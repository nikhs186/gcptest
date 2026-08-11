import {Pool, Client, QueryResult} from "pg";
import * as logger from "../logger";

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "postgres",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
  ssl: process.env.DB_SSL === "true" ? {rejectUnauthorized: false} : false,
  max: 10, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
  connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection cannot be established
});

// Handle pool errors
pool.on("error", (err) => {
  logger.error("Unexpected error on idle client", {error: err.message, stack: err.stack});
});

/**
 * Executes a SQL query against the PostgreSQL database.
 *
 * @param {string} queryText SQL query string.
 * @param {unknown[]} params Query parameters (optional).
 * @return {Promise<QueryResult>} Query result with rows and metadata.
 * @throws {Error} If the query fails or times out.
 */
export const executeQuery = async (
  queryText: string,
  params?: unknown[],
): Promise<QueryResult> => {
  const maxRetries = 10;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const startTime = Date.now();
    let client;
    try {
      if (attempt === 1) {
        logger.info("Executing database query", {
          query: queryText.substring(0, 100) + "...",
          paramCount: params?.length || 0,
        });
      } else {
        logger.info("Retrying database query", {
          attempt,
          maxRetries,
          query: queryText.substring(0, 100) + "...",
        });
      }

      // Get client from pool with timeout
      client = await Promise.race([
        pool.connect(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Database connection timeout after 10 seconds"));
          }, 10000);
        }),
      ]);

      // Execute query with timeout
      const result = await Promise.race([
        client.query(queryText, params),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Database query timeout after 45 seconds"));
          }, 45000);
        }),
      ]);

      const duration = Date.now() - startTime;
      logger.info("Database query completed", {
        duration: `${duration}ms`,
        rowCount: result.rows.length,
        ...(attempt > 1 ? {attempt} : {}),
      });

      return result;
    } catch (error) {
      const errorObj = error as {
        message?: unknown;
        code?: unknown;
        detail?: unknown;
        hint?: unknown;
        stack?: unknown;
      };
      const errorMessage = error instanceof Error ?
        error.message :
        (typeof errorObj?.message === "string" && errorObj.message.length > 0 ? errorObj.message : String(error));
      const pgCode = typeof errorObj?.code === "string" ? errorObj.code : undefined;
      const pgDetail = typeof errorObj?.detail === "string" ? errorObj.detail : undefined;
      const pgHint = typeof errorObj?.hint === "string" ? errorObj.hint : undefined;
      const errorStack = error instanceof Error ? error.stack : undefined;
      const duration = Date.now() - startTime;

      lastError = new Error(`Database query failed: ${errorMessage}`);

      try {
        logger.error("Database query failed", {
          error: errorMessage,
          code: pgCode,
          detail: pgDetail,
          hint: pgHint,
          stack: errorStack,
          duration: `${duration}ms`,
          query: queryText.substring(0, 100) + "...",
          attempt,
          maxRetries,
        });
      } catch {
        // Fallback to console if structured logger rejects payload.
        // eslint-disable-next-line no-console
        console.error("Database query failed (logger fallback)", {
          error: errorMessage,
          code: pgCode,
          detail: pgDetail,
          hint: pgHint,
          duration: `${duration}ms`,
          query: queryText.substring(0, 100) + "...",
          attempt,
          maxRetries,
        });
      }

      if (attempt < maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    } finally {
      if (client) {
        client.release();
      }
    }
  }

  throw lastError || new Error("Database query failed after all retries");
};

/**
 * Closes all database connections. Call this when shutting down the application.
 */
export const closePool = async (): Promise<void> => {
  await pool.end();
};

// --- PlanetScale (via PgBouncer-style: new Client per query) ---

function getPlanetScaleConnectionConfig(): {connectionString: string; ssl: {rejectUnauthorized: boolean}} {
  const raw = process.env.PLANETSCALE_URL;
  if (!raw) {
    throw new Error("PLANETSCALE_URL environment variable is not set");
  }
  const parsed = new URL(raw.trim().replace(/^["']|["']$/g, ""));
  parsed.searchParams.delete("sslmode");
  parsed.searchParams.delete("sslrootcert");
  return {
    connectionString: parsed.toString(),
    ssl: {rejectUnauthorized: true},
  };
}

/**
 * Executes a SQL query against PlanetScale using a fresh connection per query (PgBouncer-compatible).
 *
 * @param {string} queryText SQL query string.
 * @param {unknown[]} params Query parameters (optional).
 * @return {Promise<QueryResult>} Query result with rows and metadata.
 */
export const executePlanetScaleQuery = async (
  queryText: string,
  params?: unknown[],
): Promise<QueryResult> => {
  const startTime = Date.now();
  const client = new Client({
    ...getPlanetScaleConnectionConfig(),
    connectionTimeoutMillis: 10000,
  });

  try {
    logger.info("Executing PlanetScale query", {
      query: queryText.substring(0, 100) + "...",
      paramCount: params?.length || 0,
    });

    await Promise.race([
      client.connect(),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("PlanetScale connection timeout after 10 seconds")), 10000);
      }),
    ]);

    const result = await Promise.race([
      client.query(queryText, params),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error("PlanetScale query timeout after 45 seconds")), 45000);
      }),
    ]);

    const duration = Date.now() - startTime;
    logger.info("PlanetScale query completed", {
      duration: `${duration}ms`,
      rowCount: result.rows.length,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("PlanetScale query failed", {
      error: errorMessage,
      duration: `${duration}ms`,
      query: queryText.substring(0, 100) + "...",
    });

    throw new Error(`PlanetScale query failed: ${errorMessage}`);
  } finally {
    await client.end().catch(() => {/* ignore close errors */});
  }
};

