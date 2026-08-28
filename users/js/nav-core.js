// students/js/nav-core.js
// ============================================
// CENTRALIZED DASHBOARD NAV
// Shared across dashboard.html, affiliate.html, marketplace-orders.html,
// and sellers-page.html. Replaces dashboard-nav.js and folds in what
// used to be duplicated per page:
//   - mobile sidebar drawer toggle           (was dashboard-nav.js)
//   - account dropdown open/close            (was a pasted <script>
//                                              block in every HTML file)
//   - in-page tab switching                  (was window.switchDashboardTab
//                                              in dashboard.js AND a
//                                              separate addEventListener
//                                              loop in seller-dashboard.js)
//   - #hash deep-link routing into a tab      (was openTabFromHash,
//                                              pasted near-identically in
//                                              dashboard.js and
//                                              seller-dashboard.js)
//
// Page-specific JS keeps: auth state, data loading, and the actual
// signOut() call on the logout link. This file only owns UI wiring —
// it has no Firebase imports and knows nothing about your data.
// ============================================

(function () {
  // ---------------------------------------------------------
  // MOBILE SIDEBAR DRAWER
  // ---------------------------------------------------------
  const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
  const sidebarPanel = document.querySelector('.sidebar-panel');
  const sidebarOverlay = document.getElementById('sidebar-overlay');

  function closeSidebar() {
    sidebarToggleBtn?.classList.remove('active');
    sidebarPanel?.classList.remove('open');
    sidebarOverlay?.classList.remove('open');
  }

  function openSidebar() {
    sidebarToggleBtn?.classList.add('active');
    sidebarPanel?.classList.add('open');
    sidebarOverlay?.classList.add('open');
  }

  if (sidebarToggleBtn && sidebarPanel && sidebarOverlay) {
    sidebarToggleBtn.addEventListener('click', () => {
      const isOpen = sidebarPanel.classList.contains('open');
      isOpen ? closeSidebar() : openSidebar();
    });

    sidebarOverlay.addEventListener('click', closeSidebar);

    // Close the drawer after picking a sidebar link, so it doesn't stay
    // open over the page you just navigated to.
    document.querySelectorAll('.nav-item-btn').forEach((btn) => {
      btn.addEventListener('click', closeSidebar);
    });
  }

  // ---------------------------------------------------------
  // ACCOUNT DROPDOWN
  // IDs like "admin-avatar-slot" / "seller-display-email" still vary
  // per page and are filled in by that page's own JS — this only owns
  // the open/close behavior, which was identical everywhere anyway.
  // ---------------------------------------------------------
  const avatarBtn = document.querySelector('.user-avatar-btn');
  const dropdown = document.querySelector('.user-dropdown');

  if (avatarBtn && dropdown) {
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = !dropdown.hidden;
      dropdown.hidden = isOpen;
      avatarBtn.setAttribute('aria-expanded', String(!isOpen));
    });

    document.addEventListener('click', () => {
      dropdown.hidden = true;
      avatarBtn.setAttribute('aria-expanded', 'false');
    });

    dropdown.addEventListener('click', (e) => e.stopPropagation());
  }

  // ---------------------------------------------------------
  // IN-PAGE TAB SWITCHING
  // Works for any element carrying data-tab="some-section-id" — this
  // covers both the new .page-tab bar (dashboard.html, sellers-page.html)
  // and anything else that adopts the same pattern later. A tab-styled
  // element with NO data-tab (e.g. the "Marketplace Orders" link inside
  // the Dashboard tab bar) is a real page link and is left alone — it
  // just navigates normally.
  // ---------------------------------------------------------
  function switchDashboardTab(targetTabId, element) {
    document.querySelectorAll('.dashboard-section-card').forEach((tab) => {
      tab.classList.remove('active-tab');
    });
    document.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.classList.remove('active');
    });

    const target = document.getElementById(targetTabId);
    if (target) target.classList.add('active-tab');
    if (element) element.classList.add('active');
  }
  window.switchDashboardTab = switchDashboardTab;

  document.querySelectorAll('[data-tab]').forEach((el) => {
    el.addEventListener('click', () => switchDashboardTab(el.dataset.tab, el));
  });

  // ---------------------------------------------------------
  // #HASH DEEP-LINK ROUTING
  // Lets one page send a user straight to a specific tab on another —
  // e.g. a link to "dashboard.html#history-pane" opens Purchase History
  // immediately instead of landing on the default tab.
  // ---------------------------------------------------------
  function openTabFromHash() {
    const targetId = window.location.hash.slice(1);
    if (!targetId) return;

    const targetSection = document.getElementById(targetId);
    if (!targetSection || !targetSection.classList.contains('dashboard-section-card')) return;

    const targetBtn = document.querySelector(`[data-tab="${targetId}"]`);
    switchDashboardTab(targetId, targetBtn);
  }

  window.addEventListener('DOMContentLoaded', openTabFromHash);
  window.addEventListener('hashchange', openTabFromHash);
})();