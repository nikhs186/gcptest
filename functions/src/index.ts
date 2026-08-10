import {setGlobalOptions} from "firebase-functions/v2";
import {onRequest} from "firebase-functions/https";
import {onSchedule} from "firebase-functions/v2/scheduler";
import * as logger from "firebase-functions/logger";
import express from "express";
import apiRoutes from "./api/marketplace/routes";
import api1Routes from "./api1/routes";
import {generateWalletStatementPdf} from "./helpers/statement";
import type {StatementData} from "./helpers/statement";
import {storeXanoLogsTask} from "./tasks/xanoLogs";

setGlobalOptions({maxInstances: 10});

// Create Express app
const app = express();
const app1 = express();
// Middleware
app.use(express.json());
app.use(express.urlencoded({extended: true}));

app1.use(express.json());
app1.use(express.urlencoded({extended: true}));
// API routes
app.use("/", apiRoutes);
app1.use("/", api1Routes);
// Root endpoint
app.get("/", (req, res) => {
  res.status(200).json({
    message: "Welcome to Lisi API",
    version: "1.0.0",
  });
});
app1.get("/", (req, res) => {
  res.status(200).json({
    message: "Welcome to Lisi API 1",
    version: "1.0.0",
  });
});
// Error handling middleware — Express requires all 4 params to recognise error handlers
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Error in Express app", {error: err.message, stack: err.stack});
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app1.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error("Error in Express app", {error: err.message, stack: err.stack});
  res.status(500).json({
    error: "Internal server error",
    message: err.message,
  });
});

export const lisi = onRequest({
  cors: true,
  minInstances: 1,
  timeoutSeconds: 60,
  memory: "512MiB",
  region: "europe-west2",
}, app);


export const lisi1 = onRequest({
  cors: true,
  timeoutSeconds: 3600,
  memory: "8GiB",
  maxInstances: 2,
  region: "europe-west2",
}, app1);

export const storeXanoLogs = onSchedule({
  schedule: "every 1 hours",
  region: "europe-west2",
  timeoutSeconds: 1800,
  memory: "1GiB",
}, async () => {
  await storeXanoLogsTask();
});

export const pdf = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({error: "Method Not Allowed. Use POST."});
    return;
  }

  try {
    let data = request.body as StatementData | undefined;

    if (!data || Object.keys(data).length === 0) {
      const payload = request.query.payload;
      if (typeof payload === "string" && payload.trim().length > 0) {
        try {
          data = JSON.parse(payload) as StatementData;
        } catch (parseError) {
          response.status(400).json({error: "Invalid JSON in payload query parameter."});
          return;
        }
      }
    }

    if (!data?.dealership || !data?.transactions?.items) {
      response.status(400).json({
        error: "Invalid payload. Expecting dealership info and transactions.",
      });
      return;
    }

    const pdfBase64 = await generateWalletStatementPdf(data);
    response.status(200).json({pdf: pdfBase64});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to generate PDF", {error: message});
    response.status(500).json({error: "Internal server error."});
  }
});