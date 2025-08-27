/* =================================================================
   AO3 to Kindle - AO3 Integration
   Handle fetching and processing AO3 content
   ================================================================= */

class AO3Manager {
  constructor() {
    this.isInitialized = false;
    this.corsProxyUrl = CONFIG.CORS_PROXY_URL;
  }

  /* =================================================================
     Initialization
     ================================================================= */

  /**
   * Initialize AO3 manager
   */
  init() {
    console.log('Initializing AO3 manager...');
    this.isInitialized = true;
    console.log('AO3 manager initialized successfully');
  }

  /* =================================================================
     URL Validation & Processing
     ================================================================= */

  /**
   * Validate AO3 URL format
   */
  validateAO3Url(url) {
    // Use the enhanced validation from utils
    return window.utilsManager.validateAO3Url(url);
  }

  /**
   * Extract work ID from AO3 URL
   */
  extractWorkId(url) {
    const validation = this.validateAO3Url(url);
    return validation.valid ? validation.workId : null;
  }

  /**
   * Build download URL for specific format
   */
  buildDownloadUrl(workId, format = 'mobi') {
    const formatMap = {
      'mobi': 'mobi',
      'epub': 'epub', 
      'azw3': 'azw3',
      'pdf': 'pdf'
    };
    
    const ao3Format = formatMap[format.toLowerCase()] || 'mobi';
    return `https://archiveofourown.org/downloads/${workId}/${workId}.${ao3Format}`;
  }

  /* =================================================================
     Content Fetching
     ================================================================= */

  /**
   * Fetch AO3 work page to extract metadata and download links
   */
  async fetchWorkPage(url) {
    const fetchFunction = async () => {
      console.log('Fetching AO3 work page:', url);
      
      if (!this.corsProxyUrl) {
        throw new Error('CORS proxy not configured');
      }
      
      // Use CORS proxy to fetch the work page
      const proxyUrl = `${this.corsProxyUrl}?url=${encodeURIComponent(url)}`;
      
      const response = await window.utilsManager.withTimeout(
        fetch(proxyUrl),
        15000 // 15 second timeout
      );
      
      if (!response.ok) {
        // Try to parse JSON error response from Worker
        let errorMessage = `Failed to fetch work page: ${response.statusText}`;
        let errorResponse = null;
        
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            errorResponse = await response.json();
            errorMessage = errorResponse.error || errorMessage;
          }
        } catch (e) {
          // Fallback to status text if JSON parsing fails
        }
        
        const error = new Error(errorMessage);
        error.status = response.status;
        error.response = errorResponse;
        throw error;
      }
      
