// v3 — cache-first navigation so the app opens instantly offline
const CACHE_NAME = "portablethermal-shell-v3";
const APP_SHELL = ["/", "/index.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache the static app shell files
      await cache.addAll(APP_SHELL);
      // Also cache the hashed JS/CSS bundles referenced by index.html
      try {
        const res = await fetch("/index.html", { cache: "no-store" });
        const html = await res.text();
        await cache.put("/index.html", new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
        const assetPaths = [...new Set([...html.matchAll(/\/assets\/[^"' >]+\.(js|css)/g)].map(m => m[0]))];
        if (assetPaths.length) await cache.addAll(assetPaths);
      } catch {
        // Offline during install — existing cache will serve as fallback
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.map((n) => (n !== CACHE_NAME ? caches.delete(n) : null)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Let cross-origin requests (localhost:3000, Firebase APIs) go directly to network
  if (url.origin !== self.location.origin) return;

  // Let cloud API calls go to network — do not cache
  if (url.pathname.startsWith("/api/")) return;

  // Navigation — cache-first so the app opens immediately offline.
  // The network fetch runs in background to keep the cache fresh.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cached = await caches.match("/index.html");
        if (cached) {
          // Serve cache immediately, refresh in background
          fetch(request)
            .then((res) => {
              if (res && res.ok) {
                const clone = res.clone();
                caches.open(CACHE_NAME).then((c) => c.put("/index.html", clone));
              }
            })
            .catch(() => {});
          return cached;
        }
        // Nothing in cache yet — must use network (first-ever load)
        try {
          const res = await fetch(request);
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put("/index.html", clone));
          return res;
        } catch {
          return new Response(
            "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>PortableThermal</title><style>body{margin:0;background:#111315;color:#f7f3ea;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}p{opacity:.6;font-size:14px}</style></head><body><p>Open the app once while online to enable offline use.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }
      })()
    );
    return;
  }

  // Static assets — cache-first, fetch and store on miss
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((res) => {
        if (!res || res.status !== 200 || res.type !== "basic") return res;
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(request, clone));
        return res;
      });
    })
  );
});
