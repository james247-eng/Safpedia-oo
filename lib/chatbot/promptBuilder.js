// lib/chatbot/promptBuilder.js

function buildSystemPrompt(kbChunks) {
  const kbText = kbChunks.map((c) => c.content).join('\n\n');
  return `You are the Safpedia customer support assistant. Answer ONLY using the knowledge below. Never invent policy details, prices, or timelines not stated here. Keep answers short and friendly. If the question needs account-specific data (order status, balance, refund decision) or isn't covered below, say you'll connect them with support instead of guessing.

Knowledge:
${kbText}`;
}

function buildWhatsAppLink() {
  const number = process.env.SUPPORT_WHATSAPP_NUMBER;
  const text = encodeURIComponent('Hi, I need help with something on Safpedia');
  return number ? `https://wa.me/${number}?text=${text}` : null;
}

function detectEscalation(message, triggers) {
  const lower = message.toLowerCase();
  const hit = triggers.find((t) => lower.includes(t));
  if (hit) {
    return {
      shouldEscalate: true,
      reason: hit,
      message: `I'd like to get our team involved on this one. Could you share your email or WhatsApp number so someone can reach you? Or you can message us directly on WhatsApp.`,
      whatsappLink: buildWhatsAppLink()
    };
  }
  return { shouldEscalate: false };
}

module.exports = { buildSystemPrompt, detectEscalation, buildWhatsAppLink };