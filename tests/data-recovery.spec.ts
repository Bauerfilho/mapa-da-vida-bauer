import { expect, test, type Page } from "@playwright/test";

async function rewriteAuthenticatedBackup(
  page: Page,
  serialized: string,
  passphrase: string,
  mutation:
    | "invalid-schema"
    | "unknown-type"
    | "unknown-domain"
    | "mismatched-domain"
    | "duplicate-setting-key"
    | "broken-revision-link",
): Promise<string> {
  return page.evaluate(async ({ serializedBackup, password, mutationKind }) => {
    const envelope = JSON.parse(serializedBackup) as {
      encryption: {
        saltBase64: string;
        ivBase64: string;
        iterations: number;
      };
      ciphertextBase64: string;
    };
    const decode = (value: string) => {
      const binary = atob(value);
      return Uint8Array.from(binary, (character) => character.charCodeAt(0));
    };
    const encode = (value: Uint8Array) => {
      let binary = "";
      value.forEach((byte) => { binary += String.fromCharCode(byte); });
      return btoa(binary);
    };
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: decode(envelope.encryption.saltBase64),
        iterations: envelope.encryption.iterations,
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const iv = decode(envelope.encryption.ivBase64);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      decode(envelope.ciphertextBase64),
    );
    const decoded = JSON.parse(new TextDecoder().decode(plaintext)) as {
      checksumSHA256: string;
      manifest: { storeCounts: Record<string, number> };
      stores: {
        entities: Array<Record<string, unknown>>;
        revisions: Array<Record<string, unknown>>;
        settings: Array<Record<string, unknown>>;
      };
    };
    switch (mutationKind) {
      case "invalid-schema":
        decoded.stores.entities[0].schemaVersion = 999;
        break;
      case "unknown-type":
        decoded.stores.entities[0].type = "internato.unknown";
        break;
      case "unknown-domain":
        decoded.stores.entities[0].domain = "hospital";
        break;
      case "mismatched-domain": {
        // Escolhe um tipo explícito: o primeiro registro por ID pode já ser uma conta financeira.
        const shift = decoded.stores.entities.find((entity) => entity.type === "internato.shift");
        if (!shift || shift.domain !== "internato") throw new Error("Fixture sem jornada válida para testar domínio trocado.");
        shift.domain = "financas";
        break;
      }
      case "duplicate-setting-key": {
        const first = decoded.stores.settings[0];
        decoded.stores.settings.push({ ...first, id: `${String(first.id)}-duplicate` });
        decoded.manifest.storeCounts.settings = decoded.stores.settings.length;
        break;
      }
      case "broken-revision-link":
        decoded.stores.revisions[0].operationId = "operation-that-does-not-exist";
        break;
    }
    const { checksumSHA256: _oldChecksum, ...content } = decoded;
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(JSON.stringify(content)),
    );
    decoded.checksumSHA256 = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(JSON.stringify(decoded)),
    );
    envelope.ciphertextBase64 = encode(new Uint8Array(ciphertext));
    return JSON.stringify(envelope);
  }, { serializedBackup: serialized, password: passphrase, mutationKind: mutation });
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("workspace exposes 365-day history, settings, and future confirmed plans", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const workspace = await data.getMentorWorkspace("2026-09-01");
    return {
      days: workspace.historyWindow.days,
      start: workspace.historyWindow.start,
      end: workspace.historyWindow.end,
      settingKeys: workspace.settings.map((setting) => setting.key),
      futureShiftCount: workspace.entities.filter(
        (entity) => entity.type === "internato.shift" && entity.localDate > "2026-09-01",
      ).length,
    };
  });

  expect(result).toEqual(expect.objectContaining({
    days: 365,
    start: "2025-09-02",
    end: "2026-09-01",
  }));
  expect(result.settingKeys).toContain("retention");
  expect(result.futureShiftCount).toBeGreaterThan(0);
});

