import assert from "node:assert/strict";
import test from "node:test";

let moduleSequence = 0;

class FakeWorker extends EventTarget {
  state = "installed";
  activationRequests = 0;
  onActivationRequest = null;

  postMessage(message, ports = []) {
    if (message?.type === "MENTOR_PWA_CACHE_STATUS") {
      const responsePort = ports[0];
      responsePort?.postMessage({
        type: "MENTOR_PWA_CACHE_STATUS_RESULT",
        requestId: message.requestId,
        ready: true,
        cacheName: "mentor-bauer-shell-2026-09-01-v10",
        cacheVersion: "2026-09-01-v10",
        missing: [],
        checkedAt: Date.now(),
      });
      responsePort?.close();
      return;
    }

    if (message?.type === "MENTOR_PWA_ACTIVATE_UPDATE") {
      this.activationRequests += 1;
      this.onActivationRequest?.(this.activationRequests);
    }
  }
}

class FakeRegistration extends EventTarget {
  constructor(worker, controller) {
    super();
    this.waiting = worker;
    this.active = controller;
    this.installing = null;
    this.scope = "https://mentor.test/";
  }

  async update() {}
}

class FakeServiceWorkerContainer extends EventTarget {
  constructor(registration, controller) {
    super();
    this.registration = registration;
    this.controller = controller;
    this.ready = Promise.resolve(registration);
  }

  async register() {
    return this.registration;
  }

  async getRegistration() {
    return this.registration;
  }
}

class FakeWindow extends EventTarget {
  isSecureContext = true;
  location = { reload() {} };

  matchMedia() {
    return { matches: false, addEventListener() {} };
  }

  setTimeout(callback, delay, ...args) {
    return globalThis.setTimeout(callback, Math.min(delay, 10), ...args);
  }

  clearTimeout(timer) {
    globalThis.clearTimeout(timer);
  }
}

async function withPwaEnvironment(run) {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const controller = new FakeWorker();
  controller.state = "activated";
  const waiting = new FakeWorker();
  const registration = new FakeRegistration(waiting, controller);
  const serviceWorker = new FakeServiceWorkerContainer(registration, controller);
  const fakeWindow = new FakeWindow();

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      userAgent: "Mentor PWA test",
      maxTouchPoints: 0,
      onLine: true,
      serviceWorker,
      storage: {},
    },
  });

  try {
    moduleSequence += 1;
    const pwa = await import(`../src/pwa.ts?client-test=${moduleSequence}`);
    await run({ pwa, fakeWindow, registration, serviceWorker, waiting });
    // Activation schedules a fire-and-forget readiness confirmation. Let the
    // MessageChannel deliver it before restoring the mocked browser globals.
    await new Promise((resolve) => setTimeout(resolve, 20));
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
}

test("a waiting worker remains queryable when its availability event fired before mount", {
  concurrency: false,
}, async () => {
  await withPwaEnvironment(async ({ pwa, fakeWindow, registration, waiting }) => {
    await pwa.registerMentorPwa();

    let lateEvents = 0;
    fakeWindow.addEventListener(pwa.PWA_UPDATE_AVAILABLE_EVENT, () => {
      lateEvents += 1;
    });

    const replayed = await pwa.getMentorPwaPendingUpdate();
    assert.equal(lateEvents, 0);
    assert.equal(replayed?.registration, registration);
    assert.equal(replayed?.worker, waiting);
    assert.equal(typeof replayed?.detectedAt, "number");
  });
});

test("a timed-out activation keeps the update pending and permits a second attempt", {
  concurrency: false,
}, async () => {
  await withPwaEnvironment(async ({ pwa, registration, waiting }) => {
    await pwa.registerMentorPwa();

    waiting.onActivationRequest = (attempt) => {
      if (attempt !== 2) return;
      queueMicrotask(() => {
        registration.waiting = null;
        waiting.state = "activated";
        waiting.dispatchEvent(new Event("statechange"));
      });
    };

    const first = await pwa.activateMentorPwaUpdate(registration, {
      reload: false,
      timeoutMs: 1,
    });
    assert.equal(first.outcome, "timeout");
    assert.equal((await pwa.getMentorPwaPendingUpdate(registration))?.worker, waiting);

    const second = await pwa.activateMentorPwaUpdate(registration, {
      reload: false,
      timeoutMs: 1,
    });
    assert.equal(second.outcome, "activated");
    assert.equal(waiting.activationRequests, 2);
    assert.equal(await pwa.getMentorPwaPendingUpdate(registration), null);
  });
});

test("a late controller handoff clears only its matching pending update once", {
  concurrency: false,
}, async () => {
  await withPwaEnvironment(async ({
    pwa,
    fakeWindow,
    registration,
    serviceWorker,
    waiting,
  }) => {
    await pwa.registerMentorPwa();

    const activatedEvents = [];
    fakeWindow.addEventListener(pwa.PWA_UPDATE_ACTIVATED_EVENT, (event) => {
      activatedEvents.push(event.detail);
    });

    const timedOut = await pwa.activateMentorPwaUpdate(registration, {
      reload: false,
      timeoutMs: 1,
    });
    assert.equal(timedOut.outcome, "timeout");
    assert.equal((await pwa.getMentorPwaPendingUpdate(registration))?.worker, waiting);

    const unrelated = new FakeWorker();
    unrelated.state = "activated";
    serviceWorker.controller = unrelated;
    serviceWorker.dispatchEvent(new Event("controllerchange"));
    assert.equal((await pwa.getMentorPwaPendingUpdate(registration))?.worker, waiting);
    assert.equal(activatedEvents.length, 0);

    registration.waiting = null;
    waiting.state = "activated";
    serviceWorker.controller = waiting;
    serviceWorker.dispatchEvent(new Event("controllerchange"));

    assert.equal(await pwa.getMentorPwaPendingUpdate(registration), null);
    assert.equal(activatedEvents.length, 1);
    assert.deepEqual(activatedEvents[0], {
      outcome: "activated",
      activated: true,
      controllerChanged: true,
      registration,
    });

    serviceWorker.dispatchEvent(new Event("controllerchange"));
    assert.equal(activatedEvents.length, 1);
  });
});
