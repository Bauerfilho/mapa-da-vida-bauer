import { EarlyPregnancyReference } from "./ClinicalToolsWorkspace";
import { Baby } from "@phosphor-icons/react/dist/csr/Baby";
import { Calculator } from "@phosphor-icons/react/dist/csr/Calculator";
import { CalendarBlank } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { Drop } from "@phosphor-icons/react/dist/csr/Drop";
import { Heartbeat } from "@phosphor-icons/react/dist/csr/Heartbeat";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { Stethoscope } from "@phosphor-icons/react/dist/csr/Stethoscope";
import { Trash } from "@phosphor-icons/react/dist/csr/Trash";
import { Warning } from "@phosphor-icons/react/dist/csr/Warning";
import type { Icon } from "@phosphor-icons/react";
import { Fragment, useState, type FormEvent, type ReactNode } from "react";
import { KeyboardInput, useKeyboard, BottomSheet } from "../mobile";
import {
  calculateApgar,
  calculateArtDating,
  calculateGestationalAgeFromLmp,
  calculateGestationalAgeFromUltrasound,
  calculateMaternalShockIndex,
  calculateQuantifiedBloodLoss,
  comparePregnancyDating,
  ObstetricCalculationError,
  type ApgarAssessmentMinute,
  type ApgarComponentScore,
  type ApgarResult,
  type ArtDatingMethod,
  type MaternalShockIndexResult,
  type PregnancyDatingComparisonResult,
  type PregnancyDatingResult,
  type QuantifiedBloodLossResult,
  type LocalDate,
} from "../domain";
import "./obstetrics-workspace.css";

type CalculatorMode =
  | "lmp"
  | "ultrasound"
  | "comparison"
  | "art"
  | "qbl"
  | "shock-index"
  | "apgar";

interface CalculatorMeta {
  id: CalculatorMode;
  label: string;
  shortLabel: string;
  description: string;
  icon: Icon;
  group: "dating" | "bedside";
}

const CALCULATORS: readonly CalculatorMeta[] = [
  { id: "lmp", label: "IG e DPP pela DUM", shortLabel: "DUM", description: "Idade gestacional na data escolhida e data provável do parto.", icon: CalendarBlank, group: "dating" },
  { id: "ultrasound", label: "IG e DPP pela USG", shortLabel: "USG", description: "Atualiza a IG informada no laudo a partir da data do exame.", icon: Stethoscope, group: "dating" },
  { id: "comparison", label: "Comparar datações", shortLabel: "DUM × USG", description: "Expõe a divergência e o limiar ACOG sem redefinir a DPP.", icon: Calculator, group: "dating" },
  { id: "art", label: "Reprodução assistida e marcos", shortLabel: "ART + marcos", description: "Datação por concepção ou transferência embrionária e calendário do termo.", icon: Sparkle, group: "dating" },
  { id: "qbl", label: "Perda sanguínea quantitativa", shortLabel: "Perda sanguínea", description: "Soma volumes e pesos com as incertezas explicitadas.", icon: Drop, group: "bedside" },
  { id: "shock-index", label: "Índice de choque materno", shortLabel: "Índice de choque", description: "Relação FC/PAS como apoio ao acionamento do protocolo local.", icon: Heartbeat, group: "bedside" },
  { id: "apgar", label: "Apgar", shortLabel: "Apgar", description: "Registro estruturado dos cinco componentes, sem atrasar reanimação.", icon: Baby, group: "bedside" },
] as const;

const TRIMESTER_LABELS: Record<PregnancyDatingResult["trimester"], string> = {
  first: "1º trimestre",
  second: "2º trimestre",
  third: "3º trimestre",
};

function localDate(value: string): LocalDate {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed as LocalDate;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(trimmed);
  if (!match) return trimmed as LocalDate;
  return `${match[3]}-${match[2]}-${match[1]}` as LocalDate;
}

function dateInputValue(value: LocalDate): string {
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function dateInputDraft(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return dateInputValue(trimmed as LocalDate);
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function optionalNumber(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  return normalized === "" ? null : Number(normalized);
}

function requiredNumber(value: string): number {
  const normalized = value.trim().replace(",", ".");
  return normalized === "" ? Number.NaN : Number(normalized);
}

function formatMeasurement(value: number): string {
  return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
}

function formatLocalDate(value: LocalDate): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day))).replace(/\./g, "");
}

