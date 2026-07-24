     // Hides the preloader once the page has fully loaded.
window.addEventListener("load", () => {
  const preloader = document.getElementById("preoader");
  if (preloader) preloader.classList.add("hidden");
});

// Toggles the mobile nav menu open/closed via the hamburger button.
const menuBtn = document.getElementById("mobile-menu-btn");
const mobileMenu = document.getElementById("mobile-menu");

if (menuBtn && mobileMenu) {
  menuBtn.addEventListener("click", () => {
    menuBtn.classList.toggle("active");
    mobileMenu.classList.toggle("active");
  });

  // Close the menu when a link inside it is tapped.
  mobileMenu.querySelectorAll(".mobile-nav-link").forEach((link) => {
    link.addEventListener("click", () => {
      menuBtn.classList.remove("active");
      mobileMenu.classList.remove("active");
    });
  });
}