// api/chatbot/[action].js

const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { getKBChunks, ESCALATION_TRIGGERS } = require('../../lib/chatbot/kb');
const { buildSystemPrompt, detectEscalation } = require('../../lib/chatbot/promptBuilder');
const { checkRateLimit } = require('../../lib/chatbot/rateLimiter');
const { getChatCompletion } = require('../../lib/chatbot/groqClient');

const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_TURNS = 10;

/**
 * Consolidated chatbot router — one Vercel serverless function serving
 * multiple routes via the [action] dynamic segment, to stay under the
 * Hobby plan's 12-function-per-deployment cap.
 *
 *   GET  /api/chatbot/health           -> handleHealth
 *   POST /api/chatbot/message          -> handleMessage
 *
 * No webhook/raw-body routes here, so no split needed like marketplace's
 * webhook.js — every route in this file expects parsed JSON bodies.
 */
module.exports = async (req, res) => {
  if (req.method === 'GET' && req.query.action === 'health') {
    return res.status(200).json({ ok: true });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { action } = req.query;

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    switch (action) {
      case 'message':
        return await handleMessage(req, res, admin, db);
      default:
        return res.status(404).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`chatbot/${action} error:`, err);
    const status = err.statusCode && err.statusCode >= 400 && err.statusCode < 600 ? err.statusCode : 500;
    return res.status(status).json({ error: status === 502 ? 'Chat service temporarily unavailable' : 'Unable to process your request' });
  }
};

/**
 * POST /api/chatbot/message
 * Public — no auth required for Tier 1 (KB-only, no account data touched).
 * Session-scoped rate limiting via a client-generated session ID.
 *
 * Body: { sessionId, message, history?: [{role, content}] }
 */
async function handleMessage(req, res, admin, db) {
  const { sessionId, message, history } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Missing sessionId' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'Missing message' });
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `message must be ${MAX_MESSAGE_LENGTH} characters or fewer` });
  }

  const rate = await checkRateLimit(db, sessionId, req.headers['x-forwarded-for']);
  if (!rate.allowed) {
    return res.status(429).json({ error: 'Too many messages — please slow down', retryAfterSeconds: rate.retryAfterSeconds });
  }

  const trimmedHistory = Array.isArray(history) ? history.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.length <= MAX_MESSAGE_LENGTH).slice(-MAX_HISTORY_TURNS) : [];

  const escalation = detectEscalation(message, ESCALATION_TRIGGERS);
  if (escalation.shouldEscalate) {
    return res.status(200).json({
      reply: escalation.message,
      escalate: true,
      reason: escalation.reason
    });
  }

  const kbChunks = getKBChunks(message);
  const systemPrompt = buildSystemPrompt(kbChunks);

  const reply = await getChatCompletion({
    systemPrompt,
    history: trimmedHistory,
    message
  });

  return res.status(200).json({ reply, escalate: false });
}