test("workspace exposes only active canonical entities and deleted tombstones", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const active = await data.recordEnergy({
      value: 3,
      localDate: "2026-09-01",
      occurredAtUTC: "2026-09-01T15:00:00.000Z",
    });
    const deletedSource = await data.recordEnergy({
      value: 2,
      localDate: "2026-09-01",
      occurredAtUTC: "2026-09-01T16:00:00.000Z",
    });
    const deleted = await data.deleteEntity({
      entityId: deletedSource.id,
      expectedRevision: deletedSource.revision,
      occurredAtUTC: "2026-09-01T17:00:00.000Z",
    });
    const database = await data.openMentorDatabase();
    const superseded = {
      ...active,
      id: `${active.id}-superseded`,
      status: "superseded" as const,
      occurredAtUTC: "2026-09-01T18:00:00.000Z",
      updatedAt: "2026-09-01T18:00:00.000Z",
    };
    await database.put("entities", superseded);

    const workspace = await data.getMentorWorkspace("2026-09-01");
    return {
      activeIds: workspace.entities.map((entity) => entity.id),
      activeStatuses: [...new Set(workspace.entities.map((entity) => entity.status))],
      deletedIds: workspace.deletedEntities.map((entity) => entity.id),
      deletedStatuses: [...new Set(workspace.deletedEntities.map((entity) => entity.status))],
      supersededId: superseded.id,
      activeId: active.id,
      deletedId: deleted.id,
    };
  });

  expect(result.activeStatuses).toEqual(["active"]);
  expect(result.deletedStatuses).toEqual(["deleted"]);
  expect(result.activeIds).toContain(result.activeId);
  expect(result.activeIds).not.toContain(result.supersededId);
  expect(result.deletedIds).toContain(result.deletedId);
});

test("a tombstone remains recoverable for 60 civil days from deletion", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const boundary = await data.recordEnergy({
      value: 4,
      localDate: "2025-09-02",
      occurredAtUTC: "2025-09-02T15:00:00.000Z",
    });
    const deletedBoundary = await data.deleteEntity({
      entityId: boundary.id,
      expectedRevision: boundary.revision,
      occurredAtUTC: "2026-09-01T15:00:00.000Z",
    });
    const future = await data.recordEnergy({
      value: 5,
      localDate: "2026-12-01",
      occurredAtUTC: "2026-09-01T16:00:00.000Z",
    });
    const deletedFuture = await data.deleteEntity({
      entityId: future.id,
      expectedRevision: future.revision,
      occurredAtUTC: "2026-09-01T16:30:00.000Z",
    });

    const firstDay = await data.getMentorWorkspace("2026-09-01");
    const sixtiethDay = await data.getMentorWorkspace("2026-10-30");
    const dayAfterMinimum = await data.getMentorWorkspace("2026-10-31");
    const ids = (workspace: Awaited<ReturnType<typeof data.getMentorWorkspace>>) =>
      workspace.deletedEntities.map((entity) => entity.id);
    return {
      boundaryId: deletedBoundary.id,
      futureId: deletedFuture.id,
      firstDay: ids(firstDay),
      sixtiethDay: ids(sixtiethDay),
      dayAfterMinimum: ids(dayAfterMinimum),
    };
  });

  expect(result.firstDay).toContain(result.futureId);
  expect(result.sixtiethDay).toContain(result.boundaryId);
  expect(result.sixtiethDay).toContain(result.futureId);
  expect(result.dayAfterMinimum).not.toContain(result.boundaryId);
  expect(result.dayAfterMinimum).not.toContain(result.futureId);
});

test("created entities can be transactionally deleted and restored", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const created = await data.recordEnergy({
      value: 4,
      localDate: "2026-09-01",
      occurredAtUTC: "2026-09-01T15:00:00.000Z",
    });
    const deleted = await data.deleteEntity({
      entityId: created.id,
      expectedRevision: created.revision,
    });
    const hiddenAfterDelete = await data.getEntity(created.id);
    const restored = await data.restoreEntity({
      entityId: created.id,
      expectedRevision: deleted.revision,
    });
    const database = await data.openMentorDatabase();
    const operations = await database.getAll("operations");
    const outbox = await database.getAll("outbox");
    return {
      createdId: created.id,
      deletedStatus: deleted.status,
      restoredStatus: restored.status,
      restoredRevision: restored.revision,
      hiddenAfterDelete,
      operationKinds: operations
        .filter((operation) => operation.entityId === created.id)
        .sort((left, right) => left.sequence - right.sequence)
        .map((operation) => operation.kind),
      outboxCount: outbox.filter((item) => item.entityId === created.id).length,
    };
  });

  expect(result.deletedStatus).toBe("deleted");
  expect(result.hiddenAfterDelete).toBeNull();
  expect(result.restoredStatus).toBe("active");
  expect(result.restoredRevision).toBe(3);
  expect(result.operationKinds).toEqual(["create", "delete", "restore"]);
  expect(result.outboxCount).toBe(3);
});

