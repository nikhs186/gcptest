/**
 * ClickHouse Database Helper
 * Functions to execute queries against ClickHouse database
 */

import {createClient, ClickHouseClient} from "@clickhouse/client";
import * as logger from "firebase-functions/logger";

// Create ClickHouse client instance
const client: ClickHouseClient = createClient({
  url: process.env.CLICKHOUSE_HOST ?? "http://localhost:8123",
  username: process.env.CLICKHOUSE_USER ?? "default",
  password: process.env.CLICKHOUSE_PASSWORD ?? "",
});

/**
 * Execute a query against ClickHouse database
 * @param queryText - SQL query string to execute
 * @param params - Optional query parameters (for parameterized queries)
 * @returns Promise with query result
 */
export async function executeClickHouseQuery(
  queryText: string,
  params?: Record<string, unknown>,
): Promise<{rows: unknown[]; metadata: unknown}> {
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

    const data = await result.json<unknown[]>();

    logger.info("ClickHouse query executed successfully", {
      rowsReturned: data.length,
    });

    return {
      rows: data,
      metadata: result.query_id ? {query_id: result.query_id} : {},
    };
  } catch (error) {
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
export async function executeClickHouseQueryRows(
  queryText: string,
  params?: Record<string, unknown>,
): Promise<unknown[]> {
  const result = await executeClickHouseQuery(queryText, params);
  return result.rows;
}

/**
 * Execute a query and return the first row (convenience function)
 * @param queryText - SQL query string to execute
 * @param params - Optional query parameters
 * @returns Promise with first row or null
 */
export async function executeClickHouseQueryRow(
  queryText: string,
  params?: Record<string, unknown>,
): Promise<unknown | null> {
  const rows = await executeClickHouseQueryRows(queryText, params);
  return rows.length > 0 ? rows[0] : null;
}

/**
 * Close the ClickHouse client connection
 * Should be called when shutting down the application
 */
export async function closeClickHouseConnection(): Promise<void> {
  try {
    await client.close();
    logger.info("ClickHouse connection closed");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error closing ClickHouse connection", {error: errorMessage});
  }
}

// Export the client for advanced usage if needed
export {client};