function formatGestationalAge(result: PregnancyDatingResult): string {
  return `${result.gestationalAge.weeks} sem ${result.gestationalAge.days} d`;
}

function friendlyError(error: unknown): string {
  if (!(error instanceof ObstetricCalculationError)) {
    return "Não foi possível concluir este cálculo. Revise os valores informados.";
  }
  if (error.code === "invalid_date") return "Informe uma data civil válida.";
  if (error.code === "negative_gestational_age") return "A data de referência não pode anteceder a data-base do cálculo.";
  if (error.code === "source_date_after_reference") return "A data da USG não pode ser posterior à data escolhida para atualizar a IG.";
  if (error.code === "art_event_after_reference") return "A data do procedimento não pode ser posterior à data escolhida para calcular a IG.";
  if (error.code === "gestational_age_out_of_range") return "A idade gestacional informada no exame está fora da faixa aceita. Revise semanas e dias.";
  if (error.code === "invalid_measurement") return "Há uma medida incompatível: tara/fluidos não sanguíneos não podem superar o valor total.";
  if (error.code === "incomplete_input") return "Informe ao menos uma medida para calcular.";
  if (error.field === "gestationalDays" || error.field === "ultrasoundDays") return "Os dias da idade gestacional devem ser um inteiro de 0 a 6.";
  return "Revise os campos: use somente números válidos, inteiros quando indicado e dentro da faixa esperada.";
}

function CalculatorField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="ob-field"><span>{label}{hint ? <small>{hint}</small> : null}</span>{children}</label>;
}

function FormMessage({ error }: { error: string | null }) {
  return error ? <p className="ob-form-error" role="alert"><Warning size={17} weight="fill" />{error}</p> : null;
}

function DatingResult({ result, basisLabel }: { result: PregnancyDatingResult; basisLabel: string }) {
  const historical = result.isBeyond45Weeks6Days;
  const artBasis = result.basis.startsWith("art_");
  return <section className="ob-result" role="status" aria-live="polite" data-warning={historical || undefined}>
    <header><div><small>IG em {formatLocalDate(result.referenceDate)}</small><strong>{formatGestationalAge(result)}</strong></div><CalendarBlank size={26} weight="thin" /></header>
    <dl>
      <div><dt>DPP</dt><dd>{formatLocalDate(result.estimatedDueDate)}</dd></div>
      <div><dt>{basisLabel}</dt><dd>{formatLocalDate(result.estimatedLmp)}</dd></div>
      {historical ? <div><dt>Contexto</dt><dd>provável registro histórico</dd></div> : <div><dt>Fase</dt><dd>{TRIMESTER_LABELS[result.trimester]}</dd></div>}
    </dl>
    <p><Info size={15} />{artBasis ? `Data equivalente de concepção: ${formatLocalDate(result.estimatedConceptionDate)}. Na reprodução assistida, esta base tem precedência sobre DUM e redatação por USG.` : `Concepção estimada: ${formatLocalDate(result.estimatedConceptionDate)}. É uma aproximação de datação, não um fato observado.`}</p>
    {historical ? <p className="ob-result-warning"><Warning size={16} weight="fill" />IG acima de 45 semanas: provável registro histórico ou gestação já encerrada. Confirme as datas.</p> : null}
    {!historical && result.gestationalAge.weeks < 14 ? <EarlyPregnancyReference /> : null}
  </section>;
}

function FormActions({ onClear, submitLabel = "Calcular" }: { onClear: () => void; submitLabel?: string }) {
  const keyboard = useKeyboard();
  return <div className="ob-form-actions"><button type="button" onClick={() => { keyboard.hide(); onClear(); }}><Trash size={16} />Limpar</button><button type="submit" onClick={() => keyboard.hide()}><Calculator size={17} />{submitLabel}</button></div>;
}

