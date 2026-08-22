import { auth } from '/firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js';

const INTENT_KEY = 'safpedia-vendor-subscription-intent';
let authUser = null;
onAuthStateChanged(auth, (user) => { authUser = user; });

function saveIntent(tier, billingCycle) {
  localStorage.setItem(INTENT_KEY, JSON.stringify({ tier, billingCycle, createdAt: Date.now() }));
}

async function loadTiers() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch('/api/marketplace/get-tier-config', { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || 'Could not load tier pricing');
  return json.tiers || {};
}

async function init() {
  document.querySelectorAll('[data-tier-card] .billing-choice').forEach((button) => button.addEventListener('click', () => {
    button.parentElement.querySelectorAll('.billing-choice').forEach((b) => b.classList.remove('active'));
    button.classList.add('active');
  }));
  document.querySelectorAll('.vendor-tier-cta').forEach((button) => button.addEventListener('click', () => {
    const tier = button.dataset.tier;
    if (tier === 'safseed') { window.location.href = '/sign-up.html'; return; }
    const cycle = button.closest('[data-tier-card]')?.querySelector('.billing-choice.active')?.dataset.cycle || 'monthly';
    saveIntent(tier, cycle);
    window.location.href = authUser ? '/users/sellers-page.html#subscription-pane' : '/sign-in.html';
  }));

  let tiers;
  try { tiers = await loadTiers(); } catch (err) {
    console.error('Could not load tier config:', err);
    document.querySelectorAll('[data-tier-card]').forEach((card) => {
      card.querySelector('[data-price-monthly]').textContent = 'Pricing temporarily unavailable';
      card.querySelector('[data-tier-details]').textContent = 'Please refresh and try again.';
    });
    return;
  }
  document.querySelectorAll('[data-tier-card]').forEach((card) => {
    const tier = tiers[card.dataset.tierCard];
    if (!tier) return;
    card.querySelector('[data-price-monthly]').textContent = `₦${Number(tier.monthlyPrice).toLocaleString()}/month`;
    card.querySelector('[data-tier-details]').textContent = `${tier.productLimit} active products. Annual: ₦${Number(tier.annualPrice).toLocaleString()}.`;
  });
}
init();
