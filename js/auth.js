/* =================================================================
   AO3 to Kindle - Authentication Module
   Google OAuth2 & Sign-In Integration
   ================================================================= */

class AuthManager {
  constructor() {
    this.isInitialized = false;
    this.isSignedIn = false;
    this.currentUser = null;
    this.accessToken = null;
    this.tokenExpirationTime = null;
    
    // Event listeners for auth state changes
    this.authStateListeners = [];
    
    // Google API client references
    this.gapi = null;
    this.google = null;
    
    // Configuration
    this.SCOPES = 'https://www.googleapis.com/auth/gmail.send';
    this.DISCOVERY_DOC = 'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest';
  }

  /* =================================================================
     Initialization
     ================================================================= */

  /**
   * Initialize Google Sign-In and Gmail API
   */
  async initGoogleAuth() {
    try {
      console.log('Initializing Google Authentication...');
      
      // Wait for Google APIs to load
      await this.waitForGoogleAPIs();
      
      // Initialize gapi client
      await this.initGapiClient();
      
      // Initialize Google Sign-In
      await this.initGoogleSignIn();
      
      this.isInitialized = true;
      console.log('Google Authentication initialized successfully');
      
      // Check if user is already signed in
      await this.checkExistingAuth();
      
    } catch (error) {
      console.error('Failed to initialize Google Authentication:', error);
      this.handleAuthError(error, 'Failed to initialize authentication');
      throw error;
    }
  }