function LmpCalculator({ referenceDate }: { referenceDate: LocalDate }) {
  const keyboard = useKeyboard();
  const [lmp, setLmp] = useState("");
  const [reference, setReference] = useState(dateInputValue(referenceDate));
  const [reliability, setReliability] = useState<"reliable" | "uncertain" | "">("");
  const [result, setResult] = useState<PregnancyDatingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keyboard.hide();
    if (!reliability) { setResult(null); setError("Informe se a DUM é confiável ou incerta."); return; }
    try { setResult(calculateGestationalAgeFromLmp({ lmp: localDate(lmp), referenceDate: localDate(reference) })); setError(null); }
    catch (caught) { setResult(null); setError(friendlyError(caught)); }
  };
  const clear = () => { setLmp(""); setReference(dateInputValue(referenceDate)); setReliability(""); setResult(null); setError(null); };
  return <form className="ob-calculator-form" onSubmit={submit} noValidate data-testid="calculator-lmp">
    <div className="ob-field-grid"><CalculatorField label="Primeiro dia da DUM"><KeyboardInput aria-label="Primeiro dia da DUM" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={lmp} onChange={(event) => setLmp(dateInputDraft(event.target.value))} required /></CalculatorField><CalculatorField label="Calcular IG em"><KeyboardInput aria-label="Calcular IG em" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={reference} onChange={(event) => setReference(dateInputDraft(event.target.value))} required /></CalculatorField></div>
    <fieldset className="ob-choice"><legend>Confiabilidade da DUM</legend><div><button type="button" aria-pressed={reliability === "reliable"} onClick={() => setReliability("reliable")}>{reliability === "reliable" ? <Check size={14} /> : null}Confiável</button><button type="button" aria-pressed={reliability === "uncertain"} onClick={() => setReliability("uncertain")}>{reliability === "uncertain" ? <Check size={14} /> : null}Incerta</button></div></fieldset>
    {reliability === "uncertain" ? <p className="ob-inline-note"><Info size={15} />DUM incerta reduz a confiabilidade desta estimativa; priorize a melhor datação obstétrica documentada.</p> : null}
    <FormMessage error={error} /><FormActions onClear={clear} />
    {result ? <DatingResult result={result} basisLabel="DUM" /> : null}
  </form>;
}

function UltrasoundCalculator({ referenceDate }: { referenceDate: LocalDate }) {
  const keyboard = useKeyboard();
  const [examinationDate, setExaminationDate] = useState("");
  const [weeks, setWeeks] = useState("");
  const [days, setDays] = useState("");
  const [reference, setReference] = useState(dateInputValue(referenceDate));
  const [result, setResult] = useState<PregnancyDatingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keyboard.hide();
    try {
      setResult(calculateGestationalAgeFromUltrasound({ examinationDate: localDate(examinationDate), gestationalWeeks: requiredNumber(weeks), gestationalDays: requiredNumber(days), referenceDate: localDate(reference) }));
      setError(null);
    } catch (caught) { setResult(null); setError(friendlyError(caught)); }
  };
  const clear = () => { setExaminationDate(""); setWeeks(""); setDays(""); setReference(dateInputValue(referenceDate)); setResult(null); setError(null); };
  return <form className="ob-calculator-form" onSubmit={submit} noValidate data-testid="calculator-ultrasound">
    <CalculatorField label="Data da USG"><KeyboardInput aria-label="Data da USG" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={examinationDate} onChange={(event) => setExaminationDate(dateInputDraft(event.target.value))} required /></CalculatorField>
    <div className="ob-field-grid"><CalculatorField label="IG no laudo" hint="semanas"><KeyboardInput aria-label="Semanas na USG" inputMode="numeric" value={weeks} onChange={(event) => setWeeks(event.target.value)} placeholder="12" required /></CalculatorField><CalculatorField label="Dias" hint="0 a 6"><KeyboardInput aria-label="Dias na USG" inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} placeholder="3" required /></CalculatorField></div>
    <CalculatorField label="Atualizar IG para"><KeyboardInput aria-label="Atualizar IG para" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={reference} onChange={(event) => setReference(dateInputDraft(event.target.value))} required /></CalculatorField>
    <p className="ob-inline-note"><Info size={15} />Use a IG já emitida no laudo; não recalcule biometria manualmente.</p>
    <FormMessage error={error} /><FormActions onClear={clear} />
    {result ? <DatingResult result={result} basisLabel="DUM estimada" /> : null}
  </form>;
}

