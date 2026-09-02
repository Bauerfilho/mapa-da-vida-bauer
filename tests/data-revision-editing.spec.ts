import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("finance account, card and debt snapshots update stable entities without credentials or duplicates", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const domain = await import("/src/domain/index.ts");
    const accounts = await data.listFinanceAccounts();
    const mercadoPago = accounts.find((account) =>
      account.payload.providerName === "Mercado Pago"
    );
    if (!mercadoPago) throw new Error("Conta Mercado Pago não encontrada.");
    const updatedAccount = await data.updateFinanceAccount({
      entityId: mercadoPago.id,
      expectedRevision: mercadoPago.revision,
      accountKind: "wallet",
      balanceMinor: domain.parseBRLMinorUnits("123,45"),
      dueDate: "2026-09-20",
      occurredAtUTC: "2026-09-02T12:00:00.000Z",
    });

    const card = await data.createFinanceCard({
      provider: domain.listedFinanceProvider("Banco do Brasil"),
      label: "Cartão longitudinal QA",
      currentStatementAmountMinor: domain.parseBRLMinorUnits("300,00"),
      dueDate: "2026-09-10",
      balanceAsOfLocalDate: "2026-09-02",
      status: "active",
      occurredAtUTC: "2026-09-02T12:01:00.000Z",
    });
    const updatedCard = await data.updateFinanceRecord({
      type: "financas.card",
      entityId: card.id,
      expectedRevision: card.revision,
      patch: {
        currentStatementAmount: domain.known(
          domain.brlMoney(domain.parseBRLMinorUnits("250,00")),
          "user",
          "2026-09-03T12:01:00.000Z",
        ),
        balanceAsOfLocalDate: domain.known(
          "2026-09-03",
          "user",
          "2026-09-03T12:01:00.000Z",
        ),
      },
      occurredAtUTC: "2026-09-03T12:01:00.000Z",
    });

    const debt = await data.createFinanceDebt({
      provider: domain.listedFinanceProvider("PicPay"),
      label: "Dívida longitudinal QA",
      outstandingBalanceMinor: domain.parseBRLMinorUnits("900,00"),
      balanceAsOfLocalDate: "2026-09-02",
      status: "active",
      occurredAtUTC: "2026-09-02T12:02:00.000Z",
    });
    const updatedDebt = await data.updateFinanceRecord({
      type: "financas.debt",
      entityId: debt.id,
      expectedRevision: debt.revision,
      patch: {
        outstandingBalance: domain.known(
          domain.brlMoney(domain.parseBRLMinorUnits("800,00")),
          "user",
          "2026-09-03T12:02:00.000Z",
        ),
        balanceAsOfLocalDate: domain.known(
          "2026-09-03",
          "user",
          "2026-09-03T12:02:00.000Z",
        ),
      },
      occurredAtUTC: "2026-09-03T12:02:00.000Z",
    });

    const [accountsAfter, recordsAfter] = await Promise.all([
      data.listFinanceAccounts(),
      data.listFinanceRecords(),
    ]);
    const persistedAccount = accountsAfter.find((account) => account.id === mercadoPago.id);
    return {
      accountCount: accountsAfter.length,
      accountStable: updatedAccount.id === mercadoPago.id,
      accountRevision: updatedAccount.revision,
      accountBalance: persistedAccount?.payload.balance,
      accountPayloadKeys: Object.keys(updatedAccount.payload).sort(),
      cardStable: updatedCard.id === card.id,
      cardRevision: updatedCard.revision,
      matchingCards: recordsAfter.filter((record) => record.id === card.id).length,
      cardStatement: updatedCard.payload.currentStatementAmount,
      debtStable: updatedDebt.id === debt.id,
      debtRevision: updatedDebt.revision,
      matchingDebts: recordsAfter.filter((record) => record.id === debt.id).length,
      debtBalance: updatedDebt.payload.outstandingBalance,
    };
  });

  expect(result.accountCount).toBe(3);
  expect(result.accountStable).toBe(true);
  expect(result.accountRevision).toBeGreaterThan(1);
  expect(result.accountBalance).toMatchObject({
    state: "known",
    value: { amountMinor: 12_345, currency: "BRL" },
  });
  expect(result.accountPayloadKeys).toEqual([
    "accountKind",
    "balance",
    "dueDate",
    "lastFourDigits",
    "providerName",
  ]);
  expect(result.cardStable).toBe(true);
  expect(result.cardRevision).toBe(2);
  expect(result.matchingCards).toBe(1);
  expect(result.cardStatement).toMatchObject({ value: { amountMinor: 25_000 } });
  expect(result.debtStable).toBe(true);
  expect(result.debtRevision).toBe(2);
  expect(result.matchingDebts).toBe(1);
  expect(result.debtBalance).toMatchObject({ value: { amountMinor: 80_000 } });
});