  /**
   * Wait for Google APIs to load
   */
  async waitForGoogleAPIs() {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Google APIs failed to load within 10 seconds. Please check your internet connection and try refreshing the page.'));
      }, 10000);

      const checkAPIs = () => {
        if (typeof gapi !== 'undefined' && typeof google !== 'undefined') {
          clearTimeout(timeout);
          this.gapi = gapi;
          this.google = google;
          resolve();
        } else {
          setTimeout(checkAPIs, 100);
        }
      };
      
      checkAPIs();
    });
  }

  /**
   * Initialize Google API client
   */
  async initGapiClient() {
    await this.gapi.load('client', async () => {
      await this.gapi.client.init({
        apiKey: CONFIG.GOOGLE_API_KEY || '',
        discoveryDocs: [this.DISCOVERY_DOC],
      });
      
      console.log('Google API client initialized');
    });
  }

  /**
   * Initialize Google Sign-In
   */
  async initGoogleSignIn() {
    // Initialize Google Identity Services
    this.google.accounts.id.initialize({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      callback: this.handleCredentialResponse.bind(this),
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    // Update the HTML element with client ID
    const onloadDiv = document.getElementById('g_id_onload');
    if (onloadDiv) {
      onloadDiv.setAttribute('data-client_id', CONFIG.GOOGLE_CLIENT_ID);
    }

    // Render the sign-in button
    this.renderSignInButton();
  }

  /**
   * Render Google Sign-In button
   */
  renderSignInButton() {
    const buttonContainer = document.querySelector('.g_id_signin');
    if (buttonContainer && CONFIG.GOOGLE_CLIENT_ID) {
      // Detect mobile for optimal button configuration
      const isMobile = window.innerWidth <= 640 || /Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
      
      this.google.accounts.id.renderButton(buttonContainer, {
        type: 'standard',
        size: isMobile ? 'large' : 'large',
        theme: 'outline',
        text: 'sign_in_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: isMobile ? Math.min(buttonContainer.offsetWidth - 32, 400) : 400,
      });
    }
  }

  /* =================================================================
     Authentication Handlers
     ================================================================= */

  /**
   * Handle credential response from Google Sign-In
   */
  async handleCredentialResponse(response) {
    try {
      console.log('Handling credential response...');
      
      if (!response.credential) {
        throw new Error('No credential received from Google');
      }

      // Decode JWT token to get user info
      const userInfo = this.parseJWT(response.credential);
      console.log('User info:', { 
        name: userInfo.name, 
        email: userInfo.email 
      });

      // Store user info temporarily
      this.currentUser = userInfo;

      // Now request access token for Gmail API using a separate flow
      console.log('Requesting Gmail access token...');
      const tokenResponse = await this.requestAccessToken();
      
      if (tokenResponse && tokenResponse.access_token) {
        this.accessToken = tokenResponse.access_token;
        this.tokenExpirationTime = Date.now() + (tokenResponse.expires_in * 1000);
        this.isSignedIn = true;

        console.log('Authentication successful');
        this.notifyAuthStateChange(true, userInfo);
      } else {
        throw new Error('Failed to obtain access token');
      }
      
    } catch (error) {
      console.error('Authentication failed:', error);
      this.handleAuthError(error, 'Sign-in failed');
    }
  }

  /**
   * Request access token using OAuth2 redirect flow
   */
  async requestAccessToken() {
    return new Promise((resolve, reject) => {
      console.log('Starting OAuth2 redirect flow...');
      
      try {
        // Build OAuth2 authorization URL for redirect flow
        const authUrl = this.buildAuthUrl();
        
        // Listen for message from redirect page
        const messageHandler = (event) => {
          if (event.origin !== window.location.origin) {
            return; // Ignore messages from other origins
          }
          
          if (event.data.type === 'oauth_success') {
            window.removeEventListener('message', messageHandler);
            console.log('OAuth2 token received via redirect');
            resolve(event.data.data);
          } else if (event.data.type === 'oauth_error') {
            window.removeEventListener('message', messageHandler);
            reject(new Error(event.data.error));
          }
        };
        
        // Check if we already have a token from redirect (page refresh case)
        const storedToken = sessionStorage.getItem('ao3_kindle_oauth_token');
        if (storedToken) {
          try {
            const tokenData = JSON.parse(storedToken);
            if (tokenData.expires_at > Date.now()) {
              console.log('Found valid stored OAuth token');
              sessionStorage.removeItem('ao3_kindle_oauth_token');
              resolve(tokenData);
              return;
            }
          } catch (e) {
            // Invalid stored token, continue with normal flow
            sessionStorage.removeItem('ao3_kindle_oauth_token');
          }
        }
        
        // Add message listener for redirect response
        window.addEventListener('message', messageHandler);
        
        // Redirect to OAuth authorization URL
        console.log('Redirecting to OAuth authorization...');
        window.location.href = authUrl;
        
      } catch (error) {
        console.error('Failed to start OAuth2 flow:', error);
        reject(error);
      }
    });
  }
  
  /**
   * Build OAuth2 authorization URL for redirect flow
   */
  buildAuthUrl() {
    const baseUrl = 'https://accounts.google.com/o/oauth2/v2/auth';
    const params = new URLSearchParams({
      client_id: CONFIG.GOOGLE_CLIENT_ID,
      redirect_uri: window.location.origin + (window.location.pathname.includes('ao3-to-kindle') ? '/ao3-to-kindle/auth.html' : '/auth.html'),
      response_type: 'token', // Use implicit flow for simplicity
      scope: this.SCOPES,
      state: this.generateState(), // CSRF protection
      prompt: 'consent',
      access_type: 'online'
    });
    
    return `${baseUrl}?${params.toString()}`;
  }
  
  /**
   * Generate random state parameter for CSRF protection
   */
  generateState() {
    const array = new Uint32Array(4);
    crypto.getRandomValues(array);
    return Array.from(array, dec => dec.toString(16)).join('');
  }

  /**
   * Parse JWT token to extract user information
   */
  parseJWT(token) {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));

      return JSON.parse(jsonPayload);
    } catch (error) {
      console.error('Failed to parse JWT token:', error);
      throw new Error('Invalid token format');
    }
  }

  /**
   * Check for existing authentication
   */
  async checkExistingAuth() {
    // First check for OAuth redirect token
    const oauthToken = sessionStorage.getItem('ao3_kindle_oauth_token');
    if (oauthToken) {
      try {
        const tokenData = JSON.parse(oauthToken);
        if (tokenData.expires_at > Date.now()) {
          console.log('Processing OAuth redirect token');
          
          // Convert OAuth token to our auth format
          this.accessToken = tokenData.access_token;
          this.tokenExpirationTime = tokenData.expires_at;
          this.isSignedIn = true;
          
          // We don't have user info from redirect, so get it
          await this.getUserInfo();
          
          // Clean up the OAuth token
          sessionStorage.removeItem('ao3_kindle_oauth_token');
          
          // Store in our format
          this.storeAuthData();
          
          console.log('Successfully processed OAuth redirect');
          this.notifyAuthStateChange(true, this.currentUser);
          return;
        } else {
          sessionStorage.removeItem('ao3_kindle_oauth_token');
        }
      } catch (error) {
        console.error('Failed to process OAuth token:', error);
        sessionStorage.removeItem('ao3_kindle_oauth_token');
      }
    }
    
    // Check if we have stored auth data in session storage
    const storedAuth = sessionStorage.getItem('ao3_kindle_auth');
    if (storedAuth) {
      try {
        const authData = JSON.parse(storedAuth);
        if (this.isTokenValid(authData.tokenExpirationTime)) {
          this.accessToken = authData.accessToken;
          this.tokenExpirationTime = authData.tokenExpirationTime;
          this.currentUser = authData.currentUser;
          this.isSignedIn = true;
          
          console.log('Restored existing authentication');
          this.notifyAuthStateChange(true, this.currentUser);
          return;
        } else {
          // Token expired, clear storage
          sessionStorage.removeItem('ao3_kindle_auth');
        }
      } catch (error) {
        console.error('Failed to restore auth data:', error);
        sessionStorage.removeItem('ao3_kindle_auth');
      }
    }

    // No valid existing auth
    this.notifyAuthStateChange(false, null);
  }
  
  /**
   * Get user info from Google API using access token
   */
  async getUserInfo() {
    try {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`
        }
      });
      
      if (!response.ok) {
        throw new Error('Failed to fetch user info');
      }
      
      const userInfo = await response.json();
      this.currentUser = {
        name: userInfo.name,
        email: userInfo.email,
        picture: userInfo.picture
      };
      
      console.log('Retrieved user info:', {
        name: userInfo.name,
        email: userInfo.email
      });
      
    } catch (error) {
      console.error('Failed to get user info:', error);
      // Use fallback user info if available
      this.currentUser = {
        name: 'User',
        email: 'Unknown'
      };
    }
  }

  /* =================================================================
     Sign Out
     ================================================================= */

  /**
   * Sign out the current user
   */
  async handleSignOut() {
    try {
      console.log('Signing out...');

      // Revoke the access token
      if (this.accessToken) {
        await this.revokeToken();
      }

      // Clear all auth data
      this.clearAuthData();

      // Sign out from Google
      this.google.accounts.id.disableAutoSelect();
      
      console.log('Sign out successful');
      this.notifyAuthStateChange(false, null);
      
    } catch (error) {
      console.error('Sign out failed:', error);
      // Still clear local data even if remote signout fails
      this.clearAuthData();
      this.notifyAuthStateChange(false, null);
    }
  }

  /**
   * Revoke access token
   */
  async revokeToken() {
    try {
      const response = await fetch(`https://oauth2.googleapis.com/revoke?token=${this.accessToken}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
      
      if (!response.ok) {
        console.warn('Failed to revoke token:', response.statusText);
      }
    } catch (error) {
      console.warn('Error revoking token:', error);
    }
  }

  /**
   * Clear all authentication data
   */
  clearAuthData() {
    this.isSignedIn = false;
    this.currentUser = null;
    this.accessToken = null;
    this.tokenExpirationTime = null;
    sessionStorage.removeItem('ao3_kindle_auth');
  }

  /* =================================================================
     Token Management
     ================================================================= */

  /**
   * Get current access token, refreshing if necessary
   */
  async getAccessToken() {
    if (!this.isSignedIn || !this.accessToken) {
      throw new Error('User not authenticated');
    }

    // Check if token needs refresh (refresh 5 minutes before expiry)
    const refreshThreshold = 5 * 60 * 1000; // 5 minutes in milliseconds
    if (this.tokenExpirationTime - Date.now() < refreshThreshold) {
      console.log('Token expires soon, refreshing...');
      await this.refreshToken();
    }

    return this.accessToken;
  }

  /**
   * Refresh access token
   */
  async refreshToken() {
    try {
      console.log('Refreshing access token...');
      
      // Use retry logic for token refresh
      const tokenResponse = await window.utilsManager.retryRequest(
        () => this.requestAccessToken(),
        {
          maxRetries: 1, // Only retry once for auth
          baseDelay: 1000
        }
      );
      
      if (tokenResponse && tokenResponse.access_token) {
        this.accessToken = tokenResponse.access_token;
        this.tokenExpirationTime = Date.now() + (tokenResponse.expires_in * 1000);
        
        // Update stored auth data
        this.storeAuthData();
        
        console.log('Token refreshed successfully');
      } else {
        throw new Error('Failed to refresh token - no access token received');
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      
      // Classify the error
      const classified = window.utilsManager.classifyError(error);
      
      // For auth errors, clear everything and require re-authentication
      if (classified.type === 'auth_error' || error.message.includes('oauth') || error.message.includes('consent')) {
        console.log('Auth error during refresh, clearing auth state');
        this.clearAuthData();
        this.notifyAuthStateChange(false, null);
        
        // Show user-friendly message
        this.handleAuthError(error, 'Your session has expired. Please sign in again.');
        throw new Error('Authentication expired. Please sign in again.');
      }
      
      // For other errors, still clear auth but with different message
      this.clearAuthData();
      this.notifyAuthStateChange(false, null);
      throw new Error('Failed to refresh authentication. Please sign in again.');
    }
  }

  /**
   * Check if token is still valid
   */
  isTokenValid(expirationTime) {
    if (!expirationTime) return false;
    const bufferTime = 60 * 1000; // 1 minute buffer
    return Date.now() < (expirationTime - bufferTime);
  }

  /**
   * Store auth data in session storage
   */
  storeAuthData() {
    if (this.isSignedIn && this.accessToken) {
      const authData = {
        accessToken: this.accessToken,
        tokenExpirationTime: this.tokenExpirationTime,
        currentUser: this.currentUser,
      };
      sessionStorage.setItem('ao3_kindle_auth', JSON.stringify(authData));
    }
  }

  /* =================================================================
     Public API
     ================================================================= */

  /**
   * Check if user is authenticated
   */
  isAuthenticated() {
    return this.isSignedIn && this.accessToken && this.isTokenValid(this.tokenExpirationTime);
  }

  /**
   * Get current user information
   */
  getCurrentUser() {
    return this.currentUser;
  }

  /**
   * Add listener for auth state changes
   */
  onAuthStateChange(callback) {
    this.authStateListeners.push(callback);
  }

  /**
   * Remove auth state change listener
   */
  removeAuthStateListener(callback) {
    const index = this.authStateListeners.indexOf(callback);
    if (index > -1) {
      this.authStateListeners.splice(index, 1);
    }
  }

  /**
   * Notify all listeners of auth state change
   */
  notifyAuthStateChange(isSignedIn, user) {
    if (isSignedIn && user) {
      this.storeAuthData();
    }
    
    this.authStateListeners.forEach(callback => {
      try {
        callback(isSignedIn, user);
      } catch (error) {
        console.error('Auth state listener error:', error);
      }
    });
  }

  /* =================================================================
     Error Handling
     ================================================================= */

  /**
   * Handle authentication errors
   */
  handleAuthError(error, userMessage) {
    console.error('Auth error:', error);
    
    // Clear any partial auth state
    this.clearAuthData();
    
    // Show popup help if it's a popup-related error
    if (error && error.message && error.message.includes('popup')) {
      const popupHelp = document.getElementById('popup-help');
      if (popupHelp) {
        popupHelp.hidden = false;
      }
    }
    
    // Notify UI of error
    const event = new CustomEvent('authError', {
      detail: {
        error: error,
        message: userMessage || 'Authentication failed'
      }
    });
    document.dispatchEvent(event);
  }
}

/* =================================================================
   Global Auth Manager Instance & Initialization
   ================================================================= */

// Create global auth manager instance
window.authManager = new AuthManager();

/**
 * Global callback function for Google Sign-In
 * This needs to be in global scope for Google's callback
 */
window.handleCredentialResponse = function(response) {
  window.authManager.handleCredentialResponse(response);
};

/**
 * Initialize authentication when DOM is ready
 */
document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, initializing auth...');
  
  try {
    // Wait a bit for Google scripts to fully load
    setTimeout(async () => {
      await window.authManager.initGoogleAuth();
    }, 500);
  } catch (error) {
    console.error('Failed to initialize authentication:', error);
  }
});

/* =================================================================
   Export for ES6 modules (if needed)
   ================================================================= */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AuthManager;
}