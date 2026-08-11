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
const express_1 = require("express");
const logger = __importStar(require("../logger"));
const zip_1 = require("../api/../helpers/zip");
const hitme_1 = require("../helpers/hitme");
const cloudinaryUpload_1 = require("../helpers/cloudinaryUpload");
const xanoLogs_1 = require("../tasks/xanoLogs");
const router = (0, express_1.Router)();
router.post("/car/images/download", async (req, res) => {
    try {
        const { urls } = req.body;
        const signedUrl = await (0, zip_1.downloadImagesAsZip)(urls);
        res.status(200).json({
            success: true,
            downloadUrl: signedUrl,
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error downloading images", { error: errorMessage });
        res.status(500).json({ error: "Failed to download images", message: errorMessage });
    }
});
/**
 * POST /hitme/:hitme_id
 * Process HitMe request by matching deals with consumer profile
 * Query params:
 *   - type: "local" or "national" (default: "national")
 */
router.post("/hitme/:hitme_id", async (req, res) => {
    try {
        const hitmeId = req.params.hitme_id;
        const type = req.query.type || "national";
        if (!hitmeId) {
            return res.status(400).json({
                error: "hitme_id parameter is required",
            });
        }
        if (type !== "local" && type !== "national") {
            return res.status(400).json({
                error: "type parameter must be 'local' or 'national'",
            });
        }
        logger.info("HitMe API request received", { hitmeId, type });
        const result = await (0, hitme_1.processHitMe)(hitmeId, type);
        if (!result.success) {
            return res.status(400).json({
                success: false,
                message: result.message,
                processedDeals: result.processedDeals,
                matchedDeals: result.matchedDeals,
                totalPages: result.totalPages,
                processedCars: result.processedCars,
                matchedCars: result.matchedCars,
            });
        }
        return res.status(200).json({
            success: true,
            message: result.message,
            processedDeals: result.processedDeals,
            matchedDeals: result.matchedDeals,
            totalPages: result.totalPages,
            processedCars: result.processedCars,
            matchedCars: result.matchedCars,
        });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger.error("Error in HitMe API", {
            error: errorMessage,
            hitmeId: req.params.hitme_id,
            stack: error instanceof Error ? error.stack : undefined,
        });
        return res.status(500).json({
            error: "Failed to process HitMe request",
            message: errorMessage,
        });
    }
});
router.post("/cloudinary/upload", async (req, res) => {
    try {
        const { url, maintainRatio, optimizeImage } = req.body;
        if (!url || typeof url !== "string") {
            return res.status(400).json({ error: "url is required and must be a string" });
        }
        const result = await (0, cloudinaryUpload_1.uploadToCloudinary)(url, maintainRatio === true, optimizeImage === true);
        return res.status(200).json(result);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        logger.error("Error uploading to Cloudinary", { error: errorMessage });
        return res.status(500).json({ error: "Failed to upload image", message: errorMessage });
    }
});
router.post("/task/xanolog", async (req, res) => {
    try {
        await (0, xanoLogs_1.storeXanoLogsTask)();
        return res.status(200).json({ success: true });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
        logger.error("Error: ", { error: errorMessage });
        return res.status(500).json({ error: "Error", message: errorMessage });
    }
});
exports.default = router;
//# sourceMappingURL=routes.js.map