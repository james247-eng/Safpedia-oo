// js/chatbot/chatbot-ui.js

import { CHATBOT_CONFIG } from './chatbot-config.js';

export function renderShell(root) {
  root.innerHTML = `
    <div class="cb-bubble" id="cb-bubble" aria-label="Open chat">💬</div>
    <div class="cb-panel" id="cb-panel" hidden>
      <div class="cb-header">
        <span>${CHATBOT_CONFIG.botName}</span>
        <button class="cb-close" id="cb-close" aria-label="Close chat">×</button>
      </div>
      <div class="cb-messages" id="cb-messages"></div>
      <div class="cb-quick-replies" id="cb-quick-replies"></div>
      <form class="cb-input-row" id="cb-form">
        <input type="text" id="cb-input" placeholder="Type a message…" autocomplete="off" />
        <button type="submit" id="cb-send">Send</button>
      </form>
    </div>
  `;
}

export function renderQuickReplies(container, onPick) {
  container.innerHTML = '';
  CHATBOT_CONFIG.quickReplies.forEach((text) => {
    const chip = document.createElement('button');
    chip.className = 'cb-chip';
    chip.type = 'button';
    chip.textContent = text;
    chip.addEventListener('click', () => onPick(text));
    container.appendChild(chip);
  });
}

export function appendMessage(container, role, content) {
  const bubble = document.createElement('div');
  bubble.className = `cb-msg cb-msg--${role}`;
  bubble.textContent = content;
  container.appendChild(bubble);
  container.scrollTop = container.scrollHeight;
  return bubble;
}

export function appendTyping(container) {
  const el = document.createElement('div');
  el.className = 'cb-msg cb-msg--assistant cb-typing';
  el.innerHTML = `<span></span><span></span><span></span>`;
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}

export function appendEscalation(container, text, whatsappLink) {
  const wrap = document.createElement('div');
  wrap.className = 'cb-escalation';

  const waButton = whatsappLink
    ? `<a href="${whatsappLink}" target="_blank" rel="noopener" class="cb-escalation-btn cb-escalation-btn--whatsapp">${CHATBOT_CONFIG.escalationCTA}</a>`
    : '';

  wrap.innerHTML = `
    <p>${text}</p>
    ${waButton}
    <p class="cb-escalation-hint">Or type your email or WhatsApp number below and we'll reach you.</p>
  `;
  container.appendChild(wrap);
  container.scrollTop = container.scrollHeight;
}