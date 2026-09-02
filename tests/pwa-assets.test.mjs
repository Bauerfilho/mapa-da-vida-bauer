import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const projectUrl = new URL("../", import.meta.url);
const swSource = await readFile(new URL("public/sw.js", projectUrl), "utf8");
const pwaSource = await readFile(new URL("src/pwa.ts", projectUrl), "utf8");
const indexSource = await readFile(new URL("index.html", projectUrl), "utf8");
const manifest = JSON.parse(await readFile(new URL("public/manifest.webmanifest", projectUrl), "utf8"));
const origin = "https://mentor.test";

function contentType(pathname) {
  if (pathname.endsWith(".html") || pathname === "/") return "text/html; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".json") || pathname.endsWith(".webmanifest")) return "application/json";
  if (pathname.endsWith(".svg")) return "image/svg+xml";
  if (pathname.endsWith(".png")) return "image/png";
  return "application/octet-stream";
}

function requestUrl(input) {
  const value = typeof input === "string" ? input : input.url;
  return new URL(value, origin).href;
}

function createHarness({
  timeoutCapMs = Number.POSITIVE_INFINITY,
  workerSource = swSource,
  sharedStores,
  shellMarker = "cached shell",
  base = "/",
} = {}) {
  const listeners = new Map();
  const stores = sharedStores ?? new Map();
  const state = {
    claimed: 0,
    skipWaiting: 0,
    fetchImpl: async (input) => {
      const url = new URL(requestUrl(input));
      let body = `asset:${url.pathname}`;
      if (url.pathname === base || url.pathname === `${base}index.html`) {
        body = `<!doctype html><link rel="stylesheet" href="${base}assets/app.css"><script src="${base}assets/app.js"></script><main>${shellMarker}</main>`;
      } else if (url.pathname === `${base}assets/app.css`) {
        body = `@font-face{src:url("${base}assets/mentor.woff2")}`;
      }
      return new Response(body, {
        status: 200,
        headers: {
          "cache-control": "public, max-age=60",
          "content-type": contentType(url.pathname),
        },
      });
    },
  };

  class MemoryCache {
    entries = new Map();

    async addAll(inputs) {
      for (const input of inputs) {
        const response = await state.fetchImpl(requestUrl(input));
        if (!response.ok) throw new Error(`addAll failed: ${input}`);
        await this.put(input, response);
      }
    }

    async put(input, response) {
      this.entries.set(requestUrl(input), response.clone());
    }

    async match(input) {
      return this.entries.get(requestUrl(input))?.clone();
    }

    async keys() {
      return [...this.entries.keys()].map((url) => new Request(url));
    }

    async delete(input) {
      return this.entries.delete(requestUrl(input));
    }
  }

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new MemoryCache());
      return stores.get(name);
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
    async match(input) {
      for (const cache of stores.values()) {
        const response = await cache.match(input);
        if (response) return response;
      }
      return undefined;
    },
  };

  const self = {
    location: { origin, href: `${origin}${base}sw.js` },
    clients: {
      async claim() {
        state.claimed += 1;
      },
      async matchAll() {
        return [];
      },
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    async skipWaiting() {
      state.skipWaiting += 1;
    },
  };

  const context = {
    AbortController,
    Date,
    Headers,
    Promise,
    Request,
    Response,
    Set,
    URL,
    caches,
    clearTimeout,
    console,
    fetch: (...args) => state.fetchImpl(...args),
    self,
    setTimeout: (callback, delay, ...args) =>
      setTimeout(callback, Math.min(delay, timeoutCapMs), ...args),
  };
  vm.runInNewContext(workerSource, context, { filename: "public/sw.js" });

  async function dispatchExtendable(type, properties = {}) {
    const waits = [];
    listeners.get(type)({
      ...properties,
      waitUntil(promise) {
        waits.push(Promise.resolve(promise));
      },
    });
    await Promise.all(waits);
  }

  async function dispatchFetch(request) {
    const waits = [];
    let responsePromise;
    listeners.get("fetch")({
      request,
      respondWith(value) {
        responsePromise = Promise.resolve(value);
      },
      waitUntil(value) {
        waits.push(Promise.resolve(value));
      },
    });
    const response = responsePromise ? await responsePromise : undefined;
    await Promise.all(waits);
    return response;
  }

  return { caches, dispatchExtendable, dispatchFetch, listeners, state, stores };
}

