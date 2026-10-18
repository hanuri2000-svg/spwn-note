const CACHE_NAME = "spawn-note-v1.7.11";
const APP_FILES = [
  "./",
  "./index.html",
  "./ui.js",
  "./season-theme.css",
  "./season-theme.js",
  "./config.js",
  "./manifest.webmanifest",
  "./version.json",
  "./assets/brand-watermark.png",
];
const APP_URLS = new Set(APP_FILES.map((path) => new URL(path, self.registration.scope).href));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_FILES)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("spawn-note-v") && key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  // Normalize only known application files and only the release query.
  // Other query parameters may identify different resources.
  url.searchParams.delete("v");
  const appKey = APP_URLS.has(url.href) ? url.href : null;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME)
            .then((cache) => cache.put(appKey || event.request, copy)).catch(() => {}));
        }
        return response;
      })
      .catch(async () => {
        // Never read obsolete application caches left behind by an update.
        const cache = await caches.open(CACHE_NAME);
        const cached = await cache.match(appKey || event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const page = await cache.match(new URL("./index.html", self.registration.scope).href);
          if (page) return page;
        }
        return Response.error();
      }),
  );
});