test("generic records edit with CAS, expose conflicts, undo safely, and keep unknown fields", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const domain = await import("/src/domain/index.ts");
    const created = await data.recordGenericEvent({
      domain: "conhecimento",
      localDate: "2026-09-01",
      occurredAtUTC: "2026-09-01T12:00:00.000Z",
      summary: "Registro criado para validar edição segura.",
      payload: {
        eventKind: "revision-contract-test",
        title: "Versão original",
        nested: {
          note: "antes",
          futureField: { schema: 9, value: "não apagar" },
        },
        futureTopLevel: "preservar",
      },
    });
    const opened = await data.getEntityEditSession(created.id, "generic.event");
    const edited = await data.updateEntityRevisionAware<"generic.event">({
      entityId: created.id,
      expectedRevision: opened.entity.revision,
      committedAtUTC: "2026-09-01T12:01:00.000Z",
      summary: "Título e campo editável atualizados.",
      reason: "forged_public_reason",
      payloadPatch: {
        title: "Versão editada",
        nested: { note: "depois" },
      },
    });

    let conflict: null | {
      code: string;
      expected: number;
      actual: number;
      storedTitle: unknown;
    } = null;
    try {
      await data.updateEntityRevisionAware<"generic.event">({
        entityId: created.id,
        expectedRevision: created.revision,
        summary: "Tentativa deliberadamente obsoleta.",
        payloadPatch: { title: "não pode vencer" },
      });
    } catch (reason) {
      if (domain.isEntityRevisionConflictError(reason)) {
        conflict = {
          code: reason.code,
          expected: reason.expectedRevision,
          actual: reason.actualRevision,
          storedTitle: (reason.currentEntity.payload as Record<string, unknown>).title,
        };
      } else {
        throw reason;
      }
    }

    const afterConflict = await data.getEntityIncludingDeleted(created.id, "generic.event");
    const undone = await data.undoEntityMutation<"generic.event">({
      entityId: created.id,
      expectedRevision: edited.entity.revision,
      operationId: edited.operation.id,
      committedAtUTC: "2026-09-01T12:02:00.000Z",
    });
    const editedAgain = await data.updateEntityRevisionAware<"generic.event">({
      entityId: created.id,
      expectedRevision: undone.entity.revision,
      summary: "Nova alteração após desfazer.",
      payloadPatch: { title: "Versão nova" },
      committedAtUTC: "2026-09-01T12:03:00.000Z",
    });

    let oldUndoRejected = false;
    try {
      await data.undoEntityMutation({
        entityId: created.id,
        expectedRevision: editedAgain.entity.revision,
        operationId: edited.operation.id,
      });
    } catch (reason) {
      oldUndoRejected = Boolean(
        reason &&
          typeof reason === "object" &&
          "code" in reason &&
          reason.code === domain.ENTITY_UNDO_UNAVAILABLE,
      );
    }
    const afterRejectedUndo = await data.getEntityIncludingDeleted(
      created.id,
      "generic.event",
    );

    const createdForUndo = await data.recordGenericEvent({
      domain: "rotina",
      localDate: "2026-09-01",
      summary: "Criação que será desfeita.",
      payload: { eventKind: "undo-create-contract-test" },
    });
    const createSession = await data.getEntityEditSession(
      createdForUndo.id,
      "generic.event",
    );
    const undoneCreate = await data.undoEntityMutation<"generic.event">({
      entityId: createdForUndo.id,
      expectedRevision: createdForUndo.revision,
      operationId: createSession.latestOperation?.id,
    });
    const deletedSession = await data.getEntityEditSession(
      createdForUndo.id,
      "generic.event",
    );

    const payload = edited.entity.payload as Record<string, unknown>;
    const nested = payload.nested as Record<string, unknown>;
    const undoPayload = undone.entity.payload as Record<string, unknown>;
    const rejectedPayload = afterRejectedUndo?.payload as Record<string, unknown>;
    return {
      openedRevision: opened.entity.revision,
      editedRevision: edited.entity.revision,
      editedTitle: payload.title,
      editedNested: nested,
      preservedTop: payload.futureTopLevel,
      conflict,
      afterConflictTitle: (afterConflict?.payload as Record<string, unknown>).title,
      undoRevision: undone.entity.revision,
      undoTitle: undoPayload.title,
      inverseKind: undone.operation.kind,
      inverseReason: undone.revision.reason,
      editReason: edited.revision.reason,
      oldUndoRejected,
      afterRejectedUndoTitle: rejectedPayload.title,
      undoneCreateStatus: undoneCreate.entity.status,
      undoneCreateKind: undoneCreate.operation.kind,
      deletedSessionCanUndo: deletedSession.canUndo,
    };
  });

  expect(result.openedRevision).toBe(1);
  expect(result.editedRevision).toBe(2);
  expect(result.editedTitle).toBe("Versão editada");
  expect(result.editedNested).toEqual({
    note: "depois",
    futureField: { schema: 9, value: "não apagar" },
  });
  expect(result.preservedTop).toBe("preservar");
  expect(result.conflict).toEqual({
    code: "ENTITY_REVISION_CONFLICT",
    expected: 1,
    actual: 2,
    storedTitle: "Versão editada",
  });
  expect(result.afterConflictTitle).toBe("Versão editada");
  expect(result.undoRevision).toBe(3);
  expect(result.undoTitle).toBe("Versão original");
  expect(result.inverseKind).toBe("update");
  expect(result.inverseReason).toContain(`undo_operation:`);
  expect(result.editReason).toBe("entity_user_edit");
  expect(result.oldUndoRejected).toBe(true);
  expect(result.afterRejectedUndoTitle).toBe("Versão nova");
  expect(result.undoneCreateStatus).toBe("deleted");
  expect(result.undoneCreateKind).toBe("delete");
  expect(result.deletedSessionCanUndo).toBe(true);
});