function navigationRequest(pathname, headers = {}) {
  const controller = new AbortController();
  return {
    url: new URL(pathname, origin).href,
    method: "GET",
    mode: "navigate",
    destination: "document",
    headers: new Headers(headers),
    signal: controller.signal,
  };
}

function shellAssetRequest(pathname, destination, headers = {}) {
  const controller = new AbortController();
  return {
    url: new URL(pathname, origin).href,
    method: "GET",
    mode: "same-origin",
    destination,
    headers: new Headers(headers),
    signal: controller.signal,
  };
}

function workerSourceAtVersion(version) {
  return swSource.replace(
    /SHELL_CACHE_VERSION = "[^"]+"/,
    `SHELL_CACHE_VERSION = "${version}"`,
  );
}

test("manifest is installable and scoped to the private app", () => {
  for (const field of ["id", "start_url", "scope"]) {
    assert.equal(new URL(manifest[field], `${origin}/manifest.webmanifest`).pathname, "/");
    assert.equal(new URL(manifest[field], `${origin}/mapa-da-vida-bauer/manifest.webmanifest`).pathname, "/mapa-da-vida-bauer/");
  }
  assert.equal(manifest.display, "standalone");
  assert.ok(manifest.display_override.includes("standalone"));
  assert.equal(manifest.prefer_related_applications, false);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "maskable"));
});

test("the document declares a restrictive local-first content policy", () => {
  const policy = indexSource.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/i)?.[1] ?? "";
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /script-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'none'/);
  assert.doesNotMatch(policy, /unsafe-eval/);
  assert.match(indexSource, /name="referrer" content="no-referrer"/);
  assert.match(indexSource, /name="robots" content="noindex, nofollow, noarchive"/);
});

test("window and worker publish the same versioned cache contract", () => {
  const workerVersion = swSource.match(/SHELL_CACHE_VERSION = "([^"]+)"/)?.[1];
  const windowVersion = pwaSource.match(/MENTOR_PWA_CACHE_VERSION = "([^"]+)"/)?.[1];
  assert.equal(workerVersion, windowVersion);
  assert.match(workerVersion, /^\d{4}-\d{2}-\d{2}-v\d+$/);
});

test("documents the one-time transition boundary from the prior network-first worker", () => {
  assert.match(swSource, /previously deployed v5 worker was network-first/);
  assert.match(swSource, /Opt-in shell pinning is guaranteed from\s*\n?\/\/ v6 onward/);
});

test("precache readiness includes the generated JS, CSS, and nested font graph", async () => {
  const harness = createHarness();
  await harness.dispatchExtendable("install");

  let result;
  await harness.dispatchExtendable("message", {
    data: { type: "MENTOR_PWA_CACHE_STATUS", requestId: "readiness-1" },
    ports: [{ postMessage: (message) => { result = message; } }],
  });

  assert.equal(result.type, "MENTOR_PWA_CACHE_STATUS_RESULT");
  assert.equal(result.requestId, "readiness-1");
  assert.equal(result.ready, true);
  assert.equal(result.missing.length, 0);

  const cache = await harness.caches.open(result.cacheName);
  assert.ok(await cache.match("/assets/app.js"));
  assert.ok(await cache.match("/assets/app.css"));
  assert.ok(await cache.match("/assets/mentor.woff2"));
});

