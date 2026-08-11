/**
 * HitMe Processing Helper
 * Processes hitme requests by matching deals with consumer profiles
 */

import {executeQuery} from "./pg.js";
import {normalizeProfileData, calculateMatchScore, ConsumerProfile} from "./matchScore.js";
import {DealWithCarDetails} from "./schema.js";
import * as logger from "../logger";

const DEALS_PER_PAGE = 10;
const HITME_API_BASE_URL = "https://xnsc-n94p-ixz6.e2.xano.io/api:GjrIIA4i";

/**
 * Builds dealership filter conditions (reusable for both deals and cars)
 * @param dealershipAlias - Alias for dealership table (e.g., "dl" or "dl_car")
 * @returns SQL condition string for dealership filters
 */
function buildDealershipFilters(dealershipAlias = "dl"): string {
  return `
    ${dealershipAlias}.xdo->>'is_approved' = 'true'
    AND (${dealershipAlias}.xdo->'subscription'->>'active')::boolean = true
  `.trim();
}

/**
 * Builds city filter JOIN condition (reusable for both deals and cars)
 * @param dealershipAlias - Alias for dealership table
 * @returns SQL JOIN condition string
 */
function buildCityJoinCondition(dealershipAlias = "dl"): string {
  return `
    INNER JOIN public.mvpw1_62 muni ON (
      CASE
        WHEN jsonb_typeof(${dealershipAlias}.xdo->'location'->'muncipality') = 'number' THEN
          (${dealershipAlias}.xdo->'location'->'muncipality')::integer
        WHEN jsonb_typeof(${dealershipAlias}.xdo->'location'->'muncipality') = 'string'
             AND ${dealershipAlias}.xdo->'location'->>'muncipality' IS NOT NULL
             AND ${dealershipAlias}.xdo->'location'->>'muncipality' != ''
             AND (${dealershipAlias}.xdo->'location'->>'muncipality') ~ '^[0-9]+$' THEN
          (${dealershipAlias}.xdo->'location'->>'muncipality')::integer
        ELSE NULL
      END
    ) = muni.id
  `.trim();
}

/**
 * Calls external API to add matched deal or car to HitMe
 * @param dealershipId - Dealership ID
 * @param hitmeId - HitMe ID
 * @param dealId - Deal ID (optional, for deals)
 * @param carId - Car ID (optional, for cars)
 * @param matchScore - Match score (0-99)
 * @param type - "deal" or "car"
 * @param hitmeScore - HitMe score (defaults to rounded matchScore for deals, 0 for cars)
 * @returns Promise<boolean> - true if successful, false otherwise
 */
async function callHitMeAPI(
  dealershipId: string,
  hitmeId: string,
  dealId: string | undefined,
  matchScore: number,
  type: "deal" | "car" = "deal",
  carId?: string,
  hitmeScore?: number,
): Promise<boolean> {
  try {
    const apiUrl = `${HITME_API_BASE_URL}/dealership/${dealershipId}/hitme/${hitmeId}/add/test`;

    const requestBody: Record<string, unknown> = {
      dealership_id: dealershipId,
      match_score: matchScore,
      hitme_score: hitmeScore !== undefined ? hitmeScore : (type === "deal" ? Math.round(matchScore) : 0),
      type: type,
    };

    // Add deal_id only for deals
    if (type === "deal" && dealId) {
      requestBody.deal_id = dealId;
    }

    // Add car_id only for cars
    if (type === "car" && carId) {
      requestBody.car_id = carId;
    }

    logger.info("Calling HitMe API", {
      url: apiUrl,
      body: requestBody,
    });

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      let responseBody: string | unknown = null;
      try {
        responseBody = await response.text();
        try {
          responseBody = JSON.parse(responseBody as string);
        } catch {
          // Keep as text if not valid JSON
        }
      } catch {
        // Ignore errors reading response body
      }

      logger.error("HitMe API call failed", {
        status: response.status,
        statusText: response.statusText,
        response: responseBody,
        dealershipId,
        hitmeId,
        dealId: type === "deal" ? dealId : undefined,
        carId: type === "car" ? carId : undefined,
        matchScore,
        type,
      });
      console.log("API call failed");
      return false;
    }

    const data = await response.json();
    logger.info("HitMe API call successful", {
      response: data,
      dealershipId,
      hitmeId,
      dealId: type === "deal" ? dealId : undefined,
      carId: type === "car" ? carId : undefined,
      matchScore,
      type,
    });
    console.log("API call successful");
    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error calling HitMe API", {
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
      dealershipId,
      hitmeId,
      dealId,
      matchScore,
    });
    console.log("API call failed");
    return false;
  }
}

/**
 * Processes a hitme request by matching deals with consumer profile
 * @param hitmeId - HitMe record ID from x1_71 table
 * @param type - "local" or "national" (default: "national")
 * @returns Promise with processing results
 */