test("overnight shift clock values resolve to the correct civil date", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const shiftId = "seed-shift-2026-09-03-1900";
    const arrival = await data.recordArrival({
      shiftId,
      localDateTime: "2026-09-03T18:55",
    });
    const completed = await data.updateShift({
      shiftId,
      breakStartLocal: "23:30",
      breakEndLocal: "00:10",
      departureLocal: "06:45",
      attendance: "present",
    });
    return {
      arrival: arrival.payload.arrivalLocal,
      breakStart: completed.payload.breakStartLocal,
      breakEnd: completed.payload.breakEndLocal,
      departure: completed.payload.departureLocal,
      attendance: completed.payload.attendance,
      localDate: completed.localDate,
    };
  });

  expect(result.arrival).toEqual(expect.objectContaining({ state: "known", value: "2026-09-03T18:55" }));
  expect(result.breakStart).toEqual(expect.objectContaining({ state: "known", value: "2026-09-03T23:30" }));
  expect(result.breakEnd).toEqual(expect.objectContaining({ state: "known", value: "2026-09-04T00:10" }));
  expect(result.departure).toEqual(expect.objectContaining({ state: "known", value: "2026-09-04T06:45" }));
  expect(result.attendance).toEqual(expect.objectContaining({ state: "known", value: "present" }));
  expect(result.localDate).toBe("2026-09-03");
});

test("backup merge previews conflicts and never overwrites them", async ({ page }) => {
  test.setTimeout(40_000);
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const created = await data.recordEnergy({ value: 3, localDate: "2026-09-01" });
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    const serialized = await backup.blob.text();
    await data.deleteEntity({ entityId: created.id, expectedRevision: created.revision });
    const staged = await data.validateAndStageEncryptedBackup(
      serialized,
      "senha-segura-123",
      "recovery-test.bauerlife",
    );
    const merge = await data.applyStagedImport(staged.importId, {
      expectedPlanDigest: staged.preview.planDigest,
      mode: "safe-only",
    });
    const canonical = await data.getEntityIncludingDeleted(created.id);
    const database = await data.openMentorDatabase();
    const stagedRows = await database.getAllFromIndex("import_stage", "by_import", staged.importId);
    const persistedConflicts = (await database.getAll("conflicts"))
      .filter((conflict) => conflict.importId === staged.importId);
    const review = await data.listRestoreConflicts({ importId: staged.importId });
    const reviewExport = JSON.parse(
      await data.createRestoreConflictReviewExport(review).text(),
    ) as { conflictCount: number; conflicts: Array<{ localSnapshotAtConflict?: unknown; incomingSnapshot?: unknown }> };
    const resolved = await data.resolveRestoreConflictKeepingLocal(review[0].id);
    const openAfterResolution = await data.listRestoreConflicts({
      importId: staged.importId,
      state: "open",
    });
    const canonicalAfterResolution = await data.getEntityIncludingDeleted(created.id);
    return {
      previewConflictKeys: staged.preview.conflicts.map((conflict) => conflict.key),
      status: merge.status,
      createdEntityIds: merge.createdEntityIds,
      canonicalStatus: canonical?.status,
      stagedRowCount: stagedRows.length,
      persistedConflictCount: persistedConflicts.length,
      conflictHasIncomingSnapshot: persistedConflicts.every(
        (conflict) => conflict.incomingSnapshot !== undefined,
      ),
      reviewCount: review.length,
      reviewHasBothSnapshots: review.every(
        (conflict) => conflict.localSnapshot !== undefined && conflict.incomingSnapshot !== undefined,
      ),
      exportConflictCount: reviewExport.conflictCount,
      exportHasBothSnapshots: reviewExport.conflicts.every(
        (conflict) => conflict.localSnapshotAtConflict !== undefined && conflict.incomingSnapshot !== undefined,
      ),
      resolutionState: resolved.state,
      resolution: resolved.resolution,
      openAfterResolution: openAfterResolution.length,
      canonicalAfterResolution: canonicalAfterResolution?.status,
    };
  });

  expect(result.previewConflictKeys).toContainEqual(expect.any(String));
  expect(result.status).toBe("applied_with_conflicts");
  expect(result.createdEntityIds).not.toContain(result.previewConflictKeys[0]);
  expect(result.canonicalStatus).toBe("deleted");
  expect(result.stagedRowCount).toBe(0);
  expect(result.persistedConflictCount).toBeGreaterThan(0);
  expect(result.conflictHasIncomingSnapshot).toBe(true);
  expect(result.reviewCount).toBe(result.persistedConflictCount);
  expect(result.reviewHasBothSnapshots).toBe(true);
  expect(result.exportConflictCount).toBe(result.reviewCount);
  expect(result.exportHasBothSnapshots).toBe(true);
  expect(result.resolutionState).toBe("resolved");
  expect(result.resolution).toBe("kept_local");
  expect(result.openAfterResolution).toBe(0);
  expect(result.canonicalAfterResolution).toBe("deleted");
});