test("controlled navigation serves the pinned shell without consulting the network", async () => {
  const harness = createHarness();
  await harness.dispatchExtendable("install");
  let networkCalls = 0;
  harness.state.fetchImpl = async () => {
    networkCalls += 1;
    return new Response("<main>new server shell</main>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  };

  const response = await harness.dispatchFetch(navigationRequest("/mentor/hoje"));
  assert.equal(response.status, 200);
  assert.match(await response.text(), /cached shell/);
  assert.equal(networkCalls, 0);
});

test("navigation falls back to the offline document without fetching another build", async () => {
  const harness = createHarness();
  await harness.dispatchExtendable("install");
  const workerVersion = swSource.match(/SHELL_CACHE_VERSION = "([^"]+)"/)?.[1];
  const cache = await harness.caches.open(`mapa-da-vida-bauer-pages-shell-${workerVersion}`);
  await cache.delete("/");
  await cache.delete("/index.html");

  let networkCalls = 0;
  harness.state.fetchImpl = async () => {
    networkCalls += 1;
    throw new Error("controlled navigation must remain local");
  };

  const response = await harness.dispatchFetch(navigationRequest("/mentor/agenda"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "asset:/offline.html");
  assert.equal(networkCalls, 0);
});

test("the version cache stays immutable and executable shell assets fail closed", async () => {
  const harness = createHarness();
  await harness.dispatchExtendable("install");
  const workerVersion = swSource.match(/SHELL_CACHE_VERSION = "([^"]+)"/)?.[1];
  const cache = await harness.caches.open(`mapa-da-vida-bauer-pages-shell-${workerVersion}`);
  const keysBefore = (await cache.keys()).map((request) => request.url).sort();

  let networkCalls = 0;
  harness.state.fetchImpl = async (input) => {
    networkCalls += 1;
    const url = new URL(requestUrl(input));
    return new Response(`new-server:${url.pathname}`, {
      status: 200,
      headers: {
        "cache-control": "public, max-age=60",
        "content-type": contentType(url.pathname),
      },
    });
  };

  const pinnedScript = await harness.dispatchFetch(
    shellAssetRequest("/assets/app.js", "script"),
  );
  assert.equal(await pinnedScript.text(), "asset:/assets/app.js");
  assert.equal(networkCalls, 0);

  const missingScript = await harness.dispatchFetch(
    shellAssetRequest("/assets/not-in-this-build.js", "script"),
  );
  assert.equal(missingScript.status, 503);
  assert.equal(networkCalls, 0);

  const recoverableImage = await harness.dispatchFetch(
    shellAssetRequest("/assets/optional-image.png", "image"),
  );
  assert.equal(await recoverableImage.text(), "new-server:/assets/optional-image.png");
  assert.equal(networkCalls, 1);
  assert.equal(await cache.match("/assets/optional-image.png"), undefined);
  assert.deepEqual((await cache.keys()).map((request) => request.url).sort(), keysBefore);
});

test("auth, range, tokenized, and API requests are never intercepted for caching", async () => {
  const harness = createHarness();
  const requests = [
    navigationRequest("/api/finance"),
    navigationRequest("/auth/callback"),
    navigationRequest("/assets/video.mp4", { range: "bytes=0-100" }),
    navigationRequest("/?access_token=secret"),
    navigationRequest("/", { authorization: "Bearer secret" }),
  ];

  for (const request of requests) {
    assert.equal(await harness.dispatchFetch(request), undefined);
  }
});

test("a entrada de autenticação ChatGPT não é substituída pelo aplicativo em cache", async () => {
  const harness = createHarness();
  await harness.dispatchExtendable("install");
  assert.equal(await harness.dispatchFetch(navigationRequest("/signin-with-chatgpt?return_to=%2F")), undefined);
  const normal = await harness.dispatchFetch(navigationRequest("/?native=1"));
  assert.equal(normal.status, 200);
});

test("activation deletes only old shell caches and acknowledges explicit updates", async () => {
  const harness = createHarness();
  await harness.caches.open("mapa-da-vida-bauer-pages-shell-old");
  await harness.caches.open("user-owned-cache");
  await harness.dispatchExtendable("install");
  assert.equal(harness.state.skipWaiting, 0);

  let acknowledgement;
  await harness.dispatchExtendable("message", {
    data: { type: "MENTOR_PWA_ACTIVATE_UPDATE", requestId: "activate-1" },
    ports: [{ postMessage: (message) => { acknowledgement = message; } }],
  });
  assert.equal(acknowledgement.type, "MENTOR_PWA_ACTIVATE_UPDATE_ACK");
  assert.equal(acknowledgement.requestId, "activate-1");
  assert.equal(harness.state.skipWaiting, 1);

  await harness.dispatchExtendable("activate");
  const cacheNames = await harness.caches.keys();
  assert.ok(!cacheNames.includes("mapa-da-vida-bauer-pages-shell-old"));
  assert.ok(cacheNames.includes("user-owned-cache"));
  assert.equal(harness.state.claimed, 1);
});

test("vN stays pinned while vN+1 waits and switches only after the explicit update action", async () => {
  const sharedStores = new Map();
  const priorVersion = "2026-08-31-v99";
  const nextVersion = swSource.match(/SHELL_CACHE_VERSION = "([^"]+)"/)?.[1];
  const prior = createHarness({
    workerSource: workerSourceAtVersion(priorVersion),
    sharedStores,
    shellMarker: "shell generation N",
  });
  await prior.dispatchExtendable("install");

  const next = createHarness({
    sharedStores,
    shellMarker: "shell generation N+1",
  });
  await next.dispatchExtendable("install");

  assert.equal(next.state.skipWaiting, 0);
  assert.deepEqual(
    (await next.caches.keys()).filter((name) => name.startsWith("mapa-da-vida-bauer-pages-shell-")).sort(),
    [`mapa-da-vida-bauer-pages-shell-${nextVersion}`, `mapa-da-vida-bauer-pages-shell-${priorVersion}`].sort(),
  );

  const priorNavigation = await prior.dispatchFetch(navigationRequest("/mentor/hoje"));
  assert.match(await priorNavigation.text(), /shell generation N/);

  // Even if the old cache is partially damaged, it must not leak executable
  // content from the waiting worker's cache via a global caches.match().
  const priorCache = await prior.caches.open(`mapa-da-vida-bauer-pages-shell-${priorVersion}`);
  await priorCache.delete("/assets/app.js");
  const crossVersionScript = await prior.dispatchFetch(
    shellAssetRequest("/assets/app.js", "script"),
  );
  assert.equal(crossVersionScript.status, 503);

  await next.dispatchExtendable("message", {
    data: { type: "MENTOR_PWA_ACTIVATE_UPDATE", requestId: "switch-generation" },
  });
  assert.equal(next.state.skipWaiting, 1);
  await next.dispatchExtendable("activate");

  const remainingCaches = await next.caches.keys();
  assert.ok(!remainingCaches.includes(`mapa-da-vida-bauer-pages-shell-${priorVersion}`));
  assert.ok(remainingCaches.includes(`mapa-da-vida-bauer-pages-shell-${nextVersion}`));

  const nextNavigation = await next.dispatchFetch(navigationRequest("/mentor/hoje"));
  assert.match(await nextNavigation.text(), /shell generation N\+1/);
});