export async function processHitMe(
  hitmeId: string,
  type: "local" | "national" = "national",
): Promise<{
  success: boolean;
  message: string;
  processedDeals: number;
  matchedDeals: number;
  totalPages: number;
  processedCars: number;
  matchedCars: number;
}> {
  try {
    logger.info("Processing HitMe request", {hitmeId});

    // Step 1: Get hitme record from x1_71
    const hitmeQuery = `
      SELECT *
      FROM public.x1_71
      WHERE id = $1::bigint
      LIMIT 1
    `;

    const hitmeResult = await executeQuery(hitmeQuery, [hitmeId]);

    if (hitmeResult.rows.length === 0) {
      logger.error("HitMe record not found", {hitmeId});
      return {
        success: false,
        message: "HitMe record not found",
        processedDeals: 0,
        matchedDeals: 0,
        totalPages: 0,
        processedCars: 0,
        matchedCars: 0,
      };
    }

    const hitmeRecord = hitmeResult.rows[0];
    const status = hitmeRecord.status as string | undefined;
    const expiryTime = hitmeRecord.expiry_time as number | undefined;
    const profileId = hitmeRecord.profile as string | undefined;

    // Debug: Log hitme record structure
    logger.info("HitMe record structure", {
      hitmeId,
      recordKeys: Object.keys(hitmeRecord),
      hasXdo: !!hitmeRecord.xdo,
      hasLocation: !!(hitmeRecord as Record<string, unknown>).location,
      xdoKeys: hitmeRecord.xdo ? Object.keys(hitmeRecord.xdo as Record<string, unknown>) : [],
      locationValue: (hitmeRecord as Record<string, unknown>).location,
    });

    // Step 2: Validate status and expiry_time
    if (status !== "active") {
      logger.warn("HitMe record status is not active", {hitmeId, status});
      return {
        success: false,
        message: `HitMe record status is not active: ${status}`,
        processedDeals: 0,
        matchedDeals: 0,
        totalPages: 0,
        processedCars: 0,
        matchedCars: 0,
      };
    }

    const now = Date.now();
    if (expiryTime === undefined || expiryTime === null || expiryTime <= now) {
      logger.warn("HitMe expired", {hitmeId, expiryTime, now});
      console.log("hitme expired");
      return {
        success: false,
        message: "HitMe expired",
        processedDeals: 0,
        matchedDeals: 0,
        totalPages: 0,
        processedCars: 0,
        matchedCars: 0,
      };
    }

    if (!profileId) {
      logger.error("Profile ID not found in HitMe record", {hitmeId});
      return {
        success: false,
        message: "Profile ID not found in HitMe record",
        processedDeals: 0,
        matchedDeals: 0,
        totalPages: 0,
        processedCars: 0,
        matchedCars: 0,
      };
    }

    // Step 3: Get profile data from x1_14
    const profileQuery = `
      SELECT *
      FROM public.x1_14
      WHERE id = $1::uuid
      LIMIT 1
    `;

    const profileResult = await executeQuery(profileQuery, [profileId]);

    if (profileResult.rows.length === 0) {
      logger.error("Profile not found", {profileId, hitmeId});
      return {
        success: false,
        message: "Profile not found",
        processedDeals: 0,
        matchedDeals: 0,
        totalPages: 0,
        processedCars: 0,
        matchedCars: 0,
      };
    }

    const profileRow = profileResult.rows[0];
    const consumerProfile: ConsumerProfile = normalizeProfileData(profileRow);

    logger.info("Profile loaded for HitMe", {hitmeId, profileId});

    // Step 3.5: Handle city filtering for local type
    let cityFilter: string | null = null;
    let useCityFilter = false;

    if (type === "local") {
      // Get city from hitme record
      // Try xdo.location.city first, then try location.city (if location is a direct column)
      const hitmeXdo = hitmeRecord.xdo as Record<string, unknown> | undefined;
      const locationDirect = (hitmeRecord as Record<string, unknown>).location as Record<string, unknown> | undefined;

      // Try xdo.location.city first
      let location = hitmeXdo?.location as Record<string, unknown> | undefined;

      // If not found in xdo, try direct location column
      if (!location && locationDirect) {
        location = locationDirect;
        logger.info("Using direct location column", {hitmeId});
      }

      if (!location) {
        logger.warn("HitMe location field not found", {
          hitmeId,
          hasXdo: !!hitmeXdo,
          hasLocationDirect: !!locationDirect,
          xdoKeys: hitmeXdo ? Object.keys(hitmeXdo) : [],
        });
      } else {
        const cityId = location.city as number | string | undefined;

        logger.info("HitMe location data", {
          hitmeId,
          locationKeys: Object.keys(location),
          cityId,
        });

        if (cityId !== undefined && cityId !== null) {
          // Get city name from mvpw1_62 (municipality table)
          const cityQuery = `
            SELECT id, xdo->>'name' as name
            FROM public.mvpw1_62
            WHERE id = $1
            LIMIT 1
          `;
          const cityResult = await executeQuery(cityQuery, [cityId]);

          if (cityResult.rows.length > 0) {
            cityFilter = cityResult.rows[0].name as string;
            logger.info("City found for HitMe", {hitmeId, cityId, cityName: cityFilter});

            // Check created_at in hitme record
            const createdAt = hitmeRecord.created_at as number | undefined;
            const now = Date.now();

            if (createdAt !== undefined && createdAt !== null) {
              const hoursSinceCreation = (now - createdAt) / (60 * 60 * 1000);
              logger.info("HitMe creation time check", {
                hitmeId,
                createdAt,
                now,
                hoursSinceCreation,
              });

              // If less than 48 hours, use city filter
              if (hoursSinceCreation < 48) {
                useCityFilter = true;
                logger.info("Using city filter (within 48 hours)", {hitmeId, cityName: cityFilter});
              } else {
                logger.info("Not using city filter (48+ hours old)", {hitmeId});
              }
            } else {
              logger.warn("HitMe created_at not found, defaulting to city filter", {hitmeId});
              useCityFilter = true;
            }
          } else {
            logger.warn("City not found in x1_62", {hitmeId, cityId});
          }
        } else {
          logger.warn("City ID not found in HitMe record location", {
            hitmeId,
            locationKeys: Object.keys(location),
          });
        }
      }
    }

    // Step 4: Pre-fetch color and body caches for match score calculation
    const colorCache = new Map<number, string | null>();
    if (consumerProfile.color && consumerProfile.color.length > 0) {
      const colorPromises = consumerProfile.color.map(async (colorItem) => {
        try {
          const colorQuery = "SELECT id, name FROM public.x1_35 WHERE id = $1 LIMIT 1";
          const colorResult = await executeQuery(colorQuery, [colorItem.color]);
          colorCache.set(colorItem.color, colorResult.rows.length > 0 ? colorResult.rows[0].name as string : null);
        } catch (error) {
          colorCache.set(colorItem.color, null);
        }
      });
      await Promise.all(colorPromises);
    }

    const bodyCache = new Map<number, string | null>();
    if (consumerProfile.body && consumerProfile.body.length > 0) {
      const bodyPromises = consumerProfile.body.map(async (bodyItem) => {
        try {
          const bodyQuery = "SELECT id, code FROM public.x1_64 WHERE id = $1 LIMIT 1";
          const bodyResult = await executeQuery(bodyQuery, [bodyItem.body]);
          bodyCache.set(bodyItem.body, bodyResult.rows.length > 0 ? bodyResult.rows[0].code as string : null);
        } catch (error) {
          bodyCache.set(bodyItem.body, null);
        }
      });
      await Promise.all(bodyPromises);
    }

    // Step 5: Get total count of matching deals for pagination
    // If type is local and useCityFilter is true, first check count with city filter
    let totalDeals = 0;
    let finalUseCityFilter = useCityFilter;

    if (type === "local" && useCityFilter && cityFilter) {
      // First, check count with city filter
      const cityCountQuery = `
        SELECT COUNT(*) as total
        FROM public.mvpw1_13 d
        INNER JOIN public.mvpw1_6 dl ON (d.xdo->>'dealership_id')::uuid = dl.id
        INNER JOIN public.mvpw1_62 muni ON (
          CASE
            WHEN jsonb_typeof(dl.xdo->'location'->'muncipality') = 'number' THEN
              (dl.xdo->'location'->'muncipality')::integer
            WHEN jsonb_typeof(dl.xdo->'location'->'muncipality') = 'string'
                 AND dl.xdo->'location'->>'muncipality' IS NOT NULL
                 AND dl.xdo->'location'->>'muncipality' != ''
                 AND (dl.xdo->'location'->>'muncipality') ~ '^[0-9]+$' THEN
              (dl.xdo->'location'->>'muncipality')::integer
            ELSE NULL
          END
        ) = muni.id
        WHERE d.xdo->>'status' = 'active'
          AND (d.xdo->>'hitme')::boolean = true
          AND d.xdo->>'sale_status' = 'available'
          AND d.xdo->>'dealership_id' IS NOT NULL
          AND ${buildDealershipFilters("dl")}
          AND muni.xdo->>'name' = $1
      `;

      const cityCountResult = await executeQuery(cityCountQuery, [cityFilter]);
      const cityDealsCount = parseInt(cityCountResult.rows[0].total as string, 10);

      logger.info("City deals count check", {hitmeId, cityName: cityFilter, cityDealsCount});

      if (cityDealsCount > 0) {
        // Use city filter
        finalUseCityFilter = true;
        totalDeals = cityDealsCount;
      } else {
        // No deals for city, get all deals
        finalUseCityFilter = false;
        logger.info("No deals found for city, using all deals", {hitmeId, cityName: cityFilter});
      }
    }

    // If not using city filter (or type is national), get count of all deals
    if (!finalUseCityFilter) {
      const countQuery = `
        SELECT COUNT(*) as total
        FROM public.mvpw1_13 d
        INNER JOIN public.mvpw1_6 dl ON (d.xdo->>'dealership_id')::uuid = dl.id
        WHERE d.xdo->>'status' = 'active'
          AND (d.xdo->>'hitme')::boolean = true
          AND d.xdo->>'sale_status' = 'available'
          AND d.xdo->>'dealership_id' IS NOT NULL
          AND ${buildDealershipFilters("dl")}
      `;

      const countResult = await executeQuery(countQuery, []);
      totalDeals = parseInt(countResult.rows[0].total as string, 10);
    }

    const totalPages = Math.ceil(totalDeals / DEALS_PER_PAGE);

    logger.info("Total deals found for HitMe", {
      hitmeId,
      type,
      totalDeals,
      totalPages,
      useCityFilter: finalUseCityFilter,
      cityName: finalUseCityFilter ? cityFilter : null,
    });

    let processedDeals = 0;
    let matchedDeals = 0;

    // Step 6: Process deals page by page
    for (let page = 1; page <= totalPages; page++) {
      const offset = (page - 1) * DEALS_PER_PAGE;

      logger.info("Processing page", {hitmeId, page, totalPages, offset});

      // Get deals for current page
      // Build query with or without city filter
      let dealsQuery: string;
      let dealsQueryParams: unknown[];

      if (finalUseCityFilter && cityFilter) {
        // Query with city filter
        dealsQuery = `
          SELECT 
            d.id,
            d.xdo as deal_data,
            dc.xdo as car_data,
            dc.id as car_id,
            make.id as make_id,
            make.xdo as make_data,
            model.id as model_id,
            model.xdo as model_data,
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', inc.id,
                    'data', inc.xdo
                  )
                )
                FROM jsonb_array_elements_text(
                  CASE 
                    WHEN d.xdo->'inclusion' IS NOT NULL 
                         AND jsonb_typeof(d.xdo->'inclusion') = 'array'
                    THEN d.xdo->'inclusion'
                    ELSE '[]'::jsonb
                  END
                ) AS elem
                LEFT JOIN public.mvpw1_37 inc ON (elem::integer) = inc.id
                WHERE inc.id IS NOT NULL
              ),
              '[]'::jsonb
            ) as inclusion_data
          FROM public.mvpw1_13 d
          LEFT JOIN public.mvpw1_10 dc ON (d.xdo->>'dealership_car_id')::uuid = dc.id
          LEFT JOIN public.mvpw1_31 make ON (dc.xdo->'make'->>'id')::integer = make.id
          LEFT JOIN public.mvpw1_33 model ON (dc.xdo->'model'->>'id')::integer = model.id
          INNER JOIN public.mvpw1_6 dl ON (d.xdo->>'dealership_id')::uuid = dl.id
          INNER JOIN public.mvpw1_62 muni ON (
            CASE
              WHEN jsonb_typeof(dl.xdo->'location'->'muncipality') = 'number' THEN
                (dl.xdo->'location'->'muncipality')::integer
              WHEN jsonb_typeof(dl.xdo->'location'->'muncipality') = 'string'
                   AND dl.xdo->'location'->>'muncipality' IS NOT NULL
                   AND dl.xdo->'location'->>'muncipality' != ''
                   AND (dl.xdo->'location'->>'muncipality') ~ '^[0-9]+$' THEN
                (dl.xdo->'location'->>'muncipality')::integer
              ELSE NULL
            END
          ) = muni.id
          WHERE d.xdo->>'status' = 'active'
            AND (d.xdo->>'hitme')::boolean = true
            AND d.xdo->>'sale_status' = 'available'
            AND d.xdo->>'dealership_id' IS NOT NULL
            AND ${buildDealershipFilters("dl")}
            AND muni.xdo->>'name' = $1
          ORDER BY d.id
          LIMIT $2 OFFSET $3
        `;
        dealsQueryParams = [cityFilter, DEALS_PER_PAGE, offset];
      } else {
        // Query without city filter
        dealsQuery = `
          SELECT 
            d.id,
            d.xdo as deal_data,
            dc.xdo as car_data,
            dc.id as car_id,
            make.id as make_id,
            make.xdo as make_data,
            model.id as model_id,
            model.xdo as model_data,
            COALESCE(
              (
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', inc.id,
                    'data', inc.xdo
                  )
                )
                FROM jsonb_array_elements_text(
                  CASE 
                    WHEN d.xdo->'inclusion' IS NOT NULL 
                         AND jsonb_typeof(d.xdo->'inclusion') = 'array'
                    THEN d.xdo->'inclusion'
                    ELSE '[]'::jsonb
                  END
                ) AS elem
                LEFT JOIN public.mvpw1_37 inc ON (elem::integer) = inc.id
                WHERE inc.id IS NOT NULL
              ),
              '[]'::jsonb
            ) as inclusion_data
          FROM public.mvpw1_13 d
          LEFT JOIN public.mvpw1_10 dc ON (d.xdo->>'dealership_car_id')::uuid = dc.id
          LEFT JOIN public.mvpw1_31 make ON (dc.xdo->'make'->>'id')::integer = make.id
          LEFT JOIN public.mvpw1_33 model ON (dc.xdo->'model'->>'id')::integer = model.id
          INNER JOIN public.mvpw1_6 dl ON (d.xdo->>'dealership_id')::uuid = dl.id
          WHERE d.xdo->>'status' = 'active'
            AND (d.xdo->>'hitme')::boolean = true
            AND d.xdo->>'sale_status' = 'available'
            AND d.xdo->>'dealership_id' IS NOT NULL
            AND ${buildDealershipFilters("dl")}
          ORDER BY d.id
          LIMIT $1 OFFSET $2
        `;
        dealsQueryParams = [DEALS_PER_PAGE, offset];
      }

      const dealsResult = await executeQuery(dealsQuery, dealsQueryParams);

      // Process each deal
      for (const row of dealsResult.rows) {
        processedDeals++;

        try {
          // Parse deal data (similar to /marketplace/deal/:dealId/score)
          const dealData = (row.deal_data as Record<string, unknown>) || {};
          const carData = (row.car_data as Record<string, unknown> | null) || null;
          const makeData = (row.make_data as Record<string, unknown> | null) || null;
          const modelData = (row.model_data as Record<string, unknown> | null) || null;
          const inclusionData = (row.inclusion_data as Array<{ id: number; data: Record<string, unknown> }> | null) || null;

          const parseNumber = (value: unknown): number | undefined => {
            if (value === null || value === undefined) return undefined;
            const num = Number(value);
            return isNaN(num) ? undefined : num;
          };

          const parseArray = (value: unknown): number[] | undefined => {
            if (!value) return undefined;
            if (Array.isArray(value)) {
              return value.map((v) => parseNumber(v)).filter((v) => v !== undefined) as number[];
            }
            return undefined;
          };

          const parseInclusionArray = (value: unknown): Array<{ id: number;[key: string]: unknown }> | undefined => {
            if (value === null || value === undefined) return undefined;
            if (Array.isArray(value)) {
              if (value.length === 0) return [];
              return value
                .map((item) => {
                  if (item && typeof item === "object" && "id" in item) {
                    const inclusionItem: { id: number;[key: string]: unknown } = {
                      id: parseNumber(item.id) || 0,
                    };
                    if ("data" in item && item.data && typeof item.data === "object") {
                      Object.assign(inclusionItem, item.data);
                    }
                    return inclusionItem;
                  }
                  return null;
                })
                .filter((item) => item !== null && item.id > 0) as Array<{ id: number;[key: string]: unknown }>;
            }
            return undefined;
          };

          const parseDate = (value: unknown): Date | undefined => {
            if (!value) return undefined;
            if (value instanceof Date) return value;
            if (typeof value === "number") {
              return new Date(value > 1000000000000 ? value : value * 1000);
            }
            if (typeof value === "string") {
              const num = Number(value);
              if (!isNaN(num)) {
                return new Date(num > 1000000000000 ? num : num * 1000);
              }
              const date = new Date(value);
              return isNaN(date.getTime()) ? undefined : date;
            }
            return undefined;
          };

          // Build deal object
          const deal: DealWithCarDetails = {
            id: row.id,
            created_at: new Date(),
            monthly_price: parseNumber(dealData.monthly_price),
            deposit: parseNumber(dealData.deposit),
            lease_period: parseNumber(dealData.lease_period),
            dealership_car_id: (dealData.dealership_car_id as string) || "",
            dealership_id: (dealData.dealership_id as string) || "",
            inclusion: parseInclusionArray(inclusionData) || parseArray(dealData.inclusion)?.map((id) => ({id})) || undefined,
            mileage: parseNumber(dealData.mileage),
            yearly_mileage: parseNumber(dealData.yearly_mileage),
            sale_status: dealData.sale_status as string | undefined,
          };

          // Parse car fields
          if (carData && typeof carData === "object" && Object.keys(carData).length > 0 && row.car_id) {
            let make: string | undefined;
            if (makeData && typeof makeData === "object" && row.make_id) {
              const makeName = makeData.name as string | undefined;
              if (makeName) {
                make = makeName;
              }
            } else {
              const carMake = carData.make as { id?: number; name?: string } | undefined;
              if (carMake) {
                if (typeof carMake === "object" && carMake.name) {
                  make = carMake.name;
                } else if (typeof carMake === "string") {
                  make = carMake;
                }
              }
            }

            let model: string | undefined;
            if (modelData && typeof modelData === "object" && row.model_id) {
              const modelName = modelData.name as string | undefined;
              if (modelName) {
                model = modelName;
              }
            } else {
              const carModel = carData.model as { id?: number; name?: string } | undefined;
              if (carModel) {
                if (typeof carModel === "object" && carModel.name) {
                  model = carModel.name;
                } else if (typeof carModel === "string") {
                  model = carModel;
                }
              }
            }

            deal.car = {
              id: row.car_id as string,
              created_at: new Date(),
              dealership_id: (carData.dealership_id as string) || deal.dealership_id,
              make: make,
              model: model,
              ...(row.make_id ? {make_id: row.make_id as number} : {}),
              ...(row.model_id ? {model_id: row.model_id as number} : {}),
              model_variant: carData.model_variant as string | undefined,
              registration_date: parseDate(carData.registration_date),
              fuel: carData.fuel as string | undefined,
              transmission: carData.transmission as string | undefined,
              color: typeof carData.color === "number" ? String(carData.color) : (carData.color as string | undefined),
              body: typeof carData.body === "number" ? String(carData.body) : (carData.body as string | undefined),
              tax_class: carData.tax_class as string | undefined,
              mileage: parseNumber(carData.mileage),
              weight: parseNumber(carData.weight),
              horsepower: parseNumber(carData.horsepower),
              batterycap: parseNumber(carData.batterycap),
              spec: carData.spec as number[] | undefined,
              wheel_drive: carData.wheel_drive as string | undefined,
            };
          }

          // Calculate match score
          const matchResult = await calculateMatchScore(deal, consumerProfile, colorCache, bodyCache);

          logger.info("Match score calculated for deal", {
            hitmeId,
            dealId: deal.id,
            score: matchResult.score,
          });

          // Step 7: If score >= 60, verify deal conditions again
          if (matchResult.score >= 60) {
            // Re-verify deal conditions
            const verifyQuery = `
              SELECT 
                (d.xdo->>'hitme')::boolean as deal_hitme,
                d.xdo->>'sale_status' as deal_sale_status
              FROM public.mvpw1_13 d
              WHERE d.id = $1::uuid
              LIMIT 1
            `;

            const verifyResult = await executeQuery(verifyQuery, [deal.id]);

            if (verifyResult.rows.length === 0) {
              logger.warn("Deal not found during verification", {hitmeId, dealId: deal.id});
              continue;
            }

            const verifyRow = verifyResult.rows[0];
            const dealHitme = verifyRow.deal_hitme as boolean | null;
            const dealSaleStatus = verifyRow.deal_sale_status as string | null;

            if (dealHitme !== true || dealSaleStatus !== "available") {
              logger.warn("Deal conditions invalid after match score calculation", {
                hitmeId,
                dealId: deal.id,
                hitme: dealHitme,
                sale_status: dealSaleStatus,
                score: matchResult.score,
              });
              console.log("invalid");
              continue;
            }

            matchedDeals++;

            // Call external API to add matched deal
            const apiSuccess = await callHitMeAPI(
              deal.dealership_id,
              hitmeId,
              deal.id,
              matchResult.score,
              "deal",
            );

            logger.info("Deal matched and verified", {
              hitmeId,
              dealId: deal.id,
              dealershipId: deal.dealership_id,
              score: matchResult.score,
              apiCallSuccess: apiSuccess,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("Error processing deal", {
            hitmeId,
            dealId: row.id,
            error: errorMessage,
          });
          // Continue to next deal
          continue;
        }
      }

      logger.info("Page processed", {hitmeId, page, totalPages, processedDeals, matchedDeals});
    }

    // Step 7: Process cars from x1_10 (mvpw1_10) with same filters
    let processedCars = 0;
    let matchedCars = 0;

    // Extract profile filter values for necessary car filters
    const profileFilters: {
      body?: string[];
      transmission?: string[];
      fuel?: string[];
      wheel_drive?: string[];
      tax_class?: string[];
      specs?: number[];
    } = {};

    // Get body values from profile
    if (consumerProfile.body && consumerProfile.body.length > 0) {
      // Need to get body codes from x1_64 table
      const bodyIds = consumerProfile.body.map((b) => b.body);
      const bodyQuery = `
        SELECT code
        FROM public.x1_64
        WHERE id = ANY($1::integer[])
      `;
      const bodyResult = await executeQuery(bodyQuery, [bodyIds]);
      profileFilters.body = bodyResult.rows.map((row) => row.code as string).filter((code) => code);
    }

    // Get transmission values from profile
    if (consumerProfile.transmission && consumerProfile.transmission.length > 0) {
      profileFilters.transmission = consumerProfile.transmission.map((t) => t.transmission);
    }

    // Get fuel values from profile
    if (consumerProfile.fuel && consumerProfile.fuel.length > 0) {
      profileFilters.fuel = consumerProfile.fuel.map((f) => f.fuel);
    }

    // Get wheel_drive values from profile (if exists)
    const profileData = consumerProfile.data as Record<string, unknown> | undefined;
    if (profileData?.wheel_drive && Array.isArray(profileData.wheel_drive)) {
      profileFilters.wheel_drive = profileData.wheel_drive
        .map((wd) => {
          if (typeof wd === "string") return wd;
          if (typeof wd === "object" && wd !== null && "wheel_drive" in wd) {
            return wd.wheel_drive as string;
          }
          return null;
        })
        .filter((wd): wd is string => wd !== null);
    }

    // Get tax_class values from profile
    if (consumerProfile.tax_class && consumerProfile.tax_class.length > 0) {
      profileFilters.tax_class = consumerProfile.tax_class.map((tc) => tc.tax_class);
    }

    // Get specs values from profile
    if (consumerProfile.specs && consumerProfile.specs.length > 0) {
      profileFilters.specs = consumerProfile.specs.map((s) => s.specs);
    }

    logger.info("Profile car filters extracted", {
      hitmeId,
      bodyFilters: profileFilters.body,
      transmissionFilters: profileFilters.transmission,
      fuelFilters: profileFilters.fuel,
      wheelDriveFilters: profileFilters.wheel_drive,
      taxClassFilters: profileFilters.tax_class,
      specsFilters: profileFilters.specs,
    });

    // Build car filter conditions
    const carFilterConditions: string[] = [];
    const carFilterParams: unknown[] = [];
    let carParamIndex = 1;

    // Add body filter if present
    if (profileFilters.body && profileFilters.body.length > 0) {
      carFilterConditions.push(`dc.xdo->>'body' = ANY($${carParamIndex}::text[])`);
      carFilterParams.push(profileFilters.body);
      carParamIndex++;
    }

    // Add transmission filter if present
    if (profileFilters.transmission && profileFilters.transmission.length > 0) {
      carFilterConditions.push(`dc.xdo->>'transmission' = ANY($${carParamIndex}::text[])`);
      carFilterParams.push(profileFilters.transmission);
      carParamIndex++;
    }

    // Add fuel filter if present
    if (profileFilters.fuel && profileFilters.fuel.length > 0) {
      carFilterConditions.push(`dc.xdo->>'fuel' = ANY($${carParamIndex}::text[])`);
      carFilterParams.push(profileFilters.fuel);
      carParamIndex++;
    }

    // Add wheel_drive filter if present
    if (profileFilters.wheel_drive && profileFilters.wheel_drive.length > 0) {
      carFilterConditions.push(`dc.xdo->>'wheel_drive' = ANY($${carParamIndex}::text[])`);
      carFilterParams.push(profileFilters.wheel_drive);
      carParamIndex++;
    }

    // Add tax_class filter if present
    if (profileFilters.tax_class && profileFilters.tax_class.length > 0) {
      carFilterConditions.push(`dc.xdo->>'tax_class' = ANY($${carParamIndex}::text[])`);
      carFilterParams.push(profileFilters.tax_class);
      carParamIndex++;
    }

    // Add specs filter if present (array overlap logic)
    if (profileFilters.specs && profileFilters.specs.length > 0) {
      carFilterConditions.push(`dc.xdo->'spec' IS NOT NULL 
            AND jsonb_typeof(dc.xdo->'spec') = 'array' 
            AND EXISTS (
                SELECT 1 
                FROM jsonb_array_elements_text(dc.xdo->'spec') AS elem
                WHERE elem::integer = ANY($${carParamIndex}::integer[])
            )`);
      carFilterParams.push(profileFilters.specs);
      carParamIndex++;
    }

    // Build car count query
    let carCountQuery: string;
    let carCountParams: unknown[] = [];

    if (finalUseCityFilter && cityFilter) {
      // Car query with city filter
      carCountQuery = `
        SELECT COUNT(*) as total
        FROM public.mvpw1_10 dc
        INNER JOIN public.mvpw1_6 dl_car ON (dc.xdo->>'dealership_id')::uuid = dl_car.id
        ${buildCityJoinCondition("dl_car")}
        WHERE (dc.xdo->>'hitme')::boolean = true
          AND dc.xdo->>'sale_status' = 'available'
          AND dc.xdo->>'dealership_id' IS NOT NULL
          AND ${buildDealershipFilters("dl_car")}
          ${carFilterConditions.length > 0 ? `AND ${carFilterConditions.join(" AND ")}` : ""}
          AND muni.xdo->>'name' = $${carParamIndex}
      `;
      carCountParams = [...carFilterParams, cityFilter];
    } else {
      // Car query without city filter
      carCountQuery = `
        SELECT COUNT(*) as total
        FROM public.mvpw1_10 dc
        INNER JOIN public.mvpw1_6 dl_car ON (dc.xdo->>'dealership_id')::uuid = dl_car.id
        WHERE (dc.xdo->>'hitme')::boolean = true
          AND dc.xdo->>'sale_status' = 'available'
          AND dc.xdo->>'dealership_id' IS NOT NULL
          AND ${buildDealershipFilters("dl_car")}
          ${carFilterConditions.length > 0 ? `AND ${carFilterConditions.join(" AND ")}` : ""}
      `;
      carCountParams = carFilterParams;
    }

    const carCountResult = await executeQuery(carCountQuery, carCountParams);
    const totalCars = parseInt(carCountResult.rows[0].total as string, 10);
    const totalCarPages = Math.ceil(totalCars / DEALS_PER_PAGE);

    logger.info("Total cars found for HitMe", {
      hitmeId,
      type,
      totalCars,
      totalCarPages,
      useCityFilter: finalUseCityFilter,
      cityName: finalUseCityFilter ? cityFilter : null,
    });

    // Process cars page by page
    for (let carPage = 1; carPage <= totalCarPages; carPage++) {
      const carOffset = (carPage - 1) * DEALS_PER_PAGE;

      logger.info("Processing car page", {hitmeId, carPage, totalCarPages, carOffset});

      // Build car query
      let carQuery: string;
      let carQueryParams: unknown[];

      if (finalUseCityFilter && cityFilter) {
        carQuery = `
          SELECT dc.id, dc.xdo as car_data
          FROM public.mvpw1_10 dc
          INNER JOIN public.mvpw1_6 dl_car ON (dc.xdo->>'dealership_id')::uuid = dl_car.id
          ${buildCityJoinCondition("dl_car")}
          WHERE (dc.xdo->>'hitme')::boolean = true
            AND dc.xdo->>'sale_status' = 'available'
            AND dc.xdo->>'dealership_id' IS NOT NULL
            AND ${buildDealershipFilters("dl_car")}
            ${carFilterConditions.length > 0 ? `AND ${carFilterConditions.join(" AND ")}` : ""}
            AND muni.xdo->>'name' = $${carParamIndex}
          ORDER BY dc.id
          LIMIT $${carParamIndex + 1} OFFSET $${carParamIndex + 2}
        `;
        carQueryParams = [...carFilterParams, cityFilter, DEALS_PER_PAGE, carOffset];
      } else {
        carQuery = `
          SELECT dc.id, dc.xdo as car_data
          FROM public.mvpw1_10 dc
          INNER JOIN public.mvpw1_6 dl_car ON (dc.xdo->>'dealership_id')::uuid = dl_car.id
          WHERE (dc.xdo->>'hitme')::boolean = true
            AND dc.xdo->>'sale_status' = 'available'
            AND dc.xdo->>'dealership_id' IS NOT NULL
            AND ${buildDealershipFilters("dl_car")}
            ${carFilterConditions.length > 0 ? `AND ${carFilterConditions.join(" AND ")}` : ""}
          ORDER BY dc.id
          LIMIT $${carParamIndex} OFFSET $${carParamIndex + 1}
        `;
        carQueryParams = [...carFilterParams, DEALS_PER_PAGE, carOffset];
      }

      const carResult = await executeQuery(carQuery, carQueryParams);

      // Process each car
      for (const carRow of carResult.rows) {
        processedCars++;

        try {
          const carId = carRow.id as string;
          const carData = (carRow.car_data as Record<string, unknown>) || {};
          const dealershipId = carData.dealership_id as string | undefined;

          if (!dealershipId) {
            logger.warn("Car missing dealership_id", {hitmeId, carId});
            continue;
          }

          // Re-verify car conditions (hitme and sale_status)
          const verifyCarQuery = `
            SELECT 
              (dc.xdo->>'hitme')::boolean as car_hitme,
              dc.xdo->>'sale_status' as car_sale_status
            FROM public.mvpw1_10 dc
            WHERE dc.id = $1::uuid
            LIMIT 1
          `;

          const verifyCarResult = await executeQuery(verifyCarQuery, [carId]);

          if (verifyCarResult.rows.length === 0) {
            logger.warn("Car not found during verification", {hitmeId, carId});
            continue;
          }

          const verifyCarRow = verifyCarResult.rows[0];
          const carHitme = verifyCarRow.car_hitme as boolean | null;
          const carSaleStatus = verifyCarRow.car_sale_status as string | null;

          if (carHitme !== true || carSaleStatus !== "available") {
            logger.warn("Car conditions invalid after verification", {
              hitmeId,
              carId,
              hitme: carHitme,
              sale_status: carSaleStatus,
            });
            console.log("invalid car");
            continue;
          }

          // Call external API to add matched car
          const apiSuccess = await callHitMeAPI(
            dealershipId,
            hitmeId,
            undefined, // No deal_id for cars
            0, // Match score is 0 for cars
            "car",
            carId,
            0, // hitme_score is 0 for cars
          );

          if (apiSuccess) {
            matchedCars++;
            logger.info("Car matched and added", {
              hitmeId,
              carId,
              dealershipId,
            });
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("Error processing car", {
            hitmeId,
            carId: carRow.id,
            error: errorMessage,
          });
          continue;
        }
      }

      logger.info("Car page processed", {hitmeId, carPage, totalCarPages, processedCars, matchedCars});
    }

    logger.info("HitMe processing completed", {
      hitmeId,
      processedDeals,
      matchedDeals,
      totalPages,
      processedCars,
      matchedCars,
    });

    return {
      success: true,
      message: "HitMe processing completed",
      processedDeals,
      matchedDeals,
      totalPages,
      processedCars,
      matchedCars,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error processing HitMe", {
      hitmeId,
      error: errorMessage,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return {
      success: false,
      message: `Error processing HitMe: ${errorMessage}`,
      processedDeals: 0,
      matchedDeals: 0,
      totalPages: 0,
      processedCars: 0,
      matchedCars: 0,
    };
  }
}
