export default {
  async fetch(request) {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 200,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Set CORS headers for all responses
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response(JSON.stringify({ error: "No URL provided" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    if (!targetUrl.includes("archiveofourown.org")) {
      return new Response(JSON.stringify({ error: "Invalid URL - must be AO3" }), { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }

    try {
      // Use retry logic for AO3 requests
      const response = await this.fetchWithRetry(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; AO3-to-Kindle/1.0; +https://github.com/rtamera/ao3-to-kindle)",
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "no-cache",
          "Referer": "https://archiveofourown.org/"
        }
      }, 3, 2000); // 3 retries with 2 second initial delay

      if (!response.ok) {
        // Handle specific HTTP status codes
        const errorMessage = await this.getErrorMessage(response);
        return new Response(JSON.stringify({ 
          error: errorMessage,
          status: response.status,
          statusText: response.statusText,
          retryAfter: response.headers.get('retry-after')
        }), { 
          status: response.status === 429 ? 429 : 502, // Preserve 429, use 502 for other AO3 errors
          headers: { 
            ...corsHeaders, 
            "Content-Type": "application/json",
            ...(response.headers.get('retry-after') && { "Retry-After": response.headers.get('retry-after') })
          }
        });
      }

      // Handle different content types
      const contentType = response.headers.get('content-type') || '';
      let responseHeaders = {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Length": response.headers.get('content-length'),
        "Last-Modified": response.headers.get('last-modified'),
        "ETag": response.headers.get('etag')
      };
      
      // Remove null headers
      Object.keys(responseHeaders).forEach(key => {
        if (responseHeaders[key] === null) {
          delete responseHeaders[key];
        }
      });

      // For binary files (downloads), preserve the original content type
      if (contentType.includes('application/') || contentType.includes('octet-stream') || targetUrl.includes('/downloads/')) {
        const body = await response.arrayBuffer();
        return new Response(body, {
          headers: responseHeaders
        });
      } else {
        // For HTML content
        const body = await response.text();
        return new Response(body, {
          headers: responseHeaders
        });
      }
      
    } catch (error) {
      console.error('Worker error:', error);
      
      // Classify error types
      const errorResponse = {
        error: error.message,
        type: 'network_error',
        timestamp: new Date().toISOString()
      };
      
      if (error.message.includes('timeout')) {
        errorResponse.type = 'timeout_error';
      } else if (error.message.includes('429')) {
        errorResponse.type = 'rate_limit_error';
      } else if (error.message.includes('503') || error.message.includes('502')) {
        errorResponse.type = 'service_unavailable';
      }
      
      return new Response(JSON.stringify(errorResponse), { 
        status: error.message.includes('429') ? 429 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      });
    }
  },

  /**
   * Fetch with exponential backoff retry logic
   */
  async fetchWithRetry(url, options, maxRetries = 3, initialDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries} for ${url}`);
        
        const response = await fetch(url, {
          ...options,
          // Add timeout
          signal: AbortSignal.timeout(30000) // 30 second timeout
        });
        
        // If we get a rate limit response, wait and retry
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after');
          const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : initialDelay * Math.pow(2, attempt - 1);
          
          if (attempt < maxRetries) {
            console.log(`Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}`);
            await this.sleep(waitTime);
            continue;
          }
        }
        
        return response;
        
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          const waitTime = initialDelay * Math.pow(2, attempt - 1) + Math.random() * 1000; // Add jitter
          console.log(`Waiting ${Math.round(waitTime)}ms before retry ${attempt + 1}`);
          await this.sleep(waitTime);
        }
      }
    }
    
    throw lastError;
  },

  /**
   * Get user-friendly error message based on response
   */
  async getErrorMessage(response) {
    switch (response.status) {
      case 429:
        return "AO3 is rate limiting requests. Please wait a moment and try again.";
      case 503:
        return "AO3 is temporarily unavailable. Please try again later.";
      case 502:
      case 504:
        return "AO3 gateway error. Please try again in a few minutes.";
      case 403:
        return "Access forbidden. The work might be restricted or require login.";
      case 404:
        return "Work not found. Please check the URL and try again.";
      case 500:
        return "AO3 server error. Please try again later.";
      default:
        try {
          const text = await response.text();
          if (text.includes('Retry later')) {
            return "AO3 requests to retry later. Please wait and try again.";
          }
          return `AO3 returned ${response.status}: ${response.statusText}`;
        } catch {
          return `AO3 returned ${response.status}: ${response.statusText}`;
        }
    }
  },

  /**
   * Sleep utility function
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
};