function ComparisonCalculator() {
  const keyboard = useKeyboard();
  const [lmp, setLmp] = useState("");
  const [examinationDate, setExaminationDate] = useState("");
  const [weeks, setWeeks] = useState("");
  const [days, setDays] = useState("");
  const [reliability, setReliability] = useState<"reliable" | "uncertain" | "">("");
  const [result, setResult] = useState<PregnancyDatingComparisonResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keyboard.hide();
    if (!reliability) { setResult(null); setError("Informe se a DUM é confiável ou incerta."); return; }
    try {
      setResult(comparePregnancyDating({ lmp: localDate(lmp), examinationDate: localDate(examinationDate), ultrasoundWeeks: requiredNumber(weeks), ultrasoundDays: requiredNumber(days) }));
      setError(null);
    } catch (caught) { setResult(null); setError(friendlyError(caught)); }
  };
  const clear = () => { setLmp(""); setExaminationDate(""); setWeeks(""); setDays(""); setReliability(""); setResult(null); setError(null); };
  const canApplyAcogTable = reliability === "reliable";
  const decisionLabel = !result ? "" : !canApplyAcogTable ? "DUM incerta: diferença apenas descritiva; a tabela de redatação não é aplicável." : result.exceedsRedatingThreshold ? "Ultrapassa o limiar e apoia revisão clínica da DPP." : "Não ultrapassa o limiar desta faixa.";
  return <form className="ob-calculator-form" onSubmit={submit} noValidate data-testid="calculator-comparison">
    <div className="ob-field-grid"><CalculatorField label="DUM"><KeyboardInput aria-label="DUM para comparação" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={lmp} onChange={(event) => setLmp(dateInputDraft(event.target.value))} required /></CalculatorField><CalculatorField label="Data da USG"><KeyboardInput aria-label="Data da USG para comparação" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={examinationDate} onChange={(event) => setExaminationDate(dateInputDraft(event.target.value))} required /></CalculatorField></div>
    <div className="ob-field-grid"><CalculatorField label="IG na USG" hint="semanas"><KeyboardInput aria-label="Semanas para comparação" inputMode="numeric" value={weeks} onChange={(event) => setWeeks(event.target.value)} required /></CalculatorField><CalculatorField label="Dias" hint="0 a 6"><KeyboardInput aria-label="Dias para comparação" inputMode="numeric" value={days} onChange={(event) => setDays(event.target.value)} required /></CalculatorField></div>
    <fieldset className="ob-choice"><legend>A DUM é confiável?</legend><div><button type="button" aria-pressed={reliability === "reliable"} onClick={() => setReliability("reliable")}>{reliability === "reliable" ? <Check size={14} /> : null}Sim</button><button type="button" aria-pressed={reliability === "uncertain"} onClick={() => setReliability("uncertain")}>{reliability === "uncertain" ? <Check size={14} /> : null}Incerta / não</button></div></fieldset>
    <FormMessage error={error} /><FormActions onClear={clear} submitLabel="Comparar" />
    {result ? <section className="ob-result ob-comparison-result" role="status" aria-live="polite" data-warning={(!canApplyAcogTable || result.exceedsRedatingThreshold) || undefined}>
      <header><div><small>Diferença absoluta</small><strong>{result.absoluteDifferenceDays} dia{result.absoluteDifferenceDays === 1 ? "" : "s"}</strong></div><Calculator size={26} weight="thin" /></header>
      <dl>{canApplyAcogTable ? <><div><dt>Limiar ACOG</dt><dd>&gt; {result.discrepancyThresholdDays} dias</dd></div><div><dt>Resultado</dt><dd>{result.exceedsRedatingThreshold ? "ultrapassa" : "não ultrapassa"}</dd></div></> : <div><dt>Tabela ACOG</dt><dd>não aplicável</dd></div>}<div><dt>DPP pela DUM</dt><dd>{formatLocalDate(result.lmpEstimatedDueDate)}</dd></div><div><dt>DPP pela USG</dt><dd>{formatLocalDate(result.ultrasoundEstimatedDueDate)}</dd></div></dl>
      <p className="ob-decision"><Warning size={16} weight={canApplyAcogTable && result.exceedsRedatingThreshold ? "fill" : "regular"} />{decisionLabel}</p>
      {result.lmpGestationalAgeAtExamination.totalDays >= 28 * 7 ? <p className="ob-result-warning"><Warning size={16} weight="fill" />USG de 3º trimestre é a menos precisa; a divergência pode refletir alteração do crescimento. Não redatar automaticamente.</p> : null}
      <p><Info size={15} />Política {result.policy.id}. A DPP já estabelecida só deve mudar em circunstâncias raras, justificadas e documentadas.</p>
    </section> : null}
  </form>;
}

