const CACHE_NAME = "shinemart-pos-app-v1";
const APP_SHELL_FILES = ["./", "./index.html", "./config.js", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL_FILES).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "WARM_CACHE") return;

  const assetUrls = Array.isArray(data.assets) ? data.assets : [];
  const urlsToCache = Array.from(new Set([...APP_SHELL_FILES, ...assetUrls]));
  const activeAssetSet = new Set(
    assetUrls.map((u) => new URL(u, self.location.href).href)
  );

  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await Promise.all(
        urlsToCache.map(async (u) => {
          try {
            const req = new Request(u, { cache: "no-cache" });
            const res = await fetch(req);
            if (res && res.ok) {
              await cache.put(req.url, res);
            }
          } catch {
            // Ignore transient offline failure while warming cache
          }
        })
      );

      // Clean obsolete hashed /assets/* entries so cache stays lean
      if (activeAssetSet.size > 0) {
        const cachedKeys = await cache.keys();
        await Promise.all(
          cachedKeys.map((req) => {
            const url = new URL(req.url);
            if (url.pathname.includes("/assets/") && !activeAssetSet.has(url.href)) {
              return cache.delete(req);
            }
            return Promise.resolve(false);
          })
        );
      }
    })
  );
});

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("sw_timeout")), ms);
    fetch(request, { cache: "no-store" })
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Only cache same-origin static files; never intercept Supabase, EmailJS, or 127.0.0.1:9123 PrintAgent
  if (url.origin !== self.location.origin) return;

  if (url.pathname.includes("/assets/")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req.url);
        if (cached) return cached;
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put(req.url, fresh.clone());
        }
        return fresh;
      })
    );
    return;
  }

  // Navigation & shell files: Network-First so deploys apply fast, Cache fallback when offline
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      try {
        const fresh = await fetchWithTimeout(req, 4000);
        if (fresh && fresh.ok) {
          cache.put(req.url, fresh.clone());
        }
        return fresh;
      } catch {
        const cachedExact = await cache.match(req.url);
        if (cachedExact) return cachedExact;
        if (req.mode === "navigate") {
          const shell = (await cache.match(new URL("./index.html", self.location.href).href))
            || (await cache.match(new URL("./", self.location.href).href));
          if (shell) return shell;
        }
        throw new Error("Offline and not cached");
      }
    })
  );
});
