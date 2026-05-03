// v2 — pre-caches JS/CSS bundles so the app opens offline immediately
const CACHE_NAME = "portablethermal-shell-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Always cache the app shell HTML first
      await cache.addAll(["/", "/index.html", "/manifest.webmanifest"]);

      // Parse index.html to find the hashed JS/CSS bundle paths and cache them too.
      // This ensures the app works offline even on first open after a fresh deploy.
      try {
        const res = await fetch("/index.html", { cache: "no-store" });
        const html = await res.text();
        // Put the freshest index.html in cache
        await cache.put("/index.html", new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } }));
        // Extract /assets/*.js and /assets/*.css paths
        const assetPaths = [...new Set(
          [...html.matchAll(/\/assets\/[^"' >]+\.(js|css)/g)].map(m => m[0])
        )];
        if (assetPaths.length) await cache.addAll(assetPaths);
      } catch {
        // Offline during install — cached assets serve as fallback
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

  // Don't intercept cross-origin requests (localhost:3000 local server, Firebase APIs)
  if (url.origin !== self.location.origin) return;

  // Don't intercept Firebase cloud API calls — they need live network
  if (url.pathname.startsWith("/api/")) return;

  // Navigation requests — network first, fall back to cached index.html
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put("/index.html", clone));
          return response;
        })
        .catch(async () => {
          const cached = await caches.match("/index.html");
          return cached || caches.match("/");
        })
    );
    return;
  }

  // Static assets — cache first, fetch and cache on miss
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== "basic") return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        return response;
      });
    })
  );
});
