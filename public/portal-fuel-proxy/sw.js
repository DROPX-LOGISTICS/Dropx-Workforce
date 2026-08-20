/**
 * Browser-side proxy for IOCL/BPCL portal APIs (operator ISP egress).
 * Must control pages under /portal-fuel-proxy/ so same-origin fetches are intercepted.
 */
self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith("/portal-fuel-proxy/")) return;
  // Don't proxy the runner page or the SW script itself.
  if (url.pathname === "/portal-fuel-proxy/sw.js" || !url.searchParams.has("url")) return;

  const target = url.searchParams.get("url");
  if (!target || !/^https:\/\/(betaapi\.iocxtrapower\.com|api\.cep\.bpcl\.in|hellobpcl\.in)/i.test(target)) {
    event.respondWith(new Response("Invalid portal target", { status: 400 }));
    return;
  }

  event.respondWith((async () => {
    const headers = new Headers(event.request.headers);
    headers.delete("host");
    // Buffer the body — streaming request.body without duplex drops POSTs in Chrome.
    const method = event.request.method;
    const body =
      method === "GET" || method === "HEAD" ? undefined : await event.request.arrayBuffer();

    try {
      return await fetch(target, {
        method,
        headers,
        body,
        redirect: "follow",
        credentials: "include"
      });
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { "content-type": "application/json" }
      });
    }
  })());
});
