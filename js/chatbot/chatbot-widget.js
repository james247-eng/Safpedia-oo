// js/chatbot/chatbot-widget.js

import { CHATBOT_CONFIG } from './chatbot-config.js';
import { ChatState } from './chatbot-state.js';
import { renderShell, renderQuickReplies, appendMessage, appendTyping, appendEscalation } from './chatbot-ui.js';

export function initChatbot(shadowRoot) {
  const state = new ChatState();
  renderShell(shadowRoot);

  const bubble = shadowRoot.getElementById('cb-bubble');
  const panel = shadowRoot.getElementById('cb-panel');
  const closeBtn = shadowRoot.getElementById('cb-close');
  const messagesEl = shadowRoot.getElementById('cb-messages');
  const quickRepliesEl = shadowRoot.getElementById('cb-quick-replies');
  const form = shadowRoot.getElementById('cb-form');
  const input = shadowRoot.getElementById('cb-input');

  let opened = false;

  function open() {
    panel.hidden = false;
    panel.removeAttribute('hidden');
    bubble.classList.add('cb-bubble--active');
    opened = true;
    if (!state.messages.length) {
      appendMessage(messagesEl, 'assistant', CHATBOT_CONFIG.greeting);
    }
    input.focus();
  }

  function close(e) {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    panel.hidden = true;
    panel.setAttribute('hidden', '');
    bubble.classList.remove('cb-bubble--active');
    opened = false;
  }

  bubble.addEventListener('click', (e) => {
    e.stopPropagation();
    if (opened) {
      close(e);
    } else {
      open();
    }
  });

  closeBtn.addEventListener('click', close);

  renderQuickReplies(quickRepliesEl, (text) => handleSend(text));

  async function handleSend(text) {
    const trimmed = text.trim();
    if (!trimmed) return;

    appendMessage(messagesEl, 'user', trimmed);
    input.value = '';

    const shouldWarnClientSide = CHATBOT_CONFIG.clientEscalationKeywords.some((kw) =>
      trimmed.toLowerCase().includes(kw)
    );

    const typingEl = appendTyping(messagesEl);

    try {
      const data = await state.send(trimmed);
      typingEl.remove();

      if (data.escalate) {
        appendEscalation(messagesEl, data.reply);
      } else {
        appendMessage(messagesEl, 'assistant', data.reply);
      }
    } catch (err) {
      typingEl.remove();
      if (err.status === 429) {
        appendMessage(messagesEl, 'assistant', "You're sending messages a bit fast — give it a moment and try again.");
      } else {
        appendMessage(messagesEl, 'assistant', "Sorry, something went wrong. Please try again in a bit.");
      }
    }

    if (shouldWarnClientSide) {
      // reserved: could surface escalation CTA immediately client-side
      // without waiting on the API response, if desired later
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    handleSend(input.value);
  });

  // Replay any existing history from this session (e.g. after refresh)
  state.messages.forEach((m) => appendMessage(messagesEl, m.role, m.content));
}