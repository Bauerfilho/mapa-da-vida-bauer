import { expect, test, type Page } from "@playwright/test";

async function persisted(page: Page) {
  return page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    await data.initializeMentorData(); const db = await data.openMentorDatabase();
    return { settings: await db.getAll("settings"), datasets: await db.getAll("datasets"), entities: await db.getAll("entities"), revisions: await db.getAll("revisions"), operations: await db.getAll("operations"), outbox: await db.getAll("outbox"), metadata: (await db.getAll("app_meta")).filter((row) => ["schema_version", "data_seed_version", "retention_policy", "active_dataset_id"].includes(row.key)) };
  });
}

test("reabrir o app preserva valores e carimbos de configuração já inicializada", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => { const data = await import("/src/data/index.ts"); await data.recordEnergy({ localDate: "2026-09-02", value: 3 }); });
  const before = await persisted(page);
  await page.reload();
  expect(await persisted(page)).toEqual(before);
});

test("bootstrap não remove metadados futuros de uma configuração existente", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => {
    const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const dataset = await data.getActiveDataset();
    const setting = await db.get("settings", `${dataset.id}:retention`);
    if (!setting) throw new Error("Fixture sem configuração de retenção.");
    await db.put("settings", { ...setting, futureMetadata: { marker: "sintético", version: 2 } });
  });
  const before = await persisted(page);
  await page.reload();
  expect(await persisted(page)).toEqual(before);
});

test("configuração ausente é inicializada sem duplicar dados existentes", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(async () => { const data = await import("/src/data/index.ts"); const db = await data.openMentorDatabase(); const dataset = await data.getActiveDataset(); await db.delete("settings", `${dataset.id}:retention`); });
  const before = await persisted(page);
  expect(before.settings).toEqual([]);
  await page.reload();
  const after = await persisted(page);
  expect(after.settings).toHaveLength(1);
  expect(after.settings[0].key).toBe("retention");
  expect(after.entities).toEqual(before.entities);
  expect(after.datasets).toEqual(before.datasets);
  expect(after.revisions).toEqual(before.revisions);
  expect(after.operations).toEqual(before.operations);
});
