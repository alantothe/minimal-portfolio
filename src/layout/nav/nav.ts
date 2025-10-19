/**
 * Navigation enhancement - dynamically highlights active nav link based on current URL
 */

/// <reference lib="dom" />

declare global {
  interface Window {
    location: Location;
  }
}

interface NavLink extends HTMLAnchorElement {
  href: string;
}

/**
 * Initialize navigation highlighting
 */
function initNavigation(): void {
  const currentPath = window.location.pathname;
  const navLinks = document.querySelectorAll('.nav-link') as NodeListOf<NavLink>;
  
  // Remove active class from all nav links
  navLinks.forEach(link => {
    link.classList.remove('active');
  });
  
  // Find and highlight the matching nav link
  navLinks.forEach(link => {
    const linkPath = new URL(link.href).pathname;
    
    // Handle both exact matches and root path special case
    if (linkPath === currentPath || 
        (currentPath === '/' && linkPath === '/') ||
        (currentPath === '/home' && linkPath === '/')) {
      link.classList.add('active');
    }
  });
}

// Initialize when DOM is loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNavigation);
} else {
  initNavigation();
}
