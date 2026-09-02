/**
 * Must match public/sw.js and change for every deployed app-shell build.
 * Version v6 starts the immutable, user-activated update contract: checking or
 * downloading an update never changes the shell served by the active worker.
 */
export const MENTOR_PWA_CACHE_VERSION = "2026-09-02-v19";

export const PWA_INSTALL_AVAILABLE_EVENT = "mentor-pwa:install-available";
export const PWA_OFFLINE_READY_EVENT = "mentor-pwa:offline-ready";
export const PWA_RUNTIME_STATE_EVENT = "mentor-pwa:runtime-state";
export const PWA_UPDATE_AVAILABLE_EVENT = "mentor-pwa:update-available";
export const PWA_UPDATE_ACTIVATED_EVENT = "mentor-pwa:update-activated";

const CACHE_STATUS_REQUEST = "MENTOR_PWA_CACHE_STATUS";
const CACHE_STATUS_RESPONSE = "MENTOR_PWA_CACHE_STATUS_RESULT";
const ACTIVATE_UPDATE_REQUEST = "MENTOR_PWA_ACTIVATE_UPDATE";
const DEFAULT_MESSAGE_TIMEOUT_MS = 3_000;
const DEFAULT_ACTIVATION_TIMEOUT_MS = 12_000;

export type MentorPwaRuntimeMode = "unsupported" | "browser" | "standalone";
export type MentorPwaInstallMode = "installed" | "prompt" | "manual-ios" | "unavailable";

export interface MentorPwaRuntimeState {
  runtimeMode: MentorPwaRuntimeMode;
  installMode: MentorPwaInstallMode;
  isIos: boolean;
  isOnline: boolean;
  isSecureContext: boolean;
  serviceWorkerSupported: boolean;
}

export interface MentorPwaCacheReadiness {
  ready: boolean;
  supported: boolean;
  controlled: boolean;
  cacheName: string | null;
  cacheVersion: string | null;
  missing: string[];
  checkedAt: number;
  reason?: "unsupported" | "no-registration" | "no-worker" | "timeout" | "message-error";
}

export interface MentorPwaUpdateAvailableDetail {
  registration: ServiceWorkerRegistration;
  worker: ServiceWorker;
  detectedAt: number;
}

export interface MentorPwaActivationResult {
  outcome: "activated" | "no-update" | "unsupported" | "timeout" | "redundant" | "message-error";
  activated: boolean;
  controllerChanged: boolean;
  registration: ServiceWorkerRegistration | null;
}

export interface MentorPwaInstallResult {
  outcome: "accepted" | "dismissed" | "already-installed" | "manual-ios" | "unavailable";
  platform?: string;
}