function ArtCalculator({ referenceDate }: { referenceDate: LocalDate }) {
  const keyboard = useKeyboard();
  const [method, setMethod] = useState<ArtDatingMethod | "">("");
  const [procedureDate, setProcedureDate] = useState("");
  const [reference, setReference] = useState(dateInputValue(referenceDate));
  const [result, setResult] = useState<PregnancyDatingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keyboard.hide();
    if (!method) { setResult(null); setError("Escolha o método/data-base da reprodução assistida."); return; }
    try { setResult(calculateArtDating({ method, procedureDate: localDate(procedureDate), referenceDate: localDate(reference) })); setError(null); }
    catch (caught) { setResult(null); setError(friendlyError(caught)); }
  };
  const clear = () => { setMethod(""); setProcedureDate(""); setReference(dateInputValue(referenceDate)); setResult(null); setError(null); };
  const milestones = result?.milestones.filter(({ id }) => ["early_term", "full_term", "estimated_due_date", "late_term"].includes(id)) ?? [];
  return <form className="ob-calculator-form" onSubmit={submit} noValidate data-testid="calculator-art">
    <fieldset className="ob-choice ob-choice-stack"><legend>Data-base confirmada</legend><div><button type="button" aria-pressed={method === "conception"} onClick={() => setMethod("conception")}>{method === "conception" ? <Check size={14} /> : null}Concepção / ovulação / coleta</button><button type="button" aria-pressed={method === "embryo_transfer_day_3"} onClick={() => setMethod("embryo_transfer_day_3")}>{method === "embryo_transfer_day_3" ? <Check size={14} /> : null}Transferência D3</button><button type="button" aria-pressed={method === "embryo_transfer_day_5"} onClick={() => setMethod("embryo_transfer_day_5")}>{method === "embryo_transfer_day_5" ? <Check size={14} /> : null}Transferência D5</button></div></fieldset>
    <div className="ob-field-grid"><CalculatorField label="Data do procedimento"><KeyboardInput aria-label="Data do procedimento" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={procedureDate} onChange={(event) => setProcedureDate(dateInputDraft(event.target.value))} required /></CalculatorField><CalculatorField label="Calcular IG em"><KeyboardInput aria-label="Calcular IG da reprodução assistida em" inputMode="numeric" maxLength={10} placeholder="DD/MM/AAAA" value={reference} onChange={(event) => setReference(dateInputDraft(event.target.value))} required /></CalculatorField></div>
    <FormMessage error={error} /><FormActions onClear={clear} />
    {result ? <><DatingResult result={result} basisLabel="DUM equivalente" /><section className="ob-milestones" aria-label="Marcos da gestação"><h3><ClockCounterClockwise size={18} />Calendário do termo</h3>{milestones.map((milestone) => <div key={milestone.id}><span>{milestone.gestationalAge.weeks}+{milestone.gestationalAge.days}</span><strong>{formatLocalDate(milestone.date)}</strong></div>)}</section></> : null}
  </form>;
}

interface MaterialDraft { id: number; wet: string; dry: string }

