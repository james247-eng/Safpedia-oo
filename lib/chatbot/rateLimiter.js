// lib/chatbot/rateLimiter.js

const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 15;

async function checkRateLimit(db, sessionId, ip) {
  const safeSession = typeof sessionId === 'string' ? sessionId.slice(0, 128).replace(/[^a-zA-Z0-9_-]/g, '_') : '';
  const safeIp = typeof ip === 'string' ? ip.split(',')[0].trim().slice(0, 64) : '';
  const refs = [db.collection('chatbotRateLimits').doc(`session_${safeSession || 'anonymous'}`)];
  if (safeIp) refs.push(db.collection('chatbotRateLimits').doc(`ip_${safeIp.replace(/[^a-zA-Z0-9_.:-]/g, '_')}`));
  const now = Date.now();

  const result = await db.runTransaction(async (tx) => {
    const snaps = await Promise.all(refs.map((ref) => tx.get(ref)));
    const data = snaps.map((snap) => snap.exists ? snap.data() : { count: 0, windowStart: now });

    const blocked = data.find((d) => now - d.windowStart <= WINDOW_SECONDS * 1000 && d.count >= MAX_REQUESTS_PER_WINDOW);
    if (blocked) return { allowed: false, retryAfterSeconds: Math.ceil((blocked.windowStart + WINDOW_SECONDS * 1000 - now) / 1000) };
    data.forEach((d, i) => tx.set(refs[i], now - d.windowStart > WINDOW_SECONDS * 1000 ? { count: 1, windowStart: now } : { count: d.count + 1, windowStart: d.windowStart }));
    return { allowed: true };
  });

  return result;
}

module.exports = { checkRateLimit };