test("the service worker never opens, clears, or migrates IndexedDB", () => {
  assert.doesNotMatch(swSource, /indexedDB|deleteDatabase|IDBDatabase/);
  assert.match(swSource, /key\.startsWith\(SHELL_CACHE_PREFIX\)/);
});

test("o worker Pages confina shell e fallback à própria subpasta sem apagar outras PWAs", async () => {
  const base = "/mapa-da-vida-bauer/";
  const harness = createHarness({ base });
  await harness.caches.open("mentor-bauer-shell-private");
  await harness.caches.open("other-pwa-cache");
  await harness.dispatchExtendable("install");
  await harness.dispatchExtendable("activate");
  assert.ok((await harness.caches.keys()).includes("mentor-bauer-shell-private"));
  assert.ok((await harness.caches.keys()).includes("other-pwa-cache"));
  const shellCacheName = (await harness.caches.keys()).find((name) => name.startsWith("mapa-da-vida-bauer-pages-shell-"));
  const shellCache = await harness.caches.open(shellCacheName);
  assert.ok((await shellCache.keys()).every((request) => new URL(request.url).pathname.startsWith(base)));
  assert.ok(await shellCache.match(`${base}assets/mentor.woff2`));
  assert.equal(await harness.dispatchFetch(navigationRequest("/outra-pwa/")), undefined);
  assert.equal(await harness.dispatchFetch(navigationRequest(`${base}auth/callback`)), undefined);
  assert.equal(await harness.dispatchFetch(navigationRequest(`${base}THIRD_PARTY_NOTICES.md`)), undefined);
  harness.state.fetchImpl = async () => { throw new Error("Sem rede"); };
  assert.match(await (await harness.dispatchFetch(navigationRequest(`${base}agenda`))).text(), /cached shell/);
});
