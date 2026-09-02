import { useMemo, useState, useRef, type FormEvent, type Dispatch, type SetStateAction } from "react";
import { ArrowSquareOut, BookOpenText, CaretDown, CaretRight, Check, ClipboardText, CompassRose, Copy, FileText, Info, MagnifyingGlass, NotePencil, Pill, Plus, ShieldCheck, Stethoscope, TestTube, WarningCircle, X } from "@phosphor-icons/react";
import { BottomSheet, KeyboardInput, KeyboardTextarea, useKeyboard } from "../mobile";
import { CLINICAL_CATALOG, CLINICAL_PORTALS, EARLY_PREGNANCY_MILESTONES, EARLY_PREGNANCY_SOURCES } from "../domain/clinicalCatalog";
import { createPersonalReference, createEmptySoapDraft as blankSoap, personalReferencesFromEntities, searchClinicalReferences, serializeSoap, type ClinicalReferenceItem, type ClinicalReferenceKind, type PersonalReferencePayload, type SoapDraft } from "../domain/clinicalReference";
import type { MentorEntity } from "../domain/model";
import "./clinical-tools-workspace.css";

type ClinicalTool = ClinicalReferenceKind | "soap";
const tools = [
  { id: "cid", title: "CID-10", description: "Código, termo e sinônimos", icon: BookOpenText },
  { id: "exam", title: "Nomes de exames", description: "Termos usuais e nomenclatura SUS", icon: TestTube },
  { id: "medicine", title: "Fármacos e marcas", description: "Composição, apresentação e limites", icon: Pill },
  { id: "soap", title: "Espaço SOAP", description: "Rascunho transitório, sem salvar", icon: ClipboardText },
] as const;
const matchLabels = { code: "Código exato", title: "Termo exato", alias: "Sinônimo de busca", prefix: "Termos encontrados", approximate: "Grafia aproximada" };

export function EarlyPregnancyReference() {
  return <details className="ct-milestones"><summary><CompassRose size={19} /><span>O que costuma aparecer no início da gestação</span><CaretDown size={15} /></summary><div className="ct-milestone-list">{EARLY_PREGNANCY_MILESTONES.map((milestone) => <article key={milestone.title}><small>{milestone.period}</small><h4>{milestone.title}</h4><p>{milestone.description}</p></article>)}</div><p className="ct-caution">Marcos aproximados. A interpretação depende do laudo e da avaliação clínica; esta referência não determina localização ou viabilidade.</p><div className="ct-sources">{EARLY_PREGNANCY_SOURCES.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowSquareOut size={13} /></a>)}</div></details>;
}

function PersonalReferenceForm({ kind, onSave }: { kind: ClinicalReferenceKind; onSave: (payload: PersonalReferencePayload) => Promise<unknown> }) {
  const keyboard = useKeyboard();
  const [title, setTitle] = useState(""); const [aliases, setAliases] = useState("");
  const [code, setCode] = useState(""); const [category, setCategory] = useState("");
  const [note, setNote] = useState(""); const [sourceUrl, setSourceUrl] = useState("");
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; keyboard.hide(); setError(null); setBusy(true);
    try { await onSave(createPersonalReference({ kind, title, aliases, code, category, note, sourceUrl })); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível guardar a referência."); }
    finally { setBusy(false); }
  };
  return <form className="ct-personal-form" onSubmit={submit} noValidate>
    <p>Esta adição fica no seu catálogo pessoal e no backup. Não recebe selo de revisão e não deve conter informações de pacientes.</p>
    <label>Nome ou princípio ativo<KeyboardInput value={title} onChange={(event) => setTitle(event.target.value)} maxLength={160} required /></label>
    <label>{kind === "medicine" ? "Marcas e apresentações" : "Sinônimos"}<KeyboardInput value={aliases} onChange={(event) => setAliases(event.target.value)} maxLength={1000} placeholder="Separe os termos por vírgula" /></label>
    {kind !== "medicine" ? <label>Código, se você conferiu<KeyboardInput value={code} onChange={(event) => setCode(event.target.value)} maxLength={20} /></label> : null}
    <label>Classe ou categoria<KeyboardInput value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} /></label>
    <label>Observação da referência<KeyboardTextarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={1000} rows={3} /></label>
    <label>Link da fonte, se houver<KeyboardInput type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} maxLength={1000} placeholder="https://" /></label>
    {error ? <p role="alert" className="ct-error">{error}</p> : null}
    <button type="submit" className="primary-cta" disabled={busy}>{busy ? "Guardando…" : "Adicionar à minha referência"}</button>
  </form>;
}

