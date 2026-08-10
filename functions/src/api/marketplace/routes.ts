import {Router, Request, Response} from "express";
import * as logger from "firebase-functions/logger";
import {parseDealFilters} from "../../helpers/queryParser";
import {executeQuery, executePlanetScaleQuery} from "../../helpers/pg";
import {downloadImagesAsZip} from "../../helpers/zip";
import {
  extractBearerToken,
  validateToken,
  getConsumerIdByEmail,
} from "../../helpers/auth";
import {calculateMatchScore, ConsumerProfile, normalizeProfileData} from "../../helpers/matchScore";
import {DealWithCarDetails} from "../../helpers/schema";
import {getMarketplaceDeals} from "../../helpers/getMarketplaceDeals";
import {getMatchingDeals} from "../../helpers/matching";

const router = Router();

/**
 * GET /marketplace/deals
 * Get deals with optional filters and pagination
 */
router.get("/marketplace/deals", async (req: Request, res: Response) => {
  try {
    logger.info("Deals request received", {
      query: req.query,
      method: req.method,
      path: req.path,
    });

    // Parse and validate query parameters
    const filters = parseDealFilters(req);

    logger.info("Parsed filters", {
      filters,
      filtersPage: filters.page,
      filtersPerPage: filters.perPage,
      queryPage: req.query.page,
      queryPerPage: req.query.perPage,
    });

    // Handle Bearer token authorization (needed for favorites check)
    let consumerId: string | null = null;
    const token = extractBearerToken(req);

    if (token) {
      logger.info("Authorization token is valid");

      // Validate token with Xano API
      const userData = await validateToken(token);
      if (userData && userData.email) {
        logger.info("Token validated successfully", {email: userData.email});

        // Search for consumer in x1_2 table by email
        consumerId = await getConsumerIdByEmail(userData.email);
        if (consumerId) {
          logger.info("Consumer record found", {email: userData.email, consumerId});
        } else {
          logger.info("Consumer record not found", {email: userData.email});
        }
      } else {
        logger.warn("Token validation failed or no email returned");
      }
    }

    // Use centralized getMarketplaceDeals function
    const result = await getMarketplaceDeals(req, filters, consumerId);
    return res.status(200).json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error("Error fetching deals", {
      error: errorMessage,
      stack: errorStack,
      query: req.query,
    });

    // Determine appropriate status code
    let statusCode = 500;
    if (errorMessage.includes("timeout")) {
      statusCode = 504; // Gateway Timeout
    } else if (errorMessage.includes("connection") || errorMessage.includes("database")) {
      statusCode = 503; // Service Unavailable
    }

    return res.status(statusCode).json({
      error: "Failed to fetch deals",
      message: errorMessage,
    });
  }
});

/**
 * GET /matching
 * Get deals with profile matching (requires profileId)
 * Same input and output format as /marketplace/deals
 */
router.get("/matching", async (req: Request, res: Response) => {
  try {
    logger.info("Matching request received", {
      query: req.query,
      method: req.method,
      path: req.path,
    });

    // Validate profileId is provided and in UUID format
    const rawProfileId = req.query.profileId;
    const profileId = Array.isArray(rawProfileId) ? rawProfileId[0] : rawProfileId;
    if (!profileId || typeof profileId !== "string") {
      return res.status(400).json({
        error: "profileId is required",
        message: "Please provide a 'profileId' query parameter",
      });
    }
    const normalizedProfileId = profileId.trim();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(normalizedProfileId)) {
      return res.status(400).json({
        error: "Invalid profileId format",
        message: "profileId must be a valid UUID",
        profileId: normalizedProfileId,
      });
    }

    // Validate profileId exists in database
    const profileQuery = `
      SELECT id
      FROM public.x1_14
      WHERE id = $1::uuid
      LIMIT 1
    `;
    const profileResult = await executeQuery(profileQuery, [normalizedProfileId]);

    if (profileResult.rows.length === 0) {
      return res.status(404).json({
        error: "Profile not found",
        message: `Profile with id '${normalizedProfileId}' does not exist`,
        profileId: normalizedProfileId,
      });
    }

    logger.info("Profile validated", {profileId: normalizedProfileId});

    // Parse and validate query parameters
    const filters = parseDealFilters(req);

    logger.info("Parsed filters", {
      filters,
      filtersPage: filters.page,
      filtersPerPage: filters.perPage,
      queryPage: req.query.page,
      queryPerPage: req.query.perPage,
    });

    // Handle Bearer token authorization (needed for favorites check)
    let consumerId: string | null = null;
    const token = extractBearerToken(req);

    if (token) {
      logger.info("Authorization token is valid");

      // Validate token with Xano API
      const userData = await validateToken(token);
      if (userData && userData.email) {
        logger.info("Token validated successfully", {email: userData.email});

        // Search for consumer in x1_2 table by email
        consumerId = await getConsumerIdByEmail(userData.email);
        if (consumerId) {
          logger.info("Consumer record found", {email: userData.email, consumerId});
        } else {
          logger.info("Consumer record not found", {email: userData.email});
        }
      } else {
        logger.warn("Token validation failed or no email returned");
      }
    }

    // Use getMatchingDeals function to calculate match scores and sort by score
    const result = await getMatchingDeals(req, filters, consumerId, normalizedProfileId);
    return res.status(200).json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error("Error fetching matching deals", {
      error: errorMessage,
      stack: errorStack,
      query: req.query,
    });

    // Determine appropriate status code
    let statusCode = 500;
    if (errorMessage.includes("Invalid session")) {
      statusCode = 400; // Bad Request for invalid session
    } else if (errorMessage.includes("timeout")) {
      statusCode = 504; // Gateway Timeout
    } else if (errorMessage.includes("connection") || errorMessage.includes("database")) {
      statusCode = 503; // Service Unavailable
    }

    return res.status(statusCode).json({
      error: "Failed to fetch matching deals",
      message: errorMessage,
    });
  }
});

