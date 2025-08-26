/* =================================================================
   AO3 to Kindle - Main Application Logic
   Handles UI updates and application state
   ================================================================= */

class App {
  constructor() {
    this.authSection = null;
    this.appSection = null;
    this.userNameElement = null;
    this.signoutBtn = null;
    this.sendForm = null;
    this.statusSection = null;
    
    this.isInitialized = false;
  }

  /* =================================================================
     Initialization
     ================================================================= */

  /**
   * Initialize the application
   */
  init() {
    console.log('Initializing app...');
    
    // Get DOM elements
    this.authSection = document.getElementById('auth-section');
    this.appSection = document.getElementById('app-section');
    this.userNameElement = document.getElementById('user-name');
    this.signoutBtn = document.getElementById('signout-btn');
    this.sendForm = document.getElementById('send-form');
    this.statusSection = document.getElementById('status-section');
    
    // Set up event listeners
    this.setupEventListeners();
    
    // Listen for auth state changes
    if (window.authManager) {
      window.authManager.onAuthStateChange(this.handleAuthStateChange.bind(this));
    }
    
    this.isInitialized = true;
    console.log('App initialized successfully');
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Sign out button
    if (this.signoutBtn) {
      this.signoutBtn.addEventListener('click', this.handleSignOut.bind(this));
    }
    
    // Send form
    if (this.sendForm) {
      this.sendForm.addEventListener('submit', this.handleSendForm.bind(this));
    }
    
    // Auth error listener
    document.addEventListener('authError', this.handleAuthError.bind(this));
  }

  /* =================================================================
     Auth State Management
     ================================================================= */

  /**
   * Handle authentication state changes
   */
  handleAuthStateChange(isSignedIn, user) {
    console.log('Auth state changed:', { isSignedIn, user });
    
    if (isSignedIn && user) {
      this.showAuthenticatedState(user);
    } else {
      this.showUnauthenticatedState();
    }
  }

  /**
   * Show authenticated state (hide auth, show app)
   */
  showAuthenticatedState(user) {
    console.log('Showing authenticated state for:', user.name);
    
    // Hide auth section
    if (this.authSection) {
      this.authSection.hidden = true;
    }
    
    // Show app section
    if (this.appSection) {
      this.appSection.hidden = false;
    }
    
    // Update user name
    if (this.userNameElement && user.name) {
      this.userNameElement.textContent = user.name;
    }
    
    // Enable the send button now that user is authenticated
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
      sendBtn.disabled = false;
    }
    
    // Clear any error messages
    this.clearStatus();
    
