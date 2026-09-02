import {
  ArrowLeft,
  Bank,
  Calculator,
  CalendarBlank,
  CaretDown,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  ClockCountdown,
  Coins,
  CreditCard,
  CurrencyCircleDollar,
  Gauge,
  Info,
  LockKey,
  Plus,
  Receipt,
  ShieldCheck,
  Stack,
  Target,
  Trash,
  TrendDown,
  TrendUp,
  Wallet,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { Carousel, KeyboardInput, KeyboardTextarea, useKeyboard } from "../mobile";
import {
  asAnnualPercentageRateBps,
  financeCardDeadlineAmount,
  financeCardInstallmentHasRemainingPayments,
  selectFinanceDeadlineRailItems,
  listedFinanceProvider,
  LISTED_FINANCE_PROVIDERS,
  parseBRLMinorUnits,
  parseSignedBRLMinorUnits,
  parseFinanceSubscriptionPayload,
  simulateFinanceCardPayoff,
  shiftLocalDate,
  summarizeFinanceCard,
  todayInTimeZone,
  known,
  unknown as unknownKnowledge,
  type BRLMoney,
  type AnnualPercentageRateBps,
  type FinanceAccountKind,
  type FinanceProvider,
  type FinanceCardPayoffScenario,
  type FinanceSubscriptionStatus,
  type FinanceTransactionSummary,
  type Knowledge,
  type ListedFinanceProviderName,
  type LocalDate,
} from "../domain";
import type {
  FinanceAccountEntity,
  FinanceRecordEntity,
  FinanceSubscriptionEntity,
} from "../data";
import { useAgendaFinanceData } from "../hooks";
import "./finance-workspace.css";

type FinanceComposerKind =
  | "transaction"
  | "bill"
  | "card"
  | "debt"
  | "budget"
  | "goal";

type FinanceRecordFilter = "all" | FinanceComposerKind | "subscription";
type FinanceWorkspaceRecord = FinanceRecordEntity | FinanceSubscriptionEntity;

export interface FinanceWorkspaceProps {
  currentLocalDate?: LocalDate;
  onBack?: () => void;
  onDataChange?: () => void;
  onOpenSubscription?: () => void;
  workspaceDataRevision?: number;
}

const COMPOSER_ITEMS: readonly {
  id: FinanceComposerKind;
  label: string;
  hint: string;
  icon: Icon;
}[] = [
  {
    id: "transaction",
    label: "Movimento",
    hint: "entrada ou saída real",
    icon: CurrencyCircleDollar,
  },
  {
    id: "bill",
    label: "Conta",
    hint: "valor e vencimento",
    icon: Receipt,
  },
  {
    id: "card",
    label: "Cartão",
    hint: "fatura, limite e parcelas",
    icon: CreditCard,
  },
  {
    id: "debt",
    label: "Dívida",
    hint: "saldo e juros informados",
    icon: CreditCard,
  },
  {
    id: "budget",
    label: "Orçamento",
    hint: "limite por período",
    icon: Gauge,
  },
  {
    id: "goal",
    label: "Meta",
    hint: "alvo e progresso real",
    icon: Target,
  },
];

const RECORD_FILTERS: readonly { id: FinanceRecordFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "transaction", label: "Fluxo" },
  { id: "bill", label: "Contas" },
  { id: "card", label: "Cartões" },
  { id: "debt", label: "Dívidas" },
  { id: "budget", label: "Orçamentos" },
  { id: "goal", label: "Metas" },
  { id: "subscription", label: "Assinaturas" },
];

const SUBSCRIPTION_STATUS_OPTIONS: readonly {
  value: FinanceSubscriptionStatus;
  label: string;
  detail: string;
}[] = [
  { value: "active_confirmed", label: "Ativa", detail: "cobrança recorrente confirmada" },
  { value: "trial_confirmed", label: "Teste", detail: "apenas lembrar de revisar" },
  { value: "uncertain", label: "Conferir", detail: "não entra como obrigação" },
  { value: "cancelled_confirmed", label: "Cancelada", detail: "não entra em vencimentos" },
];

const TYPE_TO_FILTER: Record<FinanceRecordEntity["type"], FinanceComposerKind> = {
  "financas.transaction": "transaction",
  "financas.bill": "bill",
  "financas.card": "card",
  "financas.debt": "debt",
  "financas.budget": "budget",
  "financas.goal": "goal",
};

function isSubscriptionRecord(
  record: FinanceWorkspaceRecord,
): record is FinanceSubscriptionEntity {
  return record.type === "generic.event";
}

function isBillRecord(
  record: FinanceWorkspaceRecord,
): record is Extract<FinanceRecordEntity, { type: "financas.bill" }> {
  return !isSubscriptionRecord(record) && record.type === "financas.bill";
}

function recordFilterFor(record: FinanceWorkspaceRecord): Exclude<FinanceRecordFilter, "all"> {
  return isSubscriptionRecord(record) ? "subscription" : TYPE_TO_FILTER[record.type];
}

function providerName(provider: FinanceProvider): string {
  return provider.name;
}

function knownValue<T>(knowledge: Knowledge<T>): T | null {
  return knowledge.state === "known" ? knowledge.value : null;
}

function formatBRL(amountMinor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(amountMinor / 100);
}

function formatMoneyKnowledge(knowledge: Knowledge<{ amountMinor: number }>): string {
  const value = knownValue(knowledge);
  return value ? formatBRL(value.amountMinor) : "valor não informado";
}

function moneyKnowledgeInput(knowledge: Knowledge<{ amountMinor: number }>): string {
  const value = knownValue(knowledge);
  return value
    ? (value.amountMinor / 100).toFixed(2).replace(".", ",")
    : "";
}

function dateKnowledgeInput(knowledge: Knowledge<LocalDate>): string {
  return knownValue(knowledge) ?? "";
}

function textKnowledgeInput(knowledge: Knowledge<string>): string {
  return knownValue(knowledge) ?? "";
}

function rateKnowledgeInput(knowledge: Knowledge<number>): string {
  const value = knownValue(knowledge);
  return value === null ? "" : (value / 100).toFixed(2).replace(".", ",");
}

function countKnowledgeInput(knowledge: Knowledge<number>): string {
  const value = knownValue(knowledge);
  return value === null ? "" : String(value);
}

function moneyInputKnowledge(
  input: string,
  timestamp: string,
): Knowledge<BRLMoney> {
  return input.trim()
    ? known(
        { amountMinor: parseBRLMinorUnits(input), currency: "BRL" },
        "user",
        timestamp,
      )
    : unknownKnowledge("not_provided");
}

function dateInputKnowledge(
  input: string,
  timestamp: string,
): Knowledge<LocalDate> {
  return input
    ? known(input as LocalDate, "user", timestamp)
    : unknownKnowledge("not_provided");
}

function textInputKnowledge(
  input: string,
  timestamp: string,
): Knowledge<string> {
  return input.trim()
    ? known(input.trim(), "user", timestamp)
    : unknownKnowledge("not_provided");
}

function rateInputKnowledge(
  input: string,
  timestamp: string,
): Knowledge<AnnualPercentageRateBps> {
  const value = parseAnnualRateBps(input);
  return value === undefined
    ? unknownKnowledge<AnnualPercentageRateBps>("not_provided")
    : known(value, "user", timestamp);
}

function countInputKnowledge(
  input: string,
  timestamp: string,
): Knowledge<number> {
  if (!input.trim()) return unknownKnowledge<number>("not_provided");
  const value = Number(input);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("A quantidade precisa ser um inteiro não negativo.");
  }
  return known(value, "user", timestamp);
}