test("safe recovery preserves compatible entity audit history without transplanting source outbox", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const source = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const created = await data.recordGenericEvent({
      domain: "conhecimento",
      localDate: "2026-09-01",
      occurredAtUTC: "2026-09-01T12:00:00.000Z",
      summary: "Nota criada antes do backup.",
      payload: { eventKind: "knowledge-note", title: "Primeira versão" },
    });
    const edited = await data.updateEntityRevisionAware<"generic.event">({
      entityId: created.id,
      expectedRevision: created.revision,
      committedAtUTC: "2026-09-01T12:05:00.000Z",
      summary: "Título corrigido antes do backup.",
      payloadPatch: { title: "Segunda versão" },
    });
    const database = await data.openMentorDatabase();
    const sourceOutboxIds = (await database.getAll("outbox"))
      .filter((row) => row.entityId === created.id)
      .map((row) => row.id);
    const sourceOperationIds = (await data.getEntityEditSession(created.id)).history
      .map((row) => row.operation?.id)
      .filter((id): id is string => Boolean(id));
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    return {
      entityId: created.id,
      currentRevision: edited.entity.revision,
      sourceOutboxIds,
      sourceOperationIds,
      serialized: await backup.blob.text(),
    };
  });

  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  await targetPage.goto(page.url());
  try {
    const recovered = await targetPage.evaluate(async ({ serialized, entityId }) => {
      const data = await import("/src/data/index.ts");
      const staged = await data.validateAndStageEncryptedBackup(
        serialized,
        "senha-segura-123",
        "audit-history.bauerlife",
      );
      const result = await data.applyStagedImport(staged.importId, {
        expectedPlanDigest: staged.preview.planDigest,
        mode: "safe-only",
      });
      const session = await data.getEntityEditSession(entityId, "generic.event");
      const database = await data.openMentorDatabase();
      const targetOutbox = (await database.getAll("outbox"))
        .filter((row) => row.entityId === entityId);
      return {
        previewRevisionCount: staged.preview.auditRevisionImportCount,
        previewOperationCount: staged.preview.auditOperationImportCount,
        appliedRevisionCount: result.importedRevisionCount,
        appliedOperationCount: result.importedOperationCount,
        currentRevision: session.entity.revision,
        historyRevisions: session.history.map((row) => row.revision.revision),
        historyReasons: session.history.map((row) => row.revision.reason),
        operationKinds: session.history.map((row) => row.operation?.kind ?? null),
        operationSummaries: session.history.map((row) => row.operation?.summary ?? null),
        operationIds: session.history.map((row) => row.operation?.id ?? null),
        snapshotDatasetIds: session.history.map((row) => row.revision.snapshot.datasetId),
        targetDatasetId: session.entity.datasetId,
        targetOutboxCount: targetOutbox.length,
      };
    }, source);

    expect(recovered.previewRevisionCount).toBe(2);
    expect(recovered.previewOperationCount).toBe(2);
    expect(recovered.appliedRevisionCount).toBe(2);
    expect(recovered.appliedOperationCount).toBe(2);
    expect(recovered.currentRevision).toBe(source.currentRevision);
    expect(recovered.historyRevisions).toEqual([2, 1]);
    expect(recovered.historyReasons).toEqual(["entity_user_edit", "conhecimento_event_recorded"]);
    expect(recovered.operationKinds).toEqual(["update", "create"]);
    expect(recovered.operationSummaries).toEqual([
      "Título corrigido antes do backup.",
      "Nota criada antes do backup.",
    ]);
    expect(recovered.operationIds.every((id) => id && !source.sourceOperationIds.includes(id))).toBe(true);
    expect(recovered.snapshotDatasetIds).toEqual([
      recovered.targetDatasetId,
      recovered.targetDatasetId,
    ]);
    expect(source.sourceOutboxIds.length).toBe(2);
    expect(recovered.targetOutboxCount).toBe(0);
  } finally {
    await targetContext.close();
  }
});

