// api/chatbot/[action].js

const { getFirebaseAdmin } = require('../../lib/firebase-admin');
const { requireAdmin } = require('../../lib/auth');
const { sendEmail } = require('../utils/[action]');
const { getKBChunks, ESCALATION_TRIGGERS } = require('../../lib/chatbot/kb');
const { buildSystemPrompt, detectEscalation } = require('../../lib/chatbot/promptBuilder');
const { checkRateLimit } = require('../../lib/chatbot/rateLimiter');
const { getChatCompletion } = require('../../lib/chatbot/groqClient');

const MAX_MESSAGE_LENGTH = 1000;
const MAX_HISTORY_TURNS = 10;
const APP_URL = process.env.APP_URL || 'https://safpedia-oo.vercel.app';
const ADMIN_NOTIFICATION_EMAIL = process.env.ADMIN_NOTIFICATION_EMAIL;

/**
 * Consolidated chatbot router — one Vercel serverless function serving
 * multiple routes via the [action] dynamic segment, to stay under the
 * Hobby plan's 12-function-per-deployment cap.
 *
 *   GET  /api/chatbot/health                    -> health check
 *   POST /api/chatbot/message                    -> handleMessage
 *   POST /api/chatbot/escalate-submit             -> handleEscalateSubmit
 *   GET  /api/chatbot/list-escalations            -> handleListEscalations (admin)
 *   POST /api/chatbot/update-escalation-status    -> handleUpdateEscalationStatus (admin)
 */
module.exports = async (req, res) => {
  const { action } = req.query;

  if (req.method === 'GET' && action === 'health') {
    return res.status(200).json({ ok: true });
  }

  try {
    const admin = getFirebaseAdmin();
    const db = admin.firestore();

    if (req.method === 'GET' && action === 'list-escalations') {
      return await handleListEscalations(req, res, admin, db);
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    switch (action) {
      case 'message':
        return await handleMessage(req, res, admin, db);
      case 'escalate-submit':
        return await handleEscalateSubmit(req, res, admin, db);
      case 'update-escalation-status':
        return await handleUpdateEscalationStatus(req, res, admin, db);
      default:
        return res.status(404).json({ error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error(`chatbot/${action} error:`, err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
};

/**
 * POST /api/chatbot/message
 * Public — no auth required (Tier 1, KB-only, no account data touched).
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

  const trimmedHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];

  const escalation = detectEscalation(message, ESCALATION_TRIGGERS);
  if (escalation.shouldEscalate) {
    return res.status(200).json({
      reply: escalation.message,
      escalate: true,
      reason: escalation.reason,
      whatsappLink: escalation.whatsappLink
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

/**
 * POST /api/chatbot/escalate-submit
 * Public — no auth. Called once a user provides an email or WhatsApp
 * number after an escalation trigger fired. Writes to Firestore and
 * notifies the admin by email.
 *
 * Body: { sessionId, contact, transcript?: [{role, content}] }
 */
async function handleEscalateSubmit(req, res, admin, db) {
  const { sessionId, contact, topic: submittedTopic, transcript } = req.body || {};

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Missing sessionId' });
  }
  if (!contact || typeof contact !== 'string' || !contact.trim()) {
    return res.status(400).json({ error: 'Missing contact info' });
  }

  const trimmedContact = contact.trim();
  const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedContact);
  const isPhone = /^[+\d][\d\s-]{7,}$/.test(trimmedContact);

  if (!isEmail && !isPhone) {
    return res.status(200).json({
      reply: "That doesn't look like a valid email or phone number — mind trying again?",
      escalate: true
    });
  }

  const contactMethod = isEmail ? 'email' : 'whatsapp';
  const safeTranscript = Array.isArray(transcript) ? transcript.slice(-10) : [];
  const topic = typeof submittedTopic === 'string' && submittedTopic.trim()
    ? submittedTopic.trim().slice(0, 200)
    : 'General inquiry';

  const escalationRef = db.collection('chatbotEscalations').doc();
  const escalationData = {
    sessionId,
    contact: trimmedContact,
    contactMethod,
    topic,
    transcript: safeTranscript,
    status: 'new',
    source: 'chatbot',
    createdAt: admin.firestore.Timestamp.now(),
    contactedAt: null,
    resolvedAt: null
  };

  await escalationRef.set(escalationData);

  if (ADMIN_NOTIFICATION_EMAIL) {
    try {
      await sendEmail({
        toEmail: ADMIN_NOTIFICATION_EMAIL,
        toName: 'Safpedia Admin',
        subject: `New chatbot escalation (${contactMethod})`,
        headline: 'A user needs support 🚨',
        bodyContent: `Contact (${contactMethod}): ${trimmedContact}\n\nTopic: ${topic}`,
        actionUrl: `${APP_URL}/admin/chatbot-inquiries.html?id=${escalationRef.id}`,
        actionText: 'View Inquiry'
      });
    } catch (err) {
      console.error('Failed to send admin escalation email (non-blocking):', err.message);
    }
  }

  return res.status(200).json({
    reply: "Thanks — I've passed this on to our team, and someone will reach out to you shortly.",
    escalate: false
  });
}

/**
 * GET /api/chatbot/list-escalations
 * Admin-only. Optional ?status=new|contacted|resolved filter.
 */
async function handleListEscalations(req, res, admin, db) {
  await requireAdmin(req, admin);

  const { status } = req.query;
  let query = db.collection('chatbotEscalations').orderBy('createdAt', 'desc').limit(100);
  if (status && ['new', 'contacted', 'resolved'].includes(status)) {
    query = db.collection('chatbotEscalations').where('status', '==', status).orderBy('createdAt', 'desc').limit(100);
  }

  const snap = await query.get();
  const escalations = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  return res.status(200).json({ escalations });
}

/**
 * POST /api/chatbot/update-escalation-status
 * Admin-only.
 *
 * Body: { escalationId, status: 'contacted' | 'resolved' }
 */
async function handleUpdateEscalationStatus(req, res, admin, db) {
  await requireAdmin(req, admin);

  const { escalationId, status } = req.body || {};
  if (!escalationId || typeof escalationId !== 'string') {
    return res.status(400).json({ error: 'Missing escalationId' });
  }
  if (!['contacted', 'resolved'].includes(status)) {
    return res.status(400).json({ error: "status must be 'contacted' or 'resolved'" });
  }

  const ref = db.collection('chatbotEscalations').doc(escalationId);
  const snap = await ref.get();
  if (!snap.exists) {
    return res.status(404).json({ error: 'Escalation not found' });
  }

  const update = { status };
  if (status === 'contacted') update.contactedAt = admin.firestore.Timestamp.now();
  if (status === 'resolved') update.resolvedAt = admin.firestore.Timestamp.now();

  await ref.set(update, { merge: true });

  const updatedSnap = await ref.get();
  return res.status(200).json({ success: true, escalation: { id: updatedSnap.id, ...updatedSnap.data() } });
}