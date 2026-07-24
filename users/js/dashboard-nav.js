// Toggles the dashboard sidebar drawer on mobile via the hamburger button.
const sidebarToggleBtn = document.getElementById("sidebar-toggle-btn");
const sidebarPanel = document.querySelector(".sidebar-panel");
const sidebarOverlay = document.getElementById("sidebar-overlay");

function closeSidebar() {
  sidebarToggleBtn.classList.remove("active");
  sidebarPanel.classList.remove("open");
  sidebarOverlay.classList.remove("open");
}

function openSidebar() {
  sidebarToggleBtn.classList.add("active");
  sidebarPanel.classList.add("open");
  sidebarOverlay.classList.add("open");
}

if (sidebarToggleBtn && sidebarPanel && sidebarOverlay) {
  sidebarToggleBtn.addEventListener("click", () => {
    const isOpen = sidebarPanel.classList.contains("open");
    isOpen ? closeSidebar() : openSidebar();
  });

  sidebarOverlay.addEventListener("click", closeSidebar);

  // Close the drawer after picking a nav item, so it doesn't stay open
  // over the tab you just switched to.
  document.querySelectorAll(".nav-item-btn").forEach((btn) => {
    btn.addEventListener("click", closeSidebar);
  });
}