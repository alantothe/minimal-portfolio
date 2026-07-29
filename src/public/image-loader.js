/**
 * Image blur-to-sharp loading effect
 *
 * Adds a blur filter to images and removes it when they load
 */

import("/public/github-activity.js");

function initializeImageLoaders() {
  const images = document.querySelectorAll("img");

  images.forEach((img) => {
    // If image is already loaded/cached
    if (img.complete && img.naturalHeight !== 0) {
      img.setAttribute("loading-done", "");
    } else {
      // Listen for load event
      img.addEventListener(
        "load",
        () => {
          img.setAttribute("loading-done", "");
        },
        { once: true }
      );
    }
  });
}

// Initialize on DOM ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeImageLoaders);
} else {
  initializeImageLoaders();
}

// Re-initialize when SPA router loads new content
const observer = new MutationObserver(() => {
  setTimeout(initializeImageLoaders, 50);
});

// Observe all page containers for changes
const pageContainers = document.querySelectorAll(".page-container");
pageContainers.forEach((container) => {
  observer.observe(container, {
    childList: true,
    subtree: true,
  });
});