test("encrypted backup round-trip accepts a canonical finance card", async ({ page }) => {
  test.setTimeout(40_000);
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const finance = await import("/src/domain/finance.ts");
    const card = await data.createFinanceCard({
      provider: finance.listedFinanceProvider("Mercado Pago"),
      label: "Cartão QA sem credenciais",
      closingDate: "2026-09-20",
      dueDate: "2026-09-27",
      statedCreditLimitMinor: finance.parseBRLMinorUnits("2.000,00"),
      currentBalanceMinor: finance.parseBRLMinorUnits("500,00"),
      currentStatementAmountMinor: finance.parseBRLMinorUnits("300,00"),
      minimumPaymentMinor: finance.parseBRLMinorUnits("30,00"),
      annualPercentageRateBps: finance.asAnnualPercentageRateBps(1_200),
      balanceAsOfLocalDate: "2026-09-01",
      installments: [{
        label: "Compra QA",
        purchaseTotalMinor: finance.parseBRLMinorUnits("400,00"),
        installmentAmountMinor: finance.parseBRLMinorUnits("100,00"),
        totalInstallments: 4,
        remainingInstallments: 2,
        nextDueDate: "2026-09-27",
        finalDueDate: "2026-10-27",
      }],
      status: "active",
      occurredAtUTC: "2026-09-01T15:00:00.000Z",
    });
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    const validated = await data.validateEncryptedBackup(
      await backup.blob.text(),
      "senha-segura-123",
    );
    return {
      cardType: card.type,
      cardDomain: card.domain,
      entityCount: validated.storeCounts.entities,
    };
  });

  expect(result.cardType).toBe("financas.card");
  expect(result.cardDomain).toBe("financas");
  expect(result.entityCount).toBeGreaterThan(0);
});

