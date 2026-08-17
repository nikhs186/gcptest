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
exports.uploadToCloudinary = uploadToCloudinary;
exports.uploadBufferToCloudinary = uploadBufferToCloudinary;
const cloudinary_1 = require("cloudinary");
const stream_1 = require("stream");
const logger = __importStar(require("../logger"));
cloudinary_1.v2.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});
function buildUploadOptions(maintainRatio, optimizeImage) {
    const uploadOptions = {};
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
    return uploadOptions;
}
async function finalizeUpload(result, maintainRatio) {
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
        await cloudinary_1.v2.uploader.destroy(result.public_id);
        throw new Error(`Image dimensions mismatch: expected 1200x900 but got ${result.width}x${result.height}`);
    }
    const filename = result.public_id.split("/").pop() || result.public_id;
    return { urls: [result.secure_url], public_id: filename };
}
/**
 * Uploads an image to Cloudinary from a URL.
 * If maintainRatio is true, applies a 4:3 transformation (1200x900) with background fill.
 * @param url - Source image URL
 * @param maintainRatio - Whether to apply 4:3 ratio transformation
 * @returns Array containing the uploaded/transformed image URL
 */
async function uploadToCloudinary(url, maintainRatio, optimizeImage) {
    const uploadOptions = buildUploadOptions(maintainRatio, optimizeImage);
    logger.info("Uploading to Cloudinary", { url, maintainRatio });
    const result = await cloudinary_1.v2.uploader.upload(url, uploadOptions);
    return finalizeUpload(result, maintainRatio);
}
/**
 * Uploads an image to Cloudinary from a raw file buffer (e.g. a multipart/form-data upload),
 * instead of fetching it from a source URL.
 * @param buffer - Raw file bytes
 * @param maintainRatio - Whether to apply 4:3 ratio transformation
 */
async function uploadBufferToCloudinary(buffer, maintainRatio, optimizeImage) {
    const uploadOptions = buildUploadOptions(maintainRatio, optimizeImage);
    logger.info("Uploading file buffer to Cloudinary", { size: buffer.length, maintainRatio });
    const result = await new Promise((resolve, reject) => {
        const uploadStream = cloudinary_1.v2.uploader.upload_stream(uploadOptions, (error, uploadResult) => {
            if (error || !uploadResult) {
                reject(error !== null && error !== void 0 ? error : new Error("Cloudinary upload failed"));
                return;
            }
            resolve(uploadResult);
        });
        stream_1.Readable.from(buffer).pipe(uploadStream);
    });
    return finalizeUpload(result, maintainRatio);
}
//# sourceMappingURL=cloudinaryUpload.js.map