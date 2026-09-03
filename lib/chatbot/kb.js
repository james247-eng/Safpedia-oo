// lib/chatbot/kb.js

const KB = {
  platform: {
    keywords: ['what is', 'safpedia', 'how does this work'],
    content: `Safpedia is a marketplace and digital library. Buyers can purchase physical and digital products from vendors, and access courses, ebooks, audio and podcasts.`
  },
  paymentFlow: {
    keywords: ['pay', 'payment', 'checkout', 'paystack', 'card'],
    content: `Payments are processed securely through Paystack. Buyers select a product, complete payment via Paystack (card, bank transfer, or USSD), and receive confirmation immediately. Digital products deliver a secure download link; physical products are shipped by the vendor.`
  },
  vendors: {
    keywords: ['vendor', 'sell', 'become a vendor', 'storefront', 'subscription', 'tier', 'payout'],
    content: `Anyone can become a vendor by opening a storefront and choosing a subscription tier (monthly or annual). Tiers determine product limits and storefront features. Vendor payouts are requested from the vendor balance and settled via Paystack transfer.`
  },
  disputes: {
    keywords: ['refund', 'dispute', 'complaint', 'problem with order', "didn't receive"],
    content: `If there's an issue with an order, buyers can file a complaint through their order history. Vendors are notified and can respond. If unresolved, an admin reviews and makes the final decision.`
  },
  library: {
    keywords: ['course', 'ebook', 'podcast', 'enroll', 'certificate'],
    content: `The digital library offers courses, ebooks, and audio/podcasts. After purchase, users are enrolled automatically and can access content from their dashboard. Certificates are issued on course completion where applicable.`
  },
  affiliates: {
    keywords: ['affiliate', 'referral', 'commission'],
    content: `The affiliate program lets users earn commissions by referring buyers. Commissions are credited automatically when a referred purchase is verified.`
  },
  account: {
    keywords: ['login', 'sign in', 'sign up', 'password', 'google', 'facebook'],
    content: `Users can sign up or log in with email, or via Google/Facebook. Password resets are available from the login page.`
  },
  dashboard: {
    keywords: ['my dashboard', 'my courses', 'progress', 'certificate', 'continue learning'],
    content: `Your dashboard shows your enrolled courses with progress tracking. Once a course is completed, a certificate becomes available — click the Certificate button to generate and view it.`
  },
  marketplaceOrders: {
    keywords: ['my order', 'track order', 'download link', 'order status'],
    content: `Marketplace orders (separate from course purchases) can be viewed from Marketplace Orders. Digital products show a Download button once ready — clicking it generates a fresh secure link. Physical orders show shipping status (pending, shipped, delivered).`
  },
  reportingProblem: {
    keywords: ['report a problem', 'file a dispute', 'item not received', 'not as described'],
    content: `If there's an issue with a marketplace order, open that order and click "Report a problem." Choose a reason (item not received, not as described, digital access problem, or other), describe what happened, and submit. You can track the dispute status from the same order afterward.`
  },
  disputeStatuses: {
    keywords: ['dispute status', 'what does under review mean', 'resolved in my favor'],
    content: `Dispute statuses are: Under review, Vendor responded (awaiting decision), Resolved in your favor, Resolved in vendor's favor, or Closed. You'll see the vendor's response and the outcome once resolved.`
  },
  affiliateProgram: {
    keywords: ['affiliate', 'referral link', 'become an affiliate', 'refer', 'commission rate'],
    content: `To join the affiliate program, submit an application from the Affiliate page — applications are typically reviewed within 2 business days. Once approved, you get a unique referral link; purchases made through it earn you commission, visible in your stats and Recent Sales.`
  },
  affiliatePayouts: {
    keywords: ['affiliate payout', 'withdraw commission', 'affiliate bank account'],
    content: `Affiliates add a bank account (re-confirming identity for security) and can then request a payout of their full available balance. Payout history and status are visible on the same page.`
  },
  vendorProducts: {
    keywords: ['add product', 'list a product', 'edit product', 'delete product', 'my storefront'],
    content: `Vendors manage listings from the Sell on SAFpedia dashboard. New listings go live immediately with no approval step. Products with no sales can be deleted outright; products with sales history are hidden instead of deleted.`
  },
  vendorOrders: {
    keywords: ['vendor orders', 'mark shipped', 'fulfil order', 'my sales'],
    content: `Vendors track sales from the Orders tab. Physical orders are marked Shipped then Delivered by the vendor; digital orders are fulfilled automatically with no action needed.`
  },
  vendorSubscriptionTiers: {
    keywords: ['vendor tier', 'safseed', 'safbloom', 'safscale', 'upgrade plan', 'renew subscription'],
    content: `Vendor plans are Safseed (free), SafBloom, and SafScale, billed monthly or annually. Higher tiers unlock more product listings and features. If a plan lapses, listings become temporarily inactive until it's renewed.`
  },
  vendorDisputesHandling: {
    keywords: ['respond to dispute', 'buyer complaint about my product'],
    content: `Vendors can view and respond to disputes filed against their sales from the Disputes tab. A response can be submitted while a dispute is open; once resolved, the outcome is shown instead.`
  }
};

const ESCALATION_TRIGGERS = [
  'refund my money', 'i want a refund', 'this is a scam', 'fraud',
  'suspend my account', 'ban', 'legal', 'lawyer', 'account balance',
  'my order status', 'where is my order', 'my payout', 'speak to a human',
  'talk to support', 'talk to someone', 'customer service'
];

function getKBChunks(message) {
  const lower = message.toLowerCase();
  const matched = Object.values(KB).filter((entry) =>
    entry.keywords.some((kw) => lower.includes(kw))
  );
  return matched.length ? matched : [KB.platform];
}

module.exports = { KB, getKBChunks, ESCALATION_TRIGGERS };