function QblCalculator() {
  const keyboard = useKeyboard();
  const [collector, setCollector] = useState("");
  const [nonBloodFluid, setNonBloodFluid] = useState("");
  const [materials, setMaterials] = useState<MaterialDraft[]>([{ id: 1, wet: "", dry: "" }]);
  const [result, setResult] = useState<QuantifiedBloodLossResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keyboard.hide();
    const hasAnyValue = [collector, nonBloodFluid, ...materials.flatMap((item) => [item.wet, item.dry])].some((value) => value.trim() !== "");
    if (!hasAnyValue) { setResult(null); setError("Informe ao menos um volume ou peso; vazio não será tratado como zero."); return; }
    try {
      const containers = collector.trim() !== "" || nonBloodFluid.trim() !== "" ? [{ label: "Coletor", collectedFluidMl: optionalNumber(collector), nonBloodFluidMl: optionalNumber(nonBloodFluid) }] : [];
      const usedMaterials = materials.filter((item) => item.wet.trim() !== "" || item.dry.trim() !== "");
      setResult(calculateQuantifiedBloodLoss({ containers, materials: usedMaterials.map((item, index) => ({ label: `Material ${index + 1}`, wetWeightGrams: optionalNumber(item.wet), dryWeightGrams: optionalNumber(item.dry) })) }));
      setError(null);
    } catch (caught) { setResult(null); setError(friendlyError(caught)); }
  };
  const clear = () => { setCollector(""); setNonBloodFluid(""); setMaterials([{ id: 1, wet: "", dry: "" }]); setResult(null); setError(null); };
  const updateMaterial = (id: number, patch: Partial<MaterialDraft>) => setMaterials((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  return <form className="ob-calculator-form" onSubmit={submit} noValidate data-testid="calculator-qbl">
    <section className="ob-measure-section"><header><Drop size={19} /><div><h3>Coletor</h3><p>Desconte líquido amniótico/irrigação apenas quando conhecidos.</p></div></header><div className="ob-field-grid"><CalculatorField label="Volume coletado" hint="mL"><KeyboardInput aria-label="Volume no coletor em mL" inputMode="decimal" value={collector} onChange={(event) => setCollector(event.target.value)} placeholder="—" /></CalculatorField><CalculatorField label="Outros fluidos" hint="mL"><KeyboardInput aria-label="Fluidos não sanguíneos em mL" inputMode="decimal" value={nonBloodFluid} onChange={(event) => setNonBloodFluid(event.target.value)} placeholder="—" /></CalculatorField></div><button type="button" className="ob-zero-action" onClick={() => { setCollector("0"); setNonBloodFluid("0"); }}>Coletor não utilizado · registrar 0</button></section>
    <section className="ob-measure-section"><header><Calculator size={19} /><div><h3>Materiais pesados</h3><p>1 g de diferença ≈ 1 mL de sangue.</p></div></header>{materials.map((item, index) => <div className="ob-material-row" key={item.id}><span>{index + 1}</span><CalculatorField label="Molhado (g)"><KeyboardInput aria-label={`Peso molhado do material ${index + 1}`} inputMode="decimal" value={item.wet} onChange={(event) => updateMaterial(item.id, { wet: event.target.value })} placeholder="—" /></CalculatorField><CalculatorField label="Tara seca (g)"><KeyboardInput aria-label={`Tara seca do material ${index + 1}`} inputMode="decimal" value={item.dry} onChange={(event) => updateMaterial(item.id, { dry: event.target.value })} placeholder="—" /></CalculatorField>{materials.length > 1 ? <button type="button" onClick={() => setMaterials((current) => current.filter((entry) => entry.id !== item.id))} aria-label={`Remover material ${index + 1}`}><Trash size={15} /></button> : null}</div>)}<button type="button" className="ob-add-row" disabled={materials.length >= 6} onClick={() => setMaterials((current) => [...current, { id: Math.max(...current.map(({ id }) => id)) + 1, wet: "", dry: "" }])}><Plus size={16} />Adicionar material</button></section>
    <FormMessage error={error} /><FormActions onClear={clear} submitLabel="Somar perda" />
    {result ? <section className="ob-result" role="status" aria-live="polite" data-warning={result.status === "incomplete" || undefined}><header><div><small>{result.status === "complete" ? "Perda sanguínea quantitativa" : "Estimativa parcial conhecida"}</small><strong>{formatMeasurement(result.status === "complete" ? result.totalBloodLossMl! : result.knownBloodLossMl)} mL</strong></div><Drop size={27} weight="fill" /></header><dl><div><dt>Coletor</dt><dd>{formatMeasurement(result.containerBloodLossMl)} mL</dd></div><div><dt>Materiais</dt><dd>{formatMeasurement(result.materialBloodLossMl)} mL</dd></div></dl>{result.status === "incomplete" ? <p className="ob-result-warning"><Warning size={16} weight="fill" />Estimativa incompleta: {result.missingFields.length} medida{result.missingFields.length === 1 ? "" : "s"} não informada{result.missingFields.length === 1 ? "" : "s"}. O total não foi presumido.</p> : null}<p><Warning size={15} />Sangramento ativo ou instabilidade exige acionamento imediato do protocolo local; não aguarde este cálculo.</p></section> : null}
  </form>;
}

function ShockIndexCalculator() {
  const keyboard = useKeyboard();
  const [heartRate, setHeartRate] = useState("");
  const [systolicPressure, setSystolicPressure] = useState("");
  const [result, setResult] = useState<MaternalShockIndexResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keyboard.hide();
    try { setResult(calculateMaternalShockIndex({ heartRateBpm: requiredNumber(heartRate), systolicBloodPressureMmHg: requiredNumber(systolicPressure) })); setError(null); }
    catch (caught) { setResult(null); setError(friendlyError(caught)); }
  };
  const clear = () => { setHeartRate(""); setSystolicPressure(""); setResult(null); setError(null); };
  return <form className="ob-calculator-form" onSubmit={submit} noValidate data-testid="calculator-shock-index"><div className="ob-field-grid"><CalculatorField label="Frequência cardíaca" hint="bpm"><KeyboardInput aria-label="Frequência cardíaca em bpm" inputMode="decimal" value={heartRate} onChange={(event) => setHeartRate(event.target.value)} placeholder="120" required /></CalculatorField><CalculatorField label="Pressão sistólica" hint="mmHg"><KeyboardInput aria-label="Pressão arterial sistólica em mmHg" inputMode="decimal" value={systolicPressure} onChange={(event) => setSystolicPressure(event.target.value)} placeholder="100" required /></CalculatorField></div><p className="ob-formula">Índice de choque = FC ÷ PAS</p><FormMessage error={error} /><FormActions onClear={clear} />{result ? <section className="ob-result" role="status" aria-live="polite" data-warning={result.exceedsWhoAbnormalThreshold || undefined}><header><div><small>Índice de choque materno</small><strong>{result.shockIndex.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 3 })}</strong></div><Heartbeat size={28} weight={result.exceedsWhoAbnormalThreshold ? "fill" : "thin"} /></header><p className={result.exceedsWhoAbnormalThreshold ? "ob-result-warning" : ""}><Warning size={16} weight={result.exceedsWhoAbnormalThreshold ? "fill" : "regular"} />{result.exceedsWhoAbnormalThreshold ? "Acima de 1,00: sinal hemodinâmico anormal na regra combinada de HPP da OMS 2025." : "Não ultrapassa o limiar >1,00. Um valor isolado não exclui deterioração."}</p><p><Info size={15} />Interprete com sangramento, sinais vitais, perfusão e protocolo institucional; não é diagnóstico isolado.</p></section> : null}</form>;
}

