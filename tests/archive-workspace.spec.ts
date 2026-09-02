import { expect, test } from "@playwright/test";

test("Arquivo shows a recoverable tombstone after its original date leaves active history", async ({ page }) => {
  await page.goto("/");

  const setup = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const oldRecord = await data.recordEnergy({
      value: 4,
      localDate: "2025-01-01",
      occurredAtUTC: "2025-01-01T15:00:00.000Z",
    });
    const deleted = await data.deleteEntity({
      entityId: oldRecord.id,
      expectedRevision: oldRecord.revision,
      occurredAtUTC: "2026-09-01T15:00:00.000Z",
    });
    const workspace = await data.getMentorWorkspace("2026-09-01");

    return {
      deletedId: deleted.id,
      activeIds: workspace.entities.map((entity) => entity.id),
      recoverableIds: workspace.deletedEntities.map((entity) => entity.id),
    };
  });

  expect(setup.activeIds).not.toContain(setup.deletedId);
  expect(setup.recoverableIds).toContain(setup.deletedId);

  await page.reload();
  await page.getByRole("button", { name: "Arquivo", exact: true }).click();

  const deletedToggle = page.getByRole("checkbox", {
    name: "Mostrar registros excluídos",
  });
  await expect(deletedToggle).toBeEnabled();
  await expect(page.getByText("1 item recuperável", { exact: true })).toBeVisible();

  await deletedToggle.check();
  await expect(
    page.locator('.archive-workspace__record[data-deleted="true"]', {
      hasText: "Check-in de energia",
    }),
  ).toHaveCount(1);
});
