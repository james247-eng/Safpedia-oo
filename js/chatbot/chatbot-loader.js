// js/chatbot/chatbot-loader.js
// Single script tag to add on every page: <script type="module" src="/js/chatbot/chatbot-loader.js" defer></script>

(async function loadChatbot() {
  const host = document.createElement('div');
  host.id = 'safpedia-chatbot-host';
  document.body.appendChild(host);

  try {
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const cssUrl = new URL('../../css/chatbot/chatbot-widget.css', import.meta.url);
    const widgetUrl = new URL('./chatbot-widget.js', import.meta.url);

    const cssRes = await fetch(cssUrl);
    if (!cssRes.ok) {
      throw new Error(`Chatbot stylesheet failed to load (${cssRes.status})`);
    }

    const { initChatbot } = await import(widgetUrl.href);
    initChatbot(shadowRoot);

    const styleEl = document.createElement('style');
    styleEl.textContent = await cssRes.text();
    shadowRoot.prepend(styleEl);
  } catch (error) {
    console.error('Chatbot failed to load:', error);
    host.remove();
  }
})();