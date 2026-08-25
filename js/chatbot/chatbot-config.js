// js/chatbot/chatbot-config.js

export const CHATBOT_CONFIG = {
  apiBase: '/api/chatbot',
  storageKey: 'safpedia_chat_session',
  maxHistoryTurns: 10,
  botName: 'Safpedia Assistant',
  greeting: "Hi! I'm here to help with orders, vendors, courses, and more. What can I help with?",
  quickReplies: [
    'Track my order',
    'Become a vendor',
    'Refund policy',
    'How do courses work?'
  ],
  clientEscalationKeywords: ['scam', 'fraud', 'lawyer', 'legal action'],
  escalationCTA: 'Talk to a human'
};