function formatDate(localDate: LocalDate): string {
  const [year, month, day] = localDate.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function localDayNumber(localDate: LocalDate): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

function dueDistanceLabel(
  dueDate: LocalDate,
  referenceDate: LocalDate,
  kind: "due" | "renewal" = "due",
): string {
  const distance = localDayNumber(dueDate) - localDayNumber(referenceDate);
  const verb = kind === "renewal" ? "renova" : "vence";
  if (distance < 0) {
    return kind === "renewal"
      ? `renovação há ${Math.abs(distance)} dias`
      : `vencimento há ${Math.abs(distance)} dias`;
  }
  if (distance === 0) return `${verb} hoje`;
  if (distance === 1) return `${verb} amanhã`;
  return `${verb} em ${distance} dias`;
}

function optionalMoney(value: string) {
  return value.trim() ? parseBRLMinorUnits(value) : undefined;
}

function optionalDate(value: string): LocalDate | undefined {
  return value ? (value as LocalDate) : undefined;
}

function parseAnnualRateBps(value: string) {
  const normalized = value.trim().replace(/\s|%/g, "").replace(".", ",");
  if (!normalized) return undefined;
  const match = /^(\d+)(?:,(\d{1,2}))?$/.exec(normalized);
  if (!match) {
    throw new Error("Use a taxa anual em percentual, por exemplo 12,50.");
  }
  const whole = Number(match[1]);
  const decimals = Number((match[2] ?? "").padEnd(2, "0"));
  const basisPoints = whole * 100 + decimals;
  if (!Number.isSafeInteger(basisPoints)) {
    throw new Error("A taxa anual informada é grande demais.");
  }
  return asAnnualPercentageRateBps(basisPoints);
}

function subscriptionDetails(record: FinanceSubscriptionEntity) {
  return parseFinanceSubscriptionPayload(record.payload);
}

/** Exibe o preço por seu período informado; não converte anuidades em mensalidades. */
function formatSubscriptionPriceAndCadence(record: FinanceSubscriptionEntity): string {
  const details = subscriptionDetails(record);
  const cadence = knownValue(details?.cadence ?? unknownKnowledge());
  let label: string;
  switch (cadence) {
    case "monthly": label = "Mensal"; break;
    case "yearly": label = "Anual"; break;
    case "other": label = "Outra periodicidade"; break;
    case null: label = "Periodicidade não informada"; break;
    default: label = `Periodicidade informada: ${cadence}`;
  }
  return `${formatMoneyKnowledge(details?.price ?? unknownKnowledge())} · ${label}`;
}

function recordProviderName(record: FinanceWorkspaceRecord): string {
  if (isSubscriptionRecord(record)) {
    return knownValue(subscriptionDetails(record)?.institution ?? unknownKnowledge()) ??
      "Instituição não informada";
  }
  return providerName(record.payload.provider);
}

function statusLabel(record: FinanceWorkspaceRecord): string {
  const labels: Record<string, string> = {
    pending: "pendente",
    posted: "confirmado",
    voided: "anulado",
    scheduled: "programada",
    due: "a vencer",
    paid: "paga",
    overdue: "atrasada",
    cancelled: "cancelada",
    active: "ativa",
    paused: "pausado",
    defaulted: "inadimplente",
    disputed: "em contestação",
    closed: "encerrado",
    achieved: "atingida",
    active_confirmed: "ativa, confirmada",
    trial_confirmed: "teste a revisar",
    cancelled_confirmed: "cancelada, confirmada",
    uncertain: "situação a conferir",
  };
  if (isSubscriptionRecord(record)) {
    const status = subscriptionDetails(record)?.status;
    return status?.state === "known"
      ? labels[status.value] ?? status.value
      : "situação não confirmada";
  }
  return labels[record.payload.status] ?? record.payload.status;
}

function recordMainDate(record: FinanceWorkspaceRecord): LocalDate | null {
  if (isSubscriptionRecord(record)) {
    return knownValue(subscriptionDetails(record)?.renewalDate ?? unknownKnowledge());
  }
  switch (record.type) {
    case "financas.transaction":
      return record.payload.transactionDate;
    case "financas.bill":
      return knownValue(record.payload.dueDate) ?? knownValue(record.payload.paidDate);
    case "financas.debt":
      return (
        knownValue(record.payload.dueDate) ??
        knownValue(record.payload.balanceAsOfLocalDate)
      );
    case "financas.budget":
      return record.payload.periodEndLocalDate;
    case "financas.goal":
      return knownValue(record.payload.targetDate);
    case "financas.card":
      return (
        knownValue(record.payload.dueDate) ??
        knownValue(record.payload.closingDate) ??
        knownValue(record.payload.balanceAsOfLocalDate)
      );
  }
}

function recordTitle(record: FinanceWorkspaceRecord): string {
  if (isSubscriptionRecord(record)) {
    return knownValue(subscriptionDetails(record)?.service ?? unknownKnowledge()) ??
      "Assinatura sem nome informado";
  }
  switch (record.type) {
    case "financas.transaction":
      return (
        knownValue(record.payload.description) ??
        knownValue(record.payload.category) ??
        (record.payload.direction === "income" ? "Entrada" : "Saída")
      );
    case "financas.bill":
    case "financas.debt":
    case "financas.budget":
    case "financas.goal":
      return record.payload.label;
    case "financas.card":
      return record.payload.label;
  }
}

function recordAmount(record: FinanceWorkspaceRecord): string {
  if (isSubscriptionRecord(record)) {
    return formatSubscriptionPriceAndCadence(record);
  }
  switch (record.type) {
    case "financas.transaction":
      return formatBRL(record.payload.amount.amountMinor);
    case "financas.bill":
      return formatMoneyKnowledge(record.payload.amount);
    case "financas.debt":
      return formatMoneyKnowledge(record.payload.outstandingBalance);
    case "financas.budget":
      return formatBRL(record.payload.limit.amountMinor);
    case "financas.goal":
      return formatBRL(record.payload.targetAmount.amountMinor);
    case "financas.card":
      return formatMoneyKnowledge(record.payload.currentStatementAmount);
  }
}

function recordTypeLabel(record: FinanceWorkspaceRecord): string {
  if (isSubscriptionRecord(record)) return "Assinatura";
  const labels: Record<FinanceComposerKind, string> = {
    transaction: "Movimento",
    bill: "Conta",
    debt: "Dívida",
    budget: "Orçamento",
    goal: "Meta",
    card: "Cartão",
  };
  return labels[TYPE_TO_FILTER[record.type]];
}

function recordIcon(record: FinanceWorkspaceRecord): Icon {
  if (isSubscriptionRecord(record)) return Receipt;
  const item = COMPOSER_ITEMS.find((candidate) => candidate.id === TYPE_TO_FILTER[record.type]);
  return item?.icon ?? Wallet;
}

type LifecycleTargetStatus =
  | "posted"
  | "voided"
  | "due"
  | "overdue"
  | "paid"
  | "cancelled"
  | "active"
  | "paused"
  | "closed"
  | "defaulted"
  | "disputed"
  | "achieved";

interface RecordLifecycleAction {
  target: LifecycleTargetStatus;
  label: string;
  confirmation?: string;
}

function recordLifecycleActions(
  record: FinanceRecordEntity,
): readonly RecordLifecycleAction[] {
  switch (record.type) {
    case "financas.transaction":
      return record.payload.status === "pending"
        ? [
            {
              target: "posted",
              label: "Confirmar movimento",
              confirmation:
                "Confirmar este movimento? Ele passará a compor o fluxo financeiro.",
            },
            {
              target: "voided",
              label: "Anular",
              confirmation:
                "Registrar este movimento como anulado? O fato continuará no histórico.",
            },
          ]
        : [];
    case "financas.bill":
      if (!["scheduled", "due", "overdue"].includes(record.payload.status)) return [];
      return [
        ...(record.payload.status === "scheduled"
          ? [{ target: "due" as const, label: "Marcar vencida hoje" }]
          : []),
        ...(record.payload.status !== "overdue"
          ? [{ target: "overdue" as const, label: "Marcar em atraso" }]
          : []),
        {
          target: "paid",
          label: "Paga hoje",
          confirmation:
            "Confirmar que esta conta foi paga hoje? O Mentor só atualizará este registro.",
        },
        {
          target: "cancelled",
          label: "Cancelar registro",
          confirmation:
            "Registrar esta conta como cancelada? Isso não cancela cobranças no fornecedor.",
        },
      ];
    case "financas.debt": {
      if (record.payload.status === "paid") return [];
      const common: RecordLifecycleAction[] = [
        ...(record.payload.status !== "active"
          ? [{ target: "active" as const, label: "Retomar acompanhamento" }]
          : []),
        ...(record.payload.status !== "paused"
          ? [{ target: "paused" as const, label: "Pausar acompanhamento" }]
          : []),
        {
          target: "paid",
          label: "Marcar paga",
          confirmation:
            "Confirmar que esta dívida foi paga? O saldo informado será preservado como retrato histórico.",
        },
      ];
      if (record.payload.status === "active") {
        common.push(
          {
            target: "disputed",
            label: "Marcar contestada",
            confirmation:
              "Registrar esta dívida como contestada? Isso não abre uma contestação na instituição.",
          },
          { target: "defaulted", label: "Marcar inadimplente" },
        );
      }
      if (record.payload.status === "defaulted") {
        common.push({ target: "disputed", label: "Marcar contestada" });
      }
      if (record.payload.status === "disputed") {
        common.push({ target: "defaulted", label: "Marcar inadimplente" });
      }
      return common;
    }
    case "financas.card":
      if (record.payload.status === "active") {
        return [
          { target: "paused", label: "Pausar acompanhamento" },
          {
            target: "closed",
            label: "Encerrar cartão",
            confirmation:
              "Registrar este cartão como encerrado? Isso não encerra o produto na instituição.",
          },
        ];
      }
      return record.payload.status === "paused"
        ? [
            { target: "active", label: "Retomar acompanhamento" },
            {
              target: "closed",
              label: "Encerrar cartão",
              confirmation:
                "Registrar este cartão como encerrado? Isso não encerra o produto na instituição.",
            },
          ]
        : [];
    case "financas.budget":
      if (record.payload.status === "active") {
        return [
          { target: "paused", label: "Pausar orçamento" },
          { target: "closed", label: "Encerrar orçamento" },
        ];
      }
      return record.payload.status === "paused"
        ? [
            { target: "active", label: "Retomar orçamento" },
            { target: "closed", label: "Encerrar orçamento" },
          ]
        : [];
    case "financas.goal":
      if (record.payload.status === "active") {
        return [
          { target: "achieved", label: "Marcar atingida" },
          { target: "paused", label: "Pausar meta" },
          { target: "cancelled", label: "Cancelar meta" },
        ];
      }
      return record.payload.status === "paused"
        ? [
            { target: "active", label: "Retomar meta" },
            { target: "achieved", label: "Marcar atingida" },
            { target: "cancelled", label: "Cancelar meta" },
          ]
        : [];
  }
}

const LIFECYCLE_ACTION_GROUP_STYLE: CSSProperties = {
  display: "flex",
  gridColumn: "2 / -1",
  flexWrap: "wrap",
  gap: 6,
  paddingBottom: 3,
};

const LIFECYCLE_ACTION_STYLE: CSSProperties = {
  minHeight: 44,
  padding: "0 10px",
  border: "1px solid var(--fw-gold-light)",
  borderRadius: 999,
  background: "transparent",
  color: "var(--fw-wine)",
  fontSize: ".55rem",
};

interface DeadlineItem {
  id: string;
  date: LocalDate;
  label: string;
  provider: string;
  amount: string;
  note?: string;
  kind?: "due" | "renewal";
  tone: "wine" | "gold" | "green";
  record: FinanceWorkspaceRecord;
}

function buildDeadlines(records: readonly FinanceWorkspaceRecord[]): DeadlineItem[] {
  const deadlines: DeadlineItem[] = [];
  for (const record of records) {
    if (isSubscriptionRecord(record)) {
      const subscription = subscriptionDetails(record);
      const status = subscription?.status.state === "known"
        ? subscription.status.value
        : null;
      const date = subscription ? knownValue(subscription.renewalDate) : null;
      if (date && (status === "active_confirmed" || status === "trial_confirmed")) {
        deadlines.push({
          id: record.id,
          date,
          label: subscription ? knownValue(subscription.service) ?? "Assinatura" : "Assinatura",
          provider: recordProviderName(record),
          amount: formatSubscriptionPriceAndCadence(record),
          note: status === "trial_confirmed"
            ? "teste · revisar; cobrança não presumida"
            : "cobrança recorrente confirmada",
          kind: "renewal",
          tone: status === "trial_confirmed" ? "gold" : "green",
          record,
        });
      }
    }
    if (record.type === "financas.bill") {
      const date = knownValue(record.payload.dueDate);
      if (date && !["paid", "cancelled"].includes(record.payload.status)) {
        deadlines.push({
          id: record.id,
          date,
          label: record.payload.label,
          provider: providerName(record.payload.provider),
          amount: formatMoneyKnowledge(record.payload.amount),
          tone: record.payload.status === "overdue" ? "wine" : "gold",
          record,
        });
      }
    }
    if (record.type === "financas.debt") {
      const date = knownValue(record.payload.dueDate);
      if (date && record.payload.status === "active") {
        deadlines.push({
          id: record.id,
          date,
          label: record.payload.label,
          provider: providerName(record.payload.provider),
          amount: formatMoneyKnowledge(record.payload.outstandingBalance),
          tone: "wine",
          record,
        });
      }
    }
    if (record.type === "financas.card" && record.payload.status === "active") {
      const date = knownValue(record.payload.dueDate);
      const statementAmount = financeCardDeadlineAmount(record.payload);
      if (date) {
        deadlines.push({
          id: record.id,
          date,
          label: `${record.payload.label} · fatura`,
          provider: providerName(record.payload.provider),
          amount: formatMoneyKnowledge(statementAmount),
          tone: "gold",
          record,
        });
      }
      for (const installment of record.payload.installments) {
        if (!financeCardInstallmentHasRemainingPayments(installment)) continue;
        const installmentDate = knownValue(installment.nextDueDate);
        if (!installmentDate) continue;
        // A known statement/minimum already represents this card's obligation
        // on its own due date. Showing the same installment again would make
        // one commitment look like two.
        if (date === installmentDate && statementAmount.state === "known") continue;
        deadlines.push({
          id: `${record.id}-${installment.id}`,
          date: installmentDate,
          label: installment.label,
          provider: `${providerName(record.payload.provider)} · parcela`,
          amount: formatMoneyKnowledge(installment.installmentAmount),
          tone: "wine",
          record,
        });
      }
    }
    if (record.type === "financas.goal") {
      const date = knownValue(record.payload.targetDate);
      if (date && record.payload.status === "active") {
        deadlines.push({
          id: record.id,
          date,
          label: record.payload.label,
          provider: providerName(record.payload.provider),
          amount: formatBRL(record.payload.targetAmount.amountMinor),
          tone: "green",
          record,
        });
      }
    }
  }
  return deadlines.sort((left, right) =>
    left.date === right.date
      ? left.label.localeCompare(right.label)
      : left.date.localeCompare(right.date),
  );
}

function FinanceField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="fw-field">
      <span>
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

function ProviderSelect({
  value,
  onChange,
}: {
  value: ListedFinanceProviderName;
  onChange: (value: ListedFinanceProviderName) => void;
}) {
  return (
    <FinanceField label="Instituição">
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as ListedFinanceProviderName)}
      >
        {LISTED_FINANCE_PROVIDERS.map((provider) => (
          <option key={provider} value={provider}>
            {provider}
          </option>
        ))}
      </select>
    </FinanceField>
  );
}

