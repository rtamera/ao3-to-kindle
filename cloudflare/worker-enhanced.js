export default {
  async fetch(request) {
    // Handle CORS preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("No URL provided", { status: 400 });
    }

    // More robust AO3 URL validation
    if (!targetUrl.startsWith("https://archiveofourown.org/")) {
      return new Response("Invalid URL - must be AO3", { status: 400 });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5"
        }
      });

      if (!response.ok) {
        return new Response(`AO3 returned ${response.status}: ${response.statusText}`, { status: response.status });
      }

      const body = await response.text();

      return new Response(body, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": response.headers.get("content-type") || "text/html",
          "Cache-Control": "public, max-age=300", // Cache for 5 minutes
        },
      });
    } catch (error) {
      return new Response("Error fetching URL: " + error.message, { status: 500 });
    }
  },
};