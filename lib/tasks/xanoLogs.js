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
exports.storeXanoLogsTask = storeXanoLogsTask;
const logger = __importStar(require("../logger"));
const pg_1 = require("../helpers/pg");
const SLACK_URL = "https://hooks.slack.com/services/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";
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\u0000-\u001F\u007F]/g;
function sanitizeJson(obj) {
    const parsed = typeof obj === "string" ? JSON.parse(obj) : obj;
    return JSON.stringify(parsed)
        .replace(CONTROL_CHARS_RE, "")
        .replace(/'/g, "''");
}
function escapeString(str) {
    return str
        .replace(CONTROL_CHARS_RE, "")
        .replace(/'/g, "''");
}
async function runPlanetScaleQuery(query, params) {
    var _a;
    const result = await (0, pg_1.executePlanetScaleQuery)(query, params);
    return { rows: result.rows, rowCount: (_a = result.rowCount) !== null && _a !== void 0 ? _a : 0 };
}
async function sendSlackMessage(text) {
    try {
        await fetch(SLACK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text }),
        });
    }
    catch (error) {
        logger.error("Failed to send Slack message", { error: error instanceof Error ? error.message : String(error) });
    }
}
async function storeXanoLogsTask() {
    var _a, _b, _c, _d;
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
    let nextPage = 2;
    const failedBatches = [];
    try {
        // Run loop till we have processed data from all pages
        while (nextPage != null) {
            try {
                let apiMetadataIds = [];
                let filteredApiData = [];
                // Get API Logs from Single Page
                const url = `${baseUrl}/workspace/${workspaceId}/request_history?page=${pageNumber}&include_output=true`;
                const response = await fetch(url, {
                    method: "GET",
                    headers: { Authorization: `Bearer ${apiToken}` },
                });
                if (response.status !== 200) {
                    throw new Error(`Error Fetching API Logs: status ${response.status}`);
                }
                const data = await response.json();
                logger.info("Fetched Xano API logs page", { page: pageNumber, itemCount: data.items.length, nextPage: data.nextPage });
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
                if (apiMetadataIds.length === 0)
                    continue;
                // Remove all API logs which are already stored in database
                for (const item of data.items) {
                    if (!item.uri.includes("request_history")) {
                        filteredApiData.push(item);
                    }
                }
                if (filteredApiData.length === 0)
                    continue;
                // Filter out already existing logs in bulk
                const existingResult = await runPlanetScaleQuery(`SELECT metadata_id FROM api_log WHERE metadata_id IN (${filteredApiData.map((a) => a.id).join(",")})`);
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
                            var _a, _b, _c, _d;
                            const inputVal = api.input ? `'${sanitizeJson(api.input)}'::jsonb` : "null";
                            const outputVal = api.output ? `'${sanitizeJson(api.output)}'::jsonb` : "null";
                            return `(to_timestamp(${now} / 1000.0), ${api.id}, '${escapeString(api.uri)}', ${(_a = api.status) !== null && _a !== void 0 ? _a : "null"}, ${inputVal}, ${outputVal}, ${(_b = api.api_id) !== null && _b !== void 0 ? _b : "null"}, '${escapeString((_c = api.branch) !== null && _c !== void 0 ? _c : "")}', ${(_d = api.query_id) !== null && _d !== void 0 ? _d : "null"})`;
                        }).join(",\n");
                        const insertQuery = `INSERT INTO api_log (created_at, metadata_id, endpoint, status, input, output, api_id, branch_id, query_id)
              VALUES ${values}
`;
                        await runPlanetScaleQuery(insertQuery);
                        logger.info("Bulk inserted api_logs", { batch: i / BATCH_SIZE + 1, count: batch.length });
                    }
                    catch (err) {
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
            }
            catch (pageErr) {
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
            logger.info("Retrying failed items one by one", { totalItems: allFailedItems.length });
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
              ${(_a = api.status) !== null && _a !== void 0 ? _a : "null"},
              ${inputVal},
              ${outputVal},
              ${(_b = api.api_id) !== null && _b !== void 0 ? _b : "null"},
              '${escapeString((_c = api.branch) !== null && _c !== void 0 ? _c : "")}',
              ${(_d = api.query_id) !== null && _d !== void 0 ? _d : "null"}
            )`;
                    await runPlanetScaleQuery(insertQuery);
                    retrySuccessCount++;
                }
                catch (err) {
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
        logger.info("Hourly task completed", { totalRequestCount, newRequestCount, successInserts, finalFailed, errorCount, retrySuccessCount, retryFailCount });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Hourly task failed", { error: errorMessage });
        // Send Error Message in Slack
        await sendSlackMessage(`Error in Lisi API Logs task: ${errorMessage}`);
        throw error;
    }
}
//# sourceMappingURL=xanoLogs.js.map