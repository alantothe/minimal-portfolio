/**
 * USER CONFIGURATION - SINGLE SOURCE OF TRUTH
 *
 * All user-customizable settings are in this file.
 * Edit this file to customize your portfolio, logo, home page, and about page.
 */

/**
 * LOGO CONFIGURATION
 * Path: src/public/logo.png
 * Size: 60px wide (height auto-scales)
 * Format: PNG, SVG, or JPG
 */
export const logoConfig = {
  // Logo file should be at src/public/logo.png
  // Just replace the existing file with your own logo
  // No need to change anything here - just update the actual image file
  path: "/public/logo.png",
};

/**
 * HOME PAGE CONFIGURATION
 *
 * Customize your home page appearance and content here.
 */
export const homeConfig = {
  author: {
    // Your full name - displayed prominently on home page
    name: "Alan Malpartida",

    // First name only - used in greeting
    firstName: "Alan",

    // Your email address - users can click to copy and contact you
    email: "alanmalpartida@gmail.com",

    // Path to your avatar image
    // Recommended: Store in src/public/ and reference as "src/public/avatar.webp"
    // or upload to a CDN and use the URL
    photo: "src/public/avatar.webp",
  },

  professional: {
    // Your current role/position - displayed as subtitle
    title: "Founding Engineer at Questurian",

    // Brief introduction - HTML is allowed here
    // Use <strong></strong> for bold, <em></em> for italic, etc.
    intro: `Hi there, I'm Alan. I'm a <strong>Founding Engineer at Questurian</strong>, building platforms that help travelers explore the world.`,

    // Longer biography - HTML is allowed
    // Use <span id="copy-email" data-email="your@email.com">text here</span>
    // to make text clickable for email copying
    bio: `I built this space to showcase my projects and share my process. The site is intentionally minimal, just my work and occasional thoughts on what I'm exploring. Take a look around — if you have questions or want to chat about something, feel free to <span id="copy-email" data-email="alanmalpartida@gmail.com">reach out</span>.`,
  },

  // These values are automatically populated by the server
  // GitHub commits are fetched from GitHub API (requires GITHUB_TOKEN in .env)
  // Blog post count is calculated from files in src/content/blog/
  // Total views are tracked from src/data/blog-views.json
  // DO NOT manually change these - they update automatically
  metrics: {
    githubCommits: 0,
    blogPostCount: 0,
    totalViews: 0,
  },
};

/**
 * ABOUT PAGE CONFIGURATION
 *
 * Customize your about page content here.
 */
export const aboutConfig = {
  sections: {
    // PERSONAL SECTION - Your story and hobbies
    personal: {
      // Your personal introduction/bio - HTML is allowed
      intro:
        "I'm a web developer and founder of Questurin. Before this, I worked with the U.S. Air Force's ICBM program. Lately, I've been traveling South America, building projects and gaining fresh perspectives along the way.",

      // Your hobbies/interests outside of work - HTML is allowed
      hobbies:
        "Outside work, I'm usually hunting down the best local spots to eat, getting lost in films and mapping out recommendations for whoever needs them.",

      // Your social media links
      // Add or remove links as needed by adding/removing objects from this array
      socialLinks: [
        {
          name: "Github",
          url: "https://github.com/alantothe",
        },
        {
          name: "LinkedIn",
          url: "https://linkedin.com/in/alanmalpartisdaaaa",
        },
      ],
    },

    // CUSTOM SECTION - Replace this with your own company/project info
    // You can rename "questurin" to anything (e.g., "myCompany", "sideProject", etc.)
    // and update the content below
    questurin: {
      title: "About Questurin",
      description1:
        "Questurin is the travel platform that makes planning seamless, authentic, and informed. Travelers no longer need to piece together advice from scattered forums, reviews, and blogs. Questurin brings everything into one intelligent, visual experience that organizes the world by how people actually explore it.",
      description2:
        "Our contributors aren't traditional travel writers—they're digital nomads, solo adventurers, food lovers, and group travelers who share firsthand insights shaped by real journeys. Using Questurin's interactive tools, they create ranked recommendations and story-driven guides that connect places, experiences, and context in a way no static list can.",
      description3:
        "Starting with Latin America and the Caribbean, Questurin transforms fragmented travel knowledge into trusted, tailored storytelling that helps every traveler plan smarter, travel deeper, and see destinations through the eyes of those who truly know them.",
    },
  },
};

/**
 * GITHUB API SETUP (for home page commit statistics)
 *
 * The home page displays real-time GitHub commit statistics.
 * To enable this feature, you need to:
 *
 * 1. Create a GitHub Personal Access Token:
 *    - Go to https://github.com/settings/tokens
 *    - Click "Generate new token (classic)"
 *    - Select the "public_repo" scope (minimum required)
 *    - Copy the token
 *
 * 2. Create a .env file in the project root (if not already present):
 *    GITHUB_TOKEN=your_token_here
 *    GITHUB_USERNAME=your_github_username
 *
 * 3. Restart your dev server: bun run dev
 *
 * For detailed setup instructions, see: docs/SETUP.md
 *
 * Note: The GITHUB_TOKEN should never be committed to git.
 * It's already in .gitignore, so you're safe!
 */