    console.log('UI updated to authenticated state');
  }

  /**
   * Show unauthenticated state (show auth, hide app)
   */
  showUnauthenticatedState() {
    console.log('Showing unauthenticated state');
    
    // Show auth section
    if (this.authSection) {
      this.authSection.hidden = false;
    }
    
    // Hide app section
    if (this.appSection) {
      this.appSection.hidden = true;
    }
    
    // Clear user name
    if (this.userNameElement) {
      this.userNameElement.textContent = '';
    }
    
    console.log('UI updated to unauthenticated state');
  }

  /* =================================================================
     Event Handlers
     ================================================================= */

  /**
   * Handle sign out
   */
  async handleSignOut(event) {
    event.preventDefault();
    
    try {
      console.log('Signing out...');
      await window.authManager.handleSignOut();
    } catch (error) {
      console.error('Sign out failed:', error);
      this.showStatus('Sign out failed. Please try again.', 'error');
    }
  }

  /**
   * Handle send form submission
   */
  async handleSendForm(event) {
    event.preventDefault();
    
    try {
      // Get form data
      const formData = new FormData(this.sendForm);
      const ao3Url = formData.get('ao3Url')?.trim();
      const kindleEmail = formData.get('kindleEmail')?.trim();
      const format = formData.get('format') || 'mobi';
      
      // Validate inputs
      if (!this.validateForm(ao3Url, kindleEmail)) {
        return; // Validation messages already shown
      }
      
      // Show loading state
      this.setFormLoading(true);
      this.showStatus('Processing your request...', 'info');
      
      console.log('Form submission:', { ao3Url, kindleEmail, format });
      
      // Step 1: Fetch AO3 work
      this.updateProgress('Fetching story from AO3...', 25);
      const workData = await window.ao3Manager.fetchWork(ao3Url, format);
      
      // Step 2: Validate file size
      if (!window.ao3Manager.isFileSizeValid(workData.file.size)) {
        const fileSize = window.ao3Manager.formatFileSize(workData.file.size);
        throw new Error(`File is too large (${fileSize}). Gmail has a 25MB limit. Try a different format.`);
      }
      
      // Step 3: Send to Kindle via Gmail
      this.updateProgress(`Sending "${workData.metadata.title}" to your Kindle...`, 75);
      
      const result = await window.gmailManager.sendToKindle(
        kindleEmail,
        workData.metadata.title,
        workData.metadata.authorString,
        workData.file.data,
        workData.file.fileName,
        format
      );
      
      // Step 4: Success!
      this.updateProgress('Success! Story sent to your Kindle.', 100);
      
      const fileSize = window.ao3Manager.formatFileSize(workData.file.size);
      this.showStatus(
        `✅ "${workData.metadata.title}" by ${workData.metadata.authorString} has been sent to ${kindleEmail}! ` +
        `File size: ${fileSize}. It should appear on your Kindle shortly.`,
        'success'
      );
      
    } catch (error) {
      console.error('Send form error:', error);
      this.hideProgress();
      
      // Show user-friendly error messages
      let errorMessage = 'An error occurred. Please try again.';
      
      if (error.message.includes('CORS proxy')) {
        errorMessage = 'Unable to connect to AO3. Please check your internet connection and try again.';
      } else if (error.message.includes('Failed to fetch AO3')) {
        errorMessage = 'Could not fetch the story from AO3. Please check the URL and try again.';
      } else if (error.message.includes('too large')) {
        errorMessage = error.message; // File size error is already user-friendly
      } else if (error.message.includes('Gmail')) {
        errorMessage = 'Failed to send email. Please check your authentication and try again.';
      } else if (error.message.includes('URL must be')) {
        errorMessage = error.message; // URL validation errors are already user-friendly
      }
      
      this.showStatus(errorMessage, 'error');
    } finally {
      this.setFormLoading(false);
    }
  }

  /* =================================================================
     Form Validation
     ================================================================= */

  /**
   * Validate form inputs
   */
  validateForm(ao3Url, kindleEmail) {
    let isValid = true;
    
    // Clear previous errors
    this.clearFormErrors();
    
    // Validate AO3 URL
    if (!ao3Url) {
      this.showFieldError('ao3-url', 'AO3 URL is required');
      isValid = false;
    } else if (!this.validateAO3Url(ao3Url)) {
      this.showFieldError('ao3-url', 'Please enter a valid AO3 work URL');
      isValid = false;
    }
    
    // Validate Kindle email
    if (!kindleEmail) {
      this.showFieldError('kindle-email', 'Kindle email is required');
      isValid = false;
    } else if (!window.gmailManager.validateKindleEmail(kindleEmail)) {
      this.showFieldError('kindle-email', 'Please enter a valid Kindle email address (@kindle.com or @free.kindle.com)');
      isValid = false;
    }
    
    return isValid;
  }

  /**
   * Validate AO3 URL format
   */
  validateAO3Url(url) {
    if (!window.ao3Manager) {
      return false;
    }
    
    const validation = window.ao3Manager.validateAO3Url(url);
    return validation.valid;
  }

  /**
   * Show field-specific error
   */
  showFieldError(fieldId, message) {
    const errorElement = document.getElementById(`${fieldId}-error`);
    const fieldElement = document.getElementById(fieldId);
    
    if (errorElement) {
      errorElement.textContent = message;
      errorElement.style.display = 'block';
    }
    
    if (fieldElement) {
      fieldElement.classList.add('form-input-error');
    }
  }

  /**
   * Clear all form errors
   */
  clearFormErrors() {
    const errorElements = document.querySelectorAll('.form-error');
    const inputElements = document.querySelectorAll('.form-input-error');
    
    errorElements.forEach(element => {
      element.textContent = '';
      element.style.display = 'none';
    });
    
    inputElements.forEach(element => {
      element.classList.remove('form-input-error');
    });
  }

  /**
   * Set form loading state
   */
  setFormLoading(isLoading) {
    const sendBtn = document.getElementById('send-btn');
    const btnText = sendBtn?.querySelector('.btn-text');
    const btnSpinner = sendBtn?.querySelector('.btn-spinner');
    const formInputs = this.sendForm?.querySelectorAll('input, select, button');
    
    if (sendBtn) {
      sendBtn.disabled = isLoading;
    }
    
    if (btnText) {
      btnText.textContent = isLoading ? 'Sending...' : 'Send to Kindle';
    }
    
    if (btnSpinner) {
      btnSpinner.style.display = isLoading ? 'inline-block' : 'none';
    }
    
    // Disable all form inputs while loading
    if (formInputs) {
      formInputs.forEach(input => {
        input.disabled = isLoading;
      });
    }
  }

  /**
   * Handle authentication errors
   */
  handleAuthError(event) {
    const { error, message } = event.detail;
    console.error('Auth error received:', error);
    this.showStatus(message || 'Authentication failed', 'error');
  }

  /* =================================================================
     Progress Management
     ================================================================= */

  /**
   * Update progress bar and message
   */
  updateProgress(message, percentage) {
    const progressContainer = document.getElementById('progress-container');
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (progressContainer) {
      progressContainer.hidden = false;
    }
    
    if (progressFill) {
      progressFill.style.width = `${percentage}%`;
      progressFill.setAttribute('aria-valuenow', percentage);
    }
    
    if (progressText) {
      progressText.textContent = message;
    }
    
    console.log(`Progress: ${percentage}% - ${message}`);
  }

  /**
   * Hide progress bar
   */
  hideProgress() {
    const progressContainer = document.getElementById('progress-container');
    if (progressContainer) {
      progressContainer.hidden = true;
    }
  }

  /* =================================================================
     Status Management
     ================================================================= */

  /**
   * Show status message
   */
  showStatus(message, type = 'info') {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = message;
      statusMessage.className = `status-message status-${type}`;
      
      if (this.statusSection) {
        this.statusSection.hidden = false;
      }
    }
    
    console.log(`Status (${type}):`, message);
  }

  /**
   * Clear status messages
   */
  clearStatus() {
    const statusMessage = document.getElementById('status-message');
    if (statusMessage) {
      statusMessage.textContent = '';
      statusMessage.className = 'status-message';
    }
    
    if (this.statusSection) {
      this.statusSection.hidden = true;
    }
  }
}

/* =================================================================
   Global App Instance & Initialization
   ================================================================= */

// Create global app instance
window.app = new App();

/**
 * Initialize app when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM loaded, initializing app...');
  
  // Initialize app
  window.app.init();
});

/* =================================================================
   Export for ES6 modules (if needed)
   ================================================================= */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = App;
}