test("fresh installation recovers a changed deterministic seed instead of letting the seed win", async ({ page, browser }) => {
  test.setTimeout(90_000);
  const source = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const shiftId = "seed-shift-2026-09-03-1900";
    const updated = await data.updateShift({
      shiftId,
      arrivalLocal: "18:55",
      departureLocal: "06:45",
      attendance: "present",
    });
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    return { shiftId, sourceRevision: updated.revision, serialized: await backup.blob.text() };
  });

  const targetContext = await browser.newContext();
  const targetPage = await targetContext.newPage();
  await targetPage.goto(page.url());
  try {
    const recovered = await targetPage.evaluate(async ({ serialized, shiftId }) => {
      const data = await import("/src/data/index.ts");
      const staged = await data.validateAndStageEncryptedBackup(
        serialized,
        "senha-segura-123",
        "fresh-install.bauerlife",
      );
      const result = await data.applyStagedImport(staged.importId, {
        expectedPlanDigest: staged.preview.planDigest,
        mode: "safe-only",
      });
      const shift = await data.getEntityIncludingDeleted(shiftId, "internato.shift");
      const database = await data.openMentorDatabase();
      const stagedRows = await database.getAllFromIndex("import_stage", "by_import", staged.importId);
      const matchingEntities = (await database.getAll("entities"))
        .filter((entity) => entity.id === shiftId);
      const history = await data.getEntityEditSession(shiftId, "internato.shift");
      const restoredOutbox = (await database.getAll("outbox"))
        .filter((row) => row.entityId === shiftId);
      return {
        previewRestoreIds: staged.preview.entitySeedRestoreIds,
        conflicts: staged.preview.conflicts,
        restoredIds: result.restoredSeedEntityIds,
        arrival: shift?.payload.arrivalLocal,
        departure: shift?.payload.departureLocal,
        attendance: shift?.payload.attendance,
        revision: shift?.revision,
        status: shift?.status,
        matchingEntityCount: matchingEntities.length,
        stagedRows: stagedRows.length,
        historyRevisions: history.history.map((row) => row.revision.revision),
        operationKinds: history.history.map((row) => row.operation?.kind ?? null),
        importedRevisionCount: result.importedRevisionCount,
        restoredOutboxCount: restoredOutbox.length,
      };
    }, source);

    expect(recovered.previewRestoreIds).toContain(source.shiftId);
    expect(recovered.conflicts.map((conflict) => conflict.key)).not.toContain(source.shiftId);
    expect(recovered.restoredIds).toContain(source.shiftId);
    expect(recovered.arrival).toEqual(expect.objectContaining({ state: "known", value: "2026-09-03T18:55" }));
    expect(recovered.departure).toEqual(expect.objectContaining({ state: "known", value: "2026-09-04T06:45" }));
    expect(recovered.attendance).toEqual(expect.objectContaining({ state: "known", value: "present" }));
    expect(recovered.revision).toBe(source.sourceRevision);
    expect(recovered.status).toBe("active");
    expect(recovered.matchingEntityCount).toBe(1);
    expect(recovered.stagedRows).toBe(0);
    expect(recovered.historyRevisions).toEqual([source.sourceRevision, 1]);
    expect(recovered.operationKinds).toEqual(["update", "create"]);
    expect(recovered.importedRevisionCount).toBe(1);
    expect(recovered.restoredOutboxCount).toBe(0);
  } finally {
    await targetContext.close();
  }
});

test("staging tamper invalidates both preview and apply without touching canonical data", async ({ page }) => {
  test.setTimeout(90_000);
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const shiftId = "seed-shift-2026-09-03-1900";
    const before = await data.getEntityIncludingDeleted(shiftId, "internato.shift");
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    const staged = await data.validateAndStageEncryptedBackup(
      await backup.blob.text(),
      "senha-segura-123",
      "tamper-test.bauerlife",
    );
    const database = await data.openMentorDatabase();
    const stagedRows = await database.getAllFromIndex("import_stage", "by_import", staged.importId);
    const target = stagedRows.find(
      (row) => row.storeName === "entities" && row.sourceKey === shiftId,
    );
    if (!target || typeof target.value !== "object" || target.value === null) {
      throw new Error("Registro staged do turno não encontrado.");
    }
    const changed = structuredClone(target) as typeof target & {
      value: { payload: Record<string, unknown> };
    };
    changed.value.payload.arrivalLocal = {
      state: "known",
      value: "2026-09-03T19:59",
      source: "user",
    };
    await database.put("import_stage", changed);
    let previewError = "";
    let applyError = "";
    try { await data.previewStagedImport(staged.importId); } catch (error) {
      previewError = error instanceof Error ? error.message : String(error);
    }
    try {
      await data.applyStagedImport(staged.importId, {
        expectedPlanDigest: staged.preview.planDigest,
        mode: "safe-only",
      });
    } catch (error) {
      applyError = error instanceof Error ? error.message : String(error);
    }
    const after = await data.getEntityIncludingDeleted(shiftId, "internato.shift");
    const remainingStage = await database.getAllFromIndex("import_stage", "by_import", staged.importId);
    return {
      previewError,
      applyError,
      beforeArrival: before?.payload.arrivalLocal,
      afterArrival: after?.payload.arrivalLocal,
      remainingStage: remainingStage.length,
    };
  });

  expect(result.previewError).toContain("mudou");
  expect(result.applyError).toContain("mudou");
  expect(result.afterArrival).toEqual(result.beforeArrival);
  expect(result.remainingStage).toBeGreaterThan(0);
});