export interface MentorPersistentStorageResult {
  supported: boolean;
  persisted: boolean;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

interface CacheStatusMessage extends Partial<MentorPwaCacheReadiness> {
  type: typeof CACHE_STATUS_RESPONSE;
  requestId: string;
}

export interface MentorPwaActivationOptions {
  reload?: boolean;
  timeoutMs?: number;
}

let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let lastOfflineReadyKey: string | null = null;
let pendingUpdateDetail: MentorPwaUpdateAvailableDetail | null = null;
const announcedUpdateWorkers = new WeakSet<ServiceWorker>();
const announcedActivatedWorkers = new WeakSet<ServiceWorker>();
const activationPromises = new WeakMap<ServiceWorker, Promise<MentorPwaActivationResult>>();

function hasWindow(): boolean {
  return typeof window !== "undefined" && typeof navigator !== "undefined";
}

function supportsServiceWorkers(): boolean {
  return hasWindow() && window.isSecureContext && "serviceWorker" in navigator;
}

function isIosDevice(): boolean {
  if (!hasWindow()) return false;
  const navigatorWithPlatform = navigator as Navigator & { platform?: string };
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigatorWithPlatform.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandaloneDisplay(): boolean {
  if (!hasWindow()) return false;
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    navigatorWithStandalone.standalone === true ||
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    window.matchMedia?.("(display-mode: fullscreen)").matches === true ||
    window.matchMedia?.("(display-mode: minimal-ui)").matches === true
  );
}

export function getMentorPwaRuntimeMode(): MentorPwaRuntimeMode {
  if (isStandaloneDisplay()) return "standalone";
  if (!supportsServiceWorkers()) return "unsupported";
  return "browser";
}

export function getMentorPwaInstallMode(): MentorPwaInstallMode {
  if (isStandaloneDisplay()) return "installed";
  if (deferredInstallPrompt) return "prompt";
  if (isIosDevice()) return "manual-ios";
  return "unavailable";
}

export function getMentorPwaRuntimeState(): MentorPwaRuntimeState {
  return {
    runtimeMode: getMentorPwaRuntimeMode(),
    installMode: getMentorPwaInstallMode(),
    isIos: isIosDevice(),
    isOnline: hasWindow() ? navigator.onLine : false,
    isSecureContext: hasWindow() ? window.isSecureContext : false,
    serviceWorkerSupported: supportsServiceWorkers(),
  };
}

function dispatchRuntimeState(): void {
  if (!hasWindow()) return;
  window.dispatchEvent(
    new CustomEvent<MentorPwaRuntimeState>(PWA_RUNTIME_STATE_EVENT, {
      detail: getMentorPwaRuntimeState(),
    }),
  );
}

function rememberPendingUpdate(
  registration: ServiceWorkerRegistration,
  worker: ServiceWorker,
): MentorPwaUpdateAvailableDetail {
  if (
    pendingUpdateDetail?.registration === registration &&
    pendingUpdateDetail.worker === worker
  ) {
    return pendingUpdateDetail;
  }

  pendingUpdateDetail = { registration, worker, detectedAt: Date.now() };
  return pendingUpdateDetail;
}

function clearPendingUpdate(worker?: ServiceWorker): void {
  if (!worker || pendingUpdateDetail?.worker === worker) pendingUpdateDetail = null;
}

function announceActivatedUpdate(
  worker: ServiceWorker,
  result: MentorPwaActivationResult,
): void {
  clearPendingUpdate(worker);
  if (!hasWindow() || announcedActivatedWorkers.has(worker)) return;
  announcedActivatedWorkers.add(worker);
  window.dispatchEvent(
    new CustomEvent<MentorPwaActivationResult>(PWA_UPDATE_ACTIVATED_EVENT, {
      detail: result,
    }),
  );
}

function announceUpdate(registration: ServiceWorkerRegistration): void {
  const worker = registration.waiting;
  if (!worker) {
    clearPendingUpdate();
    return;
  }
  if (!hasWindow()) return;

  const detail = rememberPendingUpdate(registration, worker);
  if (announcedUpdateWorkers.has(worker)) return;
  announcedUpdateWorkers.add(worker);
  window.dispatchEvent(
    new CustomEvent<MentorPwaUpdateAvailableDetail>(PWA_UPDATE_AVAILABLE_EVENT, {
      detail,
    }),
  );
}

function announceOfflineReady(readiness: MentorPwaCacheReadiness): void {
  if (!hasWindow() || !readiness.ready) return;
  const key = `${readiness.cacheName ?? "unknown"}:${readiness.cacheVersion ?? "unknown"}`;
  if (lastOfflineReadyKey === key) return;
  lastOfflineReadyKey = key;
  window.dispatchEvent(
    new CustomEvent<MentorPwaCacheReadiness>(PWA_OFFLINE_READY_EVENT, {
      detail: readiness,
    }),
  );
}

function unavailableReadiness(
  reason: NonNullable<MentorPwaCacheReadiness["reason"]>,
): MentorPwaCacheReadiness {
  return {
    ready: false,
    supported: supportsServiceWorkers(),
    controlled: hasWindow() && "serviceWorker" in navigator
      ? navigator.serviceWorker.controller !== null
      : false,
    cacheName: null,
    cacheVersion: null,
    missing: [],
    checkedAt: Date.now(),
    reason,
  };
}

function normalizeReadiness(message: CacheStatusMessage): MentorPwaCacheReadiness {
  return {
    ready: message.ready === true,
    supported: true,
    controlled: navigator.serviceWorker.controller !== null,
    cacheName: typeof message.cacheName === "string" ? message.cacheName : null,
    cacheVersion: typeof message.cacheVersion === "string" ? message.cacheVersion : null,
    missing: Array.isArray(message.missing)
      ? message.missing.filter((entry): entry is string => typeof entry === "string")
      : [],
    checkedAt: typeof message.checkedAt === "number" ? message.checkedAt : Date.now(),
  };
}

async function currentRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!supportsServiceWorkers()) return null;
  return (await navigator.serviceWorker.getRegistration("/")) ?? null;
}

/**
 * Returns the waiting update even when its one-shot availability event fired
 * before the React listener mounted. The registration remains the source of
 * truth, so a worker that is no longer waiting clears the remembered notice.
 */
