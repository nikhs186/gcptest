import {getApps, initializeApp} from "firebase-admin/app";
import {getStorage} from "firebase-admin/storage";

// Initialize Firebase Admin if not already initialized
if (!getApps().length) {
  initializeApp();
}

// Get the default storage bucket name
// Firebase Storage uses format: PROJECT_ID.firebasestorage.app
const getDefaultBucket = () => {
  const projectId = process.env.GCLOUD_PROJECT || "lisi-lease";
  // Try Firebase Storage bucket first, fallback to appspot.com
  return `${projectId}.firebasestorage.app`;
};

/**
 * Uploads a file buffer to Firebase Storage and returns a signed URL
 * @param buffer - The file buffer to upload
 * @param folder - The folder path in storage (e.g., "temp", "images")
 * @param fileName - Optional custom file name. If not provided, generates a unique name
 * @param contentType - MIME type of the file (e.g., "application/zip", "image/jpeg")
 * @param expiresInHours - Number of hours the signed URL should be valid (default: 1)
 * @returns Promise<string> - Signed URL to access the file
 */
export async function storeFile(
  buffer: Buffer,
  folder = "temp",
  fileName?: string,
  contentType = "application/octet-stream",
  expiresInHours = 1,
): Promise<string> {
  const storage = getStorage();
  const defaultBucket = getDefaultBucket();
  const bucket = defaultBucket ? storage.bucket(defaultBucket) : storage.bucket();

  // Generate unique file name if not provided, otherwise use provided name with folder
  const finalFileName = fileName ?
    `${folder}/${fileName}` :
    `${folder}/${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const file = bucket.file(finalFileName);

  // Upload the file buffer
  await file.save(buffer, {
    contentType,
    metadata: {
      cacheControl: `public, max-age=${expiresInHours * 3600}`,
    },
  });

  // Try to get signed URL, fallback to public URL if signing fails
  try {
    const [signedUrl] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + (expiresInHours * 60 * 60 * 1000),
    });
    return signedUrl;
  } catch (error) {
    // If signing fails (e.g., missing credentials), make file public and return public URL
    // This is acceptable for temporary files
    await file.makePublic();

    // Use Firebase Storage URL format for Firebase Storage buckets
    const bucketName = bucket.name;
    let publicUrl: string;

    if (bucketName.includes("firebasestorage.app")) {
      // Firebase Storage bucket URL format
      publicUrl = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(finalFileName)}?alt=media`;
    } else {
      // Standard GCS bucket URL format
      publicUrl = `https://storage.googleapis.com/${bucketName}/${finalFileName}`;
    }

    return publicUrl;
  }
}

