const crypto = require('crypto');
const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { requireAdmin } = require('../../lib/auth');

/**
 * POST /api/cloudinary/signature
 * Admin only. Returns a signed set of upload params the browser can use to
 * upload directly to Cloudinary (course audio/PDF files) without exposing
 * the Cloudinary API secret client-side.
 * Body: { folder? }  // defaults to 'course-content'
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const admin = getFirebaseAdmin();
    await requireAdmin(req, admin);

    const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
    const API_KEY = process.env.CLOUDINARY_API_KEY;
    const API_SECRET = process.env.CLOUDINARY_API_SECRET;

    if (!CLOUD_NAME || !API_KEY || !API_SECRET) {
      return res.status(500).json({ error: 'Cloudinary is not configured' });
    }

    const { folder } = req.body || {};
    const resolvedFolder = folder || 'course-content';
    const timestamp = Math.floor(Date.now() / 1000);

    // Cloudinary signs the exact params (minus file/api_key/signature) sorted alphabetically
    const paramsToSign = { folder: resolvedFolder, timestamp };
    const stringToSign = Object.keys(paramsToSign)
      .sort()
      .map((key) => `${key}=${paramsToSign[key]}`)
      .join('&');

    const signature = crypto
      .createHash('sha1')
      .update(stringToSign + API_SECRET)
      .digest('hex');

    return res.status(200).json({
      signature,
      timestamp,
      apiKey: API_KEY,
      cloudName: CLOUD_NAME,
      folder: resolvedFolder
    });

  } catch (err) {
    console.error('cloudinary signature error:', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};