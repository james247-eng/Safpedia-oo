// api/marketplace/[action].js

const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { getAuthedUser } = require('../../lib/auth');
const { generateUploadSignature, verifyAsset, deleteAsset, generateSignedDownloadUrl } = require('../../lib/cloudinary-storage');

const MAX_TITLE_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_IMAGES = 6;
const ALLOWED_TYPES = new Set(['physical', 'digital']);

/**
 * Consolidated marketplace router — one Vercel serverless function serving
 * multiple routes via the [action] dynamic segment, to stay under the
 * Hobby plan's 12-function-per-deployment cap. URL paths are unchanged
 * from the original standalone files, so no frontend calls need updating:
 *
 *   POST /api/marketplace/create-product        -> handleCreateProduct
 *   POST /api/marketplace/update-product         -> handleUpdateProduct
 *   POST /api/marketplace/delete-product          -> handleDeleteProduct
 *   POST /api/marketplace/get-upload-signature    -> handleGetUploadSignature
 *   POST /api/marketplace/get-download-link       -> handleGetDownloadLink
 *   POST /api/marketplace/create-transaction      -> handleCreateTransaction
 *
 * webhook.js is DELIBERATELY NOT part of this router — it needs raw-body
 * signature verification (bodyParser: false), which can't share a function
 * with routes that expect parsed JSON bodies. It stays a standalone file.
 *
 * Each handler's internal logic is preserved exactly as it was in its
 * original standalone file — only the routing wrapper is shared.
 */
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    switch (action) {
      case 'create-product':
        return await handleCreateProduct(req, res, admin, db);
      case 'update-product':
        return await handleUpdateProduct(req, res, admin, db);
      case 'delete-product':
        return await handleDeleteProduct(req, res, admin, db);
      case 'get-upload-signature':
        return await handleGetUploadSignature(req, res, admin, db);
      case 'get-download-link':
        return await handleGetDownloadLink(req, res, admin, db);
      case 'create-transaction':
        return await handleCreateTransaction(req, res, admin, db);
      default:
        return res.status(404).json({ error: `Unknown action: ${action}` });
    }

  } catch (err) {
    console.error(`marketplace/${action} error:`, err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

/**
 * POST /api/marketplace/create-product
 * Any authenticated user — no admin approval required, blocked only if the
 * vendor account itself is suspended. Vendor's first name is denormalized
 * onto the product at creation time.
 *
 * Body: { productId, title, description, category, price, type, stock?,
 *          digitalAsset?, images? }
 */
async function handleCreateProduct(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);

  const vendorSnap = await db.collection('vendors').doc(user.uid).get();
  if (vendorSnap.exists && vendorSnap.data().isSuspended) {
    return res.status(403).json({ error: 'This vendor account is suspended and cannot create new products' });
  }

  const {
    productId,
    title,
    description,
    category,
    price,
    type,
    stock,
    digitalAsset,
    images
  } = req.body || {};

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid productId' });
  }
  if (!title || typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'Missing title' });
  }
  if (title.length > MAX_TITLE_LENGTH) {
    return res.status(400).json({ error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` });
  }
  if (description && (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH)) {
    return res.status(400).json({ error: `description must be a string of ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
  }
  if (!category || typeof category !== 'string' || !category.trim()) {
    return res.status(400).json({ error: 'Missing category' });
  }
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: 'price must be a positive number' });
  }
  if (!type || !ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: "type must be 'physical' or 'digital'" });
  }
  if (images !== undefined) {
    if (!Array.isArray(images) || images.length > MAX_IMAGES) {
      return res.status(400).json({ error: `images must be an array of up to ${MAX_IMAGES} items` });
    }
  }

  const expectedFolder = `vendor-products/${user.uid}/${productId}`;

  let stockValue = null;
  let digitalAssetValue = null;

  if (type === 'physical') {
    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({ error: 'stock must be a non-negative integer for physical products' });
    }
    stockValue = stock;
  }

  if (type === 'digital') {
    if (!digitalAsset || typeof digitalAsset.publicId !== 'string' || typeof digitalAsset.format !== 'string') {
      return res.status(400).json({ error: 'digitalAsset { publicId, format } is required for digital products' });
    }
    if (!digitalAsset.publicId.startsWith(`${expectedFolder}/digital/`)) {
      return res.status(403).json({ error: 'digitalAsset does not belong to this product/account' });
    }

    const resource = await verifyAsset({
      publicId: digitalAsset.publicId,
      resourceType: 'raw',
      type: 'authenticated'
    });
    if (!resource) {
      return res.status(400).json({ error: 'Uploaded digital file not found — upload may have failed or is still in progress' });
    }

    digitalAssetValue = {
      publicId: digitalAsset.publicId,
      format: digitalAsset.format,
      bytes: resource.bytes || null
    };
  }

  const verifiedImages = [];
  if (images && images.length) {
    for (const img of images) {
      if (!img || typeof img.publicId !== 'string') {
        return res.status(400).json({ error: 'Each image must include a publicId' });
      }
      if (!img.publicId.startsWith(`${expectedFolder}/media/`)) {
        return res.status(403).json({ error: 'One or more image assets do not belong to this product/account' });
      }
      const resource = await verifyAsset({
        publicId: img.publicId,
        resourceType: 'image',
        type: 'upload'
      });
      if (!resource) {
        return res.status(400).json({ error: `Image not found in storage: ${img.publicId}` });
      }
      verifiedImages.push({ publicId: img.publicId, url: resource.secure_url });
    }
  }

  const productRef = db.collection('vendorProducts').doc(productId);
  const existing = await productRef.get();
  if (existing.exists) {
    return res.status(409).json({ error: 'A product with this ID already exists — use update-product instead' });
  }

  let vendorFirstName = 'Vendor';
  try {
    const userDoc = await db.collection('user').doc(user.uid).get();
    if (userDoc.exists) {
      const u = userDoc.data();
      vendorFirstName = u.firstName || (u.email ? u.email.split('@')[0] : 'Vendor');
    }
  } catch (err) {
    console.warn('Could not fetch vendor first name, using fallback:', err.message);
  }

  const productData = {
    vendorUid: user.uid,
    vendorFirstName,
    title: title.trim(),
    description: description ? description.trim() : '',
    category: category.trim(),
    price,
    type,
    stock: stockValue,
    digitalAsset: digitalAssetValue,
    images: verifiedImages,
    isActive: true,
    totalSales: 0,
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now()
  };

  await productRef.set(productData);

  return res.status(200).json({ success: true, productId, product: productData });
}