const APGAR_OPTIONS = {
  appearance: ["Pálido/cianótico", "Corpo róseo, extremidades azuis", "Completamente róseo"],
  pulse: ["Ausente", "< 100 bpm", "≥ 100 bpm"],
  grimace: ["Sem resposta", "Careta", "Tosse/espirro/choro ou retirada"],
  activity: ["Flácido", "Alguma flexão", "Movimento ativo"],
  respiration: ["Ausente", "Lenta/irregular", "Boa respiração/choro"],
} as const;

type ApgarKey = keyof typeof APGAR_OPTIONS;

function ApgarCalculator() {
  const keyboard = useKeyboard();
  const [minute, setMinute] = useState<ApgarAssessmentMinute | null>(null);
  const [scores, setScores] = useState<Record<ApgarKey, ApgarComponentScore | null>>({ appearance: null, pulse: null, grimace: null, activity: null, respiration: null });
  const [result, setResult] = useState<ApgarResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    keyboard.hide();
    const complete = minute !== null && Object.values(scores).every((value) => value !== null);
    if (!complete || minute === null) { setResult(null); setError("Selecione o minuto e os cinco componentes; nenhum campo vazio será tratado como zero."); return; }
    try { setResult(calculateApgar({ minute, appearance: scores.appearance!, pulse: scores.pulse!, grimace: scores.grimace!, activity: scores.activity!, respiration: scores.respiration! })); setError(null); }
    catch (caught) { setResult(null); setError(friendlyError(caught)); }
  };
  const clear = () => { setMinute(null); setScores({ appearance: null, pulse: null, grimace: null, activity: null, respiration: null }); setResult(null); setError(null); };
  const labels: Record<ApgarKey, string> = { appearance: "Aparência/cor", pulse: "Pulso", grimace: "Irritabilidade reflexa", activity: "Tônus/atividade", respiration: "Respiração" };
  return <form className="ob-calculator-form" onSubmit={submit} noValidate data-testid="calculator-apgar"><fieldset className="ob-choice ob-minute-choice"><legend>Minuto da avaliação</legend><div>{([1, 5, 10, 15, 20] as const).map((value) => <button key={value} type="button" aria-pressed={minute === value} onClick={() => setMinute(value)}>{value}</button>)}</div></fieldset>{(Object.keys(APGAR_OPTIONS) as ApgarKey[]).map((key) => <fieldset className="ob-apgar-row" key={key}><legend>{labels[key]}</legend><div>{APGAR_OPTIONS[key].map((label, index) => <button key={label} type="button" aria-pressed={scores[key] === index} onClick={() => setScores((current) => ({ ...current, [key]: index as ApgarComponentScore }))}><span>{index}</span>{label}</button>)}</div></fieldset>)}<FormMessage error={error} /><FormActions onClear={clear} submitLabel="Somar Apgar" />{result ? <section className="ob-result" role="status" aria-live="polite" data-warning={result.total < 7 || undefined}><header><div><small>Apgar no {result.minute}º minuto</small><strong>{result.total} / 10</strong></div><Baby size={29} weight="thin" /></header>{result.repeatDocumentationEveryFiveMinutesUntil20 ? <p className="ob-result-warning"><ClockCounterClockwise size={16} />Apgar &lt;7: documentar novamente a cada 5 min até 20 min, conforme protocolo.</p> : null}<p><Warning size={15} />Ferramenta de registro da condição/resposta do RN. A reanimação não deve aguardar o escore de 1 minuto.</p></section> : null}</form>;
}

