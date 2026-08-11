"use strict";
/**
 * ClickHouse Database Helper
 * Functions to execute queries against ClickHouse database
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
var _a, _b, _c;
Object.defineProperty(exports, "__esModule", { value: true });
exports.client = void 0;
exports.executeClickHouseQuery = executeClickHouseQuery;
exports.executeClickHouseQueryRows = executeClickHouseQueryRows;
exports.executeClickHouseQueryRow = executeClickHouseQueryRow;
exports.closeClickHouseConnection = closeClickHouseConnection;
const client_1 = require("@clickhouse/client");
const logger = __importStar(require("../logger"));
// Create ClickHouse client instance
const client = (0, client_1.createClient)({
    url: (_a = process.env.CLICKHOUSE_HOST) !== null && _a !== void 0 ? _a : "http://localhost:8123",
    username: (_b = process.env.CLICKHOUSE_USER) !== null && _b !== void 0 ? _b : "default",
    password: (_c = process.env.CLICKHOUSE_PASSWORD) !== null && _c !== void 0 ? _c : "",
});
exports.client = client;
/**
 * Execute a query against ClickHouse database
 * @param queryText - SQL query string to execute
 * @param params - Optional query parameters (for parameterized queries)
 * @returns Promise with query result
 */
async function executeClickHouseQuery(queryText, params) {
    try {
        logger.info("Executing ClickHouse query", {
            query: queryText.substring(0, 200), // Log first 200 chars
            hasParams: !!params,
        });
        const result = await client.query({
            query: queryText,
            query_params: params,
            format: "JSONEachRow",
        });
        const data = await result.json();
        logger.info("ClickHouse query executed successfully", {
            rowsReturned: data.length,
        });
        return {
            rows: data,
            metadata: result.query_id ? { query_id: result.query_id } : {},
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error executing ClickHouse query", {
            error: errorMessage,
            query: queryText.substring(0, 200),
        });
        throw error;
    }
}
/**
 * Execute a query and return only the rows (convenience function)
 * @param queryText - SQL query string to execute
 * @param params - Optional query parameters
 * @returns Promise with array of rows
 */
async function executeClickHouseQueryRows(queryText, params) {
    const result = await executeClickHouseQuery(queryText, params);
    return result.rows;
}
/**
 * Execute a query and return the first row (convenience function)
 * @param queryText - SQL query string to execute
 * @param params - Optional query parameters
 * @returns Promise with first row or null
 */
async function executeClickHouseQueryRow(queryText, params) {
    const rows = await executeClickHouseQueryRows(queryText, params);
    return rows.length > 0 ? rows[0] : null;
}
/**
 * Close the ClickHouse client connection
 * Should be called when shutting down the application
 */
async function closeClickHouseConnection() {
    try {
        await client.close();
        logger.info("ClickHouse connection closed");
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error closing ClickHouse connection", { error: errorMessage });
    }
}
//# sourceMappingURL=clickhouse.js.map