// lib/chatbot/kb.js

const KB = {
  platform: {
    keywords: ['what is', 'safpedia', 'kbw', 'how does this work'],
    content: `Safpedia (also known as KBW Portal) is a marketplace and digital library. Buyers can purchase physical and digital products from vendors, and access courses, ebooks, audio and podcasts.`
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
    keywords: ['refund', 'dispute', 'complaint', 'problem with order', 'didn\'t receive'],
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
  }
};

const ESCALATION_TRIGGERS = [
  'refund my money', 'i want a refund', 'this is a scam', 'fraud',
  'suspend my account', 'ban', 'legal', 'lawyer', 'account balance',
  'my order status', 'where is my order', 'my payout'
];

function getKBChunks(message) {
  const lower = message.toLowerCase();
  const matched = Object.values(KB).filter((entry) =>
    entry.keywords.some((kw) => lower.includes(kw))
  );
  return matched.length ? matched : [KB.platform];
}

module.exports = { KB, getKBChunks, ESCALATION_TRIGGERS };