test("abort-on-conflict preserves validated staging for explicit retry or discard", async ({ page }) => {
  test.setTimeout(90_000);
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const created = await data.recordEnergy({ value: 2, localDate: "2026-09-01" });
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    await data.deleteEntity({ entityId: created.id, expectedRevision: created.revision });
    const staged = await data.validateAndStageEncryptedBackup(
      await backup.blob.text(),
      "senha-segura-123",
      "abort-on-conflict.bauerlife",
    );
    let applyError = "";
    try {
      await data.applyStagedImport(staged.importId, {
        expectedPlanDigest: staged.preview.planDigest,
        mode: "abort-on-conflict",
      });
    } catch (error) {
      applyError = error instanceof Error ? error.message : String(error);
    }
    const database = await data.openMentorDatabase();
    const importBeforeDiscard = await database.get("imports", staged.importId);
    const stageBeforeDiscard = await database.getAllFromIndex("import_stage", "by_import", staged.importId);
    const conflictsBeforeDiscard = (await database.getAll("conflicts"))
      .filter((conflict) => conflict.importId === staged.importId);
    const canonical = await data.getEntityIncludingDeleted(created.id);
    const discard = await data.discardStagedImport(staged.importId);
    const stageAfterDiscard = await database.getAllFromIndex("import_stage", "by_import", staged.importId);
    return {
      applyError,
      importStatus: importBeforeDiscard?.status,
      stageBeforeDiscard: stageBeforeDiscard.length,
      conflictWrites: conflictsBeforeDiscard.length,
      canonicalStatus: canonical?.status,
      discard,
      stageAfterDiscard: stageAfterDiscard.length,
    };
  });

  expect(result.applyError).toContain("conflitos");
  expect(result.importStatus).toBe("validated");
  expect(result.stageBeforeDiscard).toBeGreaterThan(0);
  expect(result.conflictWrites).toBe(0);
  expect(result.canonicalStatus).toBe("deleted");
  expect(result.discard.status).toBe("discarded");
  expect(result.stageAfterDiscard).toBe(0);
});

test("successful apply and explicit discard both remove decrypted staging rows", async ({ page }) => {
  test.setTimeout(90_000);
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    const serialized = await backup.blob.text();
    const first = await data.validateAndStageEncryptedBackup(serialized, "senha-segura-123");
    await data.applyStagedImport(first.importId, {
      expectedPlanDigest: first.preview.planDigest,
      mode: "safe-only",
    });
    const database = await data.openMentorDatabase();
    const afterApply = await database.getAllFromIndex("import_stage", "by_import", first.importId);

    const second = await data.validateAndStageEncryptedBackup(serialized, "senha-segura-123");
    const beforeDiscard = await database.getAllFromIndex("import_stage", "by_import", second.importId);
    const discarded = await data.discardStagedImport(second.importId);
    const afterDiscard = await database.getAllFromIndex("import_stage", "by_import", second.importId);
    const discardedAgain = await data.discardStagedImport(second.importId);
    return {
      afterApply: afterApply.length,
      beforeDiscard: beforeDiscard.length,
      discarded,
      afterDiscard: afterDiscard.length,
      discardedAgain,
    };
  });

  expect(result.afterApply).toBe(0);
  expect(result.beforeDiscard).toBeGreaterThan(0);
  expect(result.discarded).toEqual(expect.objectContaining({ status: "discarded" }));
  expect(result.afterDiscard).toBe(0);
  expect(result.discardedAgain).toEqual(expect.objectContaining({
    status: "already-finalized",
    removedRecordCount: 0,
  }));
});

