//<!-- PWA Install Button - Add this where you want the install prompt to appear -->
/* <div class="pwa-install-prompt" id="pwaInstallPrompt" style="display: none; position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%); background: #fff; padding: 15px 25px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); z-index: 1000; display: flex; align-items: center; gap: 12px;">
    <img src="/favicon/android-chrome-192x192.png" alt="Tech Wizards Academy" style="width: 32px; height: 32px;">
    <div style="flex-grow: 1;">
        <p style="margin: 0 0 4px 0; font-weight: 600;">Install Tech Wizards Academy</p>
        <p style="margin: 0; font-size: 14px; opacity: 0.8;">Get quick access to courses on your device</p>
    </div>
    <button onclick="installPWA()" style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Install</button>
    <button onclick="closePWAPrompt()" style="background: none; border: none; padding: 8px; cursor: pointer; opacity: 0.5;">&times;</button>
</div>

<style>
.pwa-install-prompt {
    font-family: 'Inter', sans-serif;
    animation: slideUp 0.3s ease-out;
}
@keyframes slideUp {
    from { transform: translate(-50%, 100%); opacity: 0; }
    to { transform: translate(-50%, 0); opacity: 1; }
}
.pwa-install-prompt button:hover {
    opacity: 0.9;
}
</style>

<script> */
// PWA install prompt handling
window.deferredPrompt = null;
document.addEventListener('DOMContentLoaded', function() {
    const pwaPrompt = document.getElementById('pwaInstallPrompt');
    let hasUserSeen = localStorage.getItem('pwaPromptSeen');

// Listen for 'beforeinstallprompt' event
    // Listen for beforeinstallprompt event
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 76+ from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later
        window.deferredPrompt = e;
        
        // Show the install prompt if user hasn't seen it
        if (!hasUserSeen && pwaPrompt) {
            pwaPrompt.style.display = 'flex';
        }
    });

// Handle the install button click
    window.installPWA = async function() {
        if (!window.deferredPrompt) return;
        
        // Show the install prompt
        window.deferredPrompt.prompt();
        
        // Wait for the user to respond to the prompt
        const { outcome } = await window.deferredPrompt.userChoice;
        console.log(`User response to install prompt: ${outcome}`);
        
        // Clear the saved prompt since it can't be used again
        window.deferredPrompt = null;
        
        // Hide our custom button
        window.closePWAPrompt();
    }

    window.closePWAPrompt = function() {
        if (pwaPrompt) {
            pwaPrompt.style.display = 'none';
            localStorage.setItem('pwaPromptSeen', 'true');
        }
    }

    // Clear the "seen" flag when the app is installed successfully
    window.addEventListener('appinstalled', (evt) => {
        localStorage.removeItem('pwaPromptSeen');
    });
});
