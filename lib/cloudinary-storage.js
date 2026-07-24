// lib/cloudinary-storage.js

const cloudinary = require('cloudinary').v2;

/**
 * Cloudinary storage helper for vendor product media and downloadable
 * digital files.
 *
 * Required env vars:
 *   CLOUDINARY_CLOUD_NAME
 *   CLOUDINARY_API_KEY
 *   CLOUDINARY_API_SECRET
 *
 * Two upload "kinds":
 *   - media: product photos. type: 'upload' (public, cacheable, shown on
 *     product pages).
 *   - digital: the actual downloadable product file. type: 'authenticated'
 *     so the raw asset is NOT publicly reachable by guessing the URL — a
 *     valid download link can only be produced by generateSignedDownloadUrl()
 *     below, using our API secret.
 *
 * Folder convention: vendor-products/{vendorUid}/{productId}/{kind}
 */

let configured = false;

function ensureConfigured() {
  if (configured) return;

  const required = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length) {
    throw new Error(`Cloudinary not configured — missing env vars: ${missing.join(', ')}`);
  }

  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });

  configured = true;
}

function buildFolder({ vendorUid, productId, kind }) {
  if (!vendorUid || !productId) {
    throw new Error('vendorUid and productId are required');
  }
  if (!['media', 'digital'].includes(kind)) {
    throw new Error(`Invalid upload kind: ${kind}`);
  }
  return `vendor-products/${vendorUid}/${productId}/${kind}`;
}

/**
 * Generates the signature + params a vendor's browser needs to upload
 * directly to Cloudinary. The client POSTs a multipart form to
 * https://api.cloudinary.com/v1_1/{cloudName}/{resourceType}/upload
 * including all of the returned params plus the file itself.
 *
 * @param {object} params
 * @param {string} params.vendorUid
 * @param {string} params.productId
 * @param {'media'|'digital'} params.kind
 * @returns {{ signature, timestamp, apiKey, cloudName, folder, type, resourceType }}
 */
function generateUploadSignature({ vendorUid, productId, kind }) {
  ensureConfigured();

  const folder = buildFolder({ vendorUid, productId, kind });
  const type = kind === 'digital' ? 'authenticated' : 'upload';
  const resourceType = kind === 'digital' ? 'raw' : 'image';
  const timestamp = Math.round(Date.now() / 1000);

  // Only parameters actually included in the signature need to be listed here.
  // Any param the client sends that isn't part of this signed set will be
  // rejected by Cloudinary — so the upload form is locked to this exact folder/type.
  const paramsToSign = { folder, timestamp, type };

  const signature = cloudinary.utils.api_sign_request(paramsToSign, process.env.CLOUDINARY_API_SECRET);

  return {
    signature,
    timestamp,
    apiKey: process.env.CLOUDINARY_API_KEY,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    folder,
    type,
    resourceType
  };
}

/**
 * Confirms an asset actually exists on Cloudinary and returns its metadata —
 * called server-side before a listing is allowed to publish with this asset.
 *
 * @param {object} params
 * @param {string} params.publicId
 * @param {'image'|'raw'} params.resourceType
 * @param {'upload'|'authenticated'} params.type
 * @returns {Promise<object|null>} resource metadata, or null if not found
 */
async function verifyAsset({ publicId, resourceType, type }) {
  ensureConfigured();
  try {
    const resource = await cloudinary.api.resource(publicId, { resource_type: resourceType, type });
    return resource;
  } catch (err) {
    if (err.http_code === 404) return null;
    throw err;
  }
}

/**
 * Generates a short-lived signed download URL for an 'authenticated'
 * digital product asset. Call this fresh per download request — never
 * persist the returned URL.
 *
 * @param {object} params
 * @param {string} params.publicId
 * @param {string} params.format - original file extension, e.g. 'zip', 'pdf'
 * @param {number} [params.expiresInSeconds=900]
 * @returns {string}
 */
function generateSignedDownloadUrl({ publicId, format, expiresInSeconds = 900 }) {
  ensureConfigured();

  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;

  return cloudinary.utils.private_download_url(publicId, format, {
    resource_type: 'raw',
    type: 'authenticated',
    expires_at: expiresAt,
    attachment: true
  });
}

/**
 * Deletes an asset — used when a product is removed, or an admin suspends
 * a vendor/listing.
 *
 * @param {object} params
 * @param {string} params.publicId
 * @param {'image'|'raw'} params.resourceType
 * @param {'upload'|'authenticated'} params.type
 */
async function deleteAsset({ publicId, resourceType, type }) {
  ensureConfigured();
  await cloudinary.uploader.destroy(publicId, { resource_type: resourceType, type });
}

module.exports = {
  generateUploadSignature,
  verifyAsset,
  generateSignedDownloadUrl,
  deleteAsset
};