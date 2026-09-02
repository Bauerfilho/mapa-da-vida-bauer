import { expect, test } from "@playwright/test";

const base = "/mapa-da-vida-bauer/";

test("Pages pessoal abre, controla apenas a subpasta e navega cinco centros offline", async ({ page, context }, testInfo) => {
  const failures: string[] = [];
  const errors: string[] = [];
  page.on("response", (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("./");
  await expect(page.locator(".brand-name")).toHaveText("Mentor Bauer");
  await expect(page.locator(".brand-identity")).toHaveText("Bauer Vieira · nº 7 · UNIFIMES");
  await expect(page.getByTestId("phone-stage")).toHaveAttribute("data-runtime-mode", "native");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), undefined, { timeout: 20_000 });
  const worker = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const channel = new MessageChannel();
    const readiness = await new Promise<any>((resolve) => {
      channel.port1.onmessage = ({ data }) => { channel.port1.close(); resolve(data); };
      navigator.serviceWorker.controller!.postMessage({ type: "MENTOR_PWA_CACHE_STATUS", requestId: "pages-proof" }, [channel.port2]);
    });
    return { scope: new URL(registration.scope).pathname, script: new URL(navigator.serviceWorker.controller!.scriptURL).pathname, readiness };
  });
  expect(worker.scope).toBe(base);
  expect(worker.script).toBe(`${base}sw.js`);
  expect(worker.readiness.ready).toBe(true);
  expect(worker.readiness.missing).toEqual([]);
  expect(worker.readiness.cacheName).toMatch(/^mapa-da-vida-bauer-pages-shell-/);
  const legal = await context.newPage();
  await legal.goto("./THIRD_PARTY_NOTICES.md");
  await expect(legal.locator("body")).toContainText("# Avisos de terceiros");
  await expect(legal.locator(".brand-name")).toHaveCount(0);
  await legal.close();

  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  for (const name of ["Agenda", "Registrar", "Mentor", "Arquivo", "Hoje"]) {
    await nav.getByRole("button", { name, exact: true }).click();
    await expect(nav.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
  }
  await page.screenshot({ path: testInfo.outputPath("pages-pessoal-390.png"), fullPage: true });
  await page.setViewportSize({ width: 320, height: 740 });
  await page.screenshot({ path: testInfo.outputPath("pages-pessoal-320.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator(".brand-name")).toHaveText("Mentor Bauer");
  for (const name of ["Agenda", "Registrar", "Mentor", "Arquivo", "Hoje"]) {
    await nav.getByRole("button", { name, exact: true }).click();
    await expect(nav.getByRole("button", { name, exact: true })).toHaveAttribute("aria-current", "page");
  }
  expect(errors).toEqual([]);
});

test("preview iPhone e Android carrega molduras e indicadores pela subpasta", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 1080 }, isMobile: false, hasTouch: false });
  try {
    const page = await context.newPage();
    const failures: string[] = [];
    page.on("response", (response) => { if (response.status() >= 400) failures.push(response.url()); });
    await page.goto(`http://127.0.0.1:4191${base}?preview=1`);
    await expect(page.getByTestId("device-picker")).toBeVisible();
    await expect(page.locator(".phone-bezel")).toBeVisible();
    await page.getByTestId("device-picker").click();
    await page.getByRole("menuitemradio", { name: "Pixel 10" }).click();
    await expect(page.locator(".phone-bezel")).toBeVisible();
    expect(await page.locator("img").evaluateAll((images) => images.every((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
    expect(failures).toEqual([]);
  } finally {
    await context.close();
  }
});

test("registro sintético, edição e nova gravação offline persistem após recarregar", async ({ page, context }) => {
  await page.goto("./");
  await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller));
  const nav = page.getByRole("navigation", { name: "Navegação principal" });
  await nav.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("textbox", { name: "Captura rápida", exact: true }).fill("Prova Pages sintética inicial");
  await page.getByRole("button", { name: "Guardar captura rápida" }).click();
  await expect(page.getByRole("textbox", { name: "Captura rápida", exact: true })).toHaveValue("");
  await page.reload();
  await nav.getByRole("button", { name: "Arquivo", exact: true }).click();
  await page.getByRole("searchbox", { name: "Buscar no arquivo" }).fill("Prova Pages sintética inicial");
  const record = page.locator(".archive-workspace__record").filter({ hasText: "Prova Pages sintética inicial" });
  await expect(record).toHaveCount(1);
  await record.getByRole("button", { name: /^Editar / }).click();
  const editor = page.locator(".entity-revision-editor");
  await expect(editor).toBeVisible();
  // O nome foi conferido no DOM real; aguarda a carga assíncrona dos campos da revisão.
  const capture = editor.getByRole("textbox", { name: "Capture", exact: true });
  await expect(capture).toHaveValue("Prova Pages sintética inicial");
  await capture.fill("Prova Pages sintética editada");
  await editor.getByLabel(/Motivo da alteração/).fill("Teste técnico isolado de persistência.");
  await editor.getByRole("button", { name: "Salvar nova revisão" }).click();
  await expect(editor.getByRole("status")).toBeVisible();
  await page.reload();
  await nav.getByRole("button", { name: "Arquivo", exact: true }).click();
  await page.getByRole("searchbox", { name: "Buscar no arquivo" }).fill("Prova Pages sintética editada");
  await expect(page.locator(".archive-workspace__record").filter({ hasText: "Prova Pages sintética editada" })).toHaveCount(1);

  await context.setOffline(true);
  await nav.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("textbox", { name: "Captura rápida", exact: true }).fill("Prova Pages gravada offline");
  await page.getByRole("button", { name: "Guardar captura rápida" }).click();
  await expect(page.getByRole("textbox", { name: "Captura rápida", exact: true })).toHaveValue("");
  await page.reload();
  await nav.getByRole("button", { name: "Arquivo", exact: true }).click();
  await page.getByRole("searchbox", { name: "Buscar no arquivo" }).fill("Prova Pages gravada offline");
  await expect(page.locator(".archive-workspace__record").filter({ hasText: "Prova Pages gravada offline" })).toHaveCount(1);
  expect(await page.evaluate(async () => (await indexedDB.databases()).map((database) => database.name))).toContain("bauer-life-mentor");
});
