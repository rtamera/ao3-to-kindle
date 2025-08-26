export default {
  async fetch(request) {
    const url = new URL(request.url);
    const targetUrl = url.searchParams.get("url");

    if (!targetUrl) {
      return new Response("No URL provided", { status: 400 });
    }

    if (!targetUrl.includes("archiveofourown.org")) {
      return new Response("Invalid URL - must be AO3", { status: 400 });
    }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      });

      const body = await response.text();

      return new Response(body, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "text/html",
        },
      });
    } catch (error) {
      return new Response("Error fetching URL: " + error.message, { status: 500 });
    }
  },
};