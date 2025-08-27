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
      return new Response("No URL provided", { 
        status: 400,
        headers: corsHeaders
      });
    }

    if (!targetUrl.includes("archiveofourown.org")) {
      return new Response("Invalid URL - must be AO3", { 
        status: 400,
        headers: corsHeaders
      });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`AO3 returned ${response.status}: ${response.statusText}`);
      }

      // Handle different content types
      const contentType = response.headers.get('content-type') || '';
      let responseHeaders = {
        ...corsHeaders,
        "Content-Type": contentType.includes('text/html') ? 'text/html' : contentType,
      };

      // For binary files (downloads), preserve the original content type
      if (contentType.includes('application/') || contentType.includes('octet-stream')) {
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
      return new Response(`Error fetching URL: ${error.message}`, { 
        status: 500,
        headers: corsHeaders
      });
    }
  },
};