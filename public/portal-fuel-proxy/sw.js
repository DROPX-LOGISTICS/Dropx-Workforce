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

  const headers = new Headers(event.request.headers);
  headers.delete("host");
  event.respondWith(
    fetch(target, {
      method: event.request.method,
      headers,
      body: event.request.method === "GET" || event.request.method === "HEAD" ? undefined : event.request.body,
      redirect: "follow",
      credentials: "include"
    }).catch((err) => new Response(String(err && err.message ? err.message : err), { status: 502 }))
  );
});
