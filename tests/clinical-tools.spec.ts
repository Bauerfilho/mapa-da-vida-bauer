import { expect, test, type Page } from "@playwright/test";

async function openClinical(page: Page) {
  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await page.getByRole("button", { name: /Abrir consulta rápida/ }).click();
  await expect(page.getByTestId("clinical-tools-workspace")).toBeVisible();
}
async function selectTool(page: Page, name: RegExp) {
  await page.getByRole("button", { name: "Orquestrator: escolher instrumento", exact: true }).click();
  await page.getByRole("dialog", { name: "Orquestrator", exact: true }).getByRole("button", { name }).click();
}

test("consulta CID com sinônimo mantém código e fonte sem gravar evento clínico", async ({ page }) => {
  await page.goto("/?native=1");
  await openClinical(page);
  const before = await page.evaluate(async () => (await (await import("/src/data/index.ts")).listEntities({})).length);
  await page.getByLabel("Pesquisar CID-10", { exact: true }).fill("dor de cabeca");
  await page.getByRole("button", { name: /R51 Cefaleia/ }).click();
  await expect(page.locator(".ct-detail")).toContainText("Cefaleia é um sintoma");
  await page.getByText("Origem e limites desta referência", { exact: true }).click();
  await expect(page.getByRole("link", { name: /SES-GO/ })).toHaveAttribute("href", /CodeSystem-BRCID10/);
  const after = await page.evaluate(async () => (await (await import("/src/data/index.ts")).listEntities({})).length);
  expect(after).toBe(before);
});

test("SOAP preserva rascunho entre ferramentas e descarta ao sair da área", async ({ page }) => {
  await page.goto("/?native=1");
  await openClinical(page);
  await selectTool(page, /^Espaço SOAP/);
  await page.getByLabel("SOAP Subjetivo", { exact: true }).fill("Texto sintético.\nSem paciente.");
  await selectTool(page, /^CID-10/);
  await selectTool(page, /^Espaço SOAP/);
  await expect(page.getByLabel("SOAP Subjetivo", { exact: true })).toHaveValue("Texto sintético.\nSem paciente.");
  await page.getByRole("tab", { name: "Obstetrícia", exact: true }).click();
  await page.getByRole("tab", { name: "Consulta rápida", exact: true }).click();
  await selectTool(page, /^Espaço SOAP/);
  await expect(page.getByLabel("SOAP Subjetivo", { exact: true })).toHaveValue("Texto sintético.\nSem paciente.");
  await page.getByRole("button", { name: "Hoje", exact: true }).click();
  await openClinical(page);
  await selectTool(page, /^Espaço SOAP/);
  await expect(page.getByLabel("SOAP Subjetivo", { exact: true })).toHaveValue("");
  const count = await page.evaluate(async () => (await (await import("/src/data/index.ts")).listEntities({})).filter((entity) => JSON.stringify(entity.payload).includes("Texto sintético")).length);
  expect(count).toBe(0);
});

test("urocultura com antibiograma não exibe código composto inventado", async ({ page }) => {
  await page.goto("/?native=1"); await openClinical(page); await selectTool(page, /^Nomes de exames/);
  await page.getByLabel("Pesquisar Nomes de exames", { exact: true }).fill("urocultura com antibiograma");
  await page.getByRole("button", { name: /Urocultura com antibiograma · componentes distintos/ }).click();
  await expect(page.locator(".ct-detail")).toContainText("Código único não confirmado");
  await expect(page.getByRole("button", { name: "Copiar código", exact: true })).toHaveCount(0);
  await expect(page.locator(".ct-system-note")).toContainText("SISCV");
});

test("somente adição explícita entra no catálogo pessoal e sobrevive à reabertura", async ({ page }) => {
  test.setTimeout(35_000);
  await page.goto("/?native=1"); await openClinical(page);
  await page.getByRole("button", { name: /Adicionar minha referência/ }).click();
  await page.getByLabel("Nome ou princípio ativo", { exact: true }).fill("Referência sintética pessoal");
  await page.getByLabel("Sinônimos", { exact: true }).fill("apelido-sintetico");
  await page.getByRole("button", { name: "Adicionar à minha referência", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".ct-results")).toContainText("Minha referência · não revisada");
  await page.reload(); await openClinical(page);
  await page.getByLabel("Pesquisar CID-10", { exact: true }).fill("apelido-sintetico");
  await expect(page.locator(".ct-results")).toContainText("Referência sintética pessoal");
  const stored = await page.evaluate(async () => (await (await import("/src/data/index.ts")).listEntities({})).filter((entity) => entity.payload.schema === "clinical-reference-personal-v1").map((entity) => entity.domain));
  expect(stored).toEqual(["conhecimento"]);
});

test("Arquivo não aceita revisão que faria uma referência pessoal desaparecer", async ({ page }) => {
  await page.goto("/?native=1");
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const refs = await import("/src/domain/clinicalReference.ts");
    const payload = refs.createPersonalReference({ kind: "exam", title: "Referência sintética íntegra", aliases: "apelido" });
    const saved = await data.recordGenericEvent({ domain: "conhecimento", payload, summary: "Referência de teste." });
    let rejected = false;
    try { await data.updateEntityRevisionAware({ entityId: saved.id, expectedRevision: saved.revision, payloadPatch: { title: "x".repeat(161) }, summary: "Teste de limite." }); } catch { rejected = true; }
    const current = await data.getEntity(saved.id, "generic.event");
    return { rejected, revision: current.revision, found: refs.personalReferencesFromEntities([current]).length };
  });
  expect(result).toEqual({ rejected: true, revision: 1, found: 1 });
});

test("termo relacionado devolve o foco à busca", async ({ page }) => {
  await page.goto("/?native=1"); await openClinical(page);
  await page.getByLabel("Pesquisar CID-10", { exact: true }).fill("disúria");
  await page.getByRole("button", { name: /R30.0 Disúria/ }).click();
  const related = page.locator(".ct-related").getByRole("button", { name: /^Infecção urinária/ });
  await related.focus(); await related.press("Enter");
  await expect(page.getByLabel("Pesquisar CID-10", { exact: true })).toBeFocused();
  await expect(page.getByLabel("Pesquisar CID-10", { exact: true })).toHaveValue("Infecção urinária");
});

test("adição pessoal feita no filtro gestacional aparece sem ser promovida a ficha validada", async ({ page }) => {
  await page.goto("/?native=1"); await openClinical(page); await selectTool(page, /^Fármacos e marcas/);
  await page.getByRole("button", { name: "Referências na gestação", exact: true }).click();
  await page.getByRole("button", { name: /Adicionar minha referência/ }).click();
  await page.getByLabel("Nome ou princípio ativo", { exact: true }).fill("Princípio sintético pessoal");
  await page.getByLabel("Marcas e apresentações", { exact: true }).fill("Marca sintética");
  await page.getByRole("button", { name: "Adicionar à minha referência", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.locator(".ct-results")).toContainText("Princípio sintético pessoal");
  await expect(page.locator(".ct-results")).toContainText("Minha referência · não revisada");
  await expect(page.getByRole("button", { name: "Identificar marca", exact: true })).toHaveAttribute("aria-pressed", "true");
});
