"use strict";
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
exports.executePlanetScaleQuery = exports.closePool = exports.executeQuery = void 0;
const pg_1 = require("pg");
const logger = __importStar(require("../logger"));
const pool = new pg_1.Pool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 5432,
    database: process.env.DB_NAME || "postgres",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD || "",
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 10, // Maximum number of clients in the pool
    idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
    connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection cannot be established
});
// Handle pool errors
pool.on("error", (err) => {
    logger.error("Unexpected error on idle client", { error: err.message, stack: err.stack });
});
/**
 * Executes a SQL query against the PostgreSQL database.
 *
 * @param {string} queryText SQL query string.
 * @param {unknown[]} params Query parameters (optional).
 * @return {Promise<QueryResult>} Query result with rows and metadata.
 * @throws {Error} If the query fails or times out.
 */
const executeQuery = async (queryText, params) => {
    const maxRetries = 10;
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const startTime = Date.now();
        let client;
        try {
            if (attempt === 1) {
                logger.info("Executing database query", {
                    query: queryText.substring(0, 100) + "...",
                    paramCount: (params === null || params === void 0 ? void 0 : params.length) || 0,
                });
            }
            else {
                logger.info("Retrying database query", {
                    attempt,
                    maxRetries,
                    query: queryText.substring(0, 100) + "...",
                });
            }
            // Get client from pool with timeout
            client = await Promise.race([
                pool.connect(),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error("Database connection timeout after 10 seconds"));
                    }, 10000);
                }),
            ]);
            // Execute query with timeout
            const result = await Promise.race([
                client.query(queryText, params),
                new Promise((_, reject) => {
                    setTimeout(() => {
                        reject(new Error("Database query timeout after 45 seconds"));
                    }, 45000);
                }),
            ]);
            const duration = Date.now() - startTime;
            logger.info("Database query completed", Object.assign({ duration: `${duration}ms`, rowCount: result.rows.length }, (attempt > 1 ? { attempt } : {})));
            return result;
        }
        catch (error) {
            const errorObj = error;
            const errorMessage = error instanceof Error ?
                error.message :
                (typeof (errorObj === null || errorObj === void 0 ? void 0 : errorObj.message) === "string" && errorObj.message.length > 0 ? errorObj.message : String(error));
            const pgCode = typeof (errorObj === null || errorObj === void 0 ? void 0 : errorObj.code) === "string" ? errorObj.code : undefined;
            const pgDetail = typeof (errorObj === null || errorObj === void 0 ? void 0 : errorObj.detail) === "string" ? errorObj.detail : undefined;
            const pgHint = typeof (errorObj === null || errorObj === void 0 ? void 0 : errorObj.hint) === "string" ? errorObj.hint : undefined;
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
            }
            catch (_a) {
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
        }
        finally {
            if (client) {
                client.release();
            }
        }
    }
    throw lastError || new Error("Database query failed after all retries");
};
exports.executeQuery = executeQuery;
/**
 * Closes all database connections. Call this when shutting down the application.
 */
const closePool = async () => {
    await pool.end();
};
exports.closePool = closePool;
// --- PlanetScale (via PgBouncer-style: new Client per query) ---
function getPlanetScaleConnectionConfig() {
    const raw = process.env.PLANETSCALE_URL;
    if (!raw) {
        throw new Error("PLANETSCALE_URL environment variable is not set");
    }
    const parsed = new URL(raw.trim().replace(/^["']|["']$/g, ""));
    parsed.searchParams.delete("sslmode");
    parsed.searchParams.delete("sslrootcert");
    return {
        connectionString: parsed.toString(),
        ssl: { rejectUnauthorized: true },
    };
}
/**
 * Executes a SQL query against PlanetScale using a fresh connection per query (PgBouncer-compatible).
 *
 * @param {string} queryText SQL query string.
 * @param {unknown[]} params Query parameters (optional).
 * @return {Promise<QueryResult>} Query result with rows and metadata.
 */
const executePlanetScaleQuery = async (queryText, params) => {
    const startTime = Date.now();
    const client = new pg_1.Client(Object.assign(Object.assign({}, getPlanetScaleConnectionConfig()), { connectionTimeoutMillis: 10000 }));
    try {
        logger.info("Executing PlanetScale query", {
            query: queryText.substring(0, 100) + "...",
            paramCount: (params === null || params === void 0 ? void 0 : params.length) || 0,
        });
        await Promise.race([
            client.connect(),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error("PlanetScale connection timeout after 10 seconds")), 10000);
            }),
        ]);
        const result = await Promise.race([
            client.query(queryText, params),
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error("PlanetScale query timeout after 45 seconds")), 45000);
            }),
        ]);
        const duration = Date.now() - startTime;
        logger.info("PlanetScale query completed", {
            duration: `${duration}ms`,
            rowCount: result.rows.length,
        });
        return result;
    }
    catch (error) {
        const duration = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("PlanetScale query failed", {
            error: errorMessage,
            duration: `${duration}ms`,
            query: queryText.substring(0, 100) + "...",
        });
        throw new Error(`PlanetScale query failed: ${errorMessage}`);
    }
    finally {
        await client.end().catch(() => { });
    }
};
exports.executePlanetScaleQuery = executePlanetScaleQuery;
//# sourceMappingURL=pg.js.map