test("revision repository accepts narrative text and rejects domain measurements atomically", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const domain = await import("/src/domain/index.ts");
    const note = await data.recordGenericEvent({
      domain: "conhecimento",
      localDate: "2026-09-01",
      summary: "Nota editável.",
      payload: {
        eventKind: "knowledge-note",
        title: "Título original",
        tags: ["importante"],
        score: 4,
      },
    });
    const accepted = await data.updateEntityRevisionAware<"generic.event">({
      entityId: note.id,
      expectedRevision: note.revision,
      summary: "Corrigi o título.",
      payloadPatch: { title: "Título corrigido" },
    });
    const rejectedCodes: Array<string | null> = [];
    const captureRejection = async (mutation: () => Promise<unknown>) => {
      try {
        await mutation();
        rejectedCodes.push(null);
      } catch (reason) {
        rejectedCodes.push(
          reason && typeof reason === "object" && "code" in reason
            ? String(reason.code)
            : null,
        );
      }
    };
    await captureRejection(() => data.updateEntityRevisionAware<"generic.event">({
      entityId: note.id,
      expectedRevision: accepted.entity.revision,
      summary: "Tentativa de alterar a data.",
      localDate: "2026-09-02",
      payloadPatch: { title: "Não aplicar" },
    }));
    await captureRejection(() => data.updateEntityRevisionAware<"generic.event">({
      entityId: note.id,
      expectedRevision: accepted.entity.revision,
      summary: "x".repeat(domain.MAX_ENTITY_REVISION_SUMMARY_LENGTH + 1),
      payloadPatch: { title: "Não aplicar" },
    }));
    await captureRejection(() => data.updateEntityRevisionAware<"generic.event">({
      entityId: note.id,
      expectedRevision: accepted.entity.revision,
      summary: "Tentativa de apagar a lista.",
      payloadPatch: { tags: [] },
    }));
    const energy = await data.recordEnergy({
      value: 3,
      occurredAtUTC: "2026-09-01T15:00:00.000Z",
    });
    let rejectionCode: string | null = null;
    try {
      await data.updateEntityRevisionAware<"humor.energy-check-in">({
        entityId: energy.id,
        expectedRevision: energy.revision,
        summary: "Tentativa inválida.",
        payloadPatch: { energy: 99 },
      });
    } catch (reason) {
      rejectionCode = reason && typeof reason === "object" && "code" in reason
        ? String(reason.code)
        : null;
    }
    const preservedEnergy = await data.getEntityIncludingDeleted(
      energy.id,
      "humor.energy-check-in",
    );
    const preservedNote = await data.getEntityIncludingDeleted(
      note.id,
      "generic.event",
    );
    return {
      acceptedTitle: (accepted.entity.payload as Record<string, unknown>).title,
      acceptedReason: accepted.revision.reason,
      rejectionCode,
      rejectedCodes,
      preservedNoteRevision: preservedNote?.revision,
      preservedNoteDate: preservedNote?.localDate,
      preservedTags: (preservedNote?.payload as Record<string, unknown>).tags,
      preservedEnergy: preservedEnergy?.payload.energy,
      preservedRevision: preservedEnergy?.revision,
      expectedErrorCode: domain.ENTITY_EDIT_INVALID,
    };
  });

  expect(result.acceptedTitle).toBe("Título corrigido");
  expect(result.acceptedReason).toBe("entity_user_edit");
  expect(result.rejectionCode).toBe(result.expectedErrorCode);
  expect(result.rejectedCodes).toEqual([
    result.expectedErrorCode,
    result.expectedErrorCode,
    result.expectedErrorCode,
  ]);
  expect(result.preservedNoteRevision).toBe(2);
  expect(result.preservedNoteDate).toBe("2026-09-01");
  expect(result.preservedTags).toEqual(["importante"]);
  expect(result.preservedEnergy).toBe(3);
  expect(result.preservedRevision).toBe(1);
});

