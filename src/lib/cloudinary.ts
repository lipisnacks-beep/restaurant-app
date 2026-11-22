import { v2 as cloudinary } from 'cloudinary';

const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET;

if (!cloudName || !apiKey || !apiSecret) {
  // Don't throw at module load (build time), only when actually used.
  console.warn('[cloudinary] Missing env vars. Uploads will fail until set.');
}

cloudinary.config({
  cloud_name: cloudName,
  api_key: apiKey,
  api_secret: apiSecret,
  secure: true,
});

export default cloudinary;

/**
 * Upload a base64 data URI to Cloudinary and return the secure URL.
 * Folder keeps restaurant menu / staff images organized.
 */
export async function uploadImage(dataUri: string, folder = 'restaurant'): Promise<string> {
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error('Cloudinary env vars are not configured');
  }
  const result = await cloudinary.uploader.upload(dataUri, {
    folder,
    resource_type: 'image',
    transformation: [{ width: 800, height: 600, crop: 'limit', quality: 'auto' }],
  });
  return result.secure_url;
}
