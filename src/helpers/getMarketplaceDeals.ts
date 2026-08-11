/**
 * Marketplace Deals Handler
 * Centralized function to handle all marketplace deals fetching logic
 * Supports: no-filters (with session), filters (without session), profile filters
 */

import * as logger from "../logger";
import {Request} from "express";
import {randomUUID} from "crypto";
import {getApps, initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {executeQuery} from "./pg.js";
import {getDeals} from "./deals.js";
import {DealFilters, DealWithCarDetails} from "./schema.js";
import {createSessionWithPages, getDealIdsForPage} from "./session.js";
import {getAllFavoritedDealIds} from "./auth.js";
import {ConsumerProfile, normalizeProfileData} from "./matchScore.js";
import {fetchAndFormatDeals} from "./dealFormatters.js";

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp();
}

export interface MarketplaceDealsResponse {
  sessionId: string | null;
  items: Array<DealWithCarDetails & {favourite: boolean}>;
  curPage: number;
  nextPage: number | null;
  prevPage: number | null;
  total: number | null;
  perPage: number;
  totalPages: number | null;
}

// Re-export for convenience
export type {DealWithCarDetails} from "./schema.js";

/**
 * Main function to get marketplace deals
 * Handles both session-based (no filters) and filter-based paths
 */
export async function getMarketplaceDeals(
  req: Request,
  filters: DealFilters & {hasNoFilter: boolean},
  consumerId: string | null,
): Promise<MarketplaceDealsResponse> {
  // Check if no filters are applied (excluding pagination)
  let hasNoFilters = filters.hasNoFilter;

  // Check for favourite filters in query params (not in DealFilters)
  // Note: profileId is now handled in /matching endpoint, not here
  const favouriteValue = req.query.favourite;
  if (favouriteValue !== undefined && favouriteValue !== "" && favouriteValue !== null) {
    hasNoFilters = false;
  }

  // Check if data field contains favourite
  if (req.query.data) {
    if (typeof req.query.data === "string") {
      if (req.query.data.includes("favourite")) {
        hasNoFilters = false;
      }
    }
  }

  // If no filters, use optimized query with session-based pagination
  if (hasNoFilters) {
    const rawPerPage = filters.perPage !== undefined ? filters.perPage : 18;
    const perPage = Math.max(1, Math.floor(typeof rawPerPage === "number" ? rawPerPage : parseInt(String(rawPerPage), 10) || 18));
    const rawPage = filters.page !== undefined ? filters.page : 1;
    const page = Math.max(1, Math.floor(typeof rawPage === "number" ? rawPage : parseInt(String(rawPage), 10) || 1));

    // Extract session ID from request (query parameter or data field)
    let sessionId = req.query.sessionId as string | undefined;
    if (!sessionId && req.query.data && typeof req.query.data === "string") {
      try {
        const data = JSON.parse(req.query.data);
        sessionId = data.sessionId || data.session_id;
      } catch {
        // Ignore parse errors
      }
    }

    logger.info("No filters detected - using optimized query with session-based pagination", {
      page,
      perPage,
      sessionId: sessionId || "none",
    });

    // If session ID provided, try to read from existing session first
    if (sessionId) {
      const pageDealIds = await getDealIdsForPage(sessionId, page);

      if (pageDealIds && pageDealIds.length > 0) {
        // Use existing session - fast path
        logger.info("Using existing session for no-filter query", {
          sessionId,
          page,
          dealIdsCount: pageDealIds.length,
        });

        // Fetch and format deals using common helper function
        const dealsWithFavourites = await fetchAndFormatDeals(pageDealIds, consumerId);

        // Read totalItems from session document
        let totalItems: number | null = null;
        let totalPages: number | null = null;
        try {
          logger.info("Attempting to read totalItems from Firestore", {sessionId, page});

          const sessionDoc = await getFirestore().collection("deal_sessions").doc(sessionId).get();

          logger.info("Firestore document retrieved", {
            sessionId,
            exists: sessionDoc.exists,
            docId: sessionDoc.id,
          });

          if (sessionDoc.exists) {
            const sessionData = sessionDoc.data();

            // Log the entire document for debugging
            logger.info("Firestore session document retrieved", {
              sessionId,
              documentExists: sessionDoc.exists,
              documentId: sessionDoc.id,
              rawData: sessionData,
              sessionId_field: sessionData?.sessionId,
              createdAt: sessionData?.createdAt,
              expiresAt: sessionData?.expiresAt,
              totalItems: sessionData?.totalItems,
              totalItemsType: typeof sessionData?.totalItems,
              totalItemsValue: sessionData?.totalItems,
              allKeys: sessionData ? Object.keys(sessionData) : [],
            });

            if (sessionData && typeof sessionData.totalItems === "number") {
              totalItems = sessionData.totalItems;
              totalPages = Math.ceil(totalItems / perPage);
              logger.info("Successfully read totalItems from session document", {
                sessionId,
                totalItems,
                totalPages,
                perPage,
              });
            } else {
              logger.warn("totalItems not found in session document or is not a number", {
                sessionId,
                hasSessionData: !!sessionData,
                totalItemsType: sessionData?.totalItems ? typeof sessionData.totalItems : "undefined",
                totalItemsValue: sessionData?.totalItems,
                totalItemsRaw: sessionData?.totalItems,
              });
            }
          } else {
            logger.warn("Session document does not exist", {sessionId});
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          logger.warn("Failed to read totalItems from session document", {
            error: errorMessage,
            stack: errorStack,
            sessionId,
          });
        }

        // Check if next page exists
        let nextPage: number | null = null;
        const nextPageDealIds = await getDealIdsForPage(sessionId, page + 1);
        if (nextPageDealIds && nextPageDealIds.length > 0) {
          nextPage = page + 1;
        }

        return {
          sessionId: sessionId,
          items: dealsWithFavourites,
          curPage: page,
          nextPage: nextPage,
          prevPage: page > 1 ? page - 1 : null,
          total: totalItems,
          perPage,
          totalPages: totalPages,
        };
      } else {
        // Session not found or page not found - fall through to create new session
        logger.info("Session or page not found, creating new session", {
          sessionId,
          page,
        });
        sessionId = undefined;
      }
    }

    // No session or session not found - create new session
    try {
      // Query database for deals (initial query)
      const query = `
    SELECT 
      d.id,
      d.xdo->>'sale_status' as sale_status,
      d.xdo->>'status' as status,
      d.xdo->>'dealership_id' as dealership_id,
      d.xdo->>'dealership_car_id' as dealership_car_id
    FROM public.mvpw1_13 d
    WHERE d.xdo->>'status' = 'active' LIMIT 1000
  `;

      const result = await executeQuery(query);

      // Create and shuffle deals
      const deals = result.rows.map((row) => ({
        id: row.id as string,
        sale_status: row.sale_status as string | undefined,
        status: row.status as string | undefined,
        dealership_id: row.dealership_id as string | undefined,
        dealership_car_id: row.dealership_car_id as string | undefined,
      }));

      // Fisher-Yates shuffle
      const shuffleArray = <T>(array: T[]): void => {
        for (let i = array.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [array[i], array[j]] = [array[j], array[i]];
        }
      };

      shuffleArray(deals);

      // Separate and organize by dealership
      const soldDeals: typeof deals = [];
      const regularDeals: typeof deals = [];

      const soldByDealership = new Map<string, typeof deals>();
      const regularByDealership = new Map<string, typeof deals>();

      for (const deal of deals) {
        const dealershipId = deal.dealership_id || "unknown";

        if (deal.sale_status === "sold") {
          soldDeals.push(deal);
          if (!soldByDealership.has(dealershipId)) {
            soldByDealership.set(dealershipId, []);
          }
          const soldDealsArray = soldByDealership.get(dealershipId);
          if (soldDealsArray) {
            soldDealsArray.push(deal);
          }
        } else {
          regularDeals.push(deal);
          if (!regularByDealership.has(dealershipId)) {
            regularByDealership.set(dealershipId, []);
          }
          const regularDealsArray = regularByDealership.get(dealershipId);
          if (regularDealsArray) {
            regularDealsArray.push(deal);
          }
        }
      }

      // Shuffle within each dealership group
      soldByDealership.forEach((deals) => shuffleArray(deals));
      regularByDealership.forEach((deals) => shuffleArray(deals));

      logger.info("Deals organized", {
        totalDeals: deals.length,
        soldDeals: soldDeals.length,
        regularDeals: regularDeals.length,
        dealerships: regularByDealership.size,
      });

      const totalBatches = Math.ceil(deals.length / perPage);

      // Fetch additional sold deals if needed
      if (soldDeals.length < totalBatches) {
        const neededSoldDeals = totalBatches - soldDeals.length;
        const existingSoldIds = new Set(soldDeals.map((d) => d.id));

        try {
          const soldDealsQuery = `
        SELECT 
          d.id,
          d.xdo->>'sale_status' as sale_status,
          d.xdo->>'status' as status,
          d.xdo->>'dealership_id' as dealership_id,
          d.xdo->>'dealership_car_id' as dealership_car_id
        FROM public.mvpw1_13 d
        WHERE d.xdo->>'status' = 'active'
        AND d.xdo->>'sale_status' = 'sold'
        AND d.id != ALL($1::uuid[])
        LIMIT $2
      `;

          const soldDealsResult = await executeQuery(soldDealsQuery, [
            Array.from(existingSoldIds),
            Math.min(neededSoldDeals + 50, 100),
          ]);

          const additionalSoldDeals = soldDealsResult.rows
            .map((row) => ({
              id: row.id as string,
              sale_status: row.sale_status as string | undefined,
              status: row.status as string | undefined,
              dealership_id: row.dealership_id as string | undefined,
              dealership_car_id: row.dealership_car_id as string | undefined,
            }))
            .filter((deal) => !existingSoldIds.has(deal.id))
            .slice(0, neededSoldDeals);

          // Add to soldDeals and organize by dealership
          for (const deal of additionalSoldDeals) {
            soldDeals.push(deal);
            const dealershipId = deal.dealership_id || "unknown";
            if (!soldByDealership.has(dealershipId)) {
              soldByDealership.set(dealershipId, []);
            }
            const soldDealsArray = soldByDealership.get(dealershipId);
            if (soldDealsArray) {
              soldDealsArray.push(deal);
            }
          }

          logger.info("Fetched additional sold deals", {
            needed: neededSoldDeals,
            fetched: additionalSoldDeals.length,
            totalSoldDeals: soldDeals.length,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("Error fetching additional sold deals", {
            error: errorMessage,
          });
        }
      }

      // Setup for batch creation
      const dealershipIds = Array.from(regularByDealership.keys());
      shuffleArray(dealershipIds);

      const regularIndices = new Map<string, number>();
      const soldIndices = new Map<string, number>();
      dealershipIds.forEach((id) => {
        regularIndices.set(id, 0);
        soldIndices.set(id, 0);
      });

      let soldDealGlobalIndex = 0;
      const usedDealIds = new Set<string>();

      // Helper: Get next available deal from dealership
      const getNextDeal = (
        dealershipId: string,
        isSold: boolean,
        excludeCarIds: Set<string>
      ): typeof deals[0] | null => {
        const map = isSold ? soldByDealership : regularByDealership;
        const indices = isSold ? soldIndices : regularIndices;

        const dealershipDeals = map.get(dealershipId);
        if (!dealershipDeals) return null;

        const startIndex = indices.get(dealershipId) || 0;

        for (let i = startIndex; i < dealershipDeals.length; i++) {
          const deal = dealershipDeals[i];
          if (usedDealIds.has(deal.id)) continue;
          if (deal.dealership_car_id && excludeCarIds.has(deal.dealership_car_id)) {
            continue;
          }
          indices.set(dealershipId, i + 1);
          return deal;
        }

        indices.set(dealershipId, dealershipDeals.length);
        return null;
      };

      // Helper: Get next sold deal from any dealership
      const getAnySoldDeal = (excludeCarIds: Set<string>): typeof deals[0] | null => {
        for (let i = soldDealGlobalIndex; i < soldDeals.length; i++) {
          const deal = soldDeals[i];
          if (usedDealIds.has(deal.id)) continue;
          if (deal.dealership_car_id && excludeCarIds.has(deal.dealership_car_id)) {
            continue;
          }
          soldDealGlobalIndex = i + 1;
          return deal;
        }
        soldDealGlobalIndex = soldDeals.length;
        return null;
      };

      // Helper: Get any remaining deal
      const getAnyDeal = (excludeCarIds: Set<string>): typeof deals[0] | null => {
        for (const deal of deals) {
          if (usedDealIds.has(deal.id)) continue;
          if (deal.dealership_car_id && excludeCarIds.has(deal.dealership_car_id)) {
            continue;
          }
          return deal;
        }
        return null;
      };

      // Create batches with smart distribution
      const batches: Record<number, string[]> = {};
      let batchNumber = 1;

      while (usedDealIds.size < deals.length && batchNumber <= totalBatches * 2) {
        const batch: string[] = [];
        const usedCarIdsInBatch = new Set<string>();

        shuffleArray(dealershipIds);

        // Phase 1: Add 1 sold deal in position 0-2
        const soldPosition = Math.min(Math.floor(Math.random() * 3), Math.min(perPage - 1, 2));
        const soldDeal = getAnySoldDeal(usedCarIdsInBatch);
        if (soldDeal) {
          usedDealIds.add(soldDeal.id);
          if (soldDeal.dealership_car_id) {
            usedCarIdsInBatch.add(soldDeal.dealership_car_id);
          }
          while (batch.length <= soldPosition) {
            batch.push("");
          }
          batch[soldPosition] = soldDeal.id;
        }

        // Phase 2: Add 1 deal from each dealership (round-robin)
        for (const dealershipId of dealershipIds) {
          if (batch.filter((id) => id !== "").length >= perPage) break;
          const deal = getNextDeal(dealershipId, false, usedCarIdsInBatch);
          if (deal) {
            usedDealIds.add(deal.id);
            if (deal.dealership_car_id) {
              usedCarIdsInBatch.add(deal.dealership_car_id);
            }
            batch.push(deal.id);
          }
        }

        // Phase 3: Fill remaining slots
        while (batch.filter((id) => id !== "").length < perPage && usedDealIds.size < deals.length) {
          const deal = getAnyDeal(usedCarIdsInBatch);
          if (!deal) break;
          usedDealIds.add(deal.id);
          if (deal.dealership_car_id) {
            usedCarIdsInBatch.add(deal.dealership_car_id);
          }
          batch.push(deal.id);
        }

        const finalBatch = batch.filter((id) => id !== "");
        if (finalBatch.length > 0) {
          const uniqueIds = new Set(finalBatch);
          if (uniqueIds.size !== finalBatch.length) {
            logger.error("Duplicate IDs in batch", {
              batchNumber,
              total: finalBatch.length,
              unique: uniqueIds.size,
            });
            batches[batchNumber] = Array.from(uniqueIds);
          } else {
            batches[batchNumber] = finalBatch;
          }
          batchNumber++;
        } else {
          break;
        }
      }

      // Add any remaining deals to final batches
      const missingDealIds = deals
        .filter((deal) => !usedDealIds.has(deal.id))
        .map((deal) => deal.id);

      if (missingDealIds.length > 0) {
        const lastBatchNum = Math.max(...Object.keys(batches).map(Number));
        let currentBatchNum = lastBatchNum;
        let currentBatch = [...(batches[lastBatchNum] || [])];

        for (const dealId of missingDealIds) {
          let alreadyInBatch = false;
          for (const batchDeals of Object.values(batches)) {
            if (batchDeals.includes(dealId)) {
              alreadyInBatch = true;
              break;
            }
          }

          if (alreadyInBatch) continue;

          if (currentBatch.length >= perPage) {
            batches[currentBatchNum] = currentBatch;
            currentBatchNum++;
            currentBatch = [];
          }
          currentBatch.push(dealId);
          usedDealIds.add(dealId);
        }

        if (currentBatch.length > 0) {
          batches[currentBatchNum] = currentBatch;
        }
      }

      // Store in Firestore
      if (!sessionId) {
        sessionId = randomUUID();
      }

      await createSessionWithPages(sessionId, batches, deals.length);

      logger.info("Session created for no-filter query", {
        sessionId,
        totalBatches: Object.keys(batches).length,
      });

      // Get deal IDs for the requested page
      const pageDealIds = batches[page] || [];

      if (pageDealIds.length > 0) {
        const dealsWithFavourites = await fetchAndFormatDeals(pageDealIds, consumerId);

        return {
          sessionId: sessionId,
          items: dealsWithFavourites,
          curPage: page,
          nextPage: page < totalBatches ? page + 1 : null,
          prevPage: page > 1 ? page - 1 : null,
          total: deals.length,
          perPage,
          totalPages: totalBatches,
        };
      } else {
        return {
          sessionId: sessionId,
          items: [],
          curPage: page,
          nextPage: null,
          prevPage: page > 1 ? page - 1 : null,
          total: deals.length,
          perPage,
          totalPages: totalBatches,
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error("Error in no-filter optimized query", {
        error: errorMessage,
        stack: error instanceof Error ? error.stack : undefined,
      });
      // Fall through to filter path on error
    }
  }

  // Handle filters path (normal getDeals or profile filtering)
  // This will be handled in the next part - continuing with profile check and getDeals call

  // Check if profileId is passed
  // Note: profileId validation is now done in /matching endpoint
  // Here we just fetch the profile if profileId is provided
  const profileId = req.query.profileId as string | undefined;
  let consumerProfile: ConsumerProfile | null = null;

  if (profileId) {
    try {
      const profileQuery = `
        SELECT *
        FROM public.x1_14
        WHERE id = $1::uuid
        LIMIT 1
      `;
      const profileResult = await executeQuery(profileQuery, [profileId]);
      if (profileResult.rows.length > 0) {
        consumerProfile = normalizeProfileData(profileResult.rows[0]);
      }
    } catch (error) {
      logger.error("Error fetching profile", {error, profileId});
    }
  }

  // Check for favourite filter
  const query = req.query;
  let favouriteFilter = false;
  if (query.favourite !== undefined) {
    const favouriteValue = String(query.favourite).toLowerCase();
    favouriteFilter = favouriteValue === "true" || favouriteValue === "1";
  }
  if (!favouriteFilter && query.data) {
    try {
      let dataValue: unknown;
      if (typeof query.data === "string") {
        dataValue = JSON.parse(query.data);
      } else {
        dataValue = query.data;
      }
      if (dataValue && typeof dataValue === "object" && !Array.isArray(dataValue)) {
        const dataObj = dataValue as Record<string, unknown>;
        if (dataObj.favourite !== undefined) {
          if (typeof dataObj.favourite === "boolean") {
            favouriteFilter = dataObj.favourite;
          } else {
            const favouriteValue = String(dataObj.favourite).toLowerCase();
            favouriteFilter = favouriteValue === "true" || favouriteValue === "1";
          }
        }
      }
    } catch {
      // Ignore parsing errors
    }
  }

  // Handle favourites filter
  let favoritedDealIds: string[] | null = null;
  if (favouriteFilter) {
    if (!consumerId) {
      favoritedDealIds = [];
    } else {
      favoritedDealIds = await getAllFavoritedDealIds(consumerId);
    }
  }

  // Set timeout for database query
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => {
      reject(new Error("Database query timeout after 50 seconds"));
    }, 50000);
  });

  // If profileId provided, apply profile filters
  if (consumerProfile && profileId) {
    // Build OR conditions for profile filters (similar to existing code but simplified)
    // This is a large section - will need to extract query building logic
    // For now, return early with a note that this needs to be implemented
    throw new Error("Profile filtering path not yet fully extracted - needs completion");
  }

  // Normal flow: use getDeals helper
  const dealsPromise = getDeals(filters, consumerId, favoritedDealIds);
  const deals = await Promise.race([dealsPromise, timeoutPromise]) as Awaited<ReturnType<typeof getDeals>>;

  // Ensure all items have favourite as boolean (not undefined)
  const itemsWithFavourite = deals.items.map((deal) => ({
    ...deal,
    favourite: deal.favourite ?? false,
  }));

  return {
    ...deals,
    items: itemsWithFavourite,
    sessionId: null,
  };
}
