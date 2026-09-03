const SHELL_CACHE_PREFIX = "mapa-da-vida-bauer-pages-shell-";
// O worker só administra o diretório em que foi instalado, inclusive no GitHub Pages.
const APP_BASE = new URL("./", self.location.href).pathname;
const appPath = (relative) => `${APP_BASE}${relative.replace(/^\//, "")}`;
// Release invariant: bump this value (and MENTOR_PWA_CACHE_VERSION) for every
// deployed shell build. A cache is populated only while its worker installs and
// is read-only afterwards, so an active worker can never adopt a newer index/JS.
//
// Transition boundary: the previously deployed v5 worker was network-first and
// cannot be changed retroactively. It may still fetch the server's newer index
// before this v6 worker is activated. Opt-in shell pinning is guaranteed from
// v6 onward, after the user activates this worker once.
const SHELL_CACHE_VERSION = "2026-09-03-v21";
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}${SHELL_CACHE_VERSION}`;

const CACHE_STATUS_REQUEST = "MENTOR_PWA_CACHE_STATUS";
const CACHE_STATUS_RESPONSE = "MENTOR_PWA_CACHE_STATUS_RESULT";
const OFFLINE_READY_MESSAGE = "MENTOR_PWA_OFFLINE_READY";
const ACTIVATE_UPDATE_REQUEST = "MENTOR_PWA_ACTIVATE_UPDATE";

const RUNTIME_SHELL_ASSETS = [
  "/assets/android/Keyboard.png",
  "/assets/android/Pixel10.png",
  "/assets/android/navigation-bar.svg",
  "/assets/iphone/Bezel.png",
  "/assets/iphone/Keyboard.png",
  "/assets/status/ios-status-icons.svg",
  "/assets/status/status-icons.svg",
];

const SHELL_FILES = [
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  ...RUNTIME_SHELL_ASSETS,
].map(appPath);
const SHELL_FILE_PATHS = new Set(SHELL_FILES);
const LEGAL_DOCUMENT_PATHS = new Set([appPath("THIRD_PARTY_NOTICES.md")]);
const STATIC_DESTINATIONS = new Set(["script", "style", "font", "image"]);
const SENSITIVE_ROUTE = /^\/(?:api|auth|oauth|oauth2|login|logout|signin-with-chatgpt|session|sessions|callback)(?:\/|$)/i;
const SENSITIVE_QUERY_KEYS = new Set(["access_token", "id_token", "token", "code"]);

function isSensitiveRequest(request, url) {
  if (request.method !== "GET" || url.origin !== self.location.origin || !url.pathname.startsWith(APP_BASE)) return true;
  if (
    request.headers.has("authorization") ||
    request.headers.has("range") ||
    request.headers.has("if-range")
  ) {
    return true;
  }
  const localPath = `/${url.pathname.slice(APP_BASE.length)}`;
  if (SENSITIVE_ROUTE.test(localPath) || localPath.startsWith("/.auth/")) return true;
  return [...SENSITIVE_QUERY_KEYS].some((key) => url.searchParams.has(key));
}

function isSafeCacheResponse(response) {
  if (!response.ok || response.status !== 200 || response.headers.has("content-range")) return false;
  if (response.type !== "basic" && response.type !== "default") return false;

  const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
  if (cacheControl.includes("no-store") || cacheControl.includes("private")) return false;

  const vary = response.headers.get("vary")?.toLowerCase() ?? "";
  return !vary.includes("authorization") && !vary.includes("cookie");
}

function isShellAsset(request, url) {
  if (SHELL_FILE_PATHS.has(url.pathname)) return true;
  if (url.pathname.startsWith(appPath("icons/"))) return request.destination === "image";
  if (!url.pathname.startsWith(appPath("assets/"))) return false;
  return STATIC_DESTINATIONS.has(request.destination);
}

function assetUrlsFromText(text, baseUrl) {
  const references = text.matchAll(/(?:src|href|url)\s*(?:=|\()\s*["']?([^"')\s]+)["']?/gi);
  const urls = new Set();

  for (const match of references) {
    try {
      const candidate = new URL(match[1], baseUrl);
      if (candidate.origin === self.location.origin && candidate.pathname.startsWith(appPath("assets/"))) {
        urls.add(candidate.href);
      }
    } catch {
      // Ignore malformed, inline, and browser-owned references.
    }
  }

  return [...urls];
}

async function fetchAndCache(cache, url) {
  const response = await fetch(url, { cache: "reload", credentials: "same-origin" });
  if (!isSafeCacheResponse(response)) {
    throw new Error(`Unable to precache shell asset: ${url}`);
  }
  await cache.put(url, response.clone());
  return response;
}

async function cacheAssetGraph(cache, directAssets) {
  for (const assetUrl of directAssets) {
    const assetResponse = await fetchAndCache(cache, assetUrl);
    if (!new URL(assetUrl).pathname.endsWith(".css")) continue;

    const stylesheetText = await assetResponse.text();
    const nestedAssets = assetUrlsFromText(stylesheetText, assetUrl);
    await Promise.all(nestedAssets.map((nestedUrl) => fetchAndCache(cache, nestedUrl)));
  }
}

async function storePinnedShell(cache, indexResponse, indexUrl) {
  const indexForRoot = indexResponse.clone();
  const indexForPath = indexResponse.clone();
  const indexText = await indexResponse.text();
  const directAssets = assetUrlsFromText(indexText, indexUrl);

  await cacheAssetGraph(cache, directAssets);
  await cache.put(appPath("index.html"), indexForPath);
  await cache.put(APP_BASE, indexForRoot);
}

async function precacheShell() {
  const cache = await caches.open(SHELL_CACHE);
  await cache.addAll(SHELL_FILES);

  const indexUrl = new URL("index.html", self.location.href).href;
  const indexResponse = await fetch(indexUrl, {
    cache: "reload",
    credentials: "same-origin",
  });
  if (!isSafeCacheResponse(indexResponse)) throw new Error("Unable to precache the app shell");
  await storePinnedShell(cache, indexResponse, indexUrl);
}

async function requiredShellEntries(cache) {
  const entries = new Set([APP_BASE, appPath("index.html"), ...SHELL_FILES]);
  const indexResponse = await cache.match(appPath("index.html"));
  if (!indexResponse) return [...entries];

  const indexUrl = new URL("index.html", self.location.href).href;
  const directAssets = assetUrlsFromText(await indexResponse.text(), indexUrl);
  directAssets.forEach((assetUrl) => entries.add(assetUrl));

  for (const assetUrl of directAssets) {
    if (!new URL(assetUrl).pathname.endsWith(".css")) continue;
    const stylesheet = await cache.match(assetUrl);
    if (!stylesheet) continue;
    assetUrlsFromText(await stylesheet.text(), assetUrl).forEach((nestedUrl) => entries.add(nestedUrl));
  }

  return [...entries];
}

async function getShellReadiness() {
  const cacheNames = await caches.keys();
  if (!cacheNames.includes(SHELL_CACHE)) {
    return {
      ready: false,
      cacheName: SHELL_CACHE,
      cacheVersion: SHELL_CACHE_VERSION,
      missing: ["cache"],
      checkedAt: Date.now(),
    };
  }

  const cache = await caches.open(SHELL_CACHE);
  const requiredEntries = await requiredShellEntries(cache);
  const missing = [];

  for (const entry of requiredEntries) {
    if (!(await cache.match(entry))) missing.push(entry);
  }

  return {
    ready: missing.length === 0,
    cacheName: SHELL_CACHE,
    cacheVersion: SHELL_CACHE_VERSION,
    missing,
    checkedAt: Date.now(),
  };
}

async function broadcastOfflineReadiness() {
  const readiness = await getShellReadiness();
  if (!readiness.ready) return;
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  clients.forEach((client) => client.postMessage({ type: OFFLINE_READY_MESSAGE, ...readiness }));
}

function replyToMessage(event, message) {
  const port = event.ports?.[0];
  if (port) {
    port.postMessage(message);
    return;
  }
  event.source?.postMessage?.(message);
}

async function cachedNavigationFallback(cache) {
  return (
    (await cache.match(appPath("index.html"))) ??
    (await cache.match(APP_BASE)) ??
    (await cache.match(appPath("offline.html"))) ??
    new Response("Mentor Bauer indisponível offline.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  );
}

async function handleNavigation() {
  const cache = await caches.open(SHELL_CACHE);
  return cachedNavigationFallback(cache);
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheShell());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim())
      .then(() => broadcastOfflineReadiness()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === CACHE_STATUS_REQUEST) {
    event.waitUntil(
      getShellReadiness().then((readiness) =>
        replyToMessage(event, {
          type: CACHE_STATUS_RESPONSE,
          requestId: event.data.requestId,
          ...readiness,
        }),
      ),
    );
    return;
  }

  if (event.data?.type === ACTIVATE_UPDATE_REQUEST || event.data?.type === "SKIP_WAITING") {
    replyToMessage(event, {
      type: "MENTOR_PWA_ACTIVATE_UPDATE_ACK",
      requestId: event.data.requestId,
    });
    event.waitUntil(Promise.resolve(self.skipWaiting()));
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (isSensitiveRequest(request, url) || url.pathname === appPath("sw.js") || LEGAL_DOCUMENT_PATHS.has(url.pathname)) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation());
    return;
  }

  if (!isShellAsset(request, url)) return;

  event.respondWith(
    caches.open(SHELL_CACHE).then(async (cache) => {
      const cachedResponse = await cache.match(request);
      if (cachedResponse) return cachedResponse;

      // A missing script or stylesheet must fail closed. Looking on the network
      // (or across every cache) could combine this worker's pinned HTML with a
      // different build. The complete version-coupled graph is an install gate.
      if (request.destination === "script" || request.destination === "style") {
        return new Response("Pinned app-shell asset unavailable.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }

      // Non-executable shell resources may recover from the network, but are
      // never written into the immutable version cache after installation.
      const networkResponse = await fetch(request);
      return networkResponse;
    }),
  );
});
