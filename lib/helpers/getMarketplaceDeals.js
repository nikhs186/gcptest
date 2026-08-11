"use strict";
/**
 * Marketplace Deals Handler
 * Centralized function to handle all marketplace deals fetching logic
 * Supports: no-filters (with session), filters (without session), profile filters
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMarketplaceDeals = getMarketplaceDeals;
const logger = __importStar(require("../logger"));
const crypto_1 = require("crypto");
const app_1 = require("firebase-admin/app");
const firestore_1 = require("firebase-admin/firestore");
const pg_js_1 = require("./pg.js");
const deals_js_1 = require("./deals.js");
const session_js_1 = require("./session.js");
const auth_js_1 = require("./auth.js");
const matchScore_js_1 = require("./matchScore.js");
const dealFormatters_js_1 = require("./dealFormatters.js");
// Initialize Firebase Admin if not already initialized
if (!(0, app_1.getApps)().length) {
    (0, app_1.initializeApp)();
}
/**
 * Main function to get marketplace deals
 * Handles both session-based (no filters) and filter-based paths
 */
async function getMarketplaceDeals(req, filters, consumerId) {
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
        let sessionId = req.query.sessionId;
        if (!sessionId && req.query.data && typeof req.query.data === "string") {
            try {
                const data = JSON.parse(req.query.data);
                sessionId = data.sessionId || data.session_id;
            }
            catch (_a) {
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
            const pageDealIds = await (0, session_js_1.getDealIdsForPage)(sessionId, page);
            if (pageDealIds && pageDealIds.length > 0) {
                // Use existing session - fast path
                logger.info("Using existing session for no-filter query", {
                    sessionId,
                    page,
                    dealIdsCount: pageDealIds.length,
                });
                // Fetch and format deals using common helper function
                const dealsWithFavourites = await (0, dealFormatters_js_1.fetchAndFormatDeals)(pageDealIds, consumerId);
                // Read totalItems from session document
                let totalItems = null;
                let totalPages = null;
                try {
                    logger.info("Attempting to read totalItems from Firestore", { sessionId, page });
                    const sessionDoc = await (0, firestore_1.getFirestore)().collection("deal_sessions").doc(sessionId).get();
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
                            sessionId_field: sessionData === null || sessionData === void 0 ? void 0 : sessionData.sessionId,
                            createdAt: sessionData === null || sessionData === void 0 ? void 0 : sessionData.createdAt,
                            expiresAt: sessionData === null || sessionData === void 0 ? void 0 : sessionData.expiresAt,
                            totalItems: sessionData === null || sessionData === void 0 ? void 0 : sessionData.totalItems,
                            totalItemsType: typeof (sessionData === null || sessionData === void 0 ? void 0 : sessionData.totalItems),
                            totalItemsValue: sessionData === null || sessionData === void 0 ? void 0 : sessionData.totalItems,
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
                        }
                        else {
                            logger.warn("totalItems not found in session document or is not a number", {
                                sessionId,
                                hasSessionData: !!sessionData,
                                totalItemsType: (sessionData === null || sessionData === void 0 ? void 0 : sessionData.totalItems) ? typeof sessionData.totalItems : "undefined",
                                totalItemsValue: sessionData === null || sessionData === void 0 ? void 0 : sessionData.totalItems,
                                totalItemsRaw: sessionData === null || sessionData === void 0 ? void 0 : sessionData.totalItems,
                            });
                        }
                    }
                    else {
                        logger.warn("Session document does not exist", { sessionId });
                    }
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const errorStack = error instanceof Error ? error.stack : undefined;
                    logger.warn("Failed to read totalItems from session document", {
                        error: errorMessage,
                        stack: errorStack,
                        sessionId,
                    });
                }
                // Check if next page exists
                let nextPage = null;
                const nextPageDealIds = await (0, session_js_1.getDealIdsForPage)(sessionId, page + 1);
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
            }
            else {
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
            const result = await (0, pg_js_1.executeQuery)(query);
            // Create and shuffle deals
            const deals = result.rows.map((row) => ({
                id: row.id,
                sale_status: row.sale_status,
                status: row.status,
                dealership_id: row.dealership_id,
                dealership_car_id: row.dealership_car_id,
            }));
            // Fisher-Yates shuffle
            const shuffleArray = (array) => {
                for (let i = array.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [array[i], array[j]] = [array[j], array[i]];
                }
            };
            shuffleArray(deals);
            // Separate and organize by dealership
            const soldDeals = [];
            const regularDeals = [];
            const soldByDealership = new Map();
            const regularByDealership = new Map();
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
                }
                else {
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
                    const soldDealsResult = await (0, pg_js_1.executeQuery)(soldDealsQuery, [
                        Array.from(existingSoldIds),
                        Math.min(neededSoldDeals + 50, 100),
                    ]);
                    const additionalSoldDeals = soldDealsResult.rows
                        .map((row) => ({
                        id: row.id,
                        sale_status: row.sale_status,
                        status: row.status,
                        dealership_id: row.dealership_id,
                        dealership_car_id: row.dealership_car_id,
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
                }
                catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    logger.error("Error fetching additional sold deals", {
                        error: errorMessage,
                    });
                }
            }
            // Setup for batch creation
            const dealershipIds = Array.from(regularByDealership.keys());
            shuffleArray(dealershipIds);
            const regularIndices = new Map();
            const soldIndices = new Map();
            dealershipIds.forEach((id) => {
                regularIndices.set(id, 0);
                soldIndices.set(id, 0);
            });
            let soldDealGlobalIndex = 0;
            const usedDealIds = new Set();
            // Helper: Get next available deal from dealership
            const getNextDeal = (dealershipId, isSold, excludeCarIds) => {
                const map = isSold ? soldByDealership : regularByDealership;
                const indices = isSold ? soldIndices : regularIndices;
                const dealershipDeals = map.get(dealershipId);
                if (!dealershipDeals)
                    return null;
                const startIndex = indices.get(dealershipId) || 0;
                for (let i = startIndex; i < dealershipDeals.length; i++) {
                    const deal = dealershipDeals[i];
                    if (usedDealIds.has(deal.id))
                        continue;
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
            const getAnySoldDeal = (excludeCarIds) => {
                for (let i = soldDealGlobalIndex; i < soldDeals.length; i++) {
                    const deal = soldDeals[i];
                    if (usedDealIds.has(deal.id))
                        continue;
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
            const getAnyDeal = (excludeCarIds) => {
                for (const deal of deals) {
                    if (usedDealIds.has(deal.id))
                        continue;
                    if (deal.dealership_car_id && excludeCarIds.has(deal.dealership_car_id)) {
                        continue;
                    }
                    return deal;
                }
                return null;
            };
            // Create batches with smart distribution
            const batches = {};
            let batchNumber = 1;
            while (usedDealIds.size < deals.length && batchNumber <= totalBatches * 2) {
                const batch = [];
                const usedCarIdsInBatch = new Set();
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
                    if (batch.filter((id) => id !== "").length >= perPage)
                        break;
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
                    if (!deal)
                        break;
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
                    }
                    else {
                        batches[batchNumber] = finalBatch;
                    }
                    batchNumber++;
                }
                else {
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
                    if (alreadyInBatch)
                        continue;
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
                sessionId = (0, crypto_1.randomUUID)();
            }
            await (0, session_js_1.createSessionWithPages)(sessionId, batches, deals.length);
            logger.info("Session created for no-filter query", {
                sessionId,
                totalBatches: Object.keys(batches).length,
            });
            // Get deal IDs for the requested page
            const pageDealIds = batches[page] || [];
            if (pageDealIds.length > 0) {
                const dealsWithFavourites = await (0, dealFormatters_js_1.fetchAndFormatDeals)(pageDealIds, consumerId);
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
            }
            else {
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
        }
        catch (error) {
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
    const profileId = req.query.profileId;
    let consumerProfile = null;
    if (profileId) {
        try {
            const profileQuery = `
        SELECT *
        FROM public.x1_14
        WHERE id = $1::uuid
        LIMIT 1
      `;
            const profileResult = await (0, pg_js_1.executeQuery)(profileQuery, [profileId]);
            if (profileResult.rows.length > 0) {
                consumerProfile = (0, matchScore_js_1.normalizeProfileData)(profileResult.rows[0]);
            }
        }
        catch (error) {
            logger.error("Error fetching profile", { error, profileId });
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
            let dataValue;
            if (typeof query.data === "string") {
                dataValue = JSON.parse(query.data);
            }
            else {
                dataValue = query.data;
            }
            if (dataValue && typeof dataValue === "object" && !Array.isArray(dataValue)) {
                const dataObj = dataValue;
                if (dataObj.favourite !== undefined) {
                    if (typeof dataObj.favourite === "boolean") {
                        favouriteFilter = dataObj.favourite;
                    }
                    else {
                        const favouriteValue = String(dataObj.favourite).toLowerCase();
                        favouriteFilter = favouriteValue === "true" || favouriteValue === "1";
                    }
                }
            }
        }
        catch (_b) {
            // Ignore parsing errors
        }
    }
    // Handle favourites filter
    let favoritedDealIds = null;
    if (favouriteFilter) {
        if (!consumerId) {
            favoritedDealIds = [];
        }
        else {
            favoritedDealIds = await (0, auth_js_1.getAllFavoritedDealIds)(consumerId);
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
    const dealsPromise = (0, deals_js_1.getDeals)(filters, consumerId, favoritedDealIds);
    const deals = await Promise.race([dealsPromise, timeoutPromise]);
    // Ensure all items have favourite as boolean (not undefined)
    const itemsWithFavourite = deals.items.map((deal) => {
        var _a;
        return (Object.assign(Object.assign({}, deal), { favourite: (_a = deal.favourite) !== null && _a !== void 0 ? _a : false }));
    });
    return Object.assign(Object.assign({}, deals), { items: itemsWithFavourite, sessionId: null });
}
//# sourceMappingURL=getMarketplaceDeals.js.map