/**
 * POST /api/marketplace/update-product
 * Vendor-only, own product only. `type` is intentionally not editable —
 * delete and re-create if it's genuinely wrong.
 *
 * Body: { productId, title?, description?, category?, price?, stock?,
 *          isActive?, images?, digitalAsset? }
 */
async function handleUpdateProduct(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);

  const {
    productId,
    title,
    description,
    category,
    price,
    stock,
    isActive,
    images,
    digitalAsset
  } = req.body || {};

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing productId' });
  }

  const productRef = db.collection('vendorProducts').doc(productId);
  const productSnap = await productRef.get();

  if (!productSnap.exists) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = productSnap.data();

  if (product.vendorUid !== user.uid) {
    return res.status(403).json({ error: 'This product does not belong to your account' });
  }
  if (product.isDeleted) {
    return res.status(410).json({ error: 'This product has been deleted and cannot be edited' });
  }

  const vendorSnap = await db.collection('vendors').doc(user.uid).get();
  if (vendorSnap.exists && vendorSnap.data().isSuspended) {
    return res.status(403).json({ error: 'This vendor account is suspended and cannot edit products' });
  }

  const update = { updatedAt: admin.firestore.Timestamp.now() };

  if (title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }
    if (title.length > MAX_TITLE_LENGTH) {
      return res.status(400).json({ error: `title must be ${MAX_TITLE_LENGTH} characters or fewer` });
    }
    update.title = title.trim();
  }

  if (description !== undefined) {
    if (typeof description !== 'string' || description.length > MAX_DESCRIPTION_LENGTH) {
      return res.status(400).json({ error: `description must be a string of ${MAX_DESCRIPTION_LENGTH} characters or fewer` });
    }
    update.description = description.trim();
  }

  if (category !== undefined) {
    if (typeof category !== 'string' || !category.trim()) {
      return res.status(400).json({ error: 'category cannot be empty' });
    }
    update.category = category.trim();
  }

  if (price !== undefined) {
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      return res.status(400).json({ error: 'price must be a positive number' });
    }
    update.price = price;
  }

  if (isActive !== undefined) {
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ error: 'isActive must be true or false' });
    }
    if (product.adminSuspended && isActive === true) {
      return res.status(403).json({ error: 'This product was suspended by an admin and cannot be reactivated from here' });
    }
    update.isActive = isActive;
  }

  if (stock !== undefined) {
    if (product.type !== 'physical') {
      return res.status(400).json({ error: 'stock only applies to physical products' });
    }
    if (typeof stock !== 'number' || !Number.isInteger(stock) || stock < 0) {
      return res.status(400).json({ error: 'stock must be a non-negative integer' });
    }
    update.stock = stock;
  }

  const expectedFolder = `vendor-products/${user.uid}/${productId}`;

  if (digitalAsset !== undefined) {
    if (product.type !== 'digital') {
      return res.status(400).json({ error: 'digitalAsset only applies to digital products' });
    }
    if (!digitalAsset || typeof digitalAsset.publicId !== 'string' || typeof digitalAsset.format !== 'string') {
      return res.status(400).json({ error: 'digitalAsset { publicId, format } is required' });
    }
    if (!digitalAsset.publicId.startsWith(`${expectedFolder}/digital/`)) {
      return res.status(403).json({ error: 'digitalAsset does not belong to this product/account' });
    }

    const resource = await verifyAsset({
      publicId: digitalAsset.publicId,
      resourceType: 'raw',
      type: 'authenticated'
    });
    if (!resource) {
      return res.status(400).json({ error: 'Uploaded digital file not found — upload may have failed or is still in progress' });
    }

    if (product.digitalAsset && product.digitalAsset.publicId && product.digitalAsset.publicId !== digitalAsset.publicId) {
      try {
        await deleteAsset({ publicId: product.digitalAsset.publicId, resourceType: 'raw', type: 'authenticated' });
      } catch (err) {
        console.warn('Could not delete old digital asset:', err.message);
      }
    }

    update.digitalAsset = {
      publicId: digitalAsset.publicId,
      format: digitalAsset.format,
      bytes: resource.bytes || null
    };
  }

  if (images !== undefined) {
    if (!Array.isArray(images) || images.length > MAX_IMAGES) {
      return res.status(400).json({ error: `images must be an array of up to ${MAX_IMAGES} items` });
    }

    const verifiedImages = [];
    for (const img of images) {
      if (!img || typeof img.publicId !== 'string') {
        return res.status(400).json({ error: 'Each image must include a publicId' });
      }
      if (!img.publicId.startsWith(`${expectedFolder}/media/`)) {
        return res.status(403).json({ error: 'One or more image assets do not belong to this product/account' });
      }
      const resource = await verifyAsset({ publicId: img.publicId, resourceType: 'image', type: 'upload' });
      if (!resource) {
        return res.status(400).json({ error: `Image not found in storage: ${img.publicId}` });
      }
      verifiedImages.push({ publicId: img.publicId, url: resource.secure_url });
    }

    const newPublicIds = new Set(verifiedImages.map((i) => i.publicId));
    const oldImages = product.images || [];
    for (const oldImg of oldImages) {
      if (!newPublicIds.has(oldImg.publicId)) {
        try {
          await deleteAsset({ publicId: oldImg.publicId, resourceType: 'image', type: 'upload' });
        } catch (err) {
          console.warn('Could not delete old image asset:', err.message);
        }
      }
    }

    update.images = verifiedImages;
  }

  await productRef.set(update, { merge: true });

  const updatedSnap = await productRef.get();
  return res.status(200).json({ success: true, productId, product: updatedSnap.data() });
}

