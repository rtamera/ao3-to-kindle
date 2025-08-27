/* =================================================================
   AO3 to Kindle - Production Configuration
   Safe configuration for GitHub Pages deployment
   ================================================================= */

const CONFIG = {
  // Google OAuth2 Client ID (safe to be public)
  GOOGLE_CLIENT_ID: "240265681497-e4p04p6ombjb9afm4h0q9fbfv63dcrbt.apps.googleusercontent.com",

  // Google API Key (optional, left empty for production)
  GOOGLE_API_KEY: "", // Optional

  // Cloudflare Worker URL for CORS proxy
  CORS_PROXY_URL: "https://ao3-cors-proxy.rhea-tamerarj.workers.dev",

  // Kindle email domain validation
  KINDLE_EMAIL_DOMAINS: ["@kindle.com", "@free.kindle.com"],

  // Gmail attachment size limit (25MB)
  MAX_FILE_SIZE_BYTES: 25 * 1024 * 1024,

  // App metadata
  APP_NAME: "AO3 to Kindle",
  APP_VERSION: "1.0.0",

  // Support email (update with your actual support email)
  SUPPORT_EMAIL: "support@example.com",
};

// Make config available globally
window.CONFIG = CONFIG;

// Export for modules if needed
if (typeof module !== "undefined" && module.exports) {
  module.exports = CONFIG;
}