export interface ObstetricsWorkspaceProps {
  referenceDate: LocalDate;
}

export function ObstetricsWorkspace({ referenceDate }: ObstetricsWorkspaceProps) {
  const [activeMode, setActiveMode] = useState<CalculatorMode>("lmp");
  const [menuOpen, setMenuOpen] = useState(false);
  const keyboard = useKeyboard();
  const active = CALCULATORS.find(({ id }) => id === activeMode) ?? CALCULATORS[0];
  const ActiveIcon = active.icon;
  const selectMode = (value: string) => { setActiveMode(value as CalculatorMode); setMenuOpen(false); };
  return <section className="obstetrics-workspace" data-testid="obstetrics-workspace">
  <div className="ob-tool-header"><div><p className="ob-section-label">Calculadoras de plantão</p><h2>{active.label}</h2><p>{active.description}</p></div><button type="button" className="ob-mode-trigger" aria-label={"Calculadora ativa: " + active.label + ". Trocar calculadora"} aria-haspopup="dialog" aria-expanded={menuOpen} data-testid="obstetric-calculator-selector" onClick={() => { keyboard.hide(); setMenuOpen(true); }}><ActiveIcon size={17} /><span>{active.shortLabel}</span><CaretDown size={13} /></button></div>
  <BottomSheet open={menuOpen} onOpenChange={setMenuOpen} title="Calculadoras obstétricas" description="Escolha um instrumento. Seus rascunhos permanecem ao alternar." snap={0.82}><div className="ob-calculator-picker">{CALCULATORS.map((calculator, index) => { const ModeIcon = calculator.icon; const separator = index > 0 && CALCULATORS[index - 1].group !== calculator.group; return <Fragment key={calculator.id}>{separator ? <hr /> : null}<button type="button" aria-pressed={activeMode === calculator.id} data-testid={"calculator-option-" + calculator.id} onClick={() => selectMode(calculator.id)}><ModeIcon size={24} weight="thin" /><span><strong>{calculator.label}</strong><small>{calculator.description}</small></span>{activeMode === calculator.id ? <Check size={17} /> : <CaretDown size={15} />}</button></Fragment>; })}</div></BottomSheet>
    <aside className="ob-safety-contract"><ShieldCheck size={20} weight="thin" /><p><strong>Apoio à documentação obstétrica.</strong> Confirme a melhor estimativa no prontuário; esta ferramenta não redefine a DPP nem substitui avaliação clínica.</p></aside>
    <div hidden={activeMode !== "lmp"}><LmpCalculator referenceDate={referenceDate} /></div>
    <div hidden={activeMode !== "ultrasound"}><UltrasoundCalculator referenceDate={referenceDate} /></div>
    <div hidden={activeMode !== "comparison"}><ComparisonCalculator /></div>
    <div hidden={activeMode !== "art"}><ArtCalculator referenceDate={referenceDate} /></div>
    <div hidden={activeMode !== "qbl"}><QblCalculator /></div>
    <div hidden={activeMode !== "shock-index"}><ShockIndexCalculator /></div>
    <div hidden={activeMode !== "apgar"}><ApgarCalculator /></div>
    <footer className="ob-privacy-note"><ShieldCheck size={15} /><span>Dados efêmeros: nada destas calculadoras entra no Arquivo, no backup ou nas métricas. Ao sair de Obstetrícia, os campos são descartados.</span></footer>
  </section>;
}
