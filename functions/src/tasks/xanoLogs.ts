import * as logger from "firebase-functions/logger";
import {executePlanetScaleQuery} from "../helpers/pg";

const SLACK_URL = "https://hooks.slack.com/services/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";

interface XanoRequestItem {
  id: number;
  uri: string;
  status: number;
  input: unknown;
  output: unknown;
  api_id: number;
  branch: string;
  query_id: number;
}

interface XanoPageResponse {
  items: XanoRequestItem[];
  nextPage: number | null;
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;

function sanitizeJson(obj: unknown): string {
  const parsed = typeof obj === "string" ? JSON.parse(obj) : obj;
  return JSON.stringify(parsed)
    .replace(CONTROL_CHARS_RE, "")
    .replace(/'/g, "''");
}

function escapeString(str: string): string {
  return str
    .replace(CONTROL_CHARS_RE, "")
    .replace(/'/g, "''");
}

async function runPlanetScaleQuery(query: string, params?: unknown[]): Promise<{rows: Record<string, unknown>[]; rowCount: number}> {
  const result = await executePlanetScaleQuery(query, params);
  return {rows: result.rows, rowCount: result.rowCount ?? 0};
}

async function sendSlackMessage(text: string): Promise<void> {
  try {
    await fetch(SLACK_URL, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({text}),
    });
  } catch (error) {
    logger.error("Failed to send Slack message", {error: error instanceof Error ? error.message : String(error)});
  }
}

export async function storeXanoLogsTask(): Promise<void> {
  const baseUrl = process.env.XANO_METADATA_BASE_URL;
  const workspaceId = process.env.XANO_WORKSPACE_ID;
  const apiToken = process.env.XANO_METADATA_API_TOKEN;

  if (!baseUrl || !workspaceId || !apiToken) {
    logger.error("Missing Xano environment variables");
    return;
  }

  let totalRequestCount = 0;
  let newRequestCount = 0;
  let errorCount = 0;
  let pageNumber = 1;
  let nextPage: number | null = 2;
  const failedBatches: XanoRequestItem[][] = [];

  try {
    // Run loop till we have processed data from all pages
    while (nextPage != null) {
      try {
        let apiMetadataIds: number[] = [];
        let filteredApiData: XanoRequestItem[] = [];

        // Get API Logs from Single Page
        const url = `${baseUrl}/workspace/${workspaceId}/request_history?page=${pageNumber}&include_output=true`;
        const response = await fetch(url, {
          method: "GET",
          headers: {Authorization: `Bearer ${apiToken}`},
        });

        if (response.status !== 200) {
          throw new Error(`Error Fetching API Logs: status ${response.status}`);
        }

        const data = await response.json() as XanoPageResponse;

        logger.info("Fetched Xano API logs page", {page: pageNumber, itemCount: data.items.length, nextPage: data.nextPage});

        // Add all API Logs Count
        totalRequestCount += data.items.length;

        // Increment Page Number by 1
        pageNumber += 1;

        // Update Value of Next Page
        nextPage = data.nextPage;

        // Store All Request ID's
        for (const item of data.items) {
          apiMetadataIds.push(item.id);
        }

        if (apiMetadataIds.length === 0) continue;

        // Remove all API logs which are already stored in database
        for (const item of data.items) {
          if (!item.uri.includes("request_history")) {
            filteredApiData.push(item);
          }
        }

        if (filteredApiData.length === 0) continue;

        // Filter out already existing logs in bulk
        const existingResult = await runPlanetScaleQuery(
          `SELECT metadata_id FROM api_log WHERE metadata_id IN (${filteredApiData.map((a) => a.id).join(",")})`,
        );
        const existingIds = new Set(existingResult.rows.map((row) => Number(row.metadata_id)));
        const newItems = filteredApiData.filter((api) => !existingIds.has(api.id));

        // Add New Request Logs Count
        newRequestCount += newItems.length;

        // Bulk insert in batches of 100
        const BATCH_SIZE = 100;
        for (let i = 0; i < newItems.length; i += BATCH_SIZE) {
          const batch = newItems.slice(i, i + BATCH_SIZE);
          try {
            const now = Date.now();

            const values = batch.map((api) => {
              const inputVal = api.input ? `'${sanitizeJson(api.input)}'::jsonb` : "null";
              const outputVal = api.output ? `'${sanitizeJson(api.output)}'::jsonb` : "null";
              return `(to_timestamp(${now} / 1000.0), ${api.id}, '${escapeString(api.uri)}', ${api.status ?? "null"}, ${inputVal}, ${outputVal}, ${api.api_id ?? "null"}, '${escapeString(api.branch ?? "")}', ${api.query_id ?? "null"})`;
            }).join(",\n");

            const insertQuery = `INSERT INTO api_log (created_at, metadata_id, endpoint, status, input, output, api_id, branch_id, query_id)
              VALUES ${values}
`;

            await runPlanetScaleQuery(insertQuery);
            logger.info("Bulk inserted api_logs", {batch: i / BATCH_SIZE + 1, count: batch.length});
          } catch (err) {
            errorCount += batch.length;
            failedBatches.push(batch);
            logger.error("Batch insert failed, will retry later", {
              batch: i / BATCH_SIZE + 1,
              count: batch.length,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }

        // Reset arrays for next iteration
        apiMetadataIds = [];
        filteredApiData = [];
      } catch (pageErr) {
        logger.error("Page processing failed, continuing to next page", {
          page: pageNumber,
          error: pageErr instanceof Error ? pageErr.message : String(pageErr),
        });
        pageNumber += 1;
      }
    }

    // Retry failed batches one by one
    let retrySuccessCount = 0;
    let retryFailCount = 0;
    if (failedBatches.length > 0) {
      const allFailedItems = failedBatches.flat();
      logger.info("Retrying failed items one by one", {totalItems: allFailedItems.length});
      for (const api of allFailedItems) {
        try {
          const now = Date.now();
          const inputVal = api.input ? `'${sanitizeJson(api.input)}'::jsonb` : "null";
          const outputVal = api.output ? `'${sanitizeJson(api.output)}'::jsonb` : "null";

          const insertQuery = `INSERT INTO api_log (created_at, metadata_id, endpoint, status, input, output, api_id, branch_id, query_id)
            VALUES (
              to_timestamp(${now} / 1000.0),
              ${api.id},
              '${escapeString(api.uri)}',
              ${api.status ?? "null"},
              ${inputVal},
              ${outputVal},
              ${api.api_id ?? "null"},
              '${escapeString(api.branch ?? "")}',
              ${api.query_id ?? "null"}
            )`;
          await runPlanetScaleQuery(insertQuery);
          retrySuccessCount++;
        } catch (err) {
          retryFailCount++;
          logger.error("Retry insert failed", {
            metadata_id: api.id,
            endpoint: api.uri,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Send Logs Count in Slack
    const successInserts = newRequestCount - errorCount + retrySuccessCount;
    const finalFailed = retryFailCount;
    const errorInfo = errorCount > 0 ? `\nFirst Attempt Errors: ${errorCount}\nRetry Success: ${retrySuccessCount}\nRetry Failed: ${finalFailed}` : "";
    const slackText = `Lisi API Logs Execution\nTotal Logs: ${totalRequestCount}\nNew Logs: ${newRequestCount}\nSuccessfully Inserted: ${successInserts}\nFailed: ${finalFailed}${errorInfo}`;
    await sendSlackMessage(slackText);

    logger.info("Hourly task completed", {totalRequestCount, newRequestCount, successInserts, finalFailed, errorCount, retrySuccessCount, retryFailCount});
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Hourly task failed", {error: errorMessage});

    // Send Error Message in Slack
    await sendSlackMessage(`Error in Lisi API Logs task: ${errorMessage}`);

    throw error;
  }
}