function SegmentedButtons<TValue extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: TValue;
  onChange: (value: TValue) => void;
  options: readonly { value: TValue; label: string }[];
}) {
  return (
    <fieldset className="fw-segmented">
      <legend>{label}</legend>
      <div style={{ "--fw-columns": options.length } as CSSProperties}>
        {options.map((option) => (
          <button
            type="button"
            key={option.value}
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
          >
            {value === option.value ? <Check size={14} weight="bold" /> : null}
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function ComposerFeedback({
  error,
  success,
}: {
  error: string | null;
  success: string | null;
}) {
  if (!error && !success) return null;
  return (
    <p className="fw-composer-feedback" data-state={error ? "error" : "success"} role={error ? "alert" : "status"}>
      {error ? <Warning size={17} weight="fill" /> : <CheckCircle size={17} weight="fill" />}
      {error ?? success}
    </p>
  );
}

function useComposerSubmit(onComplete: () => Promise<void>) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (action: () => Promise<void>, message: string) => {
    setError(null);
    setSuccess(null);
    try {
      await action();
      await onComplete();
      setSuccess(message);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível salvar este fato financeiro.");
      return false;
    }
  };

  return { error, success, submit };
}

type FinanceActions = ReturnType<typeof useAgendaFinanceData>["actions"];

interface ComposerProps {
  referenceDate: LocalDate;
  initialProvider: ListedFinanceProviderName;
  saving: boolean;
  actions: FinanceActions;
  onComplete: () => Promise<void>;
  editingRecord?: FinanceRecordEntity | null;
}

interface CardInstallmentDraft {
  id: string;
  label: string;
  purchaseTotal: string;
  installmentAmount: string;
  totalInstallments: string;
  remainingInstallments: string;
  nextDueDate: string;
  finalDueDate: string;
}

interface AccountEditorProps {
  account: FinanceAccountEntity;
  saving: boolean;
  actions: FinanceActions;
  onComplete: () => Promise<void>;
  onNewTransaction: () => void;
}

function AccountEditor({
  account,
  saving,
  actions,
  onComplete,
  onNewTransaction,
}: AccountEditorProps) {
  const [accountKind, setAccountKind] = useState<FinanceAccountKind | "">(
    knownValue(account.payload.accountKind) ?? "",
  );
  const [balance, setBalance] = useState(
    moneyKnowledgeInput(account.payload.balance),
  );
  const [dueDate, setDueDate] = useState(
    dateKnowledgeInput(account.payload.dueDate),
  );
  const { error, success, submit } = useComposerSubmit(onComplete);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    await submit(
      () => actions.updateFinanceAccount({
        entityId: account.id,
        expectedRevision: account.revision,
        accountKind: accountKind || null,
        balanceMinor: balance.trim() ? parseSignedBRLMinorUnits(balance) : null,
        dueDate: optionalDate(dueDate) ?? null,
      }),
      `${account.payload.providerName} atualizado no mesmo histórico.`,
    );
  };

  return (
    <form
      className="fw-account-editor"
      aria-label={`Atualizar ${account.payload.providerName}`}
      onSubmit={(event) => void handleSubmit(event)}
    >
      <header>
        <Bank size={22} weight="duotone" />
        <span>
          <small>Retrato manual da conta</small>
          <strong>{account.payload.providerName}</strong>
        </span>
      </header>
      <div className="fw-two-column">
        <FinanceField label="Tipo da conta">
          <select
            value={accountKind}
            onChange={(event) => setAccountKind(event.target.value as FinanceAccountKind | "")}
          >
            <option value="">Não informado</option>
            <option value="checking">Conta corrente</option>
            <option value="wallet">Carteira digital</option>
            <option value="credit">Crédito</option>
            <option value="other">Outro</option>
          </select>
        </FinanceField>
        <FinanceField label="Saldo conferido" hint="não é consultado pelo Mentor">
          <div className="fw-money-input">
            <span>R$</span>
            <KeyboardInput
              inputMode="decimal"
              value={balance}
              onChange={(event) => setBalance(event.target.value)}
              placeholder="0,00"
            />
          </div>
        </FinanceField>
      </div>
      <FinanceField label="Próximo vencimento" hint="somente se esta conta tiver um">
        <KeyboardInput
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
        />
      </FinanceField>
      <p className="fw-account-boundary">
        <LockKey size={15} />Este formulário não aceita senha, token, número da conta, cartão ou CVV.
      </p>
      <ComposerFeedback error={error} success={success} />
      <div className="fw-account-actions">
        <button type="button" onClick={onNewTransaction}>
          <CurrencyCircleDollar size={17} />Novo movimento
        </button>
        <button type="submit" disabled={saving}>
          <CheckCircle size={17} />{saving ? "Salvando…" : "Atualizar esta conta"}
        </button>
      </div>
    </form>
  );
}

function TransactionComposer({ referenceDate, initialProvider, saving, actions, onComplete }: ComposerProps) {
  const [provider, setProvider] = useState<ListedFinanceProviderName>(initialProvider);
  const [direction, setDirection] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(referenceDate);
  const [status, setStatus] = useState<"posted" | "pending">("posted");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const { error, success, submit } = useComposerSubmit(onComplete);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await submit(
      () =>
        actions.createFinanceTransaction({
          provider: listedFinanceProvider(provider),
          direction,
          amountMinor: parseBRLMinorUnits(amount),
          transactionDate: date,
          status,
          ...(category.trim() ? { category: category.trim() } : {}),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      "Movimento salvo no livro-caixa.",
    );
    if (saved) {
      setAmount("");
      setCategory("");
      setDescription("");
    }
  };

  return (
    <form className="fw-composer fw-composer--transaction" onSubmit={(event) => void handleSubmit(event)}>
      <div className="fw-receipt-mark">
        <CurrencyCircleDollar size={26} weight="duotone" />
        <span><small>Livro-caixa</small><strong>Movimento confirmado</strong></span>
      </div>
      <ProviderSelect value={provider} onChange={setProvider} />
      <SegmentedButtons label="Direção" value={direction} onChange={setDirection} options={[
        { value: "expense", label: "Saída" },
        { value: "income", label: "Entrada" },
      ]} />
      <FinanceField label="Valor em BRL" hint="centavos preservados">
        <div className="fw-money-input"><span>R$</span><KeyboardInput required inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0,00" /></div>
      </FinanceField>
      <div className="fw-two-column">
        <FinanceField label="Data"><KeyboardInput required type="date" value={date} onChange={(event) => setDate(event.target.value as LocalDate)} /></FinanceField>
        <FinanceField label="Estado">
          <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="posted">Confirmado</option>
            <option value="pending">Pendente</option>
          </select>
        </FinanceField>
      </div>
      <div className="fw-two-column">
        <FinanceField label="Categoria"><KeyboardInput value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Ex.: alimentação" /></FinanceField>
        <FinanceField label="Descrição"><KeyboardInput value={description} onChange={(event) => setDescription(event.target.value)} placeholder="O que foi" /></FinanceField>
      </div>
      <ComposerFeedback error={error} success={success} />
      <button className="fw-save" type="submit" disabled={saving || !amount || !date}><CheckCircle size={19} />{saving ? "Salvando…" : "Salvar movimento"}</button>
    </form>
  );
}

function BillComposer({ referenceDate, initialProvider, saving, actions, onComplete }: ComposerProps) {
  const [provider, setProvider] = useState<ListedFinanceProviderName>(initialProvider);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [status, setStatus] = useState<"scheduled" | "due" | "paid" | "overdue">("scheduled");
  const [paidDate, setPaidDate] = useState("");
  const [interest, setInterest] = useState("");
  const [note, setNote] = useState("");
  const { error, success, submit } = useComposerSubmit(onComplete);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await submit(
      () =>
        actions.createFinanceBill({
          provider: listedFinanceProvider(provider),
          label,
          amountMinor: optionalMoney(amount),
          dueDate: optionalDate(dueDate),
          paidDate: status === "paid" ? optionalDate(paidDate) : undefined,
          interestChargedMinor: optionalMoney(interest),
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      "Conta salva somente com os fatos informados.",
    );
    if (saved) {
      setLabel("");
      setAmount("");
      setDueDate("");
      setPaidDate("");
      setInterest("");
      setNote("");
    }
  };

  return (
    <form className="fw-composer fw-composer--bill" onSubmit={(event) => void handleSubmit(event)}>
      <div className="fw-bill-head"><Receipt size={25} weight="duotone" /><span><small>Conta a pagar</small><strong>Data, valor e estado separados</strong></span></div>
      <ProviderSelect value={provider} onChange={setProvider} />
      <FinanceField label="Descrição da conta"><KeyboardInput required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: fatura do cartão" /></FinanceField>
      <div className="fw-two-column">
        <FinanceField label="Valor" hint="pode ficar desconhecido"><KeyboardInput inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        <FinanceField label="Vencimento" hint="pode ficar desconhecido"><KeyboardInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value as LocalDate)} /></FinanceField>
      </div>
      <SegmentedButtons label="Situação" value={status} onChange={setStatus} options={[
        { value: "scheduled", label: "Programada" },
        { value: "due", label: "A vencer" },
        { value: "paid", label: "Paga" },
        { value: "overdue", label: "Atrasada" },
      ]} />
      {status === "paid" ? <FinanceField label="Data do pagamento" hint="pode ficar desconhecida"><KeyboardInput type="date" value={paidDate} onChange={(event) => setPaidDate(event.target.value)} /></FinanceField> : null}
      <FinanceField label="Juros cobrados" hint="somente se você souber"><KeyboardInput inputMode="decimal" value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
      <FinanceField label="Observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Informação útil para decidir e lembrar" /></FinanceField>
      <ComposerFeedback error={error} success={success} />
      <button className="fw-save" type="submit" disabled={saving || !label.trim()}><CheckCircle size={19} />{saving ? "Salvando…" : "Salvar conta"}</button>
    </form>
  );
}

function DebtComposer({ referenceDate, initialProvider, saving, actions, onComplete, editingRecord }: ComposerProps) {
  const existing = editingRecord?.type === "financas.debt" ? editingRecord : null;
  const existingProvider = existing?.payload.provider.kind === "listed"
    ? existing.payload.provider.name
    : initialProvider;
  const [provider, setProvider] = useState<ListedFinanceProviderName>(existingProvider);
  const [label, setLabel] = useState(existing?.payload.label ?? "");
  const [original, setOriginal] = useState(
    existing ? moneyKnowledgeInput(existing.payload.originalPrincipal) : "",
  );
  const [outstanding, setOutstanding] = useState(
    existing ? moneyKnowledgeInput(existing.payload.outstandingBalance) : "",
  );
  const [annualRate, setAnnualRate] = useState(
    existing ? rateKnowledgeInput(existing.payload.annualPercentageRateBps) : "",
  );
  const [interest, setInterest] = useState(
    existing ? moneyKnowledgeInput(existing.payload.interestCharged) : "",
  );
  const [balanceDate, setBalanceDate] = useState(
    existing ? dateKnowledgeInput(existing.payload.balanceAsOfLocalDate) : referenceDate,
  );
  const [dueDate, setDueDate] = useState(
    existing ? dateKnowledgeInput(existing.payload.dueDate) : "",
  );
  const [status, setStatus] = useState<"active" | "paid" | "paused" | "defaulted" | "disputed">(
    existing?.payload.status ?? "active",
  );
  const [note, setNote] = useState(
    existing ? textKnowledgeInput(existing.payload.note) : "",
  );
  const { error, success, submit } = useComposerSubmit(onComplete);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await submit(() => {
      if (!existing) {
        return actions.createFinanceDebt({
          provider: listedFinanceProvider(provider),
          label,
          originalPrincipalMinor: optionalMoney(original),
          outstandingBalanceMinor: optionalMoney(outstanding),
          annualPercentageRateBps: parseAnnualRateBps(annualRate),
          interestChargedMinor: optionalMoney(interest),
          balanceAsOfLocalDate: optionalDate(balanceDate),
          dueDate: optionalDate(dueDate),
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
        });
      }
      const timestamp = new Date().toISOString();
      const patch = {
        provider: listedFinanceProvider(provider),
        label: label.trim(),
        originalPrincipal: moneyInputKnowledge(original, timestamp),
        outstandingBalance: moneyInputKnowledge(outstanding, timestamp),
        annualPercentageRateBps: rateInputKnowledge(annualRate, timestamp),
        interestCharged: moneyInputKnowledge(interest, timestamp),
        balanceAsOfLocalDate: dateInputKnowledge(balanceDate, timestamp),
        dueDate: dateInputKnowledge(dueDate, timestamp),
        note: textInputKnowledge(note, timestamp),
      };
      return status === existing.payload.status
        ? actions.updateFinanceRecord({
            type: existing.type,
            entityId: existing.id,
            expectedRevision: existing.revision,
            patch,
          })
        : actions.updateFinanceRecord({
            type: existing.type,
            entityId: existing.id,
            expectedRevision: existing.revision,
            expectedStatus: existing.payload.status,
            patch: { ...patch, status },
          });
    }, existing
      ? "Retrato da dívida atualizado no mesmo histórico."
      : "Retrato da dívida salvo sem projetar juros futuros.");
    if (saved && !existing) {
      setLabel("");
      setOriginal("");
      setOutstanding("");
      setAnnualRate("");
      setInterest("");
      setDueDate("");
      setNote("");
    }
  };

  return (
    <form className="fw-composer fw-composer--debt" onSubmit={(event) => void handleSubmit(event)}>
      <header className="fw-debt-head"><CreditCard size={25} weight="duotone" /><span><small>Retrato da dívida</small><strong>Valores e taxa declarados por você</strong></span></header>
      <ProviderSelect value={provider} onChange={setProvider} />
      <FinanceField label="Dívida ou produto"><KeyboardInput required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: cartão, cheque especial" /></FinanceField>
      <div className="fw-debt-principal">
        <FinanceField label="Principal original"><KeyboardInput inputMode="decimal" value={original} onChange={(event) => setOriginal(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        <span><CaretRight size={18} /></span>
        <FinanceField label="Saldo devedor informado"><KeyboardInput inputMode="decimal" value={outstanding} onChange={(event) => setOutstanding(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
      </div>
      <div className="fw-two-column">
        <FinanceField label="Taxa anual (%)" hint="não convertemos nem projetamos"><KeyboardInput inputMode="decimal" value={annualRate} onChange={(event) => setAnnualRate(event.target.value)} placeholder="12,50" /></FinanceField>
        <FinanceField label="Juros já cobrados"><KeyboardInput inputMode="decimal" value={interest} onChange={(event) => setInterest(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
      </div>
      <div className="fw-two-column">
        <FinanceField label="Saldo conferido em"><KeyboardInput type="date" value={balanceDate} onChange={(event) => setBalanceDate(event.target.value as LocalDate)} /></FinanceField>
        <FinanceField label="Próximo vencimento"><KeyboardInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></FinanceField>
      </div>
      <SegmentedButtons label="Situação" value={status} onChange={setStatus} options={[
        { value: "active", label: "Ativa" },
        { value: "paid", label: "Paga" },
        { value: "paused", label: "Pausada" },
        { value: "defaulted", label: "Inadimplente" },
        { value: "disputed", label: "Contestada" },
      ]} />
      <FinanceField label="Observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Condição, parcela ou próximo passo confirmado" /></FinanceField>
      <ComposerFeedback error={error} success={success} />
      <button className="fw-save" type="submit" disabled={saving || !label.trim()}><CheckCircle size={19} />{saving ? "Salvando…" : existing ? "Atualizar este retrato" : "Salvar retrato da dívida"}</button>
    </form>
  );
}

function CardComposer({ referenceDate, initialProvider, saving, actions, onComplete, editingRecord }: ComposerProps) {
  const existing = editingRecord?.type === "financas.card" ? editingRecord : null;
  const existingProvider = existing?.payload.provider.kind === "listed"
    ? existing.payload.provider.name
    : initialProvider;
  const [provider, setProvider] = useState<ListedFinanceProviderName>(existingProvider);
  const [label, setLabel] = useState(existing?.payload.label ?? "");
  const [closingDate, setClosingDate] = useState(
    existing ? dateKnowledgeInput(existing.payload.closingDate) : "",
  );
  const [dueDate, setDueDate] = useState(
    existing ? dateKnowledgeInput(existing.payload.dueDate) : "",
  );
  const [limit, setLimit] = useState(
    existing ? moneyKnowledgeInput(existing.payload.statedCreditLimit) : "",
  );
  const [balance, setBalance] = useState(
    existing ? moneyKnowledgeInput(existing.payload.currentBalance) : "",
  );
  const [statement, setStatement] = useState(
    existing ? moneyKnowledgeInput(existing.payload.currentStatementAmount) : "",
  );
  const [minimumPayment, setMinimumPayment] = useState(
    existing ? moneyKnowledgeInput(existing.payload.minimumPayment) : "",
  );
  const [annualRate, setAnnualRate] = useState(
    existing ? rateKnowledgeInput(existing.payload.annualPercentageRateBps) : "",
  );
  const [balanceDate, setBalanceDate] = useState(
    existing ? dateKnowledgeInput(existing.payload.balanceAsOfLocalDate) : referenceDate,
  );
  const [status, setStatus] = useState<"active" | "paused" | "closed">(
    existing?.payload.status ?? "active",
  );
  const [note, setNote] = useState(
    existing ? textKnowledgeInput(existing.payload.note) : "",
  );
  const [scenarioPayment, setScenarioPayment] = useState("");
  const [installments, setInstallments] = useState<CardInstallmentDraft[]>(() =>
    existing?.payload.installments.map((installment) => ({
      id: installment.id,
      label: installment.label,
      purchaseTotal: moneyKnowledgeInput(installment.purchaseTotal),
      installmentAmount: moneyKnowledgeInput(installment.installmentAmount),
      totalInstallments: countKnowledgeInput(installment.totalInstallments),
      remainingInstallments: countKnowledgeInput(installment.remainingInstallments),
      nextDueDate: dateKnowledgeInput(installment.nextDueDate),
      finalDueDate: dateKnowledgeInput(installment.finalDueDate),
    })) ?? [],
  );
  const { error, success, submit } = useComposerSubmit(onComplete);

  const draftSummary = useMemo(() => {
    try {
      const money = (value: string): Knowledge<BRLMoney> => value.trim()
        ? known({ amountMinor: parseBRLMinorUnits(value), currency: "BRL" })
        : unknownKnowledge("not_recorded");
      const count = (value: string): Knowledge<number> => {
        if (!value.trim()) return unknownKnowledge("not_recorded");
        const parsed = Number(value);
        return Number.isSafeInteger(parsed) && parsed >= 0
          ? known(parsed)
          : unknownKnowledge("not_recorded");
      };
      return summarizeFinanceCard({
        statedCreditLimit: money(limit),
        currentBalance: money(balance),
        installments: installments.map((item) => ({
          id: item.id,
          label: item.label || "Compra parcelada",
          purchaseTotal: money(item.purchaseTotal),
          installmentAmount: money(item.installmentAmount),
          totalInstallments: count(item.totalInstallments),
          remainingInstallments: count(item.remainingInstallments),
          nextDueDate: unknownKnowledge("not_recorded"),
          finalDueDate: unknownKnowledge("not_recorded"),
        })),
      });
    } catch {
      return null;
    }
  }, [balance, installments, limit]);

  const payoff = useMemo<{ scenario: FinanceCardPayoffScenario | null; error: string | null }>(() => {
    if (!balance.trim() || !annualRate.trim() || !scenarioPayment.trim()) {
      return { scenario: null, error: null };
    }
    try {
      return {
        scenario: simulateFinanceCardPayoff({
          currentBalanceMinor: parseBRLMinorUnits(balance),
          annualPercentageRateBps: parseAnnualRateBps(annualRate)!,
          monthlyPaymentMinor: parseBRLMinorUnits(scenarioPayment),
        }),
        error: null,
      };
    } catch (cause) {
      return {
        scenario: null,
        error: cause instanceof Error ? cause.message : "Não foi possível calcular o cenário.",
      };
    }
  }, [annualRate, balance, scenarioPayment]);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await submit(
      () => {
        const normalizedInstallments = installments.map((item) => {
          const total = item.totalInstallments.trim() ? Number(item.totalInstallments) : undefined;
          const remaining = item.remainingInstallments.trim() ? Number(item.remainingInstallments) : undefined;
          if (total !== undefined && (!Number.isSafeInteger(total) || total < 1)) {
            throw new Error("O total de parcelas precisa ser um inteiro a partir de 1.");
          }
          if (remaining !== undefined && (!Number.isSafeInteger(remaining) || remaining < 0)) {
            throw new Error("As parcelas restantes precisam ser um inteiro não negativo.");
          }
          return {
            id: item.id,
            label: item.label,
            purchaseTotalMinor: optionalMoney(item.purchaseTotal),
            installmentAmountMinor: optionalMoney(item.installmentAmount),
            totalInstallments: total,
            remainingInstallments: remaining,
            nextDueDate: optionalDate(item.nextDueDate),
            finalDueDate: optionalDate(item.finalDueDate),
          };
        });
        if (!existing) {
          return actions.createFinanceCard({
            provider: listedFinanceProvider(provider),
            label,
            closingDate: optionalDate(closingDate),
            dueDate: optionalDate(dueDate),
            statedCreditLimitMinor: optionalMoney(limit),
            currentBalanceMinor: optionalMoney(balance),
            currentStatementAmountMinor: optionalMoney(statement),
            minimumPaymentMinor: optionalMoney(minimumPayment),
            annualPercentageRateBps: parseAnnualRateBps(annualRate),
            balanceAsOfLocalDate: optionalDate(balanceDate),
            installments: normalizedInstallments,
            status,
            ...(note.trim() ? { note: note.trim() } : {}),
          });
        }
        const timestamp = new Date().toISOString();
        const patch = {
          provider: listedFinanceProvider(provider),
          label: label.trim(),
          closingDate: dateInputKnowledge(closingDate, timestamp),
          dueDate: dateInputKnowledge(dueDate, timestamp),
          statedCreditLimit: moneyInputKnowledge(limit, timestamp),
          currentBalance: moneyInputKnowledge(balance, timestamp),
          currentStatementAmount: moneyInputKnowledge(statement, timestamp),
          minimumPayment: moneyInputKnowledge(minimumPayment, timestamp),
          annualPercentageRateBps: rateInputKnowledge(annualRate, timestamp),
          balanceAsOfLocalDate: dateInputKnowledge(balanceDate, timestamp),
          installments: normalizedInstallments.map((installment, index) => ({
            id: installment.id,
            label: installment.label,
            purchaseTotal: moneyInputKnowledge(
              installments[index].purchaseTotal,
              timestamp,
            ),
            installmentAmount: moneyInputKnowledge(
              installments[index].installmentAmount,
              timestamp,
            ),
            totalInstallments: countInputKnowledge(
              installments[index].totalInstallments,
              timestamp,
            ),
            remainingInstallments: countInputKnowledge(
              installments[index].remainingInstallments,
              timestamp,
            ),
            nextDueDate: dateInputKnowledge(
              installments[index].nextDueDate,
              timestamp,
            ),
            finalDueDate: dateInputKnowledge(
              installments[index].finalDueDate,
              timestamp,
            ),
          })),
          note: textInputKnowledge(note, timestamp),
        };
        return status === existing.payload.status
          ? actions.updateFinanceRecord({
              type: existing.type,
              entityId: existing.id,
              expectedRevision: existing.revision,
              patch,
            })
          : actions.updateFinanceRecord({
              type: existing.type,
              entityId: existing.id,
              expectedRevision: existing.revision,
              expectedStatus: existing.payload.status,
              patch: { ...patch, status },
            });
      },
      existing
        ? "Retrato do cartão atualizado no mesmo histórico."
        : "Retrato do cartão salvo sem credenciais.",
    );
    if (saved && !existing) {
      setLabel("");
      setClosingDate("");
      setDueDate("");
      setLimit("");
      setBalance("");
      setStatement("");
      setMinimumPayment("");
      setAnnualRate("");
      setNote("");
      setScenarioPayment("");
      setInstallments([]);
    }
  };

  return (
    <form className="fw-composer fw-composer--card" onSubmit={(event) => void handleSubmit(event)}>
      <header className="fw-card-head"><CreditCard size={27} weight="duotone" /><span><small>Retrato manual do cartão</small><strong>Fatura, limite e parcelas sem senha ou número</strong></span></header>
      <ProviderSelect value={provider} onChange={setProvider} />
      <FinanceField label="Apelido do cartão" hint="não informe número completo"><KeyboardInput required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: cartão principal" /></FinanceField>
      <div className="fw-two-column">
        <FinanceField label="Fechamento atual" hint="data exata, se conhecida"><KeyboardInput type="date" value={closingDate} onChange={(event) => setClosingDate(event.target.value)} /></FinanceField>
        <FinanceField label="Vencimento atual" hint="data exata, se conhecida"><KeyboardInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></FinanceField>
      </div>
      <div className="fw-card-money-grid">
        <FinanceField label="Limite informado"><KeyboardInput inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        <FinanceField label="Saldo atual"><KeyboardInput inputMode="decimal" value={balance} onChange={(event) => setBalance(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        <FinanceField label="Fatura atual"><KeyboardInput inputMode="decimal" value={statement} onChange={(event) => setStatement(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        <FinanceField label="Pagamento mínimo"><KeyboardInput inputMode="decimal" value={minimumPayment} onChange={(event) => setMinimumPayment(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
      </div>
      <div className="fw-two-column">
        <FinanceField label="APR anual (%)" hint="taxa exatamente informada"><KeyboardInput inputMode="decimal" value={annualRate} onChange={(event) => setAnnualRate(event.target.value)} placeholder="12,50" /></FinanceField>
        <FinanceField label="Retrato conferido em"><KeyboardInput type="date" value={balanceDate} onChange={(event) => setBalanceDate(event.target.value as LocalDate)} /></FinanceField>
      </div>
      <SegmentedButtons label="Situação" value={status} onChange={setStatus} options={[
        { value: "active", label: "Ativo" },
        { value: "paused", label: "Pausado" },
        { value: "closed", label: "Encerrado" },
      ]} />

      <section className="fw-card-derivations" aria-label="Cálculos explícitos do cartão">
        <div><Gauge size={20} /><span><small>Utilização</small><strong>{draftSummary?.utilizationBasisPoints.state === "known" ? `${(draftSummary.utilizationBasisPoints.value / 100).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%` : "dados insuficientes"}</strong></span></div>
        <div><Stack size={20} /><span><small>Parcelas restantes</small><strong>{draftSummary ? formatMoneyKnowledge(draftSummary.remainingInstallmentCommitment) : "dados insuficientes"}</strong></span></div>
        <p><Info size={14} />Utilização exige limite e saldo. Compromisso parcelado exige valor da parcela e quantidade restante em todas as compras.</p>
      </section>

      <section className="fw-installments">
        <header><Stack size={21} weight="duotone" /><span><strong>Compras parceladas</strong><small>Total, restante e vencimentos permanecem separados.</small></span></header>
        {installments.map((item, index) => (
          <article key={item.id}>
            <div className="fw-installment-title"><span>{index + 1}</span><FinanceField label="Descrição"><KeyboardInput required value={item.label} onChange={(event) => setInstallments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, label: event.target.value } : candidate))} placeholder="Ex.: notebook" /></FinanceField><button type="button" aria-label={`Remover ${item.label || `parcela ${index + 1}`}`} onClick={() => setInstallments((current) => current.filter((candidate) => candidate.id !== item.id))}><Trash size={17} /></button></div>
            <div className="fw-card-money-grid"><FinanceField label="Valor total"><KeyboardInput inputMode="decimal" value={item.purchaseTotal} onChange={(event) => setInstallments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, purchaseTotal: event.target.value } : candidate))} placeholder="R$ 0,00" /></FinanceField><FinanceField label="Valor da parcela"><KeyboardInput inputMode="decimal" value={item.installmentAmount} onChange={(event) => setInstallments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, installmentAmount: event.target.value } : candidate))} placeholder="R$ 0,00" /></FinanceField><FinanceField label="Total de parcelas"><KeyboardInput inputMode="numeric" value={item.totalInstallments} onChange={(event) => setInstallments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, totalInstallments: event.target.value } : candidate))} placeholder="—" /></FinanceField><FinanceField label="Restantes"><KeyboardInput inputMode="numeric" value={item.remainingInstallments} onChange={(event) => setInstallments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, remainingInstallments: event.target.value } : candidate))} placeholder="—" /></FinanceField></div>
            <div className="fw-two-column"><FinanceField label="Próximo vencimento"><KeyboardInput type="date" value={item.nextDueDate} onChange={(event) => setInstallments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, nextDueDate: event.target.value } : candidate))} /></FinanceField><FinanceField label="Último vencimento"><KeyboardInput type="date" value={item.finalDueDate} onChange={(event) => setInstallments((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, finalDueDate: event.target.value } : candidate))} /></FinanceField></div>
          </article>
        ))}
        <button type="button" className="fw-add-installment" onClick={() => setInstallments((current) => [...current, { id: crypto.randomUUID(), label: "", purchaseTotal: "", installmentAmount: "", totalInstallments: "", remainingInstallments: "", nextDueDate: "", finalDueDate: "" }])}><Plus size={16} />Adicionar compra parcelada</button>
      </section>

      <section className="fw-payoff-simulator">
        <header><Calculator size={21} weight="duotone" /><span><strong>Cenário descritivo de quitação</strong><small>Sem novas compras, APR fixa e pagamento após juros; não é recomendação.</small></span></header>
        <FinanceField label="Pagamento mensal do cenário" hint="não agenda nem contrata"><KeyboardInput inputMode="decimal" value={scenarioPayment} onChange={(event) => setScenarioPayment(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        {payoff.error ? (
          <p className="fw-scenario-error"><Warning size={15} />{payoff.error}</p>
        ) : payoff.scenario?.status === "paid_off" ? (
          <>
            <p><strong>Quitação aritmética alcançada.</strong> O prazo e os totais valem somente para as premissas declaradas acima.</p>
            <dl>
              <div><dt>Primeiro mês</dt><dd>{formatBRL(payoff.scenario.firstMonthInterest.amountMinor)} de juros</dd></div>
              <div><dt>Prazo aritmético</dt><dd>{payoff.scenario.months} meses</dd></div>
              <div><dt>Juros até quitar</dt><dd>{formatMoneyKnowledge(payoff.scenario.totalInterest)}</dd></div>
              <div><dt>Total até quitar</dt><dd>{formatMoneyKnowledge(payoff.scenario.totalPaid)}</dd></div>
              <div><dt>Saldo restante</dt><dd>{formatBRL(payoff.scenario.remainingBalance.amountMinor)}</dd></div>
            </dl>
          </>
        ) : payoff.scenario?.status === "payment_not_above_interest" ? (
          <>
            <p><strong>O pagamento não supera os juros do primeiro mês.</strong> A simulação foi interrompida antes de projetar prazo ou total final.</p>
            <dl>
              <div><dt>Juros do primeiro mês</dt><dd>{formatBRL(payoff.scenario.firstMonthInterest.amountMinor)}</dd></div>
              <div><dt>Prazo</dt><dd>não projetado</dd></div>
              <div><dt>Saldo não amortizado</dt><dd>{formatBRL(payoff.scenario.remainingBalance.amountMinor)}</dd></div>
            </dl>
          </>
        ) : payoff.scenario?.status === "maximum_months_reached" ? (
          <>
            <p><strong>O horizonte máximo foi atingido com saldo restante.</strong> Juros e pagamentos abaixo são acumulados apenas nos {payoff.scenario.maximumMonths} meses simulados, não totais de quitação.</p>
            <dl>
              <div><dt>Horizonte testado</dt><dd>{payoff.scenario.maximumMonths} meses</dd></div>
              <div><dt>Primeiro mês</dt><dd>{formatBRL(payoff.scenario.firstMonthInterest.amountMinor)} de juros</dd></div>
              <div><dt>Juros até o horizonte</dt><dd>{formatMoneyKnowledge(payoff.scenario.totalInterest)}</dd></div>
              <div><dt>Pago até o horizonte</dt><dd>{formatMoneyKnowledge(payoff.scenario.totalPaid)}</dd></div>
              <div><dt>Saldo restante</dt><dd>{formatBRL(payoff.scenario.remainingBalance.amountMinor)}</dd></div>
            </dl>
          </>
        ) : (
          <p>Informe saldo, APR e pagamento mensal para calcular — nenhum campo ausente será tratado como zero.</p>
        )}
      </section>

      <FinanceField label="Observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Condição confirmada ou contexto útil" /></FinanceField>
      <ComposerFeedback error={error} success={success} />
      <button className="fw-save" type="submit" disabled={saving || !label.trim()}><CheckCircle size={19} />{saving ? "Salvando…" : existing ? "Atualizar este retrato" : "Salvar retrato do cartão"}</button>
    </form>
  );
}

