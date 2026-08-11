import "dotenv/config";
import express from "express";
import cors from "cors";
import cron from "node-cron";
import * as logger from "./logger";
import apiRoutes from "./api/marketplace/routes";
import api1Routes from "./api1/routes";
import {generateWalletStatementPdf} from "./helpers/statement";
import type {StatementData} from "./helpers/statement";
import {storeXanoLogsTask} from "./tasks/xanoLogs";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({extended: true}));

app.get("/", (req, res) => {
  res.status(200).json({
    message: "Welcome to Lisi API",
    version: "1.0.0",
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({status: "ok"});
});

// Former "lisi" Cloud Function
app.use("/lisi", apiRoutes);
// Former "lisi1" Cloud Function
app.use("/lisi1", api1Routes);

// Former standalone "pdf" Cloud Function
app.post("/pdf", async (req, res) => {
  try {
    let data = req.body as StatementData | undefined;

    if (!data || Object.keys(data).length === 0) {
      const payload = req.query.payload;
      if (typeof payload === "string" && payload.trim().length > 0) {
        try {
          data = JSON.parse(payload) as StatementData;
        } catch (parseError) {
          res.status(400).json({error: "Invalid JSON in payload query parameter."});
          return;
        }
      }
    }

    if (!data?.dealership || !data?.transactions?.items) {
      res.status(400).json({
        error: "Invalid payload. Expecting dealership info and transactions.",
      });
      return;
    }

    const pdfBase64 = await generateWalletStatementPdf(data);
    res.status(200).json({pdf: pdfBase64});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to generate PDF", {error: message});
    res.status(500).json({error: "Internal server error."});
  }
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

// Former "storeXanoLogs" scheduled Cloud Function — runs hourly in-process instead.
cron.schedule("0 * * * *", async () => {
  try {
    await storeXanoLogsTask();
  } catch (error) {
    logger.error("Scheduled storeXanoLogs task failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => {
  logger.info(`Lisi API listening on port ${PORT}`);
});
