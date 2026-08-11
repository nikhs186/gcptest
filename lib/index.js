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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const node_cron_1 = __importDefault(require("node-cron"));
const logger = __importStar(require("./logger"));
const routes_1 = __importDefault(require("./api/marketplace/routes"));
const routes_2 = __importDefault(require("./api1/routes"));
const statement_1 = require("./helpers/statement");
const xanoLogs_1 = require("./tasks/xanoLogs");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
app.use(express_1.default.urlencoded({ extended: true }));
app.get("/", (req, res) => {
    res.status(200).json({
        message: "Welcome to Lisi API",
        version: "1.0.0",
    });
});
app.get("/health", (req, res) => {
    res.status(200).json({ status: "ok" });
});
// Former "lisi" Cloud Function
app.use("/lisi", routes_1.default);
// Former "lisi1" Cloud Function
app.use("/lisi1", routes_2.default);
// Former standalone "pdf" Cloud Function
app.post("/pdf", async (req, res) => {
    var _a;
    try {
        let data = req.body;
        if (!data || Object.keys(data).length === 0) {
            const payload = req.query.payload;
            if (typeof payload === "string" && payload.trim().length > 0) {
                try {
                    data = JSON.parse(payload);
                }
                catch (parseError) {
                    res.status(400).json({ error: "Invalid JSON in payload query parameter." });
                    return;
                }
            }
        }
        if (!(data === null || data === void 0 ? void 0 : data.dealership) || !((_a = data === null || data === void 0 ? void 0 : data.transactions) === null || _a === void 0 ? void 0 : _a.items)) {
            res.status(400).json({
                error: "Invalid payload. Expecting dealership info and transactions.",
            });
            return;
        }
        const pdfBase64 = await (0, statement_1.generateWalletStatementPdf)(data);
        res.status(200).json({ pdf: pdfBase64 });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Failed to generate PDF", { error: message });
        res.status(500).json({ error: "Internal server error." });
    }
});
// Error handling middleware — Express requires all 4 params to recognise error handlers
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, req, res, _next) => {
    logger.error("Error in Express app", { error: err.message, stack: err.stack });
    res.status(500).json({
        error: "Internal server error",
        message: err.message,
    });
});
// Former "storeXanoLogs" scheduled Cloud Function — runs hourly in-process instead.
node_cron_1.default.schedule("0 * * * *", async () => {
    try {
        await (0, xanoLogs_1.storeXanoLogsTask)();
    }
    catch (error) {
        logger.error("Scheduled storeXanoLogs task failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
const PORT = Number(process.env.PORT) || 8080;
app.listen(PORT, () => {
    logger.info(`Lisi API listening on port ${PORT}`);
});
//# sourceMappingURL=index.js.map