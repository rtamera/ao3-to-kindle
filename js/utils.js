/* =================================================================
   AO3 to Kindle - Utility Functions
   Common utilities and error handling helpers
   ================================================================= */

class UtilsManager {
  constructor() {
    this.isInitialized = false;
  }

  /* =================================================================
     Network Retry Logic
     ================================================================= */

  /**
   * Retry a network request with exponential backoff
   * @param {Function} requestFn - Function that returns a Promise
   * @param {Object} options - Retry options
   * @returns {Promise} - Result of the request
   */
  async retryRequest(requestFn, options = {}) {
    const {
      maxRetries = 3,
      baseDelay = 1000, // 1 second
      maxDelay = 10000, // 10 seconds
      exponentialBase = 2,
      jitter = true
    } = options;

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt + 1}/${maxRetries + 1}`);
        const result = await requestFn();
        
        if (attempt > 0) {
          console.log(`Request succeeded on attempt ${attempt + 1}`);
        }
        
        return result;
      } catch (error) {
        lastError = error;
        console.log(`Attempt ${attempt + 1} failed:`, error.message);
        
        // Don't retry on certain errors
        if (this.isNonRetryableError(error)) {
          console.log('Non-retryable error, throwing immediately');
          throw error;
        }
        
        // Don't wait after the last attempt
        if (attempt === maxRetries) {
          break;
        }
        
        // Check if we have rate limiting information
        const classified = this.classifyError(lastError);
        let delay;
        
        if (classified.type === 'rate_limit' && classified.retryAfter) {
          // Respect the retry-after header
          delay = classified.retryAfter;
          console.log(`Rate limited, waiting ${Math.round(delay / 1000)} seconds as requested...`);
        } else {
          // Calculate delay with exponential backoff
          delay = Math.min(
            baseDelay * Math.pow(exponentialBase, attempt),
            maxDelay
          );
          
          // Add jitter to prevent thundering herd
          if (jitter) {
            delay = delay * (0.5 + Math.random() * 0.5);
          }
          
          console.log(`Waiting ${Math.round(delay)}ms before retry...`);
        }
        
        await this.delay(delay);
      }
    }

    // All retries failed
    console.error(`All ${maxRetries + 1} attempts failed`);
    throw new Error(`Request failed after ${maxRetries + 1} attempts: ${lastError.message}`);
  }

  /**
   * Check if an error should not be retried
   */
  isNonRetryableError(error) {
    const nonRetryablePatterns = [
      /authentication/i,
      /unauthorized/i,
      /forbidden/i,
      /not found/i,
      /invalid.*url/i,
      /malformed/i,
      /bad request/i,
      /413/, // Payload too large
      /414/, // URI too long
      /400/  // Bad request
    ];

    const errorMessage = error.message || '';
    const errorStatus = error.status || error.code || '';

    return nonRetryablePatterns.some(pattern => 
      pattern.test(errorMessage) || pattern.test(String(errorStatus))
    );
  }

  /**
   * Delay execution for specified milliseconds
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /* =================================================================
     Error Classification
     ================================================================= */

  /**
   * Classify error types for better user messaging
   */
  classifyError(error) {
    const message = error.message || '';
    const status = error.status || error.code || 0;
    
    // Handle JSON error responses from Worker
    if (error.response && typeof error.response === 'object') {
      return {
        type: error.response.type || 'worker_error',
        userMessage: error.response.error || message,
        isRetryable: error.response.type === 'rate_limit_error' || error.response.type === 'timeout_error',
        retryAfter: error.response.retryAfter ? parseInt(error.response.retryAfter) * 1000 : null
      };
    }

    // Network errors
    if (message.includes('fetch') || message.includes('NetworkError') || message.includes('Failed to fetch')) {
      return {
        type: 'network',
        userMessage: 'Network connection error. Please check your internet connection and try again.',
        isRetryable: true
      };
    }

    // CORS errors
    if (message.includes('CORS') || message.includes('Cross-Origin')) {
      return {
        type: 'cors',
        userMessage: 'Unable to connect to the service. This might be a temporary issue, please try again.',
        isRetryable: true
      };
    }

    // Rate limiting
    if (status === 429 || message.includes('rate limit') || message.includes('too many requests') || 
        message.includes('quota') || message.includes('throttle')) {
      const retryAfter = this.extractRetryAfter(error);
      const waitTime = retryAfter ? Math.ceil(retryAfter / 1000) : 60;
      
      return {
        type: 'rate_limit',
        userMessage: `Service is temporarily busy. Please wait ${waitTime} seconds and try again.`,
        isRetryable: true,
        retryAfter: retryAfter
      };
    }

    // Server errors (5xx)
    if (status >= 500 && status < 600) {
      let userMessage = 'The server is experiencing issues. Please try again in a few moments.';
      
      // Special handling for AO3 downtime
      if (message.includes('archiveofourown') || message.includes('AO3')) {
        userMessage = 'AO3 is currently experiencing issues or may be under maintenance. Please try again in a few minutes.';
      }
      
      return {
        type: 'server_error',
        userMessage: userMessage,
        isRetryable: true
      };
    }

    // Service unavailable (503)
    if (status === 503 || message.includes('service unavailable') || message.includes('maintenance')) {
      let userMessage = 'The service is temporarily unavailable. Please try again later.';
      
      if (message.includes('archiveofourown') || message.includes('AO3')) {
        userMessage = 'AO3 is currently under maintenance or experiencing high traffic. Please try again in 10-15 minutes.';
      }
      
      return {
        type: 'service_unavailable',
        userMessage: userMessage,
        isRetryable: true
      };
    }

    // Authentication errors
    if (status === 401 || message.includes('unauthorized') || message.includes('authentication')) {
      return {
        type: 'auth_error',
        userMessage: 'Authentication failed. Please sign in again.',
        isRetryable: false
      };
    }

    // File too large
    if (status === 413 || message.includes('too large') || message.includes('25MB')) {
      return {
        type: 'file_too_large',
        userMessage: 'File is too large for Gmail (25MB limit). Try a different format.',
        isRetryable: false
      };
    }

    // Not found
    if (status === 404 || message.includes('not found')) {
      return {
        type: 'not_found',
        userMessage: 'The requested content was not found. Please check the URL.',
        isRetryable: false
      };
    }

    // Bad request
    if (status === 400 || message.includes('bad request') || message.includes('invalid')) {
      return {
        type: 'bad_request',
        userMessage: 'Invalid request. Please check your input and try again.',
        isRetryable: false
      };
    }

    // Generic error
    return {
      type: 'unknown',
      userMessage: 'An unexpected error occurred. Please try again.',
      isRetryable: true
    };
  }

  /**
   * Extract retry-after header value
   */
  extractRetryAfter(error) {
    if (error.response && error.response.headers) {
      const retryAfter = error.response.headers.get('retry-after');
      if (retryAfter) {
        const seconds = parseInt(retryAfter, 10);
        return isNaN(seconds) ? null : seconds * 1000; // Convert to milliseconds
      }
    }
    return null;
  }

  /* =================================================================
     Timeout Handling
     ================================================================= */

  /**
   * Add timeout to a promise
   */
  withTimeout(promise, timeoutMs = 30000) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Operation timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /* =================================================================
     File Size Utilities
     ================================================================= */

  /**
   * Check if file size is within limits
   */
  isFileSizeValid(sizeInBytes, limitInMB = 25) {
    const limitInBytes = limitInMB * 1024 * 1024;
    return sizeInBytes <= limitInBytes;
  }

  /**
   * Format file size for display
   */
  formatFileSize(sizeInBytes) {
    const units = ['B', 'KB', 'MB', 'GB'];
    if (sizeInBytes === 0) return '0 B';
    
    const i = Math.floor(Math.log(sizeInBytes) / Math.log(1024));
    const size = sizeInBytes / Math.pow(1024, i);
    
    return `${Math.round(size * 100) / 100} ${units[i]}`;
  }

  /* =================================================================
     URL Validation
     ================================================================= */

  /**
   * Validate AO3 URL with detailed error messages
   */
  validateAO3Url(url) {
    try {
      if (!url || typeof url !== 'string') {
        return { valid: false, error: 'URL is required' };
      }

      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        return { valid: false, error: 'URL cannot be empty' };
      }

      // Try to create URL object
      let urlObj;
      try {
        urlObj = new URL(trimmedUrl);
      } catch (e) {
        return { valid: false, error: 'Invalid URL format. Please check the URL and try again.' };
      }

      // Check protocol
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { valid: false, error: 'URL must use HTTP or HTTPS protocol' };
      }

      // Check hostname
      if (urlObj.hostname !== 'archiveofourown.org') {
        return { 
          valid: false, 
          error: 'URL must be from archiveofourown.org. Other fanfiction sites are not supported.' 
        };
      }

      // Check path pattern for works
      const workMatch = urlObj.pathname.match(/^\/works\/(\d+)(?:\/chapters\/\d+)?(?:\/.*)?$/);
      if (!workMatch) {
        return { 
          valid: false, 
          error: 'URL must be a valid AO3 work URL (e.g., https://archiveofourown.org/works/12345)' 
        };
      }

      const workId = workMatch[1];
      if (!workId || workId.length > 10) {
        return { valid: false, error: 'Invalid work ID in URL' };
      }

      return { 
        valid: true, 
        workId, 
        originalUrl: trimmedUrl,
        cleanUrl: `https://archiveofourown.org/works/${workId}`
      };

    } catch (error) {
      return { valid: false, error: 'Failed to validate URL format' };
    }
  }

  /**
   * Validate email format
   */
  validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return { valid: false, error: 'Email is required' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { valid: false, error: 'Email cannot be empty' };
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      return { valid: false, error: 'Please enter a valid email address' };
    }

    return { valid: true, email: trimmedEmail };
  }

  /**
   * Validate Kindle email specifically
   */
  validateKindleEmail(email) {
    const emailValidation = this.validateEmail(email);
    if (!emailValidation.valid) {
      return emailValidation;
    }

    const trimmedEmail = emailValidation.email.toLowerCase();
    const kindleDomains = ['@kindle.com', '@free.kindle.com'];
    
    if (!kindleDomains.some(domain => trimmedEmail.endsWith(domain))) {
      return { 
        valid: false, 
        error: 'Please enter a valid Kindle email address (ending with @kindle.com or @free.kindle.com)' 
      };
    }

    return { valid: true, email: emailValidation.email };
  }

  /* =================================================================
     Progress and Status Management
     ================================================================= */

  /**
   * Create a detailed status update object
   */
  createStatus(message, type = 'info', details = {}) {
    return {
      message,
      type, // 'info', 'success', 'warning', 'error'
      timestamp: Date.now(),
      details
    };
  }

  /**
   * Extract meaningful error information from various error types
   */
  extractErrorInfo(error) {
    return {
      message: error.message || 'Unknown error',
      status: error.status || error.code || null,
      stack: error.stack || null,
      name: error.name || 'Error',
      timestamp: Date.now()
    };
  }

  /* =================================================================
     Initialization
     ================================================================= */

  init() {
    console.log('Initializing utils manager...');
    this.isInitialized = true;
    console.log('Utils manager initialized successfully');
  }
}

/* =================================================================
   Global Utils Manager Instance
   ================================================================= */

// Create global utils manager instance
window.utilsManager = new UtilsManager();

/**
 * Initialize utils manager when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  window.utilsManager.init();
});

/* =================================================================
   Export for ES6 modules (if needed)
   ================================================================= */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = UtilsManager;
}