// js/chatbot/chatbot-state.js

import { CHATBOT_CONFIG } from './chatbot-config.js';

function loadState() {
  try {
    const raw = sessionStorage.getItem(CHATBOT_CONFIG.storageKey);
    if (raw) return JSON.parse(raw);
  } catch (err) {
    console.warn('Chatbot: could not read session storage', err);
  }
  return { sessionId: crypto.randomUUID(), messages: [] };
}

function saveState(state) {
  try {
    sessionStorage.setItem(CHATBOT_CONFIG.storageKey, JSON.stringify(state));
  } catch (err) {
    console.warn('Chatbot: could not write session storage', err);
  }
}

export class ChatState {
  constructor() {
    this._state = loadState();
  }

  get sessionId() {
    return this._state.sessionId;
  }

  get messages() {
    return this._state.messages;
  }

  addMessage(role, content) {
    this._state.messages.push({ role, content });
    if (this._state.messages.length > CHATBOT_CONFIG.maxHistoryTurns * 2) {
      this._state.messages = this._state.messages.slice(-CHATBOT_CONFIG.maxHistoryTurns * 2);
    }
    saveState(this._state);
  }

  historyForApi() {
    return this._state.messages
      .slice(-CHATBOT_CONFIG.maxHistoryTurns)
      .map(({ role, content }) => ({ role, content }));
  }

  async send(message) {
    this.addMessage('user', message);

    const res = await fetch(`${CHATBOT_CONFIG.apiBase}/message?action=message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: this.sessionId,
        message,
        history: this.historyForApi()
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw Object.assign(new Error(err.error || 'Something went wrong'), { status: res.status });
    }

    const data = await res.json();
    this.addMessage('assistant', data.reply);
    return data;
  }
}