/**
 * POST /api/marketplace/delete-product
 * Vendor-only, own product only. Hard-deletes (doc + Cloudinary assets) if
 * the product never sold; soft-deletes (isActive/isDeleted flags, doc kept
 * intact) if it has any sales history, since get-download-link and order
 * history both still depend on the doc existing.
 *
 * Body: { productId }
 */
async function handleDeleteProduct(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);

  const { productId } = req.body || {};
  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing productId' });
  }

  const productRef = db.collection('vendorProducts').doc(productId);
  const productSnap = await productRef.get();

  if (!productSnap.exists) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = productSnap.data();

  if (product.vendorUid !== user.uid) {
    return res.status(403).json({ error: 'This product does not belong to your account' });
  }
  if (product.isDeleted) {
    return res.status(409).json({ error: 'This product has already been deleted' });
  }

  const salesSnap = await productRef.collection('sales').limit(1).get();
  const hasSales = !salesSnap.empty;

  if (hasSales) {
    await productRef.set({
      isActive: false,
      isDeleted: true,
      deletedAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.Timestamp.now()
    }, { merge: true });

    return res.status(200).json({
      success: true,
      productId,
      mode: 'soft-deleted',
      message: 'This product has sales history, so it was hidden rather than permanently removed — past buyers keep access.'
    });
  }

  const cleanupErrors = [];

  if (product.digitalAsset && product.digitalAsset.publicId) {
    try {
      await deleteAsset({ publicId: product.digitalAsset.publicId, resourceType: 'raw', type: 'authenticated' });
    } catch (err) {
      cleanupErrors.push(`digital file: ${err.message}`);
    }
  }

  for (const img of product.images || []) {
    try {
      await deleteAsset({ publicId: img.publicId, resourceType: 'image', type: 'upload' });
    } catch (err) {
      cleanupErrors.push(`image ${img.publicId}: ${err.message}`);
    }
  }

  await productRef.delete();

  if (cleanupErrors.length) {
    console.warn('Product deleted but some storage cleanup failed:', productId, cleanupErrors);
  }

  return res.status(200).json({
    success: true,
    productId,
    mode: 'hard-deleted',
    storageCleanupWarnings: cleanupErrors.length ? cleanupErrors : undefined
  });
}

