import {v2 as cloudinary} from "cloudinary";
import * as logger from "../logger";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Uploads an image to Cloudinary from a URL.
 * If maintainRatio is true, applies a 4:3 transformation (1200x900) with background fill.
 * @param url - Source image URL
 * @param maintainRatio - Whether to apply 4:3 ratio transformation
 * @returns Array containing the uploaded/transformed image URL
 */
export async function uploadToCloudinary(
  url: string,
  maintainRatio?: boolean,
  optimizeImage?: boolean
): Promise<{urls: string[]; public_id: string}> {
  const uploadOptions: Record<string, unknown> = {};

  if (maintainRatio && !optimizeImage) {
    uploadOptions.transformation = [
      {
        width: 1200,
        height: 900,
        aspect_ratio: "4:3",
        crop: "pad",
        background: "gen_fill",
        fetch_format: "auto",
        quality: "auto",
      },
    ];
  }

  if (optimizeImage && !maintainRatio) {
    uploadOptions.transformation = [
      {
        width: 1200,
        fetch_format: "auto",
        quality: "auto",
        crop: "scale",
      },
    ];
  }

  logger.info("Uploading to Cloudinary", {url, maintainRatio});

  const result = await cloudinary.uploader.upload(url, uploadOptions);

  logger.info("Cloudinary upload complete", {
    publicId: result.public_id,
    url: result.secure_url,
    width: result.width,
    height: result.height,
  });

  if (maintainRatio && (result.width !== 1200 || result.height !== 900)) {
    logger.error("Uploaded image dimensions mismatch, deleting", {
      publicId: result.public_id,
      expectedWidth: 1200,
      expectedHeight: 900,
      actualWidth: result.width,
      actualHeight: result.height,
    });
    await cloudinary.uploader.destroy(result.public_id);
    throw new Error(
      `Image dimensions mismatch: expected 1200x900 but got ${result.width}x${result.height}`,
    );
  }

  const filename = result.public_id.split("/").pop() || result.public_id;
  return {urls: [result.secure_url], public_id: filename};
}