export function ClinicalToolsWorkspace({ entities = [], onSaveReference, soapDraft: soap, onSoapDraftChange: setSoap }: { entities?: readonly MentorEntity[]; onSaveReference?: (payload: PersonalReferencePayload) => Promise<unknown>; soapDraft: SoapDraft; onSoapDraftChange: Dispatch<SetStateAction<SoapDraft>> }) {
  const keyboard = useKeyboard();
  const searchInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ClinicalTool>("cid"); const [pickerOpen, setPickerOpen] = useState(false);
  const [personalOpen, setPersonalOpen] = useState(false); const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null); const [limit, setLimit] = useState(8);
  const [obstetricOnly, setObstetricOnly] = useState(false); const [gestationalOnly, setGestationalOnly] = useState(false);
  const [category, setCategory] = useState("");
  const [clearSoap, setClearSoap] = useState(false); const [notice, setNotice] = useState<string | null>(null);
  const personal = useMemo(() => personalReferencesFromEntities(entities), [entities]);
  const referenceKind = mode === "soap" ? "cid" : mode;
  const allResults = useMemo(() => searchClinicalReferences(query, referenceKind, personal), [query, referenceKind, personal]);
  const results = allResults.filter(({ item }) => (!obstetricOnly || mode !== "cid" || item.category === "Gestação e obstetrícia") && (!gestationalOnly || mode !== "medicine" || item.gestationalReference) && (!category || mode !== "medicine" || item.category === category));
  const selected = results.find((result) => result.item.id === selectedId)?.item;
  const activeTool = tools.find((tool) => tool.id === mode)!;
  const total = CLINICAL_CATALOG.filter((item) => item.kind === referenceKind).length;
  const medicineCategories = [...new Set([...CLINICAL_CATALOG, ...personal].filter((item) => item.kind === "medicine" && (!gestationalOnly || item.gestationalReference)).map((item) => item.category))];
  const soapText = serializeSoap(soap);
  const copy = async (value: string) => {
    keyboard.hide();
    try { await navigator.clipboard.writeText(value); setNotice("Copiado para a área de transferência do aparelho."); }
    catch { setNotice("Não foi possível copiar automaticamente. O texto permanece disponível para selecionar."); }
  };
  const choose = (next: ClinicalTool) => { keyboard.hide(); setMode(next); setPickerOpen(false); setQuery(""); setSelectedId(null); setCategory(""); setLimit(8); setNotice(null); };
  const searchTerm = (term: string) => { setQuery(term); setSelectedId(null); setLimit(8); };
  const searchRelated = (term: string) => { searchTerm(term); window.requestAnimationFrame(() => searchInput.current?.focus()); };

  return <section className="ct-workspace" data-testid="clinical-tools-workspace">
    <header className="ct-heading"><div><p className="eyebrow">Apoio ao plantão</p><h2>{activeTool.title}</h2><p>{activeTool.description}</p></div><button type="button" className="ct-orquestrator" onClick={() => { keyboard.hide(); setPickerOpen(true); }} aria-label="Orquestrator: escolher instrumento"><CompassRose size={18} weight="thin" /><span>Orquestrator</span><CaretDown size={13} /></button></header>
    <div className="ct-privacy"><ShieldCheck size={17} /><span>{mode === "soap" ? "Rascunho em memória · descartado ao sair desta área" : "Consulta local · não vira prontuário, pedido ou prescrição"}</span></div>
    {mode === "soap" ? <div className="ct-soap" data-testid="soap-workspace">
      <p className="ct-soap-intro">Um espaço para organizar o que você escreveu. Não incluímos achados, diagnósticos ou condutas. Evite nomes, prontuário e outros identificadores.</p>
      {([
        ["subjective", "S", "Subjetivo", "Relato e contexto, sem identificadores."],
        ["objective", "O", "Objetivo", "Achados e medidas que você observou."],
        ["assessment", "A", "Avaliação", "Seu raciocínio, hipóteses e incertezas."],
        ["plan", "P", "Plano", "Plano definido pela equipe responsável."],
      ] as const).map(([key, letter, label, placeholder]) => <label className="ct-soap-field" key={key}><span className="ct-soap-letter">{letter}</span><span className="ct-soap-body"><strong>{label}</strong><KeyboardTextarea aria-label={`SOAP ${label}`} value={soap[key]} onChange={(event) => { setSoap((draft) => ({ ...draft, [key]: event.target.value })); setClearSoap(false); }} maxLength={6000} rows={4} placeholder={placeholder} /></span></label>)}
      <div className="ct-soap-actions"><button type="button" className="primary-cta" disabled={!soapText} onClick={() => void copy(soapText)}><Copy size={19} />Copiar SOAP</button><button type="button" className="secondary-cta" disabled={!soapText} onClick={() => { keyboard.hide(); if (clearSoap) { setSoap(blankSoap()); setClearSoap(false); } else setClearSoap(true); }}>{clearSoap ? "Confirmar descarte" : "Limpar rascunho"}</button></div>
      {soapText ? <details className="ct-soap-preview"><summary>Conferir texto que será copiado</summary><pre tabIndex={0}>{soapText}</pre></details> : null}
      <p className="ct-footnote">Sem salvamento automático, backup ou envio externo. O texto copiado sai para a área de transferência; o sistema do aparelho pode sincronizá-la.</p>
    </div> : <>
      <label className="ct-search"><MagnifyingGlass size={20} /><KeyboardInput ref={searchInput} aria-label={`Pesquisar ${activeTool.title}`} value={query} onChange={(event) => searchTerm(event.target.value)} maxLength={160} placeholder={mode === "cid" ? "Ex.: dor de cabeça, ITU, N390" : mode === "exam" ? "Ex.: urina tipo 1, glicemia, Doppler" : "Marca ou princípio ativo"} />{query ? <button type="button" aria-label="Limpar busca" onClick={() => searchTerm("")}><X size={17} /></button> : null}</label>
      <div className="ct-filter-line"><span>{total} referências públicas{personal.filter((item) => item.kind === mode).length ? ` + ${personal.filter((item) => item.kind === mode).length} pessoais` : ""}</span>{mode === "cid" ? <button type="button" aria-pressed={obstetricOnly} onClick={() => { keyboard.hide(); setObstetricOnly(!obstetricOnly); setSelectedId(null); }}>{obstetricOnly ? <Check size={13} /> : null}Obstétricos</button> : null}</div>
      {mode === "medicine" ? <><div className="ct-medical-views" role="group" aria-label="Visão farmacológica"><button type="button" aria-pressed={!gestationalOnly} onClick={() => { setGestationalOnly(false); setCategory(""); setSelectedId(null); }}>Identificar marca</button><button type="button" aria-pressed={gestationalOnly} onClick={() => { setGestationalOnly(true); setCategory(""); setSelectedId(null); }}>Referências na gestação</button></div><label className="ct-category">Classe<select aria-label="Classe farmacológica" value={category} onChange={(event) => { setCategory(event.target.value); setSelectedId(null); setLimit(8); }}><option value="">Todas as classes</option>{medicineCategories.map((value) => <option key={value}>{value}</option>)}</select></label><p className="ct-medical-warning"><WarningCircle size={17} />Nenhuma ficha é uma lista de medicamentos “liberados”. Leia formulação, restrições e limites antes de usar a referência.</p></> : null}
      {mode === "exam" ? <div className="ct-system-note"><Info size={18} /><p><strong>SISCV é o portal municipal encontrado.</strong> O nome usado pela sua maternidade não foi confirmado. SIGTAP é tabela, não sistema de agendamento.</p></div> : null}
      <div className="ct-results" aria-live="polite" aria-label="Resultados de referência">{results.slice(0, limit).map(({ item, match }) => <div key={item.id} className={`ct-result ${selectedId === item.id ? "is-open" : ""}`}><button type="button" className="ct-result-trigger" onClick={() => { keyboard.hide(); setSelectedId(selectedId === item.id ? null : item.id); }} aria-expanded={selectedId === item.id}><span className={item.code ? "ct-code" : "ct-result-icon"}>{item.code ?? (mode === "medicine" ? <Pill size={23} weight="thin" /> : <TestTube size={23} weight="thin" />)}</span><span className="ct-result-copy"><strong>{item.title}</strong>{item.kind === "medicine" ? <em>{item.presentation ?? item.aliases[0]}</em> : null}<small>{item.personal ? "Minha referência · não revisada" : query ? matchLabels[match] : item.category}</small></span><CaretRight size={16} /></button>{selected?.id === item.id ? <ReferenceDetail item={item} onCopy={copy} onRelated={searchRelated} /> : null}</div>)}</div>
      {results.length > limit ? <button type="button" className="ct-show-more" onClick={() => setLimit((value) => value + 8)}>Mostrar mais {Math.min(8, results.length - limit)} referências</button> : null}
      {results.length === 0 ? <div className="ct-empty"><MagnifyingGlass size={29} weight="thin" /><h3>Vamos por outro nome?</h3><p>Este catálogo é uma seleção inicial. Tente um termo central, sinônimo ou código. Frases negativas não são convertidas em diagnósticos positivos.</p><button type="button" className="secondary-cta" onClick={() => { setCategory(""); setObstetricOnly(false); setGestationalOnly(false); searchTerm(""); }}>Ver referências disponíveis</button></div> : null}
      {onSaveReference ? <button type="button" className="ct-add-personal" onClick={() => { keyboard.hide(); setPersonalOpen(true); }}><Plus size={17} />Adicionar minha referência<span>Somente nomes, termos e fontes</span></button> : null}
      <p className="ct-footnote">Seleção educacional, não base integral para faturamento ou decisão clínica. Códigos e nomes mantêm origem e versão; não indicam disponibilidade local.</p>
      <div className="ct-portals">{CLINICAL_PORTALS.filter((portal) => mode === "medicine" ? portal.label.startsWith("Anvisa") : mode === "exam" ? !portal.label.startsWith("Anvisa") : false).map((portal) => <a key={portal.url} href={portal.url} target="_blank" rel="noopener noreferrer"><span><strong>{portal.label}</strong><small>{portal.note}</small></span><ArrowSquareOut size={17} /></a>)}</div>
    </>}
    {notice ? <p className="ct-notice" role="status">{notice}</p> : null}
    <BottomSheet open={pickerOpen} onOpenChange={setPickerOpen} title="Orquestrator" description="Escolha o instrumento de consulta." snap={0.58}><div className="ct-picker">{tools.map((tool) => { const Icon = tool.icon; return <button type="button" key={tool.id} onClick={() => choose(tool.id)} aria-pressed={mode === tool.id}><Icon size={26} weight="thin" /><span><strong>{tool.title}</strong><small>{tool.description}</small></span>{mode === tool.id ? <Check size={17} /> : <CaretRight size={17} />}</button>; })}</div></BottomSheet>
    <BottomSheet open={personalOpen} onOpenChange={setPersonalOpen} title="Minha referência" description="Seu complemento, separado das fichas públicas revisadas." snap={0.9}>{personalOpen && onSaveReference ? <PersonalReferenceForm kind={referenceKind} onSave={async (payload) => { await onSaveReference(payload); setPersonalOpen(false); setGestationalOnly(false); setCategory(""); setObstetricOnly(false); setNotice("Referência pessoal guardada. Ela não recebeu validação clínica automática."); searchTerm(payload.title); }} /> : null}</BottomSheet>
  </section>;
}

