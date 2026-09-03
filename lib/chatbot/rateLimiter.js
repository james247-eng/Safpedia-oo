// lib/chatbot/rateLimiter.js

const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 15;

async function checkRateLimit(db, sessionId, ip) {
  const key = sessionId || ip || 'anonymous';
  const ref = db.collection('chatbotRateLimits').doc(key);
  const now = Date.now();

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() : { count: 0, windowStart: now };

    if (now - data.windowStart > WINDOW_SECONDS * 1000) {
      tx.set(ref, { count: 1, windowStart: now });
      return { allowed: true };
    }
    if (data.count >= MAX_REQUESTS_PER_WINDOW) {
      const retryAfterSeconds = Math.ceil((data.windowStart + WINDOW_SECONDS * 1000 - now) / 1000);
      return { allowed: false, retryAfterSeconds };
    }
    tx.set(ref, { count: data.count + 1, windowStart: data.windowStart });
    return { allowed: true };
  });

  return result;
}

module.exports = { checkRateLimit };