test("finance subscription status updates the same generic entity with CAS and audit justification", async ({ page }) => {
  const result = await page.evaluate(async () => {
    const data = await import("/src/data/index.ts");
    const domain = await import("/src/domain/index.ts");
    const created = await data.recordGenericEvent({
      domain: "financas",
      localDate: "2026-09-01",
      summary: "Assinatura informada para teste de revisão.",
      payload: {
        schema: "finance-record-v1",
        eventKind: "finance-subscription",
        recordMode: "subscription",
        institution: domain.known("PicPay"),
        subscription: {
          service: domain.known("Serviço QA"),
          price: domain.known({ amountMinor: 3_490, currency: "BRL" }),
          cadence: domain.known("monthly"),
          renewalDate: domain.known("2026-09-20"),
          status: domain.known("active_confirmed"),
          futureField: { preserve: true },
        },
      },
    });
    await data.recordGenericEvent({
      domain: "financas",
      localDate: "2026-09-01",
      summary: "Nota financeira não estruturada.",
      payload: { eventKind: "finance-note", note: domain.known("Não listar") },
    });

    const before = await data.listFinanceSubscriptions();
    const updated = await data.updateFinanceSubscriptionStatus({
      entityId: created.id,
      expectedRevision: created.revision,
      status: "cancelled_confirmed",
      justification: "Cancelamento conferido no fornecedor em 01/09.",
      occurredAtUTC: "2026-09-01T15:00:00.000Z",
    });

    let staleRejected = false;
    try {
      await data.updateFinanceSubscriptionStatus({
        entityId: created.id,
        expectedRevision: created.revision,
        status: "active_confirmed",
        justification: "Tentativa com revisão antiga.",
      });
    } catch {
      staleRejected = true;
    }
    let blankRejected = false;
    try {
      await data.updateFinanceSubscriptionStatus({
        entityId: created.id,
        expectedRevision: updated.revision,
        status: "active_confirmed",
        justification: "   ",
      });
    } catch {
      blankRejected = true;
    }

    const after = await data.listFinanceSubscriptions();
    const session = await data.getEntityEditSession(created.id, "generic.event");
    const subscription = updated.payload.subscription as Record<string, unknown>;
    return {
      beforeIds: before.map((item) => item.id),
      afterIds: after.map((item) => item.id),
      sameId: updated.id === created.id,
      revision: updated.revision,
      status: subscription.status,
      futureField: subscription.futureField,
      staleRejected,
      blankRejected,
      auditReason: session.history[0]?.revision.reason,
      auditSummary: session.latestOperation?.summary,
    };
  });

  expect(result.beforeIds).toEqual(result.afterIds);
  expect(result.afterIds).toHaveLength(1);
  expect(result.sameId).toBe(true);
  expect(result.revision).toBe(2);
  expect(result.status).toMatchObject({
    state: "known",
    value: "cancelled_confirmed",
    source: "user",
  });
  expect(result.futureField).toEqual({ preserve: true });
  expect(result.staleRejected).toBe(true);
  expect(result.blankRejected).toBe(true);
  expect(result.auditReason).toBe("finance_subscription_status_updated");
  expect(result.auditSummary).toContain("Cancelamento conferido no fornecedor");
});
