// Simple PWA registration and install prompt handler
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js')
      .then(reg => {
        console.log('Service worker registered.', reg);
      })
      .catch(err => {
        console.warn('Service worker registration failed:', err);
      });
  });
}

// Optional: capture the beforeinstallprompt event so you can show a custom install button
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  deferredPrompt = e;
  // Dispatch a custom event so UI can listen for it (if you add an install button later)
  window.dispatchEvent(new CustomEvent('pwa-install-ready'));
});

// Helper to trigger the saved install prompt (callable from other scripts)
window.triggerPWAInstall = async function() {
  if (!deferredPrompt) return null;
  deferredPrompt.prompt();
  const choiceResult = await deferredPrompt.userChoice;
  deferredPrompt = null;
  return choiceResult;
};
