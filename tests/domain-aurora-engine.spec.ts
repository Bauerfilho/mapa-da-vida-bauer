import { test, expect } from "@playwright/test";
import { createSuiteAurora, type AuroraStatus } from "../src/appearance/aurora-engine";

function harness(failure?: "link" | "buffer" | "attribute" | "uniform") {
  const createdPrograms = new Set<object>(), deletedPrograms = new Set<object>();
  const createdBuffers = new Set<object>(), deletedBuffers = new Set<object>();
  const callbacks = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, EventListener>();
  let nextFrame = 0;
  const noOperation = () => undefined;
  const gl = {
    FRAGMENT_SHADER: 1, VERTEX_SHADER: 2, HIGH_FLOAT: 3, COMPILE_STATUS: 4, LINK_STATUS: 5,
    ARRAY_BUFFER: 6, STATIC_DRAW: 7, FLOAT: 8, DEPTH_TEST: 9, BLEND: 10, COLOR_BUFFER_BIT: 11, TRIANGLES: 12,
    getShaderPrecisionFormat: () => ({ precision: 23 }), createShader: () => ({}),
    shaderSource: noOperation, compileShader: noOperation, getShaderParameter: () => true, deleteShader: noOperation,
    createProgram: () => { const value = {}; createdPrograms.add(value); return value; },
    attachShader: noOperation, linkProgram: noOperation,
    getProgramParameter: () => failure !== "link", getProgramInfoLog: () => "Falha sintética de link",
    createBuffer: () => { if (failure === "buffer") return null; const value = {}; createdBuffers.add(value); return value; },
    deleteProgram: (value: object) => deletedPrograms.add(value), deleteBuffer: (value: object) => deletedBuffers.add(value),
    useProgram: noOperation, bindBuffer: noOperation, bufferData: noOperation,
    getAttribLocation: () => failure === "attribute" ? -1 : 0,
    enableVertexAttribArray: noOperation, vertexAttribPointer: noOperation,
    getUniformLocation: () => { if (failure === "uniform") throw new Error("Falha sintética de uniform"); return {}; },
    disable: noOperation, clearColor: noOperation, clear: noOperation, viewport: noOperation,
    uniform2f: noOperation, uniform1f: noOperation, uniform3f: noOperation, drawArrays: noOperation,
  };
  const view = {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++nextFrame; callbacks.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => callbacks.delete(id),
    addEventListener: noOperation, removeEventListener: noOperation,
  };
  const document = {
    hidden: false, defaultView: view,
    addEventListener: (name: string, callback: EventListener) => listeners.set(name, callback),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const canvas = {
    ownerDocument: document, width: 0, height: 0,
    getContext: () => gl, getBoundingClientRect: () => ({ width: 390, height: 844 }),
    addEventListener: noOperation, removeEventListener: noOperation,
  } as unknown as HTMLCanvasElement;
  const status: AuroraStatus[] = [];
  const controller = createSuiteAurora(canvas, (value) => status.push(value));
  return {
    controller, status, createdPrograms, deletedPrograms, createdBuffers, deletedBuffers, callbacks,
    frame: (timestamp: number) => { const current = [...callbacks.values()]; callbacks.clear(); current.forEach((callback) => callback(timestamp)); },
    hidden: (value: boolean) => { document.hidden = value; listeners.get("visibilitychange")?.(new Event("visibilitychange")); },
  };
}

for (const failure of ["link", "buffer", "attribute", "uniform"] as const) {
  test(`falha de ${failure} libera recursos parciais e não inicia relógio`, () => {
    const scene = harness(failure);
    expect(scene.status.at(-1)?.ready).toBe(false);
    expect(scene.deletedPrograms.size).toBe(scene.createdPrograms.size);
    expect(scene.deletedBuffers.size).toBe(scene.createdBuffers.size);
    expect(scene.callbacks.size).toBe(0);
    scene.controller.dispose();
    expect(scene.deletedPrograms.size).toBe(scene.createdPrograms.size);
    expect(scene.deletedBuffers.size).toBe(scene.createdBuffers.size);
  });
}

test("ocultação e pausa congelam elapsed e retorno não compensa o tempo ausente", () => {
  const scene = harness();
  expect(scene.status.at(-1)?.ready).toBe(true);
  scene.frame(0); scene.frame(40);
  expect(scene.controller.getStats().elapsed).toBeCloseTo(0.04);
  scene.hidden(true);
  expect(scene.callbacks.size).toBe(0);
  scene.frame(10000);
  expect(scene.controller.getStats().elapsed).toBeCloseTo(0.04);
  scene.hidden(false); scene.frame(10000); scene.frame(10040);
  expect(scene.controller.getStats().elapsed).toBeCloseTo(0.08);
  scene.controller.setPaused(true); scene.frame(10100);
  expect(scene.controller.getStats().elapsed).toBeCloseTo(0.08);
  scene.controller.setPaused(false); scene.frame(20000); scene.frame(20040);
  expect(scene.controller.getStats().elapsed).toBeCloseTo(0.12);
  scene.controller.dispose(); scene.controller.dispose();
  expect(scene.callbacks.size).toBe(0);
  expect(scene.deletedPrograms.size).toBe(1);
  expect(scene.deletedBuffers.size).toBe(1);
});