      const html = await response.text();
      return this.parseWorkPage(html, url);
    };

    try {
      return await window.utilsManager.retryRequest(fetchFunction, {
        maxRetries: 2,
        baseDelay: 2000, // Start with 2 seconds
        maxDelay: 8000   // Cap at 8 seconds
      });
    } catch (error) {
      console.error('Error fetching work page:', error);
      const classified = window.utilsManager.classifyError(error);
      throw new Error(classified.userMessage);
    }
  }

  /**
   * Parse AO3 work page HTML to extract metadata
   */
  parseWorkPage(html, originalUrl) {
    try {
      // Create a DOM parser
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      
      // Extract metadata
      const titleElement = doc.querySelector('.title.heading');
      const authorElements = doc.querySelectorAll('.byline a[rel="author"]');
      const summaryElement = doc.querySelector('.summary blockquote');
      const statsElements = doc.querySelectorAll('.stats .stat');
      
      // Extract work ID from URL
      const validation = this.validateAO3Url(originalUrl);
      const workId = validation.valid ? validation.workId : null;
      
      if (!workId) {
        throw new Error('Could not extract work ID from URL');
      }
      
      // Build metadata object
      const metadata = {
        workId: workId,
        title: titleElement ? titleElement.textContent.trim() : 'Unknown Title',
        authors: Array.from(authorElements).map(el => el.textContent.trim()),
        authorString: Array.from(authorElements).map(el => el.textContent.trim()).join(', ') || 'Unknown Author',
        summary: summaryElement ? summaryElement.textContent.trim() : '',
        originalUrl: originalUrl,
        downloadUrls: this.buildDownloadUrls(workId)
      };
      
      // Extract stats if available
      statsElements.forEach(stat => {
        const label = stat.querySelector('dt')?.textContent?.toLowerCase();
        const value = stat.querySelector('dd')?.textContent?.trim();
        
        if (label && value) {
          if (label.includes('word')) {
            metadata.wordCount = value;
          } else if (label.includes('chapter')) {
            metadata.chapters = value;
          }
        }
      });
      
      console.log('Extracted metadata:', metadata);
      return metadata;
      
    } catch (error) {
      console.error('Error parsing work page:', error);
      throw new Error(`Failed to parse AO3 work page: ${error.message}`);
    }
  }

  /**
   * Build download URLs for all supported formats
   */
  buildDownloadUrls(workId) {
    return {
      mobi: this.buildDownloadUrl(workId, 'mobi'),
      epub: this.buildDownloadUrl(workId, 'epub'),
      azw3: this.buildDownloadUrl(workId, 'azw3'),
      pdf: this.buildDownloadUrl(workId, 'pdf')
    };
  }

  /* =================================================================
     File Downloading
     ================================================================= */

  /**
   * Download file from AO3 and convert to base64
   */
  async downloadFile(downloadUrl, format = 'mobi') {
    const downloadFunction = async () => {
      console.log('Downloading file:', downloadUrl);
      
      // Use CORS proxy to download the file
      const proxyUrl = `${this.corsProxyUrl}?url=${encodeURIComponent(downloadUrl)}`;
      
      const response = await window.utilsManager.withTimeout(
        fetch(proxyUrl),
        30000 // 30 second timeout for file downloads
      );
      
      if (!response.ok) {
        // Try to parse JSON error response from Worker
        let errorMessage = `Download failed: ${response.statusText}`;
        let errorResponse = null;
        
        try {
          const contentType = response.headers.get('content-type') || '';
          if (contentType.includes('application/json')) {
            errorResponse = await response.json();
            errorMessage = errorResponse.error || errorMessage;
          }
        } catch (e) {
          // Fallback to status text if JSON parsing fails
        }
        
        const error = new Error(errorMessage);
        error.status = response.status;
        error.response = errorResponse;
        throw error;
      }
      
      // Get content length to check file size before downloading
      const contentLength = response.headers.get('content-length');
      if (contentLength) {
        const fileSize = parseInt(contentLength, 10);
        if (!window.utilsManager.isFileSizeValid(fileSize, 25)) {
          const formattedSize = window.utilsManager.formatFileSize(fileSize);
          throw new Error(`File is too large (${formattedSize}). Gmail has a 25MB attachment limit. Try a different format like EPUB which is usually smaller.`);
        }
      }
      
      // Get the file as array buffer
      const arrayBuffer = await response.arrayBuffer();
      
      // Double-check file size after download
      if (!window.utilsManager.isFileSizeValid(arrayBuffer.byteLength, 25)) {
        const formattedSize = window.utilsManager.formatFileSize(arrayBuffer.byteLength);
        throw new Error(`File is too large (${formattedSize}). Gmail has a 25MB attachment limit. Try a different format like EPUB which is usually smaller.`);
      }
      
      // Convert to base64
      const base64String = this.arrayBufferToBase64(arrayBuffer);
      
      console.log(`File downloaded successfully (${arrayBuffer.byteLength} bytes)`);
      
      return {
        data: base64String,
        size: arrayBuffer.byteLength,
        format: format,
        mimeType: this.getMimeType(format)
      };
    };

    try {
      return await window.utilsManager.retryRequest(downloadFunction, {
        maxRetries: 2,
        baseDelay: 3000, // Start with 3 seconds for file downloads
        maxDelay: 10000  // Cap at 10 seconds
      });
    } catch (error) {
      console.error('Error downloading file:', error);
      
      // If it's already a user-friendly file size error, pass it through
      if (error.message.includes('too large') || error.message.includes('25MB')) {
        throw error;
      }
      
      const classified = window.utilsManager.classifyError(error);
      throw new Error(classified.userMessage);
    }
  }

  /**
   * Convert ArrayBuffer to base64 string
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const len = bytes.byteLength;
    
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    
    return btoa(binary);
  }

  /**
   * Get MIME type for format
   */
  getMimeType(format) {
    const mimeTypes = {
      'mobi': 'application/x-mobipocket-ebook',
      'epub': 'application/epub+zip',
      'azw3': 'application/vnd.amazon.ebook',
      'pdf': 'application/pdf'
    };
    
    return mimeTypes[format.toLowerCase()] || 'application/octet-stream';
  }

  /* =================================================================
     Main Public API
     ================================================================= */

  /**
   * Fetch AO3 work and prepare for sending
   */
  async fetchWork(url, format = 'mobi') {
    try {
      console.log('Starting AO3 work fetch process:', { url, format });
      
      // Validate URL
      const validation = this.validateAO3Url(url);
      if (!validation.valid) {
        throw new Error(validation.error);
      }
      
      // Fetch work page and extract metadata
      const metadata = await this.fetchWorkPage(url);
      
      // Download the file in requested format
      const downloadUrl = metadata.downloadUrls[format.toLowerCase()];
      if (!downloadUrl) {
        throw new Error(`Format ${format} not supported`);
      }
      
      const fileData = await this.downloadFile(downloadUrl, format);
      
      // Create filename
      const sanitizedTitle = this.sanitizeFilename(metadata.title);
      const sanitizedAuthor = this.sanitizeFilename(metadata.authorString);
      const fileName = `${sanitizedTitle} - ${sanitizedAuthor}.${format.toLowerCase()}`;
      
      return {
        metadata: metadata,
        file: {
          ...fileData,
          fileName: fileName
        }
      };
      
    } catch (error) {
      console.error('Error in fetchWork:', error);
      throw error;
    }
  }

  /* =================================================================
     Utilities
     ================================================================= */

  /**
   * Sanitize filename by removing invalid characters
   */
  sanitizeFilename(filename) {
    return filename
      .replace(/[<>:"/\\|?*]/g, '') // Remove invalid filename characters
      .replace(/\s+/g, ' ') // Normalize spaces
      .trim()
      .substring(0, 100); // Limit length
  }

  /**
   * Check if file size is within Gmail limits (25MB)
   */
  isFileSizeValid(sizeInBytes) {
    const maxSize = 25 * 1024 * 1024; // 25MB in bytes
    return sizeInBytes <= maxSize;
  }

  /**
   * Format file size for display
   */
  formatFileSize(sizeInBytes) {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    if (sizeInBytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(sizeInBytes) / Math.log(1024));
    return Math.round(sizeInBytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}

/* =================================================================
   Global AO3 Manager Instance
   ================================================================= */

// Create global AO3 manager instance
window.ao3Manager = new AO3Manager();

/**
 * Initialize AO3 manager when DOM is ready
 */
document.addEventListener('DOMContentLoaded', () => {
  window.ao3Manager.init();
});

/* =================================================================
   Export for ES6 modules (if needed)
   ================================================================= */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = AO3Manager;
}