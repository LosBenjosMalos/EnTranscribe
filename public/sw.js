const SHELL_CACHE = "entranscribe-shell-v1";
const BASE_URL = new URL("./", self.location.href);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll([BASE_URL.href, new URL("manifest.webmanifest", BASE_URL).href]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("entranscribe-shell-") && key !== SHELL_CACHE).map((key) => caches.delete(key)))),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      let response;
      try {
        response = await fetch(event.request);
        if (response.ok) await cache.put(event.request, response.clone());
      } catch {
        response = await cache.match(event.request);
      }

      if (!response && event.request.mode === "navigate") {
        response = await cache.match(BASE_URL.href);
      }
      if (!response) return new Response("Offline resource unavailable", { status: 503 });
      return withIsolationHeaders(response);
    })(),
  );
});

function withIsolationHeaders(response) {
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