function ReferenceDetail({ item, onCopy, onRelated }: { item: ClinicalReferenceItem; onCopy: (value: string) => Promise<void>; onRelated: (value: string) => void }) {
  return <div className="ct-detail"><p className="ct-summary">{item.summary}</p>{!item.code && item.kind === "exam" ? <p className="ct-no-code">Código único não confirmado.</p> : null}<div className="ct-aliases"><small>{item.kind === "medicine" ? "Nomes associados nesta ficha" : "Também pode ser procurado por"}</small><p>{item.aliases.join(" · ") || "Sem sinônimos adicionais"}</p></div><ul className="ct-cautions">{item.cautions.map((caution) => <li key={caution}>{caution}</li>)}</ul><div className="ct-copy-actions">{item.code ? <button type="button" onClick={() => void onCopy(item.code!)}><Copy size={15} />Copiar código</button> : null}<button type="button" onClick={() => void onCopy(item.title)}><Copy size={15} />Copiar nome</button></div>{item.related.length ? <div className="ct-related"><strong>Outros termos para revisar</strong><p>Relações de nomenclatura, não indicação de exames ou diagnósticos.</p><div>{item.related.map((term) => <button type="button" key={term} onClick={() => onRelated(term)}>{term}<CaretRight size={12} /></button>)}</div></div> : null}<details className="ct-source-detail"><summary>Origem e limites desta referência</summary><p>{item.scope}</p><div className="ct-sources">{item.sources.map((source) => <a key={source.url} href={source.url} target="_blank" rel="noopener noreferrer">{source.label}<ArrowSquareOut size={13} /></a>)}</div></details></div>;
}
