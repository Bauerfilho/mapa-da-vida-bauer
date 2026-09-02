// Prova local de duas builds reais; não publica, não instala e não usa perfil pessoal.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (index % 2 === 0) pairs.push([value, all[index + 1]]);
  return pairs;
}, []));
for (const key of ["--before", "--after", "--output"]) assert(args[key], `Informe ${key} com um caminho explícito.`);
const output = path.resolve(args["--output"]);
await mkdir(output, { recursive: true });
const hash = (value) => createHash("sha256").update(value).digest("hex");
async function identity(directory) {
  const root = path.resolve(directory);
  const html = await readFile(path.join(root, "index.html"), "utf8");
  const sw = await readFile(path.join(root, "sw.js"), "utf8");
  const version = /SHELL_CACHE_VERSION\s*=\s*"([^"]+)"/.exec(sw)?.[1];
  const js = /<script\b[^>]*src="([^"]+)"/.exec(html)?.[1];
  const css = /<link\b[^>]*href="([^"]+\.css)"/.exec(html)?.[1];
  assert(version && js && css, "Build sem versão ou entradas executáveis identificáveis.");
  await Promise.all([js, css].map((url) => readFile(path.join(root, url))));
  return { root, version, js, css, htmlSHA256: hash(html), swSHA256: hash(sw) };
}

