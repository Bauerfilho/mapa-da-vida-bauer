import { expect, test, type Page } from "@playwright/test";

async function openObstetricCalculators(page: Page) {
  // Fixa somente o relógio do navegador de teste; o produto continua usando o dia real.
  await page.clock.setFixedTime(new Date("2026-09-01T12:00:00-03:00"));
  await page.goto("/");
  await expect(page.getByTestId("today-screen")).toBeVisible();

  await page.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByTestId("register-screen")).toBeVisible();

  await page.getByRole("button", { name: /Abrir calculadoras obstétricas/ }).click();
  await expect(page.getByTestId("internato-workspace")).toBeVisible();
  await expect(page.getByRole("tab", { name: "Obstetrícia" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByTestId("obstetrics-workspace")).toBeVisible();
}

async function selectCalculator(page: Page, id: string) {
  await page.getByTestId("obstetric-calculator-selector").click();
  await page.getByTestId(`calculator-option-${id}`).click();
}

async function persistedClinicalState(page: Page) {
  return page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const workspace = await data.getMentorWorkspace("2026-09-01");
    const database = await data.openMentorDatabase();

    return {
      dataRevision: workspace.dataset.dataRevision,
      entities: await database.count("entities"),
      revisions: await database.count("revisions"),
      operations: await database.count("operations"),
      metrics: await database.count("metrics_cache"),
    };
  });
}

