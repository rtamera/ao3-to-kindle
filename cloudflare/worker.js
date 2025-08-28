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
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!targetUrl.includes("archiveofourown.org")) {
      return new Response(
        JSON.stringify({ error: "Invalid URL - must be AO3" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    try {
      // Use retry logic for AO3 requests with better headers to avoid detection
      const userAgents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0"
      ];
      const randomUA = userAgents[Math.floor(Math.random() * userAgents.length)];
      
      const response = await this.fetchWithRetry(
        targetUrl,
        {
          headers: {
            "User-Agent": randomUA,
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate, br",
            "DNT": "1",
            "Connection": "keep-alive",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": targetUrl.includes("/downloads/") ? "document" : "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "same-origin",
            "Cache-Control": "max-age=0",
          },
        },
        2, // Reduced retries to avoid long waits
        3000 // Longer initial delay
      );

      if (!response.ok) {
        // Handle specific HTTP status codes
        const errorMessage = await this.getErrorMessage(response);
        return new Response(
          JSON.stringify({
            error: errorMessage,
            status: response.status,
            statusText: response.statusText,
            retryAfter: response.headers.get("retry-after"),
          }),
          {
            status: response.status === 429 ? 429 : 502, // Preserve 429, use 502 for other AO3 errors
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              ...(response.headers.get("retry-after") && {
                "Retry-After": response.headers.get("retry-after"),
              }),
            },
          }
        );
      }

      // Handle different content types
      const contentType = response.headers.get("content-type") || "";
      let responseHeaders = {
        ...corsHeaders,
        "Content-Type": contentType,
        "Content-Length": response.headers.get("content-length"),
        "Last-Modified": response.headers.get("last-modified"),
        ETag: response.headers.get("etag"),
      };

      // Remove null headers
      Object.keys(responseHeaders).forEach((key) => {
        if (responseHeaders[key] === null) {
          delete responseHeaders[key];
        }
      });

      // For binary files (downloads), stream the response to avoid timeout
      if (
        contentType.includes("application/") ||
        contentType.includes("octet-stream") ||
        targetUrl.includes("/downloads/")
      ) {
        // Stream the response directly to avoid loading into memory
        return new Response(response.body, {
          headers: responseHeaders,
        });
      } else {
        // For HTML content
        const body = await response.text();
        return new Response(body, {
          headers: responseHeaders,
        });
      }
    } catch (error) {
      console.error("Worker error:", error);

      // Classify error types
      const errorResponse = {
        error: error.message,
        type: "network_error",
        timestamp: new Date().toISOString(),
      };

      if (error.message.includes("timeout")) {
        errorResponse.type = "timeout_error";
      } else if (error.message.includes("429")) {
        errorResponse.type = "rate_limit_error";
      } else if (
        error.message.includes("503") ||
        error.message.includes("502")
      ) {
        errorResponse.type = "service_unavailable";
      }

      return new Response(JSON.stringify(errorResponse), {
        status: error.message.includes("429") ? 429 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },

  /**
   * Fetch with intelligent retry logic optimized for AO3 rate limiting
   */
  async fetchWithRetry(url, options, maxRetries = 3, initialDelay = 2000) {
    let lastError;
    const isDownload = url.includes("/downloads/");

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries} for ${url}`);

        // Longer timeout for better success rate
        const timeoutMs = isDownload ? 15000 : 8000; // 15s for downloads, 8s for pages
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        // Add delay before each request (except first) to avoid rate limiting
        if (attempt > 1) {
          const preDelay = 1000 + Math.random() * 2000; // 1-3 second random delay
          console.log(`Pre-request delay: ${Math.round(preDelay)}ms`);
          await this.sleep(preDelay);
        }

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        // Handle rate limiting more aggressively
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const waitTime = retryAfter
            ? parseInt(retryAfter) * 1000
            : Math.min(initialDelay * Math.pow(2, attempt), 30000); // Cap at 30 seconds

          if (attempt < maxRetries) {
            console.log(
              `Rate limited, waiting ${waitTime}ms before retry ${attempt + 1}`
            );
            await this.sleep(waitTime);
            continue;
          }
        }

        // Also retry on slow responses that might indicate soft rate limiting
        if (response.status === 200) {
          return response;
        }

        // Retry server errors with longer delays
        if (response.status >= 500 && attempt < maxRetries) {
          const serverErrorDelay = 5000 + Math.random() * 5000; // 5-10 seconds
          console.log(`Server error ${response.status}, waiting ${Math.round(serverErrorDelay)}ms`);
          await this.sleep(serverErrorDelay);
          continue;
        }

        return response;
      } catch (error) {
        lastError = error;
        console.error(`Attempt ${attempt} failed:`, error.message);

        if (attempt < maxRetries) {
          // Longer backoff for timeouts as they often indicate rate limiting
          const isTimeout = error.name === 'AbortError' || error.message.includes('timeout');
          const waitTime = isTimeout 
            ? 5000 + (initialDelay * Math.pow(2, attempt - 1)) + Math.random() * 3000 // 5s + exponential + jitter
            : initialDelay * Math.pow(2, attempt - 1) + Math.random() * 1000; // Standard backoff
            
          console.log(
            `Waiting ${Math.round(waitTime)}ms before retry ${attempt + 1}${isTimeout ? ' (timeout detected)' : ''}`
          );
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
          if (text.includes("Retry later")) {
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
    return new Promise((resolve) => setTimeout(resolve, ms));
  },
};
