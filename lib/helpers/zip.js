"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.downloadImagesAsZip = downloadImagesAsZip;
const adm_zip_1 = __importDefault(require("adm-zip"));
const storage_1 = require("./storage");
/**
 * Fast URL check (cheap)
 */
function isValidUrl(url) {
    try {
        new URL(url);
        return true;
    }
    catch (_a) {
        return false;
    }
}
/**
 * Split array into chunks of specified size
 */
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}
/**
 * Download images in batches of 5, create ZIP, upload to Firebase Storage,
 * and return signed URL
 */
async function downloadImagesAsZip(urls = []) {
    if (!Array.isArray(urls) || urls.length === 0) {
        throw new Error("urls must be a non-empty array");
    }
    const zip = new adm_zip_1.default();
    // Filter obvious bad URLs early
    const validUrls = urls.filter(isValidUrl);
    // Split URLs into batches of 5
    const batches = chunkArray(validUrls, 5);
    let count = 0;
    let globalIndex = 0;
    // Process each batch sequentially
    for (const batch of batches) {
        // Download images in parallel within each batch
        // Track the original index for each URL in the batch
        const batchWithIndices = batch.map((url, batchIndex) => ({
            url,
            originalIndex: globalIndex + batchIndex,
        }));
        const results = await Promise.allSettled(batchWithIndices.map(async ({ url, originalIndex }) => {
            const res = await fetch(url, {
                // Abort slow requests
                signal: AbortSignal.timeout(10000),
            });
            if (!res.ok)
                return null;
            const contentType = res.headers.get("content-type") || "";
            if (!contentType.startsWith("image/"))
                return null;
            const buffer = Buffer.from(await res.arrayBuffer());
            const ext = contentType.split("/")[1] || "jpg";
            return {
                name: `image_${originalIndex + 1}.${ext}`,
                buffer,
            };
        }));
        // Add successful downloads to ZIP
        for (const r of results) {
            if (r.status === "fulfilled" && r.value) {
                zip.addFile(r.value.name, r.value.buffer);
                count++;
            }
        }
        // Update global index for next batch
        globalIndex += batch.length;
    }
    if (count === 0) {
        throw new Error("No valid image URLs found");
    }
    // Generate ZIP buffer
    const zipBuffer = zip.toBuffer();
    // Upload to Firebase Storage in temp folder and get signed URL
    const fileName = `images_${Date.now()}_${Math.random().toString(36).substring(7)}.zip`;
    const signedUrl = await (0, storage_1.storeFile)(zipBuffer, "temp", fileName, "application/zip", 1);
    return signedUrl;
}
//# sourceMappingURL=zip.js.map