/**
 * GET /table/columns/:tableName
 * Get all columns for a specific table (checks all schemas)
 */
router.get("/table/columns/:tableName", async (req: Request, res: Response) => {
  try {
    const tableName = req.params.tableName;
    logger.info("Table columns request received", {tableName});

    // Query to find the table in any schema and get its columns
    const query = `
            SELECT 
                table_schema,
                column_name,
                data_type,
                is_nullable,
                column_default
            FROM information_schema.columns
            WHERE table_name = $1
            AND table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND table_schema NOT LIKE 'pg_%'
            ORDER BY table_schema, ordinal_position;
        `;

    const result = await executeQuery(query, [tableName]);
    const columns = result.rows.map((row) => ({
      schema: row.table_schema,
      name: row.column_name,
      type: row.data_type,
      nullable: row.is_nullable === "YES",
      default: row.column_default,
    }));

    // Group by schema
    const schemaColumns: Record<string, unknown[]> = {};
    result.rows.forEach((row) => {
      const schema = row.table_schema;
      if (!schemaColumns[schema]) {
        schemaColumns[schema] = [];
      }
      schemaColumns[schema].push({
        name: row.column_name,
        type: row.data_type,
        nullable: row.is_nullable === "YES",
        default: row.column_default,
      });
    });

    res.status(200).json({
      table: tableName,
      columns: columns,
      columnsBySchema: schemaColumns,
      count: columns.length,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error fetching table columns", {error: errorMessage});

    res.status(500).json({
      error: "Failed to fetch table columns",
      message: errorMessage,
    });
  }
});

/**
 * GET /table
 * Get all schemas and their tables in the database
 */
router.get("/table", async (req: Request, res: Response) => {
  try {
    logger.info("Schemas and tables request received");

    // Query to get all schemas (excluding system schemas)
    const schemaQuery = `
            SELECT schema_name
            FROM information_schema.schemata
            WHERE schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND schema_name NOT LIKE 'pg_%'
            ORDER BY schema_name;
        `;

    const schemaResult = await executeQuery(schemaQuery);
    const schemas = schemaResult.rows.map((row) => row.schema_name);

    // Query to get all tables grouped by schema
    const tablesQuery = `
            SELECT 
                table_schema,
                table_name,
                table_type
            FROM information_schema.tables
            WHERE table_schema NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
            AND table_schema NOT LIKE 'pg_%'
            AND table_type = 'BASE TABLE'
            ORDER BY table_schema, table_name;
        `;

    const tablesResult = await executeQuery(tablesQuery);

    // Group tables by schema
    const schemaTables: Record<string, string[]> = {};
    let totalTables = 0;

    schemas.forEach((schema) => {
      schemaTables[schema] = [];
    });

    tablesResult.rows.forEach((row) => {
      const schema = row.table_schema;
      const tableName = row.table_name;
      if (schemaTables[schema]) {
        schemaTables[schema].push(tableName);
        totalTables++;
      }
    });

    // Format response with schema and tables structure
    const response = {
      schemas: schemas.map((schema) => ({
        name: schema,
        tables: schemaTables[schema] || [],
        tableCount: schemaTables[schema]?.length || 0,
      })),
      totalSchemas: schemas.length,
      totalTables: totalTables,
    };

    logger.info("Schemas and tables fetched successfully", {
      schemaCount: schemas.length,
      totalTables: totalTables,
    });

    res.status(200).json(response);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    logger.error("Error fetching schemas and tables", {
      error: errorMessage,
      stack: errorStack,
    });

    res.status(500).json({
      error: "Failed to fetch schemas and tables",
      message: errorMessage,
    });
  }
});

/**
 * GET /marketplace/deal/:dealId/score
 * Calculate match score for a specific deal with a profile
 * Query params: profileId (required)
 */
router.get("/marketplace/deal/:dealId/score", async (req: Request, res: Response) => {
  try {
    const dealId = req.params.dealId;
    const profileId = req.query.profileId as string | undefined;

    if (!profileId) {
      return res.status(400).json({
        error: "profileId query parameter is required",
      });
    }

    logger.info("Match score request", {dealId, profileId});

    // Fetch profile from x1_14 table
    const profileQuery = `
      SELECT *
      FROM public.x1_14
      WHERE id = $1::uuid
      LIMIT 1
    `;

    const profileResult = await executeQuery(profileQuery, [profileId]);

    if (profileResult.rows.length === 0) {
      return res.status(404).json({
        error: "Profile not found",
        profileId,
      });
    }

    // Map database row to ConsumerProfile interface using normalization
    const profileRow = profileResult.rows[0];
    const consumerProfile: ConsumerProfile = normalizeProfileData(profileRow);

    // Query deal data
    const dealQuery = `
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
      WHERE d.id = $1::uuid
      LIMIT 1
    `;

    const dealResult = await executeQuery(dealQuery, [dealId]);

    if (dealResult.rows.length === 0) {
      return res.status(404).json({
        error: "Deal not found",
        dealId,
      });
    }

    const row = dealResult.rows[0];
    const dealData = (row.deal_data as Record<string, unknown>) || {};
    const carData = (row.car_data as Record<string, unknown> | null) || null;
    const makeData = (row.make_data as Record<string, unknown> | null) || null;
    const modelData = (row.model_data as Record<string, unknown> | null) || null;
    const inclusionData = (row.inclusion_data as Array<{ id: number; data: Record<string, unknown> }> | null) || null;

    // Parse deal fields (reuse logic from getDeals)
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
        // Store make_id and model_id for match score calculation
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

    // Fetch color names from x1_35 for profile colors
    const profileColors: Array<{ id: number; name: string; priority: number }> = [];
    if (consumerProfile.color && consumerProfile.color.length > 0) {
      const colorPromises = consumerProfile.color.map(async (colorItem) => {
        try {
          const colorQuery = `
            SELECT id, name
            FROM public.x1_35
            WHERE id = $1
            LIMIT 1
          `;
          const colorResult = await executeQuery(colorQuery, [colorItem.color]);
          if (colorResult.rows.length > 0) {
            return {
              id: colorItem.color,
              name: colorResult.rows[0].name as string,
              priority: colorItem.priority,
            };
          }
          return {
            id: colorItem.color,
            name: `Unknown (ID: ${colorItem.color})`,
            priority: colorItem.priority,
          };
        } catch (error) {
          return {
            id: colorItem.color,
            name: `Error fetching (ID: ${colorItem.color})`,
            priority: colorItem.priority,
          };
        }
      });
      const resolvedColors = await Promise.all(colorPromises);
      profileColors.push(...resolvedColors);
    }

    // Fetch body codes from x1_64 for profile bodies
    const profileBodies: Array<{ id: number; code: string; priority: number }> = [];
    if (consumerProfile.body && consumerProfile.body.length > 0) {
      const bodyPromises = consumerProfile.body.map(async (bodyItem) => {
        try {
          const bodyQuery = `
            SELECT id, code
            FROM public.x1_64
            WHERE id = $1
            LIMIT 1
          `;
          const bodyResult = await executeQuery(bodyQuery, [bodyItem.body]);
          if (bodyResult.rows.length > 0) {
            return {
              id: bodyItem.body,
              code: bodyResult.rows[0].code as string,
              priority: bodyItem.priority,
            };
          }
          return {
            id: bodyItem.body,
            code: `Unknown (ID: ${bodyItem.body})`,
            priority: bodyItem.priority,
          };
        } catch (error) {
          return {
            id: bodyItem.body,
            code: `Error fetching (ID: ${bodyItem.body})`,
            priority: bodyItem.priority,
          };
        }
      });
      const resolvedBodies = await Promise.all(bodyPromises);
      profileBodies.push(...resolvedBodies);
    }

    // Log profile data for debugging
    if (consumerProfile.id === "76b40ea2-b479-4855-bafd-9bd857a16a67") {
      logger.info("Profile data for score calculation (deal/score endpoint)", {
        profileId: consumerProfile.id,
        monthly_price: JSON.stringify(consumerProfile.monthly_price),
        deposit: JSON.stringify(consumerProfile.deposit),
        mileage: JSON.stringify(consumerProfile.mileage),
        lease_period: JSON.stringify(consumerProfile.lease_period),
        fuel: JSON.stringify(consumerProfile.fuel),
        specs: JSON.stringify(consumerProfile.specs),
        inclusion: JSON.stringify(consumerProfile.inclusion),
        color: JSON.stringify(consumerProfile.color),
        body: JSON.stringify(consumerProfile.body),
      });
    }

    // Log deal data for debugging
    if (deal.id === "6a05ea3f-9fe9-4140-938a-e8a6ba5368c6") {
      logger.info("Deal data for score calculation (deal/score endpoint)", {
        dealId: deal.id,
        monthly_price: deal.monthly_price,
        deposit: deal.deposit,
        mileage: deal.mileage,
        lease_period: deal.lease_period,
        car_fuel: deal.car?.fuel,
        car_transmission: deal.car?.transmission,
        car_color: deal.car?.color,
        car_body: deal.car?.body,
        car_tax_class: deal.car?.tax_class,
        car_mileage: deal.car?.mileage,
        car_spec: deal.car?.spec,
        inclusion: deal.inclusion?.map((inc) => inc.id),
      });
    }

    // Calculate match score
    const matchResult = await calculateMatchScore(deal, consumerProfile);

    logger.info("Match score generated for deal", {
      profileId: consumerProfile.id,
      dealId: deal.id,
      score: matchResult.score,
    });
    logger.info(`Match score: profileId=${consumerProfile.id}, dealId=${deal.id}, score=${matchResult.score}`);

    return res.status(200).json({
      dealId: deal.id,
      profileId: consumerProfile.id,
      matchScore: matchResult.score,
      breakdown: matchResult.breakdown,
      missingData: matchResult.missingData,
      color: {
        profile: profileColors,
        deal: deal.car?.color || null,
      },
      body: {
        profile: profileBodies,
        deal: deal.car?.body || null,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error calculating match score", {
      error: errorMessage,
      dealId: req.params.dealId,
      profileId: req.query.profileId,
    });

    return res.status(500).json({
      error: "Failed to calculate match score",
      message: errorMessage,
    });
  }
});


router.post("/car/images/download", async (req: Request, res: Response) => {
  try {
    const {urls} = req.body;
    const rawData = await downloadImagesAsZip(urls);

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=images.zip"
    );
    res.setHeader("Content-Length", rawData.length);
    res.send(rawData);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error downloading images", {error: errorMessage});
    res.status(500).json({error: "Failed to download images", message: errorMessage});
  }
});


router.post("/query", async (req: Request, res: Response) => {
  try {
    const {query} = req.body;
    if (!query) {
      return res.status(400).json({
        error: "Query is required",
        message: "Please provide a 'query' in the request body",
      });
    }

    const queryString = Array.isArray(query) ? query[0] : query;
    logger.info("Executing query", {query: queryString});

    // Retry logic: up to 10 attempts
    const maxRetries = 10;
    let lastError: Error | null = null;
    let result;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        result = await executeQuery(queryString);
        if (attempt > 1) {
          logger.info("Query succeeded after retry", {attempt, totalAttempts: attempt});
        }
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn("Query execution failed, retrying", {
          attempt,
          maxRetries,
          error: lastError.message,
        });

        // If this is not the last attempt, wait a bit before retrying
        if (attempt < maxRetries) {
          // Exponential backoff: wait 100ms * attempt number
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    // If we exhausted all retries, throw the last error
    if (!result) {
      throw lastError || new Error("Query execution failed after all retries");
    }

    return res.send(result.rows);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error executing query after retries", {error: errorMessage});
    return res.status(500).json({
      error: "Error executing query",
      message: errorMessage,
    });
  }
});
router.post("/planetscale/query", async (req: Request, res: Response) => {
  try {
    const {query, params} = req.body as {query?: string; params?: unknown[]};

    if (!query || typeof query !== "string" || query.trim().length === 0) {
      return res.status(400).json({error: "Missing or invalid 'query' in request body"});
    }

    const result = await executePlanetScaleQuery(query, params);

    return res.status(200).json({
      rows: result.rows,
      rowCount: result.rowCount,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("PlanetScale query endpoint error", {error: errorMessage});
    return res.status(500).json({
      error: "Query execution failed",
      message: errorMessage,
    });
  }
});

export default router;