export async function getMentorPwaPendingUpdate(
  registration?: ServiceWorkerRegistration | null,
): Promise<MentorPwaUpdateAvailableDetail | null> {
  if (!supportsServiceWorkers()) {
    clearPendingUpdate();
    return null;
  }

  const resolvedRegistration = registration ?? (await currentRegistration());
  if (!resolvedRegistration || !navigator.serviceWorker.controller) {
    clearPendingUpdate();
    return null;
  }

  const worker = resolvedRegistration.waiting;
  if (!worker) {
    clearPendingUpdate();
    return null;
  }

  return rememberPendingUpdate(resolvedRegistration, worker);
}

/**
 * Asks the active service worker to verify every required app-shell entry.
 * This is the source of truth for an "available offline" UI indicator.
 */
export async function checkMentorPwaCacheReadiness(
  registration?: ServiceWorkerRegistration | null,
  timeoutMs = DEFAULT_MESSAGE_TIMEOUT_MS,
): Promise<MentorPwaCacheReadiness> {
  if (!supportsServiceWorkers()) return unavailableReadiness("unsupported");

  const resolvedRegistration = registration ?? (await currentRegistration());
  if (!resolvedRegistration) return unavailableReadiness("no-registration");

  const worker =
    navigator.serviceWorker.controller ??
    resolvedRegistration.active ??
    resolvedRegistration.waiting ??
    resolvedRegistration.installing;
  if (!worker) return unavailableReadiness("no-worker");

  const requestId = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  return new Promise<MentorPwaCacheReadiness>((resolve) => {
    const channel = new MessageChannel();
    let settled = false;

    const finish = (result: MentorPwaCacheReadiness) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      channel.port1.close();
      announceOfflineReady(result);
      resolve(result);
    };

    const timer = window.setTimeout(
      () => finish(unavailableReadiness("timeout")),
      Math.max(250, timeoutMs),
    );

    channel.port1.onmessage = (event: MessageEvent<CacheStatusMessage>) => {
      const message = event.data;
      if (message?.type !== CACHE_STATUS_RESPONSE || message.requestId !== requestId) return;
      finish(normalizeReadiness(message));
    };

    try {
      worker.postMessage({ type: CACHE_STATUS_REQUEST, requestId }, [channel.port2]);
    } catch {
      finish(unavailableReadiness("message-error"));
    }
  });
}

function watchRegistration(registration: ServiceWorkerRegistration): void {
  if (registration.waiting && navigator.serviceWorker.controller) announceUpdate(registration);

  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;

    installing.addEventListener("statechange", () => {
      if (installing.state !== "installed") return;
      if (navigator.serviceWorker.controller) announceUpdate(registration);
      void checkMentorPwaCacheReadiness(registration);
    });
  });
}

export async function registerMentorPwa(): Promise<ServiceWorkerRegistration | null> {
  if (!supportsServiceWorkers()) return null;
  if (registrationPromise) return registrationPromise;

  registrationPromise = navigator.serviceWorker
    .register("/sw.js", { scope: "/", updateViaCache: "none" })
    .then((registration) => {
      watchRegistration(registration);
      void navigator.serviceWorker.ready.then((readyRegistration) =>
        checkMentorPwaCacheReadiness(readyRegistration),
      );
      return registration;
    })
    .catch(() => {
      registrationPromise = null;
      return null;
    });

  return registrationPromise;
}

/**
 * Checks/downloads a new worker into its own immutable cache. It deliberately
 * never asks that worker to skip waiting; activation remains a separate tap.
 */
export async function checkForMentorPwaUpdate(): Promise<ServiceWorkerRegistration | null> {
  const registration = (await registerMentorPwa()) ?? (await currentRegistration());
  if (!registration) return null;
  try {
    await registration.update();
  } catch {
    return registration;
  }
  announceUpdate(registration);
  return registration;
}

function waitForWorkerActivation(
  registration: ServiceWorkerRegistration,
  worker: ServiceWorker,
  timeoutMs: number,
): Promise<MentorPwaActivationResult> {
  const currentController = navigator.serviceWorker.controller;

  return new Promise((resolve) => {
    let settled = false;
    let controllerChanged = false;

    const finish = (outcome: MentorPwaActivationResult["outcome"]) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      worker.removeEventListener("statechange", onStateChange);
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      resolve({
        outcome,
        activated: outcome === "activated",
        controllerChanged,
        registration,
      });
    };

    const onControllerChange = () => {
      controllerChanged = navigator.serviceWorker.controller !== currentController;
      if (controllerChanged) finish("activated");
    };

    const onStateChange = () => {
      if (worker.state === "activated") finish("activated");
      if (worker.state === "redundant") finish("redundant");
    };

    const timer = window.setTimeout(() => finish("timeout"), Math.max(1_000, timeoutMs));
    worker.addEventListener("statechange", onStateChange);
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    try {
      worker.postMessage({
        type: ACTIVATE_UPDATE_REQUEST,
        requestId: crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      });
    } catch {
      finish("message-error");
    }
  });
}

