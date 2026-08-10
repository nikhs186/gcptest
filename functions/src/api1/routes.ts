import {Router, Request, Response} from "express";
import * as logger from "firebase-functions/logger";
import {downloadImagesAsZip} from "../api/../helpers/zip";
import {processHitMe} from "../helpers/hitme";
import {uploadToCloudinary} from "../helpers/cloudinaryUpload";
import {storeXanoLogsTask} from "../tasks/xanoLogs";

const router = Router();

router.post("/car/images/download", async (req: Request, res: Response) => {
  try {
    const {urls} = req.body;
    const signedUrl = await downloadImagesAsZip(urls);

    res.status(200).json({
      success: true,
      downloadUrl: signedUrl,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Error downloading images", {error: errorMessage});
    res.status(500).json({error: "Failed to download images", message: errorMessage});
  }
});

/**
 * POST /hitme/:hitme_id
 * Process HitMe request by matching deals with consumer profile
 * Query params:
 *   - type: "local" or "national" (default: "national")
 */
router.post("/hitme/:hitme_id", async (req: Request, res: Response) => {
  try {
    const hitmeId = req.params.hitme_id;
    const type = (req.query.type as string) || "national";

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

    logger.info("HitMe API request received", {hitmeId, type});

    const result = await processHitMe(hitmeId, type);

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
  } catch (error) {
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

router.post("/cloudinary/upload", async (req: Request, res: Response) => {
  try {
    const {url, maintainRatio, optimizeImage} = req.body as {url?: string; maintainRatio?: boolean; optimizeImage?: boolean};

    if (!url || typeof url !== "string") {
      return res.status(400).json({error: "url is required and must be a string"});
    }

    const result = await uploadToCloudinary(url, maintainRatio === true, optimizeImage === true);

    return res.status(200).json(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    logger.error("Error uploading to Cloudinary", {error: errorMessage});
    return res.status(500).json({error: "Failed to upload image", message: errorMessage});
  }
});

router.post("/task/xanolog", async (req: Request, res: Response) => {
  try {
    await storeXanoLogsTask();
    return res.status(200).json({success: true});
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    logger.error("Error: ", {error: errorMessage});
    return res.status(500).json({error: "Error", message: errorMessage});
  }
});

export default router;
