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
        reject(new Error('Google APIs failed to load within timeout'));
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
      this.google.accounts.id.renderButton(buttonContainer, {
        type: 'standard',
        size: 'large',
        theme: 'outline',
        text: 'sign_in_with',
        shape: 'rectangular',
        logo_alignment: 'left',
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
   * Request access token using OAuth2 flow
   */
  async requestAccessToken() {
    return new Promise((resolve, reject) => {
      console.log('Initializing OAuth2 token client...');
      
      try {
        const client = this.google.accounts.oauth2.initTokenClient({
          client_id: CONFIG.GOOGLE_CLIENT_ID,
          scope: this.SCOPES,
          callback: (response) => {
            console.log('OAuth2 token response:', response);
            
            if (response.error) {
              console.error('OAuth2 error:', response.error);
              reject(new Error(response.error));
              return;
            }
            
            if (!response.access_token) {
              console.error('No access token in response');
              reject(new Error('No access token received'));
              return;
            }
            
            console.log('Successfully received access token');
            resolve(response);
          },
          error_callback: (error) => {
            console.error('OAuth2 error callback:', error);
            reject(new Error(error.message || 'OAuth2 authorization failed'));
          }
        });

        console.log('Requesting access token...');
        client.requestAccessToken({
          prompt: 'consent' // Force consent screen to show scopes
        });
        
      } catch (error) {
        console.error('Failed to initialize OAuth2 client:', error);
        reject(error);
      }
    });
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
      const tokenResponse = await this.requestAccessToken();
      
      if (tokenResponse && tokenResponse.access_token) {
        this.accessToken = tokenResponse.access_token;
        this.tokenExpirationTime = Date.now() + (tokenResponse.expires_in * 1000);
        
        // Update stored auth data
        this.storeAuthData();
        
        console.log('Token refreshed successfully');
      } else {
        throw new Error('Failed to refresh token');
      }
    } catch (error) {
      console.error('Token refresh failed:', error);
      // Force re-authentication
      await this.handleSignOut();
      throw new Error('Authentication expired. Please sign in again.');
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