/**
 * POST /api/marketplace/get-upload-signature
 * Any authenticated user. Returns everything the caller's browser needs to
 * upload a file directly to Cloudinary via a signed upload.
 *
 * Body: { productId, kind: 'media' | 'digital' }
 */
async function handleGetUploadSignature(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);

  const { productId, kind } = req.body || {};

  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid productId' });
  }
  if (!kind || !['media', 'digital'].includes(kind)) {
    return res.status(400).json({ error: "kind must be 'media' or 'digital'" });
  }

  const uploadParams = generateUploadSignature({
    vendorUid: user.uid,
    productId,
    kind
  });

  return res.status(200).json({
    success: true,
    ...uploadParams
  });
}

/**
 * POST /api/marketplace/get-download-link
 * Any authenticated user who actually bought this digital product. Called
 * on-demand from the buyer's purchase history — never store the returned
 * URL, it expires quickly by design.
 *
 * Body: { productId, reference }
 */
async function handleGetDownloadLink(req, res, admin, db) {
  const user = await getAuthedUser(req, admin);

  const { productId, reference } = req.body || {};
  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing productId' });
  }
  if (!reference || typeof reference !== 'string') {
    return res.status(400).json({ error: 'Missing reference' });
  }

  const saleRef = db.collection('vendorProducts').doc(productId).collection('sales').doc(reference);
  const saleSnap = await saleRef.get();

  if (!saleSnap.exists) {
    return res.status(404).json({ error: 'Purchase record not found' });
  }

  const sale = saleSnap.data();

  if (sale.buyerUid !== user.uid) {
    return res.status(403).json({ error: 'This purchase does not belong to this account' });
  }
  if (sale.productType !== 'digital') {
    return res.status(400).json({ error: 'This product is not a digital download' });
  }
  if (sale.fulfillmentStatus !== 'available') {
    return res.status(400).json({ error: `Download unavailable — order status: ${sale.fulfillmentStatus || 'unknown'}` });
  }

  const productSnap = await db.collection('vendorProducts').doc(productId).get();
  if (!productSnap.exists) {
    return res.status(404).json({ error: 'Product not found' });
  }
  const product = productSnap.data();

  if (!product.digitalAsset || !product.digitalAsset.publicId || !product.digitalAsset.format) {
    return res.status(500).json({ error: 'This product has no digital file on record' });
  }

  const downloadUrl = generateSignedDownloadUrl({
    publicId: product.digitalAsset.publicId,
    format: product.digitalAsset.format,
    expiresInSeconds: 900 // 15 minutes
  });

  return res.status(200).json({
    success: true,
    downloadUrl,
    expiresInSeconds: 900
  });
}

