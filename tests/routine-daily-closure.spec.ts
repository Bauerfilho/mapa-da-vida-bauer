import { expect, test } from "@playwright/test";

test("Hoje fecha o dia sem exigir planejamento nem criar blocos vazios", async ({ page }) => {
  await page.goto("/");

  await page.getByRole("button", { name: "Fechar meu dia" }).click();

  await expect(page.getByRole("heading", { name: "Fechar meu dia" })).toBeVisible();
  await expect(page.getByText("Três prioridades protegidas", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Planejamento completo/ })).toBeVisible();

  await page.getByLabel("Fecho em uma frase").fill("Mantive o essencial e encerrei sem reconstruir o que não registrei.");
  await page.getByRole("button", { name: "Salvar fechamento" }).click();

  await expect(page.getByText("Fechamento salvo; o restante do dia continua como não registrado.", { exact: true })).toBeVisible();

  const saved = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const workspace = await data.getMentorWorkspace();
    const closure = [...workspace.entities].reverse().find((entity) =>
      entity.type === "generic.event" &&
      entity.domain === "rotina" &&
      entity.payload.eventKind === "routine-day-plan" &&
      entity.payload.entryMode === "closure",
    );
    return closure?.type === "generic.event" ? closure.payload : null;
  });

  expect(saved).not.toBeNull();
  expect(saved?.tasks).toEqual([]);
  expect(saved?.blocks).toEqual([]);
  expect(saved?.closure).toMatchObject({
    reflection: { state: "known", value: "Mantive o essencial e encerrei sem reconstruir o que não registrei." },
    dayScore: { state: "unknown", reason: "not_recorded" },
  });

  await page.getByRole("button", { name: /Planejamento completo/ }).click();
  await expect(page.getByRole("heading", { name: "Rotina", exact: true })).toBeVisible();
  await expect(page.getByText("Três prioridades protegidas", { exact: true })).toBeVisible();
});