test.describe("calculadoras obstétricas", () => {
  test("abre pelo Registrar, calcula IG/DPP pela DUM e não persiste os dados clínicos", async ({
    page,
  }) => {
    await openObstetricCalculators(page);

    const before = await persistedClinicalState(page);
    const lmp = page.getByTestId("calculator-lmp");

    await lmp.getByLabel("Primeiro dia da DUM").fill("28/07/2026");
    await lmp.getByLabel("Calcular IG em").fill("01/09/2026");
    await lmp.getByRole("button", { name: "Confiável", exact: true }).click();
    await lmp.getByRole("button", { name: "Calcular", exact: true }).click();

    const result = lmp.getByRole("status");
    await expect(result).toContainText("5 sem 0 d");
    await expect(result.getByText("04 de mai de 2027", { exact: true })).toBeVisible();
    await expect(
      page.getByText(/Dados efêmeros: nada destas calculadoras entra no Arquivo/),
    ).toBeVisible();
    await expect.poll(() => persistedClinicalState(page)).toEqual(before);

    await page.getByRole("button", { name: "Voltar", exact: true }).click();
    await expect(page.getByTestId("register-screen")).toBeVisible();
    await page.getByRole("button", { name: /Abrir calculadoras obstétricas/ }).click();

    await expect(
      page.getByTestId("calculator-lmp").getByLabel("Primeiro dia da DUM"),
    ).toHaveValue("");
    await expect.poll(() => persistedClinicalState(page)).toEqual(before);
  });

  test("troca para USG pelo seletor, limpa resultado inválido e preserva rascunhos ao alternar", async ({
    page,
  }) => {
    await openObstetricCalculators(page);

    const lmp = page.getByTestId("calculator-lmp");
    await lmp.getByLabel("Primeiro dia da DUM").fill("28/07/2026");

    await selectCalculator(page, "ultrasound");
    const ultrasound = page.getByTestId("calculator-ultrasound");
    await expect(ultrasound).toBeVisible();
    await expect(page.getByTestId("obstetric-calculator-selector")).toContainText("USG");

    await ultrasound.getByLabel("Data da USG").fill("01/08/2026");
    await ultrasound.getByLabel("Semanas na USG").fill("10");
    await ultrasound.getByLabel("Dias na USG").fill("3");
    await ultrasound.getByLabel("Atualizar IG para").fill("01/09/2026");
    await ultrasound.getByRole("button", { name: "Calcular", exact: true }).click();

    await expect(ultrasound.getByRole("status")).toContainText("14 sem 6 d");
    await expect(
      ultrasound.getByRole("status").getByText("24 de fev de 2027", { exact: true }),
    ).toBeVisible();

    await ultrasound.getByLabel("Dias na USG").fill("7");
    await ultrasound.getByRole("button", { name: "Calcular", exact: true }).click();

    await expect(ultrasound.getByRole("alert")).toContainText("0 a 6");
    await expect(ultrasound.getByRole("status")).toHaveCount(0);

    await selectCalculator(page, "lmp");
    await expect(lmp).toBeVisible();
    await expect(lmp.getByLabel("Primeiro dia da DUM")).toHaveValue("28/07/2026");

    await selectCalculator(page, "ultrasound");
    await expect(ultrasound.getByLabel("Data da USG")).toHaveValue("01/08/2026");
    await expect(ultrasound.getByLabel("Semanas na USG")).toHaveValue("10");
    await expect(ultrasound.getByLabel("Dias na USG")).toHaveValue("7");
    await expect(ultrasound.getByLabel("Atualizar IG para")).toHaveValue("01/09/2026");

    await ultrasound.getByLabel("Data da USG").click();
    await expect(page.getByTestId("keyboard-dock")).toHaveAttribute(
      "data-visible",
      "true",
    );
    await page.getByRole("tab", { name: "Jornada", exact: true }).click();
    await expect(page.getByTestId("keyboard-dock")).toHaveAttribute(
      "data-visible",
      "false",
    );
    await expect(page.getByTestId("obstetrics-workspace")).toHaveCount(0);

    await page.getByRole("tab", { name: "Obstetrícia", exact: true }).click();
    await expect(page.getByTestId("obstetrics-workspace")).toBeVisible();
    await expect(
      page.getByTestId("calculator-lmp").getByLabel("Primeiro dia da DUM"),
    ).toHaveValue("");
    await selectCalculator(page, "ultrasound");
    const resetUltrasound = page.getByTestId("calculator-ultrasound");
    await expect(resetUltrasound.getByLabel("Data da USG")).toHaveValue("");
    await resetUltrasound.getByLabel("Data da USG").click();
    await expect(page.getByTestId("keyboard-dock")).toHaveAttribute(
      "data-visible",
      "true",
    );

    await page
      .getByTestId("internato-workspace")
      .getByRole("button", { name: "Voltar", exact: true })
      .click();
    await expect(page.getByTestId("keyboard-dock")).toHaveAttribute(
      "data-visible",
      "false",
    );
    await page.getByRole("button", { name: /Abrir calculadoras obstétricas/ }).click();

    await expect(
      page.getByTestId("calculator-lmp").getByLabel("Primeiro dia da DUM"),
    ).toHaveValue("");
    await selectCalculator(page, "ultrasound");
    const reopenedUltrasound = page.getByTestId("calculator-ultrasound");
    await expect(reopenedUltrasound.getByLabel("Data da USG")).toHaveValue("");
    await expect(reopenedUltrasound.getByLabel("Semanas na USG")).toHaveValue("");
    await expect(reopenedUltrasound.getByLabel("Dias na USG")).toHaveValue("");
    await expect(reopenedUltrasound.getByLabel("Atualizar IG para")).toHaveValue(
      "01/09/2026",
    );
  });

  test("compara datações e impede uma DUM incerta de virar decisão automática", async ({
    page,
  }) => {
    await openObstetricCalculators(page);
    await selectCalculator(page, "comparison");

    const comparison = page.getByTestId("calculator-comparison");
    await comparison.getByLabel("DUM para comparação").fill("01/01/2026");
    await comparison.getByLabel("Data da USG para comparação").fill("01/03/2026");
    await comparison.getByLabel("Semanas para comparação").fill("10");
    await comparison.getByLabel("Dias para comparação").fill("0");

    await comparison.getByRole("button", { name: "Comparar", exact: true }).click();
    await expect(comparison.getByRole("alert")).toContainText(
      "Informe se a DUM é confiável ou incerta",
    );
    await expect(comparison.getByRole("status")).toHaveCount(0);

    await comparison
      .getByRole("button", { name: "Incerta / não", exact: true })
      .click();
    await comparison.getByRole("button", { name: "Comparar", exact: true }).click();

    const result = comparison.getByRole("status");
    await expect(result).toContainText("11 dias");
    await expect(result).toContainText(
      "DUM incerta: diferença apenas descritiva; a tabela de redatação não é aplicável",
    );
    await expect(result).not.toContainText("apoia revisão clínica da DPP");
    await expect(result).not.toContainText("Não ultrapassa o limiar desta faixa");
  });

  test("rejeita uma data futura de reprodução assistida", async ({ page }) => {
    await openObstetricCalculators(page);
    await selectCalculator(page, "art");

    const art = page.getByTestId("calculator-art");
    await art
      .getByRole("button", { name: "Concepção / ovulação / coleta", exact: true })
      .click();
    await art.getByLabel("Data do procedimento").fill("02/09/2026");
    await art.getByLabel("Calcular IG da reprodução assistida em").fill("01/09/2026");
    await art.getByRole("button", { name: "Calcular", exact: true }).click();

    await expect(art.getByRole("alert")).toBeVisible();
    await expect(art.getByRole("status")).toHaveCount(0);
    await expect(art.getByLabel("Data do procedimento")).toHaveValue("02/09/2026");
  });

  test("calcula a perda sanguínea quantitativa canônica de 450 mL", async ({ page }) => {
    await openObstetricCalculators(page);
    await selectCalculator(page, "qbl");

    const qbl = page.getByTestId("calculator-qbl");
    await qbl.getByLabel("Volume no coletor em mL").fill("350");
    await qbl.getByLabel("Fluidos não sanguíneos em mL").fill("50");
    await qbl.getByLabel("Peso molhado do material 1").fill("250");
    await qbl.getByLabel("Tara seca do material 1").fill("100");
    await qbl.getByRole("button", { name: "Somar perda", exact: true }).click();

    const result = qbl.getByRole("status");
    await expect(result).toContainText("Perda sanguínea quantitativa");
    await expect(result).toContainText("450 mL");
    await expect(result).toContainText("Coletor300 mL");
    await expect(result).toContainText("Materiais150 mL");
    await expect(result).not.toContainText("Estimativa incompleta");
  });

  test("sinaliza índice de choque materno acima de 1,00", async ({ page }) => {
    await openObstetricCalculators(page);
    await selectCalculator(page, "shock-index");

    const shockIndex = page.getByTestId("calculator-shock-index");
    await shockIndex.getByLabel("Frequência cardíaca em bpm").fill("120");
    await shockIndex.getByLabel("Pressão arterial sistólica em mmHg").fill("100");
    await shockIndex.getByRole("button", { name: "Calcular", exact: true }).click();

    const result = shockIndex.getByRole("status");
    await expect(result.locator("strong")).toHaveText(/^1,20{1,2}$/);
    await expect(result).toHaveAttribute("data-warning", "true");
    await expect(result).toContainText("Acima de 1,00: sinal hemodinâmico anormal");
  });

  test("um Apgar baixo aos 10 minutos mantém o lembrete de documentação seriada", async ({
    page,
  }) => {
    await openObstetricCalculators(page);
    await selectCalculator(page, "apgar");

    const apgar = page.getByTestId("calculator-apgar");
    await apgar
      .getByRole("group", { name: "Minuto da avaliação" })
      .getByRole("button", { name: "10", exact: true })
      .click();
    await apgar
      .getByRole("group", { name: "Aparência/cor" })
      .getByRole("button", { name: /Pálido\/cianótico/ })
      .click();
    await apgar
      .getByRole("group", { name: "Pulso" })
      .getByRole("button", { name: /Ausente/ })
      .click();
    await apgar
      .getByRole("group", { name: "Irritabilidade reflexa" })
      .getByRole("button", { name: /Sem resposta/ })
      .click();
    await apgar
      .getByRole("group", { name: "Tônus\/atividade" })
      .getByRole("button", { name: /Flácido/ })
      .click();
    await apgar
      .getByRole("group", { name: "Respiração" })
      .getByRole("button", { name: /Ausente/ })
      .click();
    await apgar.getByRole("button", { name: "Somar Apgar", exact: true }).click();

    const result = apgar.getByRole("status");
    await expect(result).toContainText("Apgar no 10º minuto");
    await expect(result).toContainText("0 / 10");
    await expect(result).toHaveAttribute("data-warning", "true");
    await expect(result).toContainText("documentar novamente a cada 5 min até 20 min");
  });
});