function BudgetComposer({ referenceDate, initialProvider, saving, actions, onComplete }: ComposerProps) {
  const [provider, setProvider] = useState<ListedFinanceProviderName>(initialProvider);
  const [label, setLabel] = useState("");
  const [limit, setLimit] = useState("");
  const [spent, setSpent] = useState("");
  const [startDate, setStartDate] = useState(referenceDate);
  const [endDate, setEndDate] = useState(shiftLocalDate(referenceDate, 29));
  const [status, setStatus] = useState<"active" | "paused" | "closed">("active");
  const [note, setNote] = useState("");
  const { error, success, submit } = useComposerSubmit(onComplete);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await submit(
      () =>
        actions.createFinanceBudget({
          provider: listedFinanceProvider(provider),
          label,
          limitMinor: parseBRLMinorUnits(limit),
          spentAmountMinor: optionalMoney(spent),
          periodStartLocalDate: startDate,
          periodEndLocalDate: endDate,
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      "Orçamento salvo com limite e período explícitos.",
    );
    if (saved) {
      setLabel("");
      setLimit("");
      setSpent("");
      setNote("");
    }
  };

  return (
    <form className="fw-composer fw-composer--budget" onSubmit={(event) => void handleSubmit(event)}>
      <div className="fw-budget-gauge"><Gauge size={31} weight="duotone" /><span><small>Envelope de gasto</small><strong>Limite não é saldo</strong></span></div>
      <ProviderSelect value={provider} onChange={setProvider} />
      <FinanceField label="Nome do orçamento"><KeyboardInput required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: alimentação no internato" /></FinanceField>
      <div className="fw-two-column">
        <FinanceField label="Limite"><KeyboardInput required inputMode="decimal" value={limit} onChange={(event) => setLimit(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        <FinanceField label="Gasto informado" hint="pode ficar desconhecido"><KeyboardInput inputMode="decimal" value={spent} onChange={(event) => setSpent(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
      </div>
      <div className="fw-period-band">
        <FinanceField label="Início"><KeyboardInput required type="date" value={startDate} onChange={(event) => setStartDate(event.target.value as LocalDate)} /></FinanceField>
        <span><CalendarBlank size={18} /><i /></span>
        <FinanceField label="Fim"><KeyboardInput required type="date" value={endDate} onChange={(event) => setEndDate(event.target.value as LocalDate)} /></FinanceField>
      </div>
      <SegmentedButtons label="Situação" value={status} onChange={setStatus} options={[
        { value: "active", label: "Ativo" },
        { value: "paused", label: "Pausado" },
        { value: "closed", label: "Encerrado" },
      ]} />
      <FinanceField label="Regra ou observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="O que este envelope protege" /></FinanceField>
      <ComposerFeedback error={error} success={success} />
      <button className="fw-save" type="submit" disabled={saving || !label.trim() || !limit || !startDate || !endDate}><CheckCircle size={19} />{saving ? "Salvando…" : "Salvar orçamento"}</button>
    </form>
  );
}

function GoalComposer({ referenceDate, initialProvider, saving, actions, onComplete }: ComposerProps) {
  const [provider, setProvider] = useState<ListedFinanceProviderName>(initialProvider);
  const [label, setLabel] = useState("");
  const [target, setTarget] = useState("");
  const [accumulated, setAccumulated] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [status, setStatus] = useState<"active" | "achieved" | "paused" | "cancelled">("active");
  const [note, setNote] = useState("");
  const { error, success, submit } = useComposerSubmit(onComplete);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const saved = await submit(
      () =>
        actions.createFinanceGoal({
          provider: listedFinanceProvider(provider),
          label,
          targetAmountMinor: parseBRLMinorUnits(target),
          accumulatedAmountMinor: optionalMoney(accumulated),
          targetDate: optionalDate(targetDate),
          status,
          ...(note.trim() ? { note: note.trim() } : {}),
        }),
      "Meta financeira salva com alvo explícito.",
    );
    if (saved) {
      setLabel("");
      setTarget("");
      setAccumulated("");
      setTargetDate("");
      setNote("");
    }
  };

  return (
    <form className="fw-composer fw-composer--goal" onSubmit={(event) => void handleSubmit(event)}>
      <div className="fw-goal-head"><Target size={29} weight="duotone" /><span><small>Destino financeiro</small><strong>Alvo sem pressão automática</strong></span></div>
      <ProviderSelect value={provider} onChange={setProvider} />
      <FinanceField label="Nome da meta"><KeyboardInput required value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Ex.: reserva para setembro" /></FinanceField>
      <div className="fw-goal-steps">
        <FinanceField label="Já acumulado" hint="pode ficar desconhecido"><KeyboardInput inputMode="decimal" value={accumulated} onChange={(event) => setAccumulated(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
        <span><TrendUp size={18} /></span>
        <FinanceField label="Valor-alvo"><KeyboardInput required inputMode="decimal" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="R$ 0,00" /></FinanceField>
      </div>
      <FinanceField label="Data-alvo" hint="pode ficar desconhecida"><KeyboardInput type="date" value={targetDate} onChange={(event) => setTargetDate(event.target.value as LocalDate)} /></FinanceField>
      <SegmentedButtons label="Situação" value={status} onChange={setStatus} options={[
        { value: "active", label: "Ativa" },
        { value: "achieved", label: "Atingida" },
        { value: "paused", label: "Pausada" },
        { value: "cancelled", label: "Cancelada" },
      ]} />
      <FinanceField label="Motivo ou observação"><KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="O que esta meta torna possível" /></FinanceField>
      <ComposerFeedback error={error} success={success} />
      <button className="fw-save" type="submit" disabled={saving || !label.trim() || !target}><CheckCircle size={19} />{saving ? "Salvando…" : "Salvar meta"}</button>
    </form>
  );
}

function Composer({
  kind,
  referenceDate,
  initialProvider,
  saving,
  actions,
  onComplete,
  editingRecord,
}: ComposerProps & { kind: FinanceComposerKind }) {
  switch (kind) {
    case "transaction":
      return <TransactionComposer {...{ referenceDate, initialProvider, saving, actions, onComplete }} />;
    case "bill":
      return <BillComposer {...{ referenceDate, initialProvider, saving, actions, onComplete }} />;
    case "card":
      return <CardComposer {...{ referenceDate, initialProvider, saving, actions, onComplete, editingRecord }} />;
    case "debt":
      return <DebtComposer {...{ referenceDate, initialProvider, saving, actions, onComplete, editingRecord }} />;
    case "budget":
      return <BudgetComposer {...{ referenceDate, initialProvider, saving, actions, onComplete }} />;
    case "goal":
      return <GoalComposer {...{ referenceDate, initialProvider, saving, actions, onComplete }} />;
  }
}

export function FinanceWorkspace({
  currentLocalDate,
  onBack,
  onDataChange,
  onOpenSubscription,
  workspaceDataRevision = 0,
}: FinanceWorkspaceProps) {
  const keyboard = useKeyboard();
  const referenceDate = currentLocalDate ?? todayInTimeZone();
  const finance = useAgendaFinanceData(referenceDate, 30);
  const [composer, setComposer] = useState<FinanceComposerKind | null>(null);
  const [composerProvider, setComposerProvider] = useState<ListedFinanceProviderName>("Mercado Pago");
  const [editingRecord, setEditingRecord] = useState<FinanceRecordEntity | null>(null);
  const [accounts, setAccounts] = useState<FinanceAccountEntity[]>([]);
  const [accountEditorId, setAccountEditorId] = useState<string | null>(null);
  const [records, setRecords] = useState<FinanceWorkspaceRecord[]>([]);
  const [flowSummary, setFlowSummary] = useState<FinanceTransactionSummary | null>(null);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [recordFilter, setRecordFilter] = useState<FinanceRecordFilter>("all");
  const [showAllRecords, setShowAllRecords] = useState(false);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [subscriptionActionError, setSubscriptionActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [subscriptionEditor, setSubscriptionEditor] = useState<{
    recordId: string;
    status: FinanceSubscriptionStatus;
    justification: string;
  } | null>(null);
  const flowStart = shiftLocalDate(referenceDate, -29);

  const loadAllRecords = async () => {
    const [nextAccounts, next, subscriptions, nextSummary] = await Promise.all([
      finance.reads.listFinanceAccounts(),
      finance.reads.listFinanceRecords(),
      finance.reads.listFinanceSubscriptions(),
      finance.reads.getFinanceTransactionSummary({
        startLocalDate: flowStart,
        endLocalDate: referenceDate,
      }),
    ]);
    setAccounts(nextAccounts);
    setRecords([...next, ...subscriptions]);
    setFlowSummary(nextSummary);
    keyboard.hide();
    onDataChange?.();
  };

  useEffect(() => {
    let active = true;
    setRecordsLoading(true);
    Promise.all([
      finance.reads.listFinanceAccounts(),
      finance.reads.listFinanceRecords(),
      finance.reads.listFinanceSubscriptions(),
      finance.reads.getFinanceTransactionSummary({
        startLocalDate: flowStart,
        endLocalDate: referenceDate,
      }),
    ])
      .then(([nextAccounts, next, subscriptions, nextSummary]) => {
        if (active) {
          setAccounts(nextAccounts);
          setRecords([...next, ...subscriptions]);
          setFlowSummary(nextSummary);
        }
      })
      .catch(() => {
        if (active) {
          setAccounts([]);
          setRecords([]);
          setFlowSummary(null);
        }
      })
      .finally(() => {
        if (active) setRecordsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [finance.reads, finance.snapshot, flowStart, referenceDate, workspaceDataRevision]);

  const summary = flowSummary;
  const visibleDeadlines = useMemo(
    () => selectFinanceDeadlineRailItems(buildDeadlines(records), referenceDate, 6),
    [records, referenceDate],
  );
  const unknownDeadlineCount = records.filter((record) => {
    if (isSubscriptionRecord(record)) {
      const subscription = subscriptionDetails(record);
      const status = subscription?.status.state === "known"
        ? subscription.status.value
        : null;
      return (status === "active_confirmed" || status === "trial_confirmed") &&
        subscription?.renewalDate.state !== "known";
    }
    if (record.type === "financas.bill") {
      return !["paid", "cancelled"].includes(record.payload.status) && !knownValue(record.payload.dueDate);
    }
    if (record.type === "financas.debt") {
      return record.payload.status === "active" && !knownValue(record.payload.dueDate);
    }
    if (record.type === "financas.card") {
      return record.payload.status === "active" && !knownValue(record.payload.dueDate);
    }
    return false;
  }).length;
  const subscriptionReviewCount = records.filter((record) => {
    if (!isSubscriptionRecord(record)) return false;
    const status = subscriptionDetails(record)?.status;
    return status?.state !== "known" || status.value === "uncertain";
  }).length;

  const filteredRecords = useMemo(() => {
    const filtered = recordFilter === "all"
      ? records
      : records.filter((record) => recordFilterFor(record) === recordFilter);
    return [...filtered].sort((left, right) =>
      right.localDate === left.localDate
        ? right.updatedAt.localeCompare(left.updatedAt)
        : right.localDate.localeCompare(left.localDate),
    );
  }, [recordFilter, records]);
  const visibleRecords = showAllRecords ? filteredRecords : filteredRecords.slice(0, 7);

  const providerFacts = LISTED_FINANCE_PROVIDERS.map((name) => {
    const providerRecords = records.filter((record) => recordProviderName(record) === name);
    const nextDeadline = buildDeadlines(providerRecords).find((deadline) => deadline.date >= referenceDate) ?? null;
    const account = accounts.find((candidate) => candidate.payload.providerName === name) ?? null;
    return { name, count: providerRecords.length, nextDeadline, account };
  });
  const selectedAccount = accounts.find((account) => account.id === accountEditorId) ?? null;

  const transitionFinanceLifecycle = async (
    record: FinanceRecordEntity,
    action: RecordLifecycleAction,
  ) => {
    if (action.confirmation && !globalThis.confirm(action.confirmation)) return;
    setActionError(null);
    setActionNotice(null);
    setActionPendingId(record.id);
    try {
      switch (record.type) {
        case "financas.transaction": {
          if (action.target !== "posted" && action.target !== "voided") {
            throw new Error("A ação não corresponde a este movimento.");
          }
          await finance.actions.updateFinanceRecord({
            type: record.type,
            entityId: record.id,
            expectedRevision: record.revision,
            expectedStatus: record.payload.status,
            patch: { status: action.target },
          });
          break;
        }
        case "financas.bill": {
          if (!["due", "overdue", "paid", "cancelled"].includes(action.target)) {
            throw new Error("A ação não corresponde a esta conta.");
          }
          if (action.target === "paid") {
            await finance.actions.updateFinanceRecord({
              type: record.type,
              entityId: record.id,
              expectedRevision: record.revision,
              expectedStatus: record.payload.status,
              patch: {
                status: "paid",
                paidDate: known(referenceDate, "user", new Date().toISOString()),
              },
            });
          } else {
            const target = action.target as "due" | "overdue" | "cancelled";
            await finance.actions.updateFinanceRecord({
              type: record.type,
              entityId: record.id,
              expectedRevision: record.revision,
              expectedStatus: record.payload.status,
              patch: { status: target },
            });
          }
          break;
        }
        case "financas.debt": {
          if (!["active", "paid", "paused", "defaulted", "disputed"].includes(action.target)) {
            throw new Error("A ação não corresponde a esta dívida.");
          }
          const target = action.target as "active" | "paid" | "paused" | "defaulted" | "disputed";
          await finance.actions.updateFinanceRecord({
            type: record.type,
            entityId: record.id,
            expectedRevision: record.revision,
            expectedStatus: record.payload.status,
            patch: { status: target },
          });
          break;
        }
        case "financas.card": {
          if (!["active", "paused", "closed"].includes(action.target)) {
            throw new Error("A ação não corresponde a este cartão.");
          }
          const target = action.target as "active" | "paused" | "closed";
          await finance.actions.updateFinanceRecord({
            type: record.type,
            entityId: record.id,
            expectedRevision: record.revision,
            expectedStatus: record.payload.status,
            patch: { status: target },
          });
          break;
        }
        case "financas.budget": {
          if (!["active", "paused", "closed"].includes(action.target)) {
            throw new Error("A ação não corresponde a este orçamento.");
          }
          const target = action.target as "active" | "paused" | "closed";
          await finance.actions.updateFinanceRecord({
            type: record.type,
            entityId: record.id,
            expectedRevision: record.revision,
            expectedStatus: record.payload.status,
            patch: { status: target },
          });
          break;
        }
        case "financas.goal": {
          if (!["active", "achieved", "paused", "cancelled"].includes(action.target)) {
            throw new Error("A ação não corresponde a esta meta.");
          }
          const target = action.target as "active" | "achieved" | "paused" | "cancelled";
          await finance.actions.updateFinanceRecord({
            type: record.type,
            entityId: record.id,
            expectedRevision: record.revision,
            expectedStatus: record.payload.status,
            patch: { status: target },
          });
          break;
        }
      }
      await loadAllRecords();
      setActionNotice(
        `${recordTitle(record)}: ${action.label.toLowerCase()} registrado no mesmo histórico.`,
      );
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Não foi possível atualizar o registro financeiro.");
    } finally {
      setActionPendingId(null);
    }
  };

  const markBillPaid = async (record: FinanceWorkspaceRecord) => {
    if (record.type !== "financas.bill") return;
    const action = recordLifecycleActions(record).find(
      (candidate) => candidate.target === "paid",
    );
    if (action) await transitionFinanceLifecycle(record, action);
  };

  const beginSubscriptionEdit = (record: FinanceSubscriptionEntity) => {
    const currentStatus = subscriptionDetails(record)?.status;
    setSubscriptionActionError(null);
    setActionNotice(null);
    setSubscriptionEditor({
      recordId: record.id,
      status: currentStatus?.state === "known" ? currentStatus.value : "uncertain",
      justification: "",
    });
  };

  const saveSubscriptionStatus = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!subscriptionEditor) return;
    const record = records.find((candidate) => candidate.id === subscriptionEditor.recordId);
    if (!record || !isSubscriptionRecord(record)) {
      setSubscriptionActionError("A assinatura mudou ou deixou de estar disponível. Atualize a tela.");
      return;
    }
    const justification = subscriptionEditor.justification.trim();
    if (!justification) {
      setSubscriptionActionError("Informe o motivo ou a referência desta atualização.");
      return;
    }
    setSubscriptionActionError(null);
    setActionNotice(null);
    try {
      await finance.actions.updateFinanceSubscriptionStatus({
        entityId: record.id,
        expectedRevision: record.revision,
        status: subscriptionEditor.status,
        justification,
      });
      const timestamp = new Date().toISOString();
      setRecords((current) => current.map((candidate) => {
        if (!isSubscriptionRecord(candidate) || candidate.id !== record.id) return candidate;
        return {
          ...candidate,
          revision: candidate.revision + 1,
          updatedAt: timestamp,
          payload: {
            ...candidate.payload,
            subscription: {
              ...candidate.payload.subscription,
              status: known(subscriptionEditor.status, "user", timestamp),
            },
          },
        };
      }));
      setSubscriptionEditor(null);
      keyboard.hide();
      setActionNotice(`Situação de ${recordTitle(record)} atualizada sem criar outro registro.`);
      onDataChange?.();
    } catch (cause) {
      setSubscriptionActionError(cause instanceof Error ? cause.message : "Não foi possível atualizar a assinatura.");
    }
  };

  const summaryMoney = (knowledge: Knowledge<BRLMoney> | undefined) =>
    knowledge ? formatMoneyKnowledge(knowledge) : "carregando…";

  return (
    <main className="finance-workspace" data-testid="finance-workspace">
      {onBack ? <button type="button" className="fw-back" onClick={onBack}><ArrowLeft size={18} />Voltar</button> : null}

      <header className="fw-header">
        <span className="fw-header-icon"><Wallet size={28} weight="thin" /></span>
        <div>
          <p>Dinheiro também afeta o bem-estar</p>
          <h1>Finanças</h1>
          <span>Fluxo, compromissos e metas — sem senha bancária e sem saldo inventado.</span>
        </div>
      </header>

      <section className="fw-truth-banner" aria-label="Princípios do núcleo financeiro">
        <ShieldCheck size={22} weight="duotone" />
        <p><strong>Você confirma; o Mentor organiza.</strong><span>Mercado Pago, Banco do Brasil e PicPay entram apenas como instituições. Nenhum saldo é consultado ou inferido.</span></p>
      </section>

      <section className="fw-provider-section" aria-labelledby="fw-provider-title">
        <div className="fw-section-heading">
          <Bank size={22} weight="thin" />
          <div><h2 id="fw-provider-title">Suas instituições</h2><p>Fatos registrados e próximo compromisso conhecido.</p></div>
        </div>
        <div className="fw-provider-list">
          {providerFacts.map((provider) => (
            <button
              type="button"
              key={provider.name}
              aria-expanded={provider.account?.id === accountEditorId}
              onClick={() => {
                setComposerProvider(provider.name);
                setComposer(null);
                setEditingRecord(null);
                setAccountEditorId((current) =>
                  provider.account && current !== provider.account.id
                    ? provider.account.id
                    : null
                );
              }}
            >
              <span className="fw-provider-mark"><CreditCard size={23} weight="thin" /></span>
              <span><strong>{provider.name}</strong><small>{provider.account ? formatMoneyKnowledge(provider.account.payload.balance) : "conta não carregada"} · {provider.count ? `${provider.count} fato${provider.count === 1 ? "" : "s"}` : "nenhum fato"}</small></span>
              <em>{provider.nextDeadline ? `${formatDate(provider.nextDeadline.date)} · ${provider.nextDeadline.amount}` : "sem vencimento conhecido"}</em>
              <CaretDown size={17} />
            </button>
          ))}
        </div>
        {selectedAccount ? <AccountEditor
          key={`${selectedAccount.id}-${selectedAccount.revision}`}
          account={selectedAccount}
          saving={finance.saving}
          actions={finance.actions}
          onComplete={loadAllRecords}
          onNewTransaction={() => {
            setComposerProvider(selectedAccount.payload.providerName);
            setAccountEditorId(null);
            setEditingRecord(null);
            setComposer("transaction");
          }}
        /> : null}
      </section>

      <section className="fw-flow" aria-labelledby="fw-flow-title">
        <header>
          <div><p>Janela explícita</p><h2 id="fw-flow-title">Fluxo dos últimos 30 dias</h2><span>{formatDate(flowStart)} — {formatDate(referenceDate)}</span></div>
          <ChartLineUp size={28} weight="thin" />
        </header>
        <dl>
          <div data-tone="positive"><dt><TrendUp size={16} />Entradas</dt><dd>{summaryMoney(summary?.income)}</dd><small>{summary?.income.state === "known" ? "somente confirmadas" : "ainda não informadas"}</small></div>
          <div data-tone="negative"><dt><TrendDown size={16} />Saídas</dt><dd>{summaryMoney(summary?.expense)}</dd><small>{summary?.expense.state === "known" ? "somente confirmadas" : "ainda não informadas"}</small></div>
          <div data-tone="net"><dt><Coins size={16} />Fluxo líquido</dt><dd>{summaryMoney(summary?.net)}</dd><small>{summary?.net.state === "known" ? "entradas − saídas" : "exige os dois lados"}</small></div>
        </dl>
        <p className="fw-flow-note"><Info size={15} />Fluxo líquido não é saldo bancário. Um lado ausente permanece desconhecido, nunca vira zero.</p>
      </section>

      <section className="fw-section" aria-labelledby="fw-deadlines-title">
        <div className="fw-section-heading">
          <ClockCountdown size={22} weight="thin" />
          <div><h2 id="fw-deadlines-title">Vencimentos e renovações</h2><p>Compromissos ativos dos últimos 30 dias e dos próximos 30; os anteriores seguem no histórico.</p></div>
        </div>
        {visibleDeadlines.length ? (
          <div className="fw-deadline-list">
            {visibleDeadlines.map((deadline) => (
              <article key={deadline.id} data-tone={deadline.tone}>
                <time dateTime={deadline.date}><strong>{formatDate(deadline.date)}</strong><small>{dueDistanceLabel(deadline.date, referenceDate, deadline.kind)}</small></time>
                <span className="fw-deadline-node" />
                <div><small>{deadline.provider}</small><strong>{deadline.label}</strong><span>{deadline.amount}</span>{deadline.note ? <span className="fw-deadline-note">{deadline.note}</span> : null}</div>
                {isBillRecord(deadline.record) ? <button type="button" disabled={finance.saving || actionPendingId !== null} onClick={() => void markBillPaid(deadline.record)}><Check size={15} />Paga hoje</button> : null}
              </article>
            ))}
          </div>
        ) : (
          <div className="fw-empty"><CalendarBlank size={26} weight="thin" /><p><strong>Nenhum vencimento ou renovação conhecido nesta janela.</strong><span>Isso não significa que não exista: registre uma data quando você puder confirmar.</span></p></div>
        )}
        {unknownDeadlineCount ? <p className="fw-unknown-dates"><Warning size={15} />{unknownDeadlineCount} compromisso{unknownDeadlineCount === 1 ? "" : "s"} ou teste{unknownDeadlineCount === 1 ? "" : "s"} sem data informada.</p> : null}
        {subscriptionReviewCount ? <p className="fw-unknown-dates"><Info size={15} />{subscriptionReviewCount} assinatura{subscriptionReviewCount === 1 ? "" : "ões"} com situação a conferir; nenhuma delas entra como obrigação.</p> : null}
        {actionError ? <p className="fw-action-error" role="alert"><Warning size={15} />{actionError}</p> : null}
      </section>

      <section className="fw-section" aria-labelledby="fw-register-title">
        <div className="fw-section-heading">
          <Plus size={22} weight="thin" />
          <div><h2 id="fw-register-title">Registrar um fato</h2><p>Cada tipo abre uma calculadora própria; campos vazios continuam desconhecidos.</p></div>
        </div>
        <div className="fw-composer-picker">
          {COMPOSER_ITEMS.map((item) => {
            const ItemIcon = item.icon;
            const active = composer === item.id;
            return <button type="button" key={item.id} aria-pressed={active} onClick={() => {
              setAccountEditorId(null);
              setEditingRecord(null);
              setComposer(active ? null : item.id);
            }}><ItemIcon size={22} weight={active ? "duotone" : "thin"} /><span><strong>{item.label}</strong><small>{item.hint}</small></span><CaretDown size={16} /></button>;
          })}
        </div>
        {onOpenSubscription ? (
          <button type="button" className="fw-supplemental" onClick={onOpenSubscription}>
            <Receipt size={21} weight="duotone" />
            <span><strong>Assinatura recorrente</strong><small>serviço, preço, periodicidade, renovação e situação</small></span>
            <CaretRight size={16} />
          </button>
        ) : null}
        {composer ? (
          <div className="fw-composer-stage" id="fw-composer-stage">
            <Composer key={`${composer}-${composerProvider}-${editingRecord?.id ?? "new"}-${editingRecord?.revision ?? 0}`} kind={composer} referenceDate={referenceDate} initialProvider={composerProvider} saving={finance.saving} actions={finance.actions} onComplete={loadAllRecords} editingRecord={editingRecord} />
            <button type="button" className="fw-close-composer" onClick={() => { setComposer(null); setEditingRecord(null); }}>Fechar formulário</button>
          </div>
        ) : null}
      </section>

      <section className="fw-section" aria-labelledby="fw-history-title">
        <div className="fw-section-heading">
          <Wallet size={22} weight="thin" />
          <div><h2 id="fw-history-title">Histórico financeiro</h2><p>Fatos guardados; a ordem não altera o registro original.</p></div>
        </div>
        <Carousel className="fw-filter-strip" contentClassName="fw-filter-strip__track" ariaLabel="Filtrar histórico financeiro">
          {RECORD_FILTERS.map((filter) => <button type="button" key={filter.id} aria-pressed={recordFilter === filter.id} onClick={() => { setRecordFilter(filter.id); setShowAllRecords(false); }}>{filter.label}</button>)}
        </Carousel>
        {actionNotice ? <p className="fw-action-notice" role="status"><CheckCircle size={15} />{actionNotice}</p> : null}
        {recordsLoading || finance.loading ? <p className="fw-loading" role="status">Lendo registros deste iPhone…</p> : visibleRecords.length ? (
          <div className="fw-record-list">
            {visibleRecords.map((record) => {
              const RecordIcon = recordIcon(record);
              const mainDate = recordMainDate(record);
              const editingSubscription = isSubscriptionRecord(record) && subscriptionEditor?.recordId === record.id;
              const lifecycleRecord = isSubscriptionRecord(record) ? null : record;
              const lifecycleActions = lifecycleRecord
                ? recordLifecycleActions(lifecycleRecord)
                : [];
              return <article key={record.id}>
                <span className="fw-record-icon"><RecordIcon size={21} weight="thin" /></span>
                <div><small>{recordTypeLabel(record)} · {recordProviderName(record)}</small><strong>{recordTitle(record)}</strong><span>{mainDate ? formatDate(mainDate) : "data não informada"} · {statusLabel(record)}</span></div>
                <em>{recordAmount(record)}</em>
                {lifecycleActions.length ? <div
                  role="group"
                  aria-label={`Atualizar situação de ${recordTitle(record)}`}
                  aria-busy={actionPendingId === record.id}
                  style={LIFECYCLE_ACTION_GROUP_STYLE}
                >{lifecycleActions.map((action) => <button
                  key={action.target}
                  type="button"
                  disabled={finance.saving || actionPendingId !== null}
                  style={LIFECYCLE_ACTION_STYLE}
                  onClick={() => lifecycleRecord && void transitionFinanceLifecycle(lifecycleRecord, action)}
                >{actionPendingId === record.id ? "Salvando…" : action.label}</button>)}</div> : null}
                {lifecycleRecord && (lifecycleRecord.type === "financas.card" || lifecycleRecord.type === "financas.debt") ? <button
                  type="button"
                  className="fw-record-manage"
                  aria-expanded={editingRecord?.id === lifecycleRecord.id}
                  onClick={() => {
                    if (editingRecord?.id === lifecycleRecord.id) {
                      setEditingRecord(null);
                      setComposer(null);
                      return;
                    }
                    setAccountEditorId(null);
                    setEditingRecord(lifecycleRecord);
                    if (lifecycleRecord.payload.provider.kind === "listed") {
                      setComposerProvider(lifecycleRecord.payload.provider.name);
                    }
                    setComposer(lifecycleRecord.type === "financas.card" ? "card" : "debt");
                    globalThis.setTimeout(() => {
                      document.getElementById("fw-composer-stage")?.scrollIntoView({
                        behavior: "smooth",
                        block: "start",
                      });
                    }, 0);
                  }}
                >{editingRecord?.id === lifecycleRecord.id ? "Fechar atualização" : "Atualizar retrato"}</button> : null}
                {isSubscriptionRecord(record) ? <button
                  type="button"
                  className="fw-record-manage"
                  aria-expanded={editingSubscription}
                  aria-controls={`subscription-editor-${record.id}`}
                  onClick={() => {
                    if (editingSubscription) {
                      keyboard.hide();
                      setSubscriptionEditor(null);
                      setSubscriptionActionError(null);
                    } else {
                      beginSubscriptionEdit(record);
                    }
                  }}
                >{editingSubscription ? "Fechar atualização" : "Atualizar situação"}</button> : null}
                {editingSubscription && subscriptionEditor ? <form
                  id={`subscription-editor-${record.id}`}
                  className="fw-subscription-editor"
                  aria-busy={finance.saving}
                  onSubmit={(event) => void saveSubscriptionStatus(event)}
                >
                  <p className="fw-subscription-charge">{formatSubscriptionPriceAndCadence(record)}</p>
                  <fieldset>
                    <legend>Nova situação de {recordTitle(record)}</legend>
                    <div className="fw-subscription-statuses">
                      {SUBSCRIPTION_STATUS_OPTIONS.map((option) => <button
                        key={option.value}
                        type="button"
                        aria-pressed={subscriptionEditor.status === option.value}
                        onClick={() => setSubscriptionEditor((current) => current ? { ...current, status: option.value } : current)}
                      ><strong>{option.label}</strong><small>{option.detail}</small></button>)}
                    </div>
                  </fieldset>
                  <label className="fw-subscription-justification">
                    <span>Motivo ou referência da atualização</span>
                    <KeyboardTextarea
                      value={subscriptionEditor.justification}
                      onChange={(event) => setSubscriptionEditor((current) => current ? { ...current, justification: event.target.value } : current)}
                      placeholder="Ex.: confirmei no aplicativo do fornecedor hoje"
                    />
                  </label>
                  <p className="fw-subscription-boundary"><Info size={15} />O Mentor só atualiza seu registro. “Registrar como cancelada” não cancela nem altera a assinatura no fornecedor.</p>
                  {subscriptionActionError ? <p className="fw-action-error" role="alert"><Warning size={15} />{subscriptionActionError}</p> : null}
                  <div className="fw-subscription-actions">
                    <button type="button" onClick={() => { keyboard.hide(); setSubscriptionEditor(null); setSubscriptionActionError(null); }}>Manter como está</button>
                    <button type="submit" disabled={finance.saving || !subscriptionEditor.justification.trim()}>{subscriptionEditor.status === "cancelled_confirmed" ? "Registrar como cancelada" : "Salvar situação no Mentor"}</button>
                  </div>
                </form> : null}
              </article>;
            })}
          </div>
        ) : <div className="fw-empty"><Wallet size={26} weight="thin" /><p><strong>Nenhum fato neste filtro.</strong><span>Registrar um fato cria histórico; não precisamos completar lacunas.</span></p></div>}
        {filteredRecords.length > 7 ? <button type="button" className="fw-show-all" onClick={() => setShowAllRecords((current) => !current)}>{showAllRecords ? "Mostrar menos" : `Mostrar todos (${filteredRecords.length})`}</button> : null}
      </section>

      <aside className="fw-privacy-note"><LockKey size={20} weight="thin" /><p><strong>Privado e sem poder de movimentação.</strong><span>Não digite senha, CVV, token, número completo do cartão ou credenciais. O Mentor não paga, transfere, contrata crédito ou acessa os bancos.</span></p></aside>

      {finance.error ? <p className="fw-global-error" role="alert"><Warning size={16} />{finance.error.message}</p> : null}
    </main>
  );
}

export default FinanceWorkspace;