const report = { status: "running", startedAt: new Date().toISOString(), stages: [], browserErrors: [] };
let browser; let context; let server; let page; let currentStage = "preflight";
try {
  const before = await identity(args["--before"]);
  const after = await identity(args["--after"]);
  assert.notEqual(before.version, after.version, "A prova exige versões distintas; recarregar a mesma build não é atualizar.");
  assert.notEqual(before.js, after.js, "A prova exige código de aplicação distinto nas duas builds.");
  report.before = before; report.after = after;
  let activeRoot = before.root;
  let authRequests = 0;
  report.authNetworkRequests = 0;
  const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff" };
  server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, "http://127.0.0.1");
      if (url.pathname === "/signin-with-chatgpt") {
        // Endpoint sintético: prova passagem à rede, sem login, token ou serviço de terceiros.
        authRequests += 1;
        report.authNetworkRequests = authRequests;
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
        response.end("<!doctype html><h1>Entrada de autenticação sintética</h1>"); return;
      }
      const relative = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
      const file = path.resolve(activeRoot, `.${relative}`);
      if (!file.startsWith(`${activeRoot}${path.sep}`)) { response.writeHead(403); response.end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": mime[path.extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" });
      response.end(body);
    } catch { response.writeHead(404, { "Content-Type": "text/plain" }); response.end("Arquivo ausente."); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  report.origin = origin;
  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "allow" });
  page = await context.newPage();
  page.on("pageerror", (error) => report.browserErrors.push(String(error)));

  async function until(check, message, timeout = 20_000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await check()) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(message);
  }
  async function workerStatus(target = "controller") {
    return page.evaluate(async (target) => {
      const registration = await navigator.serviceWorker.getRegistration();
      const worker = target === "waiting" ? registration?.waiting : navigator.serviceWorker.controller;
      if (!worker) return null;
      return new Promise((resolve, reject) => {
        const channel = new MessageChannel(); const requestId = crypto.randomUUID();
        const timer = setTimeout(() => { channel.port1.close(); reject(new Error("Worker não respondeu à inspeção real.")); }, 5000);
        channel.port1.onmessage = ({ data }) => {
          if (data.type !== "MENTOR_PWA_CACHE_STATUS_RESULT" || data.requestId !== requestId) return;
          clearTimeout(timer); channel.port1.close(); resolve(data);
        };
        worker.postMessage({ type: "MENTOR_PWA_CACHE_STATUS", requestId }, [channel.port2]);
      });
    }, target);
  }
  async function requireWorker(version, target = "controller") {
    await until(async () => {
      const result = await workerStatus(target);
      return result?.cacheVersion === version && result.ready && result.missing.length === 0;
    }, `O ${target} não ficou pronto na versão ${version}.`);
    const result = await workerStatus(target);
    assert.equal(result.cacheVersion, version); assert.equal(result.ready, true); assert.deepEqual(result.missing, []);
    return result;
  }
  async function shellIdentity(expected) {
    const actual = await page.evaluate(() => ({ js: [...document.querySelectorAll('script[type="module"][src]')].map((node) => node.getAttribute("src")), css: [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => node.getAttribute("href")) }));
    assert(actual.js.includes(expected.js), "DOM e versão do controlador precisam ser da mesma build.");
    assert(actual.css.includes(expected.css), "O CSS precisa pertencer à mesma build.");
    return actual;
  }
  async function nativeData() {
    return page.evaluate(async () => {
      // Leitura nativa: nenhum módulo de desenvolvimento nem API de escrita injeta a prova.
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("bauer-life-mentor");
        request.onupgradeneeded = () => { request.transaction.abort(); reject(new Error("Banco da aplicação não foi criado pela UI.")); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const names = ["datasets", "entities", "revisions", "operations", "outbox", "settings"];
      const tx = db.transaction(names, "readonly");
      const values = await Promise.all(names.map((name) => new Promise((resolve, reject) => {
        const request = tx.objectStore(name).getAll(); request.onsuccess = () => resolve([name, request.result]); request.onerror = () => reject(request.error);
      })));
      db.close(); return Object.fromEntries(values);
    });
  }
  async function capture(text) {
    await page.getByRole("button", { name: "Registrar", exact: true }).click();
    const field = page.getByLabel("Captura rápida", { exact: true });
    await field.fill(text);
    await page.getByRole("button", { name: "Guardar captura rápida", exact: true }).click();
    await until(async () => await field.inputValue() === "", "A captura não foi concluída pela interface.");
  }
  async function findInArchive(text) {
    await page.getByRole("button", { name: "Arquivo", exact: true }).click();
    await page.getByLabel("Buscar no arquivo", { exact: true }).fill(text);
    const match = page.getByText(text, { exact: true }).first();
    await match.waitFor({ state: "visible" });
    await match.scrollIntoViewIfNeeded();
    const bounds = await match.boundingBox();
    assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 844, "O registro verificado também precisa estar enquadrado na captura.");
  }
  function captured(rows, text) { return rows.entities.filter((entity) => entity.payload?.capture?.value === text); }

  currentStage = "build-anterior";
  await page.goto(`${origin}/?native=1`);
  const oldStatus = await requireWorker(before.version);
  await shellIdentity(before);
  const marker = `PROVA-PWA-${before.version}-${after.version}`;
  await capture(marker); await findInArchive(marker);
  const original = await nativeData();
  assert.equal(captured(original, marker).length, 1, "A interface precisa ter criado exatamente um registro.");
  await writeFile(path.join(output, "dados-sinteticos-antes.json"), JSON.stringify(original, null, 2));
  await page.screenshot({ path: path.join(output, "01-registro-antes.png") });
  report.stages.push({ stage: currentStage, status: "PASS", worker: oldStatus, entityId: captured(original, marker)[0].id });

  currentStage = "nova-build-aguardando";
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  activeRoot = after.root; // Troca atômica do servidor, sem trocar origem, perfil ou documento.
  await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration.update(); });
  const waiting = await requireWorker(after.version, "waiting");
  await requireWorker(before.version); await shellIdentity(before);
  const update = page.getByRole("button", { name: /Atualização pronta/ });
  await update.waitFor({ state: "visible" });
  await page.screenshot({ path: path.join(output, "02-atualizacao-aguardando.png") });
  report.stages.push({ stage: currentStage, status: "PASS", activeVersion: before.version, waiting });

  currentStage = "aceitacao-pelo-botao";
  await Promise.all([page.waitForEvent("domcontentloaded"), update.click()]);
  const newStatus = await requireWorker(after.version); await shellIdentity(after);
  await page.getByRole("button", { name: "Arquivo", exact: true }).waitFor({ state: "visible" });
  await findInArchive(marker);
  const restored = await nativeData();
  assert.deepEqual(restored, original, "Atualizar a casca não pode modificar os seis conjuntos de registros.");
  const cacheProof = await page.evaluate(async (cacheName) => {
    const names = await caches.keys(); const cache = await caches.open(cacheName); const response = await cache.match("/index.html");
    const digest = await crypto.subtle.digest("SHA-256", await response.arrayBuffer());
    return { names, htmlSHA256: [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("") };
  }, newStatus.cacheName);
  assert.equal(cacheProof.htmlSHA256, after.htmlSHA256);
  assert(!cacheProof.names.includes(oldStatus.cacheName), "O cache antigo da casca deve sair, sem tocar no banco.");
  await page.screenshot({ path: path.join(output, "03-registro-apos-atualizar.png") });
  report.stages.push({ stage: currentStage, status: "PASS", worker: newStatus, canonicalStoresUnchanged: true, cacheProof });

  currentStage = "entrada-de-autenticacao";
  const authTab = await context.newPage();
  const authResponse = await authTab.goto(`${origin}/signin-with-chatgpt?return_to=%2F`);
  report.authProbe = { status: authResponse?.status(), moduleScript: await authTab.evaluate(() => document.querySelector('script[type="module"]')?.getAttribute("src") ?? null) };
  await authTab.getByRole("heading", { name: "Entrada de autenticação sintética", exact: true }).waitFor({ timeout: 5000 });
  assert.equal(authRequests, 1, "A entrada de autenticação deve chegar à rede, não ao index guardado.");
  await authTab.close();
  report.stages.push({ stage: currentStage, status: "PASS", networkAuthRequests: authRequests });

  currentStage = "documento-novo-offline";
  await context.setOffline(true);
  await page.reload({ waitUntil: "domcontentloaded" });
  await requireWorker(after.version); await shellIdentity(after); await findInArchive(marker);
  assert.deepEqual(await nativeData(), original, "A recarga offline deve recuperar os mesmos dados persistidos.");
  const offlineMarker = `${marker}-NOVO-OFFLINE`;
  await capture(offlineMarker);
  await page.reload({ waitUntil: "domcontentloaded" });
  await findInArchive(offlineMarker);
  const offlineData = await nativeData();
  assert.equal(captured(offlineData, offlineMarker).length, 1);
  assert.deepEqual(captured(offlineData, marker), captured(original, marker));
  await writeFile(path.join(output, "dados-sinteticos-offline.json"), JSON.stringify(offlineData, null, 2));
  await page.screenshot({ path: path.join(output, "04-novo-registro-offline.png") });
  report.stages.push({ stage: currentStage, status: "PASS", reloadedOffline: true, newOfflineRecordPreserved: true });
  assert.deepEqual(report.browserErrors, [], "Erros JavaScript não podem ser omitidos na prova.");
  report.status = "PASS";
} catch (error) {
  report.status = "FAIL"; report.failedStage = currentStage; report.error = String(error.stack ?? error);
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(output, "falha.png") }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  if (context) await context.close();
  if (browser) await browser.close();
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(output, "resultado.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, stages: report.stages.map(({ stage, status }) => ({ stage, status })), failedStage: report.failedStage, error: report.error, report: path.join(output, "resultado.json") }, null, 2));
}
