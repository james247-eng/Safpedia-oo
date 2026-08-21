const TIERS = Object.freeze({
  safseed: Object.freeze({
    displayName: 'Safseed', monthlyPrice: 0, annualPrice: null, durationDays: null, productLimit: 3
  }),
  safbloom: Object.freeze({
    displayName: 'SafBloom', monthlyPrice: 6300, annualPrice: 68796, durationDays: 30, productLimit: 30
  }),
  safscale: Object.freeze({
    displayName: 'SafScale', monthlyPrice: 10500, annualPrice: 108360, durationDays: 30, productLimit: 75
  })
});

/**
 * Vendor fields: subscriptionTier, subscriptionStatus, subscriptionExpiresAt,
 * subscriptionStartedAt, subscriptionPaystackReference,
 * subscriptionOverrideActive, subscriptionUpdatedAt, storefrontActive, and
 * isSuspended. storefrontActive defaults to true when missing.
 * Existing vendor documents may omit them and default to Safseed.
 */
function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  return null;
}

function evaluateVendorCreateProductAccess(vendorDoc, activeProductCount, now = new Date()) {
  const vendor = vendorDoc && typeof vendorDoc === 'object' ? vendorDoc : {};
  const tierKey = Object.prototype.hasOwnProperty.call(TIERS, vendor.subscriptionTier)
    ? vendor.subscriptionTier
    : 'safseed';
  const tier = TIERS[tierKey];

  if (vendor.isSuspended === true) {
    return { allowed: false, reasonCode: 'suspended', message: 'This vendor account is suspended and cannot create new products' };
  }

  if (tierKey !== 'safseed' && vendor.subscriptionOverrideActive !== true) {
    const expiryMillis = timestampToMillis(vendor.subscriptionExpiresAt);
    const active = vendor.subscriptionStatus === 'active'
      && expiryMillis !== null
      && expiryMillis > now.getTime();
    if (!active) {
      return { allowed: false, reasonCode: 'subscription_expired', message: 'Your subscription has expired. Please renew before creating a product.' };
    }
  }

  const count = Number.isFinite(activeProductCount) && activeProductCount >= 0 ? activeProductCount : 0;
  if (count >= tier.productLimit) {
    return { allowed: false, reasonCode: 'limit_reached', message: `You have reached the ${tier.productLimit}-product limit for ${tier.displayName}. Upgrade to add more products.` };
  }

  return { allowed: true, reasonCode: 'ok', message: 'Product creation is allowed.' };
}

module.exports = { TIERS, evaluateVendorCreateProductAccess };