test("authenticated but unsupported entities and duplicate setting keys are rejected before staging", async ({ page }) => {
  test.setTimeout(120_000);
  const source = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    return backup.blob.text();
  });
  const invalidSchema = await rewriteAuthenticatedBackup(
    page,
    source,
    "senha-segura-123",
    "invalid-schema",
  );
  const unknownType = await rewriteAuthenticatedBackup(
    page,
    source,
    "senha-segura-123",
    "unknown-type",
  );
  const unknownDomain = await rewriteAuthenticatedBackup(
    page,
    source,
    "senha-segura-123",
    "unknown-domain",
  );
  const mismatchedDomain = await rewriteAuthenticatedBackup(
    page,
    source,
    "senha-segura-123",
    "mismatched-domain",
  );
  const duplicateSetting = await rewriteAuthenticatedBackup(
    page,
    source,
    "senha-segura-123",
    "duplicate-setting-key",
  );
  const brokenRevisionLink = await rewriteAuthenticatedBackup(
    page,
    source,
    "senha-segura-123",
    "broken-revision-link",
  );
  const errors = await page.evaluate(async ({
    invalidSchemaBackup,
    unknownTypeBackup,
    unknownDomainBackup,
    mismatchedDomainBackup,
    duplicateSettingBackup,
    brokenRevisionLinkBackup,
  }) => {
    const data = await import("/src/data/index.ts");
    const database = await data.openMentorDatabase();
    const importsBefore = (await database.getAll("imports")).length;
    const stageBefore = (await database.getAll("import_stage")).length;
    const validate = async (serialized: string) => {
      try {
        await data.validateEncryptedBackup(serialized, "senha-segura-123");
        return "";
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    };
    const validationErrors = {
      invalidSchema: await validate(invalidSchemaBackup),
      unknownType: await validate(unknownTypeBackup),
      unknownDomain: await validate(unknownDomainBackup),
      mismatchedDomain: await validate(mismatchedDomainBackup),
      duplicateSetting: await validate(duplicateSettingBackup),
      brokenRevisionLink: await validate(brokenRevisionLinkBackup),
    };
    return {
      validationErrors,
      importsBefore,
      importsAfter: (await database.getAll("imports")).length,
      stageBefore,
      stageAfter: (await database.getAll("import_stage")).length,
    };
  }, {
    invalidSchemaBackup: invalidSchema,
    unknownTypeBackup: unknownType,
    unknownDomainBackup: unknownDomain,
    mismatchedDomainBackup: mismatchedDomain,
    duplicateSettingBackup: duplicateSetting,
    brokenRevisionLinkBackup: brokenRevisionLink,
  });

  expect(errors.validationErrors.invalidSchema).toContain("inválid");
  expect(errors.validationErrors.unknownType).toContain("inválid");
  expect(errors.validationErrors.unknownDomain).toContain("inválid");
  expect(errors.validationErrors.mismatchedDomain).toContain("inválid");
  expect(errors.validationErrors.duplicateSetting).toContain("chave lógica");
  expect(errors.validationErrors.brokenRevisionLink).toContain("operação");
  expect(errors.importsAfter).toBe(errors.importsBefore);
  expect(errors.stageAfter).toBe(errors.stageBefore);
});

test("backup timestamp advances only after round-trip validated delivery is confirmed", async ({ page }) => {
  test.setTimeout(120_000);
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const database = await data.openMentorDatabase();
    const olderBackup = await data.exportEncryptedBackup("senha-segura-123");
    await new Promise((resolve) => window.setTimeout(resolve, 5));
    const backup = await data.exportEncryptedBackup("senha-segura-123");
    const beforeConfirmation = await database.get("app_meta", "last_backup_created_at");
    const newestConfirmation = await data.confirmEncryptedBackupDelivery(backup.deliveryReceipt);
    const olderConfirmation = await data.confirmEncryptedBackupDelivery(olderBackup.deliveryReceipt);
    const afterConfirmation = await database.get("app_meta", "last_backup_created_at");
    let replayError = "";
    try { await data.confirmEncryptedBackupDelivery(backup.deliveryReceipt); } catch (error) {
      replayError = error instanceof Error ? error.message : String(error);
    }
    return {
      beforeConfirmation: beforeConfirmation?.value ?? null,
      afterConfirmation: afterConfirmation?.value ?? null,
      exportedAt: backup.exportedAt,
      newestConfirmation,
      olderConfirmation,
      replayError,
    };
  });

  expect(result.beforeConfirmation).toBeNull();
  expect(result.afterConfirmation).toBe(result.exportedAt);
  expect(result.newestConfirmation.status).toBe("recorded");
  expect(result.olderConfirmation.status).toBe("older-than-current");
  expect(result.replayError).toContain("não está mais válido");
});