/**
 * POST /api/marketplace/create-transaction
 * One product (and therefore one vendor) per checkout — no multi-vendor cart.
 * Runs on a SEPARATE Paystack business account from courses/affiliates.
 *
 * NOTE: this handler authenticates via the raw Authorization header itself
 * (matching the original standalone file, and the pattern used by the
 * courses create-transaction.js) rather than getAuthedUser — preserved
 * exactly as-is rather than normalized, to avoid changing behavior during
 * consolidation.
 *
 * Body: { productId, quantity?, shippingAddress? }
 */
async function handleCreateTransaction(req, res, admin, db) {
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const idToken = authHeader.replace('Bearer ', '');
  if (!idToken) {
    return res.status(401).json({ error: 'Missing authorization token' });
  }

  const decoded = await admin.auth().verifyIdToken(idToken);
  const buyerUid = decoded.uid;

  const { productId, quantity, shippingAddress } = req.body || {};
  if (!productId || typeof productId !== 'string') {
    return res.status(400).json({ error: 'Missing productId' });
  }

  const qty = typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 0 ? quantity : 1;

  const productRef = db.collection('vendorProducts').doc(productId);
  const productSnap = await productRef.get();
  if (!productSnap.exists) {
    return res.status(404).json({ error: 'Product not found' });
  }

  const product = productSnap.data();

  if (!product.isActive) {
    return res.status(400).json({ error: 'This product is no longer available' });
  }
  if (typeof product.price !== 'number') {
    return res.status(400).json({ error: 'Product price must be a number in Firestore' });
  }
  if (product.vendorUid === buyerUid) {
    return res.status(400).json({ error: 'You cannot purchase your own product' });
  }

  if (product.type === 'physical') {
    if (product.stock === null || product.stock < qty) {
      return res.status(400).json({ error: 'Not enough stock available' });
    }
    if (!shippingAddress || typeof shippingAddress !== 'object') {
      return res.status(400).json({ error: 'shippingAddress is required for physical products' });
    }
    const required = ['fullName', 'phone', 'address', 'city', 'state'];
    const missing = required.filter((f) => !shippingAddress[f] || typeof shippingAddress[f] !== 'string');
    if (missing.length) {
      return res.status(400).json({ error: `shippingAddress missing: ${missing.join(', ')}` });
    }
  }

  let commissionRate = 0.15;
  try {
    const settingsSnap = await db.collection('settings').doc('marketplace').get();
    if (settingsSnap.exists && typeof settingsSnap.data().platformCommissionRate === 'number') {
      commissionRate = settingsSnap.data().platformCommissionRate;
    }
  } catch (err) {
    console.warn('Could not load marketplace settings, using default commission rate:', err.message);
  }

  const amountNaira = product.price * qty;
  const amountKobo = Math.round(amountNaira * 100);

  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY_MARKETPLACE;
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: 'PAYSTACK_SECRET_KEY_MARKETPLACE not configured' });
  }

  const origin = req.headers.origin || process.env.SITE_URL || 'https://techwizardsacademy.com';
  const callbackUrl = `${origin}/marketplace-payment-success.html`;

  const initRes = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      email: decoded.email,
      amount: amountKobo,
      callback_url: callbackUrl,
      metadata: {
        orderType: 'marketplace',
        buyerUid,
        productId,
        vendorUid: product.vendorUid,
        productTitle: product.title || 'Product',
        productType: product.type,
        quantity: qty,
        commissionRate,
        shippingAddress: product.type === 'physical' ? shippingAddress : null
      }
    })
  });

  const initJson = await initRes.json();

  if (!initJson.status) {
    console.error('Paystack init failed:', initJson);
    return res.status(502).json({ error: 'Paystack initialization failed', details: initJson });
  }

  console.log('Marketplace payment initialized:', {
    reference: initJson.data.reference,
    buyerUid,
    productId,
    vendorUid: product.vendorUid
  });

  return res.status(200).json({
    authorization_url: initJson.data.authorization_url,
    reference: initJson.data.reference
  });
}