/**
 * Deterministically activates exactly the waiting worker and resolves only after
 * activation/controller handoff (or with an explicit failure outcome). This is
 * the sole application path that sends the worker's skip-waiting request.
 */
export async function activateMentorPwaUpdate(
  registration?: ServiceWorkerRegistration | null,
  options: MentorPwaActivationOptions = {},
): Promise<MentorPwaActivationResult> {
  if (!supportsServiceWorkers()) {
    return {
      outcome: "unsupported",
      activated: false,
      controllerChanged: false,
      registration: null,
    };
  }

  const resolvedRegistration = registration ?? (await currentRegistration());
  const worker = resolvedRegistration?.waiting;
  if (!resolvedRegistration || !worker) {
    clearPendingUpdate();
    return {
      outcome: "no-update",
      activated: false,
      controllerChanged: false,
      registration: resolvedRegistration ?? null,
    };
  }

  let activation = activationPromises.get(worker);
  if (!activation) {
    activation = waitForWorkerActivation(
      resolvedRegistration,
      worker,
      options.timeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS,
    );
    activationPromises.set(worker, activation);
  }

  let result: MentorPwaActivationResult;
  try {
    result = await activation;
  } finally {
    if (activationPromises.get(worker) === activation) activationPromises.delete(worker);
  }

  if (result.activated) {
    announceActivatedUpdate(worker, result);
    void checkMentorPwaCacheReadiness(resolvedRegistration);
    if (options.reload) window.location.reload();
  } else if (resolvedRegistration.waiting !== worker) {
    clearPendingUpdate(worker);
  } else {
    rememberPendingUpdate(resolvedRegistration, worker);
  }
  return result;
}

/** Backwards-compatible tap handler; new UI should await activateMentorPwaUpdate. */
export function activateWaitingServiceWorker(registration: ServiceWorkerRegistration): boolean {
  if (!registration.waiting) return false;
  void activateMentorPwaUpdate(registration, { reload: true });
  return true;
}

export async function requestMentorPwaInstall(): Promise<MentorPwaInstallResult> {
  const installMode = getMentorPwaInstallMode();
  if (installMode === "installed") return { outcome: "already-installed" };
  if (installMode === "manual-ios") return { outcome: "manual-ios" };
  if (!deferredInstallPrompt) return { outcome: "unavailable" };

  const prompt = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await prompt.prompt();
  const choice = await prompt.userChoice;
  dispatchRuntimeState();
  return { outcome: choice.outcome, platform: choice.platform };
}

export async function requestMentorPersistentStorage(): Promise<MentorPersistentStorageResult> {
  if (!hasWindow() || !navigator.storage?.persist || !navigator.storage.persisted) {
    return { supported: false, persisted: false };
  }

  const alreadyPersisted = await navigator.storage.persisted();
  if (alreadyPersisted) return { supported: true, persisted: true };
  return { supported: true, persisted: await navigator.storage.persist() };
}

if (hasWindow()) {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    window.dispatchEvent(
      new CustomEvent<MentorPwaRuntimeState>(PWA_INSTALL_AVAILABLE_EVENT, {
        detail: getMentorPwaRuntimeState(),
      }),
    );
    dispatchRuntimeState();
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    dispatchRuntimeState();
  });
  window.addEventListener("online", dispatchRuntimeState);
  window.addEventListener("offline", dispatchRuntimeState);

  for (const query of [
    "(display-mode: standalone)",
    "(display-mode: fullscreen)",
    "(display-mode: minimal-ui)",
  ]) {
    window.matchMedia?.(query).addEventListener?.("change", dispatchRuntimeState);
  }
}

if (supportsServiceWorkers()) {
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    if (event.data?.type !== "MENTOR_PWA_OFFLINE_READY") return;
    announceOfflineReady(normalizeReadiness(event.data as CacheStatusMessage));
  });
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    const pending = pendingUpdateDetail;
    if (pending && navigator.serviceWorker.controller === pending.worker) {
      announceActivatedUpdate(pending.worker, {
        outcome: "activated",
        activated: true,
        controllerChanged: true,
        registration: pending.registration,
      });
    }
    dispatchRuntimeState();
    void checkMentorPwaCacheReadiness();
  });
}

if (import.meta.env?.PROD) void registerMentorPwa();
