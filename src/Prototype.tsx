import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Archive } from "@phosphor-icons/react/dist/csr/Archive";
import { ArrowCounterClockwise } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { Bank } from "@phosphor-icons/react/dist/csr/Bank";
import { Bed } from "@phosphor-icons/react/dist/csr/Bed";
import { BookOpen } from "@phosphor-icons/react/dist/csr/BookOpen";
import { BowlFood } from "@phosphor-icons/react/dist/csr/BowlFood";
import { Brain } from "@phosphor-icons/react/dist/csr/Brain";
import { CalendarDots } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { CaretRight } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChartLineUp } from "@phosphor-icons/react/dist/csr/ChartLineUp";
import { Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { Calculator } from "@phosphor-icons/react/dist/csr/Calculator";
import { Circle } from "@phosphor-icons/react/dist/csr/Circle";
import { ClipboardText } from "@phosphor-icons/react/dist/csr/ClipboardText";
import { Clock } from "@phosphor-icons/react/dist/csr/Clock";
import { CloudCheck } from "@phosphor-icons/react/dist/csr/CloudCheck";
import { CompassRose } from "@phosphor-icons/react/dist/csr/CompassRose";
import { CreditCard } from "@phosphor-icons/react/dist/csr/CreditCard";
import { CurrencyCircleDollar } from "@phosphor-icons/react/dist/csr/CurrencyCircleDollar";
import { FileArrowDown } from "@phosphor-icons/react/dist/csr/FileArrowDown";
import { FileArrowUp } from "@phosphor-icons/react/dist/csr/FileArrowUp";
import { FirstAid } from "@phosphor-icons/react/dist/csr/FirstAid";
import { GearFine } from "@phosphor-icons/react/dist/csr/GearFine";
import { GraduationCap } from "@phosphor-icons/react/dist/csr/GraduationCap";
import { HeadCircuit } from "@phosphor-icons/react/dist/csr/HeadCircuit";
import { Heart } from "@phosphor-icons/react/dist/csr/Heart";
import { House } from "@phosphor-icons/react/dist/csr/House";
import { Info } from "@phosphor-icons/react/dist/csr/Info";
import { Lightbulb } from "@phosphor-icons/react/dist/csr/Lightbulb";
import { ListChecks } from "@phosphor-icons/react/dist/csr/ListChecks";
import { LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { MoonStars } from "@phosphor-icons/react/dist/csr/MoonStars";
import { NotePencil } from "@phosphor-icons/react/dist/csr/NotePencil";
import { Pill } from "@phosphor-icons/react/dist/csr/Pill";
import { Plus } from "@phosphor-icons/react/dist/csr/Plus";
import { ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SignOut } from "@phosphor-icons/react/dist/csr/SignOut";
import { Smiley } from "@phosphor-icons/react/dist/csr/Smiley";
import { TrendUp } from "@phosphor-icons/react/dist/csr/TrendUp";
import { UserCircle } from "@phosphor-icons/react/dist/csr/UserCircle";
import { Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { BottomSheet, KeyboardInput, MobileScroll, useKeyboard } from "./mobile";
import { useMedicationData, useMentorData } from "./hooks";
import {
  createCsvExport,
  updateLaboratoryPanel,
  createJsonExport,
  applyStagedImport,
  confirmEncryptedBackupDelivery,
  discardStagedImport,
  exportEncryptedBackup,
  shareOrDownloadFile,
  stageEncryptedBackup,
  type AppliedBackupMergeResult,
  type AppliedLegacyImportResult,
  type BackupDeliveryReceipt,
  type RolledBackLegacyImportResult,
} from "./data";
import {
  combineLocalDateAndTime,
  known,
  localDateFromDateTime,
  localTimeInTimeZone,
  resolveShiftDepartureLocalDateTime,
  shiftLocalDate,
  todayInTimeZone,
  unknown as unknownKnowledge,
  type Domain,
  type LocalDate,
  type LocalTime,
  type MentorEntity,
  type MentorWorkspace,
} from "./domain";
import {
  buildAnalyticsReport,
  formatBRLMinor,
  type AnalyticsMetric,
  type AnalyticsReport,
  type DomainAnalyticsSummary,
} from "./domain/analytics";
import {
  DomainForms,
  type DomainFormMode,
  type DomainSaveRequest,
} from "./features/DomainForms";
import { DOMAIN_CATALOG } from "./features/domainCatalog";
import {
  MentorInsights,
  type MentorInsightsWindowDays,
} from "./features/MentorInsights";
import { ArchiveWorkspace } from "./features/ArchiveWorkspace";
import { AgendaPlanner } from "./features/AgendaPlanner";
import { AnnualDatesWorkspace } from "./features/AnnualDatesWorkspace";
import { MetricTrends } from "./features/MetricTrends";
import type { MetricSignalId } from "./domain/metricSeries";
import { reviewCycles, type ReviewCycle } from "./domain/reviewCycles";
import { ReviewCycleStrip } from "./features/ReviewCycleStrip";
import { ProtectedRetentionWorkspace } from "./features/ProtectedRetentionWorkspace";
import { getProtectedRetentionSchedule } from "./data/protectedRetention";
import { ANNUAL_DATE_SCHEMA, annualDateAlerts, projectAnnualDates, type AnnualOccurrence } from "./domain/annualDates";
import { FinanceWorkspace } from "./features/FinanceWorkspace";
import { InternatoShiftControl } from "./features/InternatoShiftControl";
import { ObstetricsWorkspace } from "./features/ObstetricsWorkspace";
import { MedicationWorkspace } from "./features/MedicationWorkspace";
import { LaboratoryWorkspace } from "./features/LaboratoryWorkspace";
import { ClinicalToolsWorkspace } from "./features/ClinicalToolsWorkspace";
import { SuiteAppearanceControls, SuiteBackdrop, SuiteMotionControl, useSuiteAppearance } from "./appearance/SuiteAppearance";
import "./appearance/suite-appearance.css";
import { createEmptySoapDraft, type SoapDraft } from "./domain/clinicalReference";
import { LegacyImportForm } from "./features/LegacyImportForm";
import { StudiesWorkspace } from "./features/StudiesWorkspace";
import { RoutineWorkspace, type RoutineWorkspaceMode } from "./features/RoutineWorkspace";
import { EntityRevisionEditor } from "./features/EntityRevisionEditor";
import {
  RESTORE_CONFLICTS_CHANGED_EVENT,
  RestoreConflictReviewLauncher,
  RestoreConflictWorkspace,
} from "./features/RestoreConflictWorkspace";
import {
  ClinicianReportBuilder,
  ACCESSIBILITY_CLASS_NAMES,
  MENTOR_PREFERENCES_SETTING_KEY,
  PreferencesWorkspace,
  accessibilityClassNames,
  mentorPreferencesFromSettings,
  type ClinicianReportGeneration,
  type MentorPreferences,
} from "./features";
import {
  PWA_INSTALL_AVAILABLE_EVENT,
  PWA_OFFLINE_READY_EVENT,
  PWA_RUNTIME_STATE_EVENT,
  PWA_UPDATE_ACTIVATED_EVENT,
  PWA_UPDATE_AVAILABLE_EVENT,
  activateMentorPwaUpdate,
  checkMentorPwaCacheReadiness,
  getMentorPwaPendingUpdate,
  getMentorPwaRuntimeState,
  requestMentorPwaInstall,
  type MentorPwaCacheReadiness,
  type MentorPwaRuntimeState,
  type MentorPwaUpdateAvailableDetail,
} from "./pwa";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/jost/400.css";
import "@fontsource/jost/500.css";

type TabId = "today" | "agenda" | "register" | "mentor" | "archive";
type DomainId = Domain;
type InternatoSection = "jornada" | "obstetricia" | "apoio";
type SheetState = { kind: "moment" } | { kind: "medication" } | { kind: "departure" } | { kind: "domain"; domain: DomainId; initialMode?: DomainFormMode } | { kind: "backup" } | { kind: "restore" } | { kind: "conflicts" } | { kind: "clinician" } | null;
type BackupActionResult = {
  delivery: "shared" | "downloaded";
  receipt: BackupDeliveryReceipt;
  fileName: string;
};
const domains = DOMAIN_CATALOG;

const demoSignal = [
  { d: "09/7", foco: 42, energia: 18 }, { d: "13/7", foco: 56, energia: 24 },
  { d: "18/7", foco: 70, energia: 44 }, { d: "24/7", foco: 62, energia: 37 },
  { d: "30/7", foco: 76, energia: 48 }, { d: "05/8", foco: 64, energia: 35 },
  { d: "12/8", foco: 80, energia: 51 }, { d: "18/8", foco: 61, energia: 33 },
  { d: "24/8", foco: 74, energia: 47 }, { d: "01/9", foco: 84, energia: 58 },
];

const navItems = [
  { id: "today", label: "Hoje", icon: House },
  { id: "agenda", label: "Agenda", icon: CalendarDots },
  { id: "register", label: "Registrar", icon: Plus },
  { id: "mentor", label: "Mentor", icon: UserCircle },
  { id: "archive", label: "Arquivo", icon: Archive },
] as const;

const visualMode = () => new URLSearchParams(window.location.search).get("visual") === "1";
const formatLongDate = (date: Date) => new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long" }).format(date);
const nowTime = () => localTimeInTimeZone();

export default function Prototype() {
  const suiteRootRef = useRef<HTMLDivElement | null>(null);
  const { theme: suiteTheme, setTheme: setSuiteTheme, paused: suitePaused, setPaused: setSuitePaused } = useSuiteAppearance();
  const visualDemo = useMemo(visualMode, []);
  const mentor = useMentorData();
  const currentLocalDate = mentor.snapshot?.localDate ?? todayInTimeZone();
  const medicationToday = useMedicationData(currentLocalDate);
  const keyboard = useKeyboard();
  const initialScreen = useMemo(() => new URLSearchParams(window.location.search).get("screen"), []);
  const [activeTab, setActiveTab] = useState<TabId>(() => navItems.some((item) => item.id === initialScreen) ? initialScreen as TabId : initialScreen === "finance" ? "mentor" : "today");
  const [focusedDomain, setFocusedDomain] = useState<DomainId | null>(initialScreen === "finance" ? "financas" : null);
  const [internatoSection, setInternatoSection] = useState<InternatoSection>("jornada");
  const [internatoSoap, setInternatoSoap] = useState<SoapDraft>(createEmptySoapDraft);
  const [insightsWindow, setInsightsWindow] = useState<MentorInsightsWindowDays>(60);
  const [metricSignal, setMetricSignal] = useState<MetricSignalId>("sleep-duration");
  const [domainReturnTab, setDomainReturnTab] = useState<TabId>(initialScreen === "finance" ? "mentor" : "register");
  const [cycleSelection, setCycleSelection] = useState<string | null>("current");
  const [retentionDue, setRetentionDue] = useState<boolean | null>(false);
  useEffect(() => { let active = true; if (mentor.workspace) void getProtectedRetentionSchedule().then((schedule) => { if (active) setRetentionDue(schedule.due); }).catch(() => { if (active) setRetentionDue(null); }); return () => { active = false; }; }, [mentor.workspace?.dataset.id, mentor.workspace?.dataset.dataRevision, currentLocalDate]);
  const [routineEntryMode, setRoutineEntryMode] = useState<RoutineWorkspaceMode>("planning");
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [editingEntity, setEditingEntity] = useState<MentorEntity | null>(null);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [energy, setEnergy] = useState<number | null>(visualDemo ? 3 : null);
  const [arrival, setArrival] = useState<string | null>(visualDemo ? "06:52" : null);
  const [departure, setDeparture] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [pwaState, setPwaState] = useState<MentorPwaRuntimeState>(() => getMentorPwaRuntimeState());
  const [offlineReady, setOfflineReady] = useState(false);
  const [pwaUpdate, setPwaUpdate] = useState<MentorPwaUpdateAvailableDetail | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [toastAction, setToastAction] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const toastTimer = useRef<number | null>(null);

  // A cor alcança as folhas modais sem alterar o runtime móvel protegido.
  useEffect(() => {
    const root = suiteRootRef.current;
    if (!root) return;
    const portalRoot = root.closest<HTMLElement>(".device-screen") ?? document.documentElement;
    const names = ["--paper", "--paper-warm", "--surface", "--ink", "--ink-soft", "--muted", "--wine", "--wine-dark", "--gold", "--gold-light", "--green", "--blue", "--blue-select", "--blue-soft", "--navy", "--red", "--orange", "--focus", "--control-border"];
    const previousTokens = new Map(names.map((name) => [name, portalRoot.style.getPropertyValue(name)]));
    const previousTheme = portalRoot.dataset.suiteTheme;
    const previousModule = portalRoot.dataset.suiteModule;
    const previousColorScheme = portalRoot.style.colorScheme;
    const metaTheme = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const previousMetaTheme = metaTheme?.content;
    const computed = getComputedStyle(root);
    portalRoot.classList.add("mentor-suite-portal");
    portalRoot.dataset.suiteTheme = suiteTheme;
    portalRoot.dataset.suiteModule = "mentor";
    portalRoot.style.colorScheme = suiteTheme;
    names.forEach((name) => portalRoot.style.setProperty(name, computed.getPropertyValue(name)));
    if (metaTheme) metaTheme.content = suiteTheme === "dark" ? "#100f16" : "#faf6f2";
    return () => {
      portalRoot.classList.remove("mentor-suite-portal");
      if (previousTheme === undefined) delete portalRoot.dataset.suiteTheme; else portalRoot.dataset.suiteTheme = previousTheme;
      if (previousModule === undefined) delete portalRoot.dataset.suiteModule; else portalRoot.dataset.suiteModule = previousModule;
      portalRoot.style.colorScheme = previousColorScheme;
      previousTokens.forEach((value, name) => { if (value) portalRoot.style.setProperty(name, value); else portalRoot.style.removeProperty(name); });
      if (metaTheme && previousMetaTheme !== undefined) metaTheme.content = previousMetaTheme;
    };
  }, [suiteTheme]);

  // O rascunho atravessa as subáreas do Internato, mas nunca sai desse ciclo de vida nem vai ao banco.
  useEffect(() => {
    if (focusedDomain !== "internato") setInternatoSoap((draft) => Object.values(draft).some(Boolean) ? createEmptySoapDraft() : draft);
  }, [focusedDomain]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => {
    let mounted = true;
    const updateRuntime = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as MentorPwaRuntimeState : null;
      setPwaState(detail ?? getMentorPwaRuntimeState());
    };
    const updateReadiness = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as MentorPwaCacheReadiness : null;
      if (detail) setOfflineReady(detail.ready);
    };
    const updateAvailable = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as MentorPwaUpdateAvailableDetail : null;
      if (detail) setPwaUpdate(detail);
    };
    const updateActivated = () => setPwaUpdate(null);
    window.addEventListener(PWA_INSTALL_AVAILABLE_EVENT, updateRuntime);
    window.addEventListener(PWA_RUNTIME_STATE_EVENT, updateRuntime);
    window.addEventListener(PWA_OFFLINE_READY_EVENT, updateReadiness);
    window.addEventListener(PWA_UPDATE_AVAILABLE_EVENT, updateAvailable);
    window.addEventListener(PWA_UPDATE_ACTIVATED_EVENT, updateActivated);
    void checkMentorPwaCacheReadiness().then((readiness) => setOfflineReady(readiness.ready)).catch(() => setOfflineReady(false));
    void getMentorPwaPendingUpdate().then((detail) => {
      // Initial null is already represented by state. Ignoring it here avoids
      // an older async lookup erasing an update event received in the meantime.
      if (mounted && detail) setPwaUpdate(detail);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      window.removeEventListener(PWA_INSTALL_AVAILABLE_EVENT, updateRuntime);
      window.removeEventListener(PWA_RUNTIME_STATE_EVENT, updateRuntime);
      window.removeEventListener(PWA_OFFLINE_READY_EVENT, updateReadiness);
      window.removeEventListener(PWA_UPDATE_AVAILABLE_EVENT, updateAvailable);
      window.removeEventListener(PWA_UPDATE_ACTIVATED_EVENT, updateActivated);
    };
  }, []);

  useEffect(() => {
    if (visualDemo || !mentor.snapshot) return;
    setEnergy(mentor.snapshot.latestEnergy?.payload.energy ?? null);
    const arrivalValue = mentor.snapshot.currentShift?.payload.arrivalLocal;
    const departureValue = mentor.snapshot.currentShift?.payload.departureLocal;
    setArrival(arrivalValue?.state === "known" ? arrivalValue.value.slice(11, 16) : null);
    setDeparture(departureValue?.state === "known" ? departureValue.value.slice(11, 16) : null);
  }, [mentor.snapshot, visualDemo]);

  useEffect(() => {
    if (visualDemo) return;
    void medicationToday.refresh().catch(() => undefined);
  }, [currentLocalDate, medicationToday.refresh, mentor.workspace?.dataset.dataRevision, visualDemo]);

  const medicationSlots = medicationToday.snapshot?.trail.slots ?? [];
  const medicationPlannedCount = medicationSlots.length;
  const medicationPendingCount = medicationSlots.filter(
    (slot) => slot.state === "not_recorded",
  ).length;
  const medicationDone = visualDemo || (
    medicationPlannedCount > 0 && medicationPendingCount === 0
  );

  useEffect(() => () => { if (toastTimer.current) window.clearTimeout(toastTimer.current); }, []);

  const showToast = (message: string, action: { label: string; run: () => Promise<void> } | null = null) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    setToast(message);
    setToastAction(action);
    toastTimer.current = window.setTimeout(() => { setToast(null); setToastAction(null); }, action ? 8_000 : 4_800);
  };

  const dismissInput = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    keyboard.hide();
  };

  const closeSheet = () => {
    dismissInput();
    setSheet(null);
  };

  const recordEnergy = async (value: number) => {
    try { await mentor.actions.recordEnergy({ value: value as 1 | 2 | 3 | 4 | 5 }); setEnergy(value); showToast(`Energia ${value}/5 registrada`); }
    catch { showToast("Não foi possível salvar; seus dados anteriores foram preservados"); }
  };
  const recordArrival = async (value: string = nowTime()) => {
    closeSheet();
    try {
      const shift = mentor.snapshot?.currentShift;
      if (!shift) throw new Error("Jornada não encontrada");
      const localDateTime = combineLocalDateAndTime(
        localDateFromDateTime(shift.payload.scheduledStartLocal),
        value as LocalTime,
      );
      await mentor.actions.recordArrival({ shiftId: shift.id, localDateTime });
      setArrival(value);
      showToast(`Chegada registrada às ${value}`);
    }
    catch { showToast("Chegada não salva; o registro anterior permanece"); }
  };
  const recordDeparture = async (value: string = nowTime()) => {
    closeSheet();
    try {
      const shift = mentor.snapshot?.currentShift;
      if (!shift) throw new Error("Jornada não encontrada");
      const localDateTime = resolveShiftDepartureLocalDateTime(
        shift.payload.scheduledStartLocal,
        shift.payload.scheduledEndLocal,
        value as LocalTime,
      );
      await mentor.actions.recordDeparture({ shiftId: shift.id, localDateTime });
      setDeparture(value);
      showToast(`Saída registrada às ${value}`);
    }
    catch { showToast("Saída não salva; o registro anterior permanece"); }
  };
  const saveDomainEvent = async ({ input, message }: DomainSaveRequest) => {
    try {
      const localDate = domainInputLocalDate(input)
        ?? input.localDate
        ?? mentor.workspace?.referenceLocalDate
        ?? mentor.snapshot?.localDate
        ?? todayInTimeZone();
      await mentor.actions.recordGenericEvent({ ...input, localDate });
      closeSheet();
      showToast(message);
    } catch {
      showToast("Não foi possível salvar; seus dados anteriores foram preservados");
      throw new Error("O registro não foi salvo. Seus dados anteriores permanecem intactos.");
    }
  };
  const saveQuickCapture = async (text: string) => saveDomainEvent({
    input: {
      domain: "conhecimento",
      summary: "Quick knowledge capture explicitly recorded by the user.",
      payload: {
        schema: "knowledge-capture-v1",
        eventKind: "knowledge-capture",
        title: unknownKnowledge("not_recorded"),
        topic: unknownKnowledge("not_recorded"),
        source: {
          kind: known("quick-capture"),
          reference: unknownKnowledge("not_recorded"),
        },
        capture: known(text.trim()),
        application: unknownKnowledge("not_recorded"),
        openQuestion: unknownKnowledge("not_recorded"),
        confidence: unknownKnowledge("not_recorded"),
        nextReviewDate: unknownKnowledge("not_recorded"),
        tags: unknownKnowledge("not_recorded"),
      },
    },
    message: "Captura guardada no Arquivo",
  });
  const openDomain = (domain: DomainId) => {
    setDomainReturnTab(activeTab);
    dismissInput();
    setEditingEntity(null);
    setPreferencesOpen(false);
    if (domain === "agenda") {
      setFocusedDomain(null);
      setActiveTab("agenda");
      return;
    }
    if (domain === "rotina") setRoutineEntryMode("planning");
    if (domain === "internato") setInternatoSection("jornada");
    setFocusedDomain(domain);
    setActiveTab(domain === "financas" ? "mentor" : "register");
  };
  const openObstetrics = () => {
    setDomainReturnTab(activeTab);
    dismissInput();
    setEditingEntity(null);
    setPreferencesOpen(false);
    setInternatoSection("obstetricia");
    setFocusedDomain("internato");
    setActiveTab("register");
  };
  const openClinicalTools = () => {
    setDomainReturnTab(activeTab);
    dismissInput(); setEditingEntity(null); setPreferencesOpen(false);
    setInternatoSection("apoio"); setFocusedDomain("internato"); setActiveTab("register");
  };
  const selectInternatoSection = (section: InternatoSection) => {
    dismissInput();
    setInternatoSection(section);
  };
  const handleInternatoTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const sections: InternatoSection[] = ["jornada", "obstetricia", "apoio"];
    const index = sections.indexOf(internatoSection);
    const next = event.key === "End" ? sections.at(-1) : event.key === "Home" ? sections[0]
      : event.key === "ArrowRight" ? sections[(index + 1) % sections.length]
      : event.key === "ArrowLeft" ? sections[(index + sections.length - 1) % sections.length] : null;
    if (!next) return;
    event.preventDefault();
    selectInternatoSection(next);
    window.requestAnimationFrame(() => document.getElementById(`internato-tab-${next}`)?.focus());
  };
  const openRoutineClosure = () => {
    setDomainReturnTab(activeTab);
    dismissInput();
    setEditingEntity(null);
    setRoutineEntryMode("closure");
    setFocusedDomain("rotina");
  };
  const closeDomain = () => { dismissInput(); setFocusedDomain(null); setActiveTab(domainReturnTab); };
  const changeTab = (tab: TabId) => { dismissInput(); setEditingEntity(null); setPreferencesOpen(false); setFocusedDomain(null); setInternatoSection("jornada"); setRoutineEntryMode("planning"); setActiveTab(tab); };
  const installPwa = async () => {
    const result = await requestMentorPwaInstall();
    if (result.outcome === "manual-ios") showToast("No Safari: Compartilhar → Adicionar à Tela de Início");
    else if (result.outcome === "accepted") showToast("Instalação confirmada");
    else if (result.outcome === "already-installed") showToast("O Mentor já está instalado");
    else if (result.outcome === "dismissed") showToast("Instalação adiada; seus dados continuam intactos");
    else showToast("Instalação disponível somente em navegador compatível e HTTPS");
    setPwaState(getMentorPwaRuntimeState());
  };
  const activatePwaUpdate = async () => {
    if (!pwaUpdate) return;
    const attemptedUpdate = pwaUpdate;
    showToast("Atualizando o aplicativo com seus dados preservados…");
    try {
      const result = await activateMentorPwaUpdate(attemptedUpdate.registration, { reload: true });
      if (result.activated) {
        setPwaUpdate(null);
        return;
      }

      const pending = await getMentorPwaPendingUpdate(
        result.registration ?? attemptedUpdate.registration,
      );
      setPwaUpdate(pending);
      showToast(pending
        ? "A atualização continua pronta; toque novamente quando estiver conectado"
        : "O aplicativo já está atualizado");
    } catch {
      // An uncertain lookup must not hide an update that may still be waiting.
      const pending = await getMentorPwaPendingUpdate(attemptedUpdate.registration)
        .catch(() => attemptedUpdate);
      setPwaUpdate(pending);
      showToast("A atualização continua pronta; tente novamente quando estiver conectado");
    }
  };
  const preferences = useMemo(
    () => mentorPreferencesFromSettings(mentor.workspace?.settings ?? []),
    [mentor.workspace?.settings],
  );
  const preferenceAccessibilityClasses = useMemo(
    () => accessibilityClassNames(preferences.accessibility),
    [preferences.accessibility],
  );
  const preferenceAccessibilityKey = preferenceAccessibilityClasses.join(" ");
  useEffect(() => {
    const selected = new Set(preferenceAccessibilityClasses);
    for (const className of ACCESSIBILITY_CLASS_NAMES) {
      document.documentElement.classList.toggle(className, selected.has(className));
    }
    return () => {
      for (const className of ACCESSIBILITY_CLASS_NAMES) {
        document.documentElement.classList.remove(className);
      }
    };
  }, [preferenceAccessibilityKey]);
  const analytics60 = useMemo(() => mentor.workspace
    ? buildAnalyticsReport(mentor.workspace.entities, {
        endLocalDate: mentor.workspace.referenceLocalDate,
        days: 60,
        datasetId: mentor.workspace.dataset.id,
      })
    : null,
  [mentor.workspace]);

  const todayAnnualAlerts = useMemo(() => mentor.workspace ? annualDateAlerts(mentor.workspace.entities, mentor.workspace.referenceLocalDate) : [], [mentor.workspace]);
  const cycles = useMemo(() => reviewCycles(mentor.workspace?.referenceLocalDate ?? currentLocalDate), [mentor.workspace?.referenceLocalDate, currentLocalDate]);
  const selectedCycle = cycleSelection === "current" ? cycles[0] : cycles.find((cycle) => cycle.id === cycleSelection);
  useEffect(() => { if (cycleSelection && cycleSelection !== "current" && !selectedCycle) setCycleSelection("current"); }, [cycleSelection, selectedCycle]);
  const selectedAnalytics = useMemo(() => !selectedCycle && insightsWindow === 60 && analytics60 ? analytics60 : buildAnalyticsReport(mentor.workspace?.entities ?? [], { endLocalDate: selectedCycle?.window.end ?? mentor.workspace?.referenceLocalDate ?? todayInTimeZone(), days: selectedCycle?.window.days ?? insightsWindow, ...(mentor.workspace ? { datasetId: mentor.workspace.dataset.id } : {}) }), [analytics60, insightsWindow, mentor.workspace, selectedCycle]);

  const deleteArchiveEntity = async (entity: MentorEntity) => {
    try {
      const deleted = await mentor.actions.deleteEntity({ entityId: entity.id, expectedRevision: entity.revision });
      showToast("Registro movido para excluídos", {
        label: "Desfazer",
        run: async () => {
          await mentor.actions.restoreEntity({ entityId: deleted.id, expectedRevision: deleted.revision });
          showToast("Exclusão desfeita · registro restaurado");
        },
      });
    } catch {
      showToast("Não foi possível excluir; o registro foi preservado");
    }
  };
  const restoreArchiveEntity = async (entity: MentorEntity) => {
    try {
      await mentor.actions.restoreEntity({ entityId: entity.id, expectedRevision: entity.revision });
      showToast("Registro restaurado no histórico");
    } catch {
      showToast("Não foi possível restaurar; nenhuma outra informação mudou");
    }
  };
  const exportReadable = async (kind: "json" | "csv") => {
    const workspace = mentor.workspace;
    if (!workspace) {
      showToast("O Arquivo ainda está carregando");
      return;
    }
    const filter = {
      startLocalDate: workspace.historyWindow.start,
      endLocalDate: workspace.historyWindow.end,
    };
    const stamp = workspace.referenceLocalDate;
    let blob: Blob;
    try {
      blob = kind === "json"
        ? createJsonExport(workspace.entities, filter)
        : createCsvExport(workspace.entities, filter);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : "Não foi possível preparar a exportação legível. Seus dados continuam preservados.");
      return;
    }
    const fileName = kind === "json"
      ? `Mentor_Bauer_${stamp}.json`
      : `Mentor_Bauer_${stamp}.csv`;
    try {
      const result = await shareOrDownloadFile(blob, fileName, "Mentor Bauer");
      showToast(result === "shared" ? "Arquivo compartilhado pelo iPhone" : "Arquivo preparado para download");
    } catch {
      showToast("A exportação foi cancelada; nenhum dado foi alterado");
    }
  };

  const content = preferencesOpen ? (
    <PreferencesWorkspace
      value={preferences}
      appearanceContent={<SuiteMotionControl paused={suitePaused} reducedMotion={preferences.accessibility.reducedMotion} onPausedChange={setSuitePaused} />}
      storage={mentor.workspace?.storage ?? null}
      saving={mentor.saving}
      onBack={() => setPreferencesOpen(false)}
      onSave={async (nextPreferences) => {
        await mentor.actions.saveSetting(MENTOR_PREFERENCES_SETTING_KEY, nextPreferences);
        showToast("Preferências aplicadas ao Mentor");
      }}
      onRequestPersistence={async () => {
        try {
          const result = await mentor.actions.requestStoragePersistence();
          showToast(result.storage.persisted ? "Proteção persistente confirmada" : "O iPhone não confirmou a proteção; mantenha backups recentes");
        } catch {
          showToast("O estado de proteção não pôde ser atualizado; seus dados foram preservados");
        }
      }}
    />
  ) : editingEntity ? (
    <div className="page inner-page revision-editor-workspace" data-testid="revision-editor-workspace">
      <button type="button" className="back-button" onClick={() => setEditingEntity(null)}><ArrowLeft size={18} />Voltar ao Arquivo</button>
      <EntityRevisionEditor entityId={editingEntity.id} expectedType={editingEntity.type} title="Corrigir registro" onChanged={async () => { await mentor.refresh(); showToast("Nova revisão salva · versão anterior preservada"); }} />
    </div>
  ) : focusedDomain === "exames" ? (
    <LaboratoryWorkspace entities={mentor.workspace?.entities ?? []} currentLocalDate={currentLocalDate} onBack={closeDomain} onSave={async (payload, original) => {
      if (original) { await updateLaboratoryPanel({ entityId: original.id, expectedRevision: original.revision, payload }); await mentor.refresh(); }
      else await mentor.actions.recordGenericEvent({ domain: "exames", payload, localDate: payload.collectedOn, summary: "Painel laboratorial pessoal registrado sem interpretação clínica." });
    }} />
  ) : focusedDomain === "financas" ? (
    <FinanceWorkspace currentLocalDate={mentor.workspace?.referenceLocalDate ?? todayInTimeZone()} onBack={closeDomain} onDataChange={() => { void mentor.refresh(); }} onOpenSubscription={() => setSheet({ kind: "domain", domain: "financas", initialMode: "finance-subscription" })} workspaceDataRevision={mentor.workspace?.dataset.dataRevision} />
  ) : focusedDomain === "medicamentos" ? (
    <MedicationWorkspace currentLocalDate={mentor.workspace?.referenceLocalDate ?? mentor.snapshot?.localDate ?? todayInTimeZone()} onBack={closeDomain} onDataChange={() => { void Promise.all([mentor.refresh(), medicationToday.refresh()]); }} onOpenSupplemental={(initialMode) => setSheet({ kind: "domain", domain: "medicamentos", initialMode })} />
  ) : focusedDomain === "internato" ? (
    <div className="page inner-page internato-workspace" data-testid="internato-workspace">
      <button type="button" className="back-button" onClick={() => { dismissInput(); setFocusedDomain(null); setInternatoSection("jornada"); }}><ArrowLeft size={18} />Voltar</button>
      <PageHeader eyebrow="Diário clínico e ferramentas de plantão" title="Internato" copy="Jornada e calculadoras ficam no mesmo território, mas os dados clínicos das ferramentas nunca entram no seu histórico." icon={<FirstAid size={28} weight="thin" />} />
      <div className="internato-section-tabs" role="tablist" aria-label="Áreas do Internato" onKeyDown={handleInternatoTabKeyDown}>
        <button id="internato-tab-jornada" type="button" role="tab" aria-selected={internatoSection === "jornada"} aria-controls="internato-panel-jornada" tabIndex={internatoSection === "jornada" ? 0 : -1} onClick={() => selectInternatoSection("jornada")}><Clock size={17} />Jornada</button>
        <button id="internato-tab-obstetricia" type="button" role="tab" aria-selected={internatoSection === "obstetricia"} aria-controls="internato-panel-obstetricia" tabIndex={internatoSection === "obstetricia" ? 0 : -1} onClick={() => selectInternatoSection("obstetricia")}><Calculator size={17} />Obstetrícia</button>
        <button id="internato-tab-apoio" type="button" role="tab" aria-selected={internatoSection === "apoio"} aria-controls="internato-panel-apoio" tabIndex={internatoSection === "apoio" ? 0 : -1} onClick={() => selectInternatoSection("apoio")}><BookOpen size={17} />Consulta rápida</button>
      </div>
      <div id="internato-panel-jornada" role="tabpanel" aria-labelledby="internato-tab-jornada" hidden={internatoSection !== "jornada"}>{internatoSection === "jornada" ? <>
          <InternatoShiftControl
            shifts={mentor.workspace?.entities.filter((entity): entity is MentorEntity<"internato.shift"> => entity.type === "internato.shift") ?? []}
            referenceDate={mentor.workspace?.referenceLocalDate ?? mentor.snapshot?.localDate ?? todayInTimeZone()}
            preferredShiftId={mentor.snapshot?.currentShift?.id}
            actions={mentor.actions}
            saving={mentor.saving}
            onSaved={() => { showToast("Jornada atualizada · métricas recalculadas"); }}
          />
          <button type="button" className="secondary-cta" onClick={() => setSheet({ kind: "domain", domain: "internato" })}><ClipboardText size={18} />Registrar participação e aprendizado</button>
        </> : null}</div>
      <div id="internato-panel-obstetricia" role="tabpanel" aria-labelledby="internato-tab-obstetricia" hidden={internatoSection !== "obstetricia"}>{internatoSection === "obstetricia" ? <ObstetricsWorkspace referenceDate={mentor.workspace?.referenceLocalDate ?? mentor.snapshot?.localDate ?? todayInTimeZone()} /> : null}</div>
      <div id="internato-panel-apoio" role="tabpanel" aria-labelledby="internato-tab-apoio" hidden={internatoSection !== "apoio"}>{internatoSection === "apoio" ? <ClinicalToolsWorkspace entities={mentor.workspace?.entities ?? []} soapDraft={internatoSoap} onSoapDraftChange={setInternatoSoap} onSaveReference={async (payload) => { await mentor.actions.recordGenericEvent({ domain: "conhecimento", payload, localDate: currentLocalDate, summary: "Referência pessoal adicionada ao catálogo, sem validação clínica automática." }); }} /> : null}</div>
    </div>
  ) : focusedDomain === "estudos" ? (
    <StudiesWorkspace
      currentLocalDate={mentor.workspace?.referenceLocalDate ?? mentor.snapshot?.localDate ?? todayInTimeZone()}
      studyGoalDefaults={preferences.studyGoals}
      onBack={closeDomain}
      onDataChange={() => { void mentor.refresh(); }}
    />
  ) : focusedDomain === "rotina" ? (
    <RoutineWorkspace
      currentLocalDate={mentor.workspace?.referenceLocalDate ?? mentor.snapshot?.localDate ?? todayInTimeZone()}
      initialMode={routineEntryMode}
      onBack={() => { setFocusedDomain(null); setRoutineEntryMode("planning"); }}
      onDataChange={() => { void mentor.refresh(); }}
    />
  ) : focusedDomain ? (
    <DomainScreen domain={focusedDomain} visualDemo={visualDemo} analytics={selectedAnalytics.domains[focusedDomain]} sleepGoal={preferences.sleepGoal} onBack={closeDomain} onRegister={() => setSheet({ kind: "domain", domain: focusedDomain })} />
  ) : activeTab === "today" ? (
    <TodayScreen retentionDue={retentionDue} onRetention={() => changeTab("archive")} annualAlerts={todayAnnualAlerts} onAgenda={() => setActiveTab("agenda")} visualDemo={visualDemo} report={analytics60} currentShift={mentor.snapshot?.currentShift ?? null} lastBackupCreatedAt={mentor.snapshot?.lastBackupCreatedAt ?? null} energy={energy} arrival={arrival} departure={departure} medicationDone={medicationDone} medicationPlannedCount={visualDemo ? 1 : medicationPlannedCount} medicationPendingCount={visualDemo ? 0 : medicationPendingCount} saveState={mentor.error ? "error" : mentor.saving ? "saving" : "saved"} online={online} pwaState={pwaState} offlineReady={offlineReady} updateAvailable={Boolean(pwaUpdate)} onUpdate={() => void activatePwaUpdate()} onInstall={() => void installPwa()} onEnergy={recordEnergy} onContinue={() => openDomain("internato")} onMedication={() => openDomain("medicamentos")} onDeparture={() => setSheet({ kind: "departure" })} onFinance={() => openDomain("financas")} onCloseDay={openRoutineClosure} onMetric={() => setActiveTab("mentor")} onBackup={() => setSheet({ kind: "backup" })} />
  ) : activeTab === "agenda" ? (mentor.workspace
      ? <AgendaScreen workspace={mentor.workspace} onDataChange={() => { void mentor.refresh(); }} />
      : <WorkspaceGate title="Agenda" loading={mentor.loading} error={mentor.error} onRetry={() => { void mentor.refresh(); }} />)
    : activeTab === "register" ? <RegisterScreen onDomain={(domain) => { if (["agenda", "financas", "internato", "medicamentos", "estudos", "rotina", "exames"].includes(domain)) openDomain(domain); else setSheet({ kind: "domain", domain }); }} onObstetrics={openObstetrics} onClinicalTools={openClinicalTools} onQuickCapture={saveQuickCapture} />
      : activeTab === "mentor" ? (mentor.workspace
          ? <MentorScreen visualDemo={visualDemo} workspace={mentor.workspace} onDomain={openDomain} report={selectedAnalytics} windowDays={insightsWindow} onWindowChange={(days) => { setCycleSelection(null); setInsightsWindow(days); }} cycles={cycles} cycleSelection={cycleSelection} onCycleChange={setCycleSelection} reducedMotion={preferences.accessibility.reducedMotion} signalId={metricSignal} onSignalChange={setMetricSignal} />
          : <WorkspaceGate title="Mentor" loading={mentor.loading} error={mentor.error} onRetry={() => { void mentor.refresh(); }} />)
        : mentor.workspace
          ? <><ArchiveWorkspace maintenance={<ProtectedRetentionWorkspace dataRevision={mentor.workspace.dataset.dataRevision} onDataChange={() => { void mentor.refresh(); }} onBackup={() => setSheet({ kind: "backup" })} />} entities={mentor.workspace.entities} deletedEntities={mentor.workspace.deletedEntities} currentLocalDate={mentor.workspace.referenceLocalDate} storage={mentor.workspace.storage} onBackup={() => setSheet({ kind: "backup" })} onRestore={() => setSheet({ kind: "restore" })} onPreferences={() => { dismissInput(); setEditingEntity(null); setPreferencesOpen(true); }} onEdit={(entity) => { dismissInput(); setEditingEntity(entity); }} onDelete={deleteArchiveEntity} onRestoreEntity={restoreArchiveEntity} onRequestPersistence={async () => { const result = await mentor.actions.requestStoragePersistence(); showToast(result.storage.persisted ? "Proteção persistente confirmada" : "O iPhone não confirmou a proteção; mantenha backups recentes"); }} onExportJson={() => exportReadable("json")} onExportCsv={() => exportReadable("csv")} onClinicianReport={() => setSheet({ kind: "clinician" })} /><RestoreConflictReviewLauncher onOpen={() => setSheet({ kind: "conflicts" })} /></>
          : <WorkspaceGate title="Arquivo" loading={mentor.loading} error={mentor.error} onRetry={() => { void mentor.refresh(); }} />;

  return <div ref={suiteRootRef} className="suite-shell" data-suite-module="mentor" data-suite-theme={suiteTheme}>
    <SuiteBackdrop module="mentor" theme={suiteTheme} paused={suitePaused || preferences.accessibility.reducedMotion} />
    <div className="suite-content">
    <MobileScroll key={preferencesOpen ? "preferences" : focusedDomain ?? activeTab} className={`app-screen mentor-shell ${preferenceAccessibilityKey}`.trim()}><main className="screen-content" data-testid="mentor-app">{content}</main></MobileScroll>
    <div className="suite-quick-controls"><SuiteAppearanceControls theme={suiteTheme} onThemeChange={setSuiteTheme} /></div>
    <BottomNav active={activeTab} onChange={changeTab} />
    {toast ? <div className="mentor-toast" role="status" aria-live="polite"><CheckCircle size={18} weight="fill" /><span>{toast}</span>{toastAction ? <button type="button" onClick={() => { const action = toastAction; setToastAction(null); void action.run().catch(() => showToast("Não foi possível desfazer; o registro segue recuperável no Arquivo")); }}>{toastAction.label}</button> : null}</div> : null}
    <ActionSheets
      visualDemo={visualDemo}
      localDate={mentor.workspace?.referenceLocalDate ?? mentor.snapshot?.localDate ?? todayInTimeZone()}
      entities={mentor.workspace?.entities ?? []}
      state={sheet}
      onClose={closeSheet}
      onArrival={recordArrival}
      onDeparture={recordDeparture}
      onOpenMedications={() => { closeSheet(); openDomain("medicamentos"); }}
      onBackup={async (passphrase) => {
        const result = await exportEncryptedBackup(passphrase);
        const delivery = await shareOrDownloadFile(result.blob, result.fileName, "Backup privado do Mentor Bauer");
        if (delivery === "shared") {
          await confirmEncryptedBackupDelivery(result.deliveryReceipt);
          await mentor.refresh();
          closeSheet();
          showToast("Backup cifrado entregue pela folha de compartilhamento");
        }
        return { delivery, receipt: result.deliveryReceipt, fileName: result.fileName };
      }}
      onConfirmDownloadedBackup={async (receipt) => {
        await confirmEncryptedBackupDelivery(receipt);
        await mentor.refresh();
        closeSheet();
        showToast("Backup confirmado em Arquivos/Downloads");
      }}
      onRestoreApplied={async (result) => {
        const appliedCount = result.createdEntityIds.length + result.restoredSeedEntityIds.length + result.addedSettingKeys.length;
        window.dispatchEvent(new Event(RESTORE_CONFLICTS_CHANGED_EVENT));
        try {
          await mentor.refresh();
          closeSheet();
          showToast(result.conflicts.length
            ? `${appliedCount} item(ns) e ${result.importedRevisionCount} versão(ões) aplicados · ${result.conflicts.length} em Arquivo > Conflitos`
            : appliedCount
              ? `${appliedCount} item(ns) e ${result.importedRevisionCount} versão(ões) recuperados`
              : "Backup conferido · nada novo para aplicar");
        } catch {
          closeSheet();
          showToast("Backup aplicado; a atualização visual ficará pronta ao reabrir o app");
        }
      }}
      onLegacyApplied={async (result) => { await mentor.refresh(); showToast(result.conflicts.length ? `Beta importado · ${result.conflicts.length} conflito(s) preservado(s)` : "Beta importado com snapshot reversível"); }}
      onLegacyRolledBack={async () => { await mentor.refresh(); showToast("Importação beta revertida com segurança"); }}
      onClinicianReportReady={async (report) => { const result = await shareOrDownloadFile(report.blob, report.fileName, "Relatório privado do Mentor Bauer"); closeSheet(); showToast(result === "shared" ? "Relatório aberto na folha de compartilhamento" : "Relatório preparado para download"); }}
      onSaved={saveDomainEvent}
      onNotice={(message) => { closeSheet(); showToast(message); }}
    />
    </div>
  </div>;
}

function BrandHeader({ saveState, online, lastBackupCreatedAt, onBackup }: { saveState: string; online: boolean; lastBackupCreatedAt: string | null; onBackup: () => void }) {
  const saveLabel = saveState === "saving" ? "Salvando…" : saveState === "error" ? "Revisar salvamento" : "Salvo";
  const backupAgeDays = lastBackupCreatedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(lastBackupCreatedAt)) / 86_400_000))
    : null;
  const backupLabel = backupAgeDays === null ? "Fazer backup" : backupAgeDays === 0 ? "Backup hoje" : backupAgeDays === 1 ? "Backup ontem" : backupAgeDays < 7 ? `Backup há ${backupAgeDays}d` : "Backup atrasado";
  return <header className="brand-header">
    <div className="brand-lockup"><CompassRose className="brand-mark" size={34} weight="thin" /><div><p className="brand-name">Mentor Bauer</p><p className="brand-identity">Bauer Vieira · nº 7 · UNIFIMES</p></div></div>
    <div className="header-status" aria-label="Estado do aplicativo"><span><CloudCheck size={18} />{saveLabel} · {online ? "Online" : "Offline"}</span><button type="button" data-attention={backupAgeDays === null || backupAgeDays >= 7 || undefined} onClick={onBackup} aria-label={`${backupLabel}. Criar backup privado`}><ArrowCounterClockwise size={18} />{backupLabel}</button></div>
  </header>;
}

function TodayScreen({ retentionDue, onRetention, annualAlerts, onAgenda, visualDemo, report, currentShift, lastBackupCreatedAt, energy, arrival, departure, medicationDone, medicationPlannedCount, medicationPendingCount, saveState, online, pwaState, offlineReady, updateAvailable, onUpdate, onInstall, onEnergy, onContinue, onMedication, onDeparture, onFinance, onCloseDay, onMetric, onBackup }: {
  annualAlerts: AnnualOccurrence[]; onAgenda: () => void;
  retentionDue: boolean | null; onRetention: () => void;
  visualDemo: boolean; report: AnalyticsReport | null; currentShift: MentorEntity<"internato.shift"> | null; lastBackupCreatedAt: string | null; energy: number | null; arrival: string | null; departure: string | null; medicationDone: boolean;
  medicationPlannedCount: number; medicationPendingCount: number;
  saveState: string; online: boolean; pwaState: MentorPwaRuntimeState; offlineReady: boolean; updateAvailable: boolean; onUpdate: () => void; onInstall: () => void; onEnergy: (value: number) => void; onContinue: () => void;
  onMedication: () => void; onDeparture: () => void; onFinance: () => void; onCloseDay: () => void; onMetric: () => void; onBackup: () => void;
}) {
  const date = visualDemo ? new Date(2026, 8, 1, 12) : new Date();
  const assignment = currentShift?.payload.assignment.state === "known" ? currentShift.payload.assignment.value : null;
  const location = currentShift?.payload.location.state === "known" ? currentShift.payload.location.value : null;
  const plannedStart = currentShift?.payload.scheduledStartLocal.slice(11, 16) ?? null;
  const plannedEnd = currentShift?.payload.scheduledEndLocal.slice(11, 16) ?? null;
  const plannedWindow = plannedStart && plannedEnd ? `${plannedStart}–${plannedEnd}` : null;
  const chapterStatus = currentShift
    ? currentShift.payload.scheduleState === "confirmed_planned" ? "programada" : "a confirmar"
    : "sem dado confirmado";
  const shiftHeading = visualDemo ? "Enfermaria obstétrica" : assignment ?? (currentShift ? "Setor não confirmado" : "Jornada sem dado confirmado");
  const medicationTitle = visualDemo
    ? medicationDone ? "Medicação das 08:00 confirmada" : "Confirmar medicação das 08:00"
    : medicationPlannedCount === 0
      ? "Cadastrar horários de medicação"
      : medicationDone
        ? `Todas as ${medicationPlannedCount} dose${medicationPlannedCount === 1 ? "" : "s"} registradas`
        : `${medicationPendingCount} dose${medicationPendingCount === 1 ? "" : "s"} sem registro`;
  const departureTitle = departure
    ? `Saída registrada às ${departure}`
    : visualDemo ? "Registrar saída às 19:00"
      : plannedEnd ? `Registrar saída · previsão ${plannedEnd}` : "Registrar saída";
  const hasCurrentShift = visualDemo || Boolean(currentShift);
  return <div className="page today-page" data-testid="today-screen">
    <BrandHeader saveState={saveState} online={online} lastBackupCreatedAt={lastBackupCreatedAt} onBackup={onBackup} />
    <PwaStatusStrip state={pwaState} offlineReady={offlineReady} updateAvailable={updateAvailable} onUpdate={onUpdate} onInstall={onInstall} />
    <section className="today-heading" aria-labelledby="today-title"><h1 id="today-title">Hoje</h1><span>·</span><p>{formatLongDate(date)}</p></section>
    {annualAlerts.length ? <button type="button" className="annual-today-alert" onClick={onAgenda}><CalendarDots size={26} weight="thin" /><span><strong>{annualAlerts.length === 1 ? "Uma data para lembrar" : `${annualAlerts.length} datas para lembrar`}</strong><small>{annualAlerts.slice(0, 3).map((item) => `${item.title} · ${formatAgendaDate(item.localDate)}`).join("; ")}{annualAlerts.length > 3 ? `; mais ${annualAlerts.length - 3}` : ""}</small></span><CaretRight size={17} /></button> : null}

    <section className="chapter-rail" aria-label="Capítulos do dia">
      {visualDemo
        ? <div className="chapter-step complete"><Check size={17} weight="bold" /><span><strong>Manhã</strong><small>concluída</small></span></div>
        : <div className="chapter-step future"><Circle size={28} weight="thin" /><span><strong>Manhã</strong><small>não confirmada</small></span></div>}
      <span className="chapter-line" />
      <div className={`chapter-step ${currentShift || visualDemo ? "current" : "future"}`}>{currentShift || visualDemo ? <span className="current-orb" /> : <Circle size={28} weight="thin" />}<span><strong>{visualDemo ? "Internato" : "Escala"}</strong><small>{visualDemo ? "agora" : chapterStatus}</small></span></div>
      <span className="chapter-line" />
      <div className="chapter-step future"><Circle size={28} weight="thin" /><span><strong>Noite</strong><small>depois</small></span></div>
      <p className="swipe-hint">manhã · compromisso principal · noite</p>
    </section>

    <section className="chapter-now ruled-section">
      <div className="section-title icon-gold"><BookOpen size={25} weight="thin" /><h2>{visualDemo ? "Seu capítulo agora" : currentShift ? "Jornada prevista" : "Jornada de hoje"}</h2></div>
      <h3>{shiftHeading} {(visualDemo || plannedWindow) ? <span>· {visualDemo ? "07:00–19:00" : `previsto ${plannedWindow}`}</span> : null}</h3>
      {!visualDemo && location ? <p className="arrival-line">Local confirmado · {location}</p> : null}
      <p className="arrival-line">{arrival ? <>Chegada {arrival} <span className="positive">· {visualDemo && arrival === "06:52" ? "8 min antecipado" : "registrada"}</span></> : <>Chegada <span className="unknown">· dado não confirmado</span></>}</p>
      {departure ? <p className="departure-note">Saída registrada às {departure}</p> : null}
      <button type="button" className="primary-cta" onClick={onContinue}><CompassRose size={26} weight="thin" /><span>Continuar meu dia</span><CaretRight size={24} weight="light" /></button>
    </section>

    <section className="essentials ruled-section">
      <div className="section-title icon-gold"><ClipboardText size={25} weight="thin" /><h2>Três essenciais</h2></div>
      <ActionRow icon={<Clock size={24} weight="thin" />} tone="wine" title={medicationTitle} state={medicationDone ? "Completo" : medicationPlannedCount > 0 ? `${medicationPlannedCount - medicationPendingCount}/${medicationPlannedCount}` : undefined} onClick={onMedication} />
      {hasCurrentShift
        ? <ActionRow icon={<SignOut size={24} weight="thin" />} tone="blue" title={departureTitle} onClick={onDeparture} />
        : <ActionRow icon={<CalendarDots size={24} weight="thin" />} tone="blue" title="Planejar próxima jornada" subtitle="Abrir Internato e organizar a escala" onClick={onContinue} />}
      <ActionRow icon={<Wallet size={24} weight="thin" />} tone="green" title={visualDemo ? "Revisar PicPay · vence amanhã" : "Revisar contas e vencimentos"} subtitle="Mercado Pago, Banco do Brasil e PicPay" onClick={onFinance} />
    </section>

    <section className="gentle-checkin ruled-section">
      <div className="section-title icon-blue"><Heart size={25} weight="thin" /><h2>Check-in gentil</h2></div>
      <p>Como está sua energia agora?</p>
      <div className="energy-scale" role="group" aria-label="Energia de 1 a 5">
        {[1, 2, 3, 4, 5].map((value) => <button key={value} type="button" className={energy === value ? "selected" : ""} aria-pressed={energy === value} aria-label={`Energia ${value} de 5`} onClick={() => onEnergy(value)}>{value}</button>)}
      </div>
      <p className="microcopy">Sem diagnóstico · dado para revisar depois</p>
      <button type="button" className="secondary-cta" onClick={onCloseDay}><CheckCircle size={20} weight="thin" />Fechar meu dia<CaretRight size={17} weight="light" /></button>
    </section>

    {retentionDue ? <ActionRow icon={<Archive size={24} weight="thin" />} tone="wine" title="Revisar o arquivo deste mês" subtitle="Só retirar dados antigos com backup reaberto e conferido" onClick={onRetention} /> : null}
    {retentionDue === null ? <ActionRow icon={<Archive size={24} weight="thin" />} tone="wine" title="Conferir a revisão do arquivo" subtitle="A verificação automática não pôde ser concluída; nenhum registro foi removido" onClick={onRetention} /> : null}
    <InsightCard visualDemo={visualDemo} report={report} onMetric={onMetric} />
    <p className="retention-note">60 dias no painel · 365 dias preservados</p>
  </div>;
}

function PwaStatusStrip({ state, offlineReady, updateAvailable, onUpdate, onInstall }: { state: MentorPwaRuntimeState; offlineReady: boolean; updateAvailable: boolean; onUpdate: () => void; onInstall: () => void }) {
  if (updateAvailable) {
    return <button type="button" className="pwa-status-strip pwa-install" data-state="update" onClick={onUpdate}><ArrowCounterClockwise size={18} /><span><strong>Atualização pronta</strong><small>Toque para ativar a nova versão; os registros locais permanecem intactos.</small></span><CaretRight size={17} /></button>;
  }
  if (state.runtimeMode === "standalone") {
    return <div className="pwa-status-strip" data-state={offlineReady ? "ready" : "checking"}><CloudCheck size={18} weight={offlineReady ? "fill" : "thin"} /><span><strong>Aplicativo instalado</strong><small>{offlineReady ? "Conteúdo essencial verificado para uso offline" : "Preparando conteúdo offline…"}</small></span></div>;
  }
  if (state.installMode === "manual-ios") {
    return <button type="button" className="pwa-status-strip pwa-install" onClick={onInstall}><Plus size={18} /><span><strong>Instalar neste iPhone</strong><small>Faça isso antes de registrar dados importantes; Safari e o ícone usam armazenamentos separados.</small></span><CaretRight size={17} /></button>;
  }
  if (state.installMode === "prompt") {
    return <button type="button" className="pwa-status-strip pwa-install" onClick={onInstall}><Plus size={18} /><span><strong>Instalar Mentor Bauer</strong><small>Acesso rápido e funcionamento offline depois da preparação.</small></span><CaretRight size={17} /></button>;
  }
  return null;
}

function ActionRow({ icon, tone, title, subtitle, state, onClick }: { icon: ReactNode; tone: string; title: string; subtitle?: string; state?: string; onClick: () => void }) {
  return <button type="button" className="action-row" data-tone={tone} onClick={onClick}>
    <span className="action-icon" aria-hidden="true">{icon}</span><span className="action-copy"><strong>{title}</strong>{subtitle ? <small>{subtitle}</small> : null}{state ? <small className="row-state">{state}</small> : null}</span><CaretRight className="row-caret" size={19} weight="light" />
  </button>;
}

function InsightCard({ visualDemo, report, onMetric }: { visualDemo: boolean; report: AnalyticsReport | null; onMetric: () => void }) {
  const nextAction = report?.nextActions[0] ?? null;
  return <section className="insight-card" aria-labelledby="insight-title">
    <div className="insight-heading"><TrendUp size={24} weight="thin" /><h2 id="insight-title">Insight útil do Mentor</h2>{visualDemo ? <span className="visual-sample-label">Amostra visual</span> : null}</div>
    {visualDemo ? <>
      <p>Blocos curtos foram concluídos em <strong>18 de 23</strong> dias semelhantes.</p><small>Janela: 60 dias · 4 dias sem dado</small><MiniSignal />
      <div className="insight-disclaimer"><Info size={17} /><span>Associação observada · não prova causa</span><button type="button" onClick={onMetric}>Ver métrica completa <CaretRight size={17} /></button></div>
    </> : nextAction ? <div className="insight-real"><Lightbulb size={24} weight="thin" /><div><p>{nextAction.title}</p><small>{nextAction.reason}</small><span>Janela: {nextAction.evidence.window.days} dias · n={nextAction.evidence.n} · {nextAction.evidence.missing} faltante{nextAction.evidence.missing === 1 ? "" : "s"}</span></div><button type="button" onClick={onMetric}>Ver evidência <CaretRight size={16} /></button></div> : <div className="insight-empty"><ChartLineUp size={25} weight="thin" /><div><p>Ainda estamos reunindo evidência para uma próxima ação.</p><small>{report ? `${report.n} registros em ${report.observedDays} dias · ${report.missingDays} dias sem registro` : "Carregando histórico"} · ausência de registro não vira “não”</small></div><button type="button" onClick={onMetric}>Como funciona <CaretRight size={16} /></button></div>}
  </section>;
}

function MiniSignal() {
  return <div className="mini-signal" aria-label="Duas séries de tendência em 60 dias"><ResponsiveContainer width="100%" height="100%"><LineChart data={demoSignal} margin={{ top: 7, right: 8, bottom: 4, left: 8 }}><Line type="monotone" dataKey="foco" stroke="#f8cf37" strokeWidth={2} dot={{ r: 2.2, fill: "#f8cf37", strokeWidth: 0 }} isAnimationActive={false} /><Line type="monotone" dataKey="energia" stroke="#4a89f6" strokeWidth={2} dot={{ r: 2, fill: "#4a89f6", strokeWidth: 0 }} isAnimationActive={false} /></LineChart></ResponsiveContainer></div>;
}

function PageHeader({ eyebrow, title, copy, icon }: { eyebrow: string; title: string; copy: string; icon: ReactNode }) {
  return <header className="page-header"><div className="page-header-icon" aria-hidden="true">{icon}</div><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{copy}</p></div></header>;
}

function WorkspaceGate({ title, loading, error, onRetry }: { title: string; loading: boolean; error: Error | null; onRetry: () => void }) {
  return <div className="page inner-page" aria-busy={loading ? "true" : undefined}>
    <PageHeader eyebrow="Memória local" title={title} copy={loading ? "Abrindo os registros preservados neste iPhone." : "Os dados continuam no aparelho; tente reabrir a leitura."} icon={<Archive size={28} weight="thin" />} />
    <section className="editorial-card workspace-gate" role={error ? "alert" : "status"}>
      <ShieldCheck size={26} weight="thin" />
      <div><h2>{loading ? "Carregando sem alterar nada" : "Leitura temporariamente indisponível"}</h2><p>{loading ? "Nenhum vazio será interpretado como ausência enquanto a base abre." : "O aplicativo não apagou nem substituiu o histórico."}</p></div>
      {!loading ? <button type="button" className="secondary-cta" onClick={onRetry}>Tentar novamente</button> : null}
    </section>
  </div>;
}

function knownText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && (value as { state?: unknown }).state === "known") {
    const knownValue = (value as { value?: unknown }).value;
    return typeof knownValue === "string" && knownValue.trim() ? knownValue.trim() : null;
  }
  return null;
}

function knownBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value && typeof value === "object" && (value as { state?: unknown }).state === "known") {
    const knownValue = (value as { value?: unknown }).value;
    return typeof knownValue === "boolean" ? knownValue : null;
  }
  return null;
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function validLocalDate(value: string | null): LocalDate | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
    ? value as LocalDate
    : null;
}

function domainInputLocalDate(input: DomainSaveRequest["input"]): LocalDate | null {
  const payload = input.payload as Record<string, unknown>;
  const kind = knownText(payload.eventKind) ?? (typeof payload.eventKind === "string" ? payload.eventKind : "");
  if (kind === "agenda-event" || kind === "agenda-task") {
    return validLocalDate(knownText(valueAtPath(payload, "date")));
  }
  if (kind === "finance-transaction") {
    return validLocalDate(knownText(valueAtPath(payload, "transaction.occurredOn")));
  }
  return null;
}

function formatAgendaDate(localDate: string): string {
  const [year, month, day] = localDate.split("-").map(Number);
  if (![year, month, day].every(Number.isFinite)) return localDate;
  return new Intl.DateTimeFormat("pt-BR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, day)))
    .replace(/\./g, "");
}

function AgendaScreen({ workspace, onDataChange }: { workspace: MentorWorkspace | null; onDataChange: () => void }) {
  const referenceDate = workspace?.referenceLocalDate ?? todayInTimeZone();
  const [selectedDate, setSelectedDate] = useState<LocalDate>(referenceDate);
  useEffect(() => setSelectedDate(referenceDate), [referenceDate]);
  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, index) => shiftLocalDate(referenceDate, index)), [referenceDate]);
  const agendaItems = useMemo(() => (workspace?.entities ?? []).flatMap((entity) => {
    if (entity.type === "internato.shift") {
      const shift = entity as MentorEntity<"internato.shift">;
      const title = shift.payload.assignment.state === "known" ? shift.payload.assignment.value : "Jornada de internato";
      return [{
        id: shift.id,
        localDate: shift.payload.scheduledStartLocal.slice(0, 10),
        time: `${shift.payload.scheduledStartLocal.slice(11, 16)}–${shift.payload.scheduledEndLocal.slice(11, 16)}`,
        title,
        state: shift.payload.scheduleState === "confirmed_planned" ? "Escala confirmada" : "Escala ainda não confirmada",
        confirmed: shift.payload.scheduleState === "confirmed_planned",
      }];
    }
    if (entity.type === "agenda.task" || entity.type === "agenda.event") {
      const item = entity as MentorEntity<"agenda.task"> | MentorEntity<"agenda.event">;
      const plannedStart = item.payload.plannedStartLocal.state === "known" ? item.payload.plannedStartLocal.value : null;
      const plannedEnd = item.payload.plannedEndLocal.state === "known" ? item.payload.plannedEndLocal.value : null;
      const dueDate = item.payload.dueLocalDate.state === "known" ? item.payload.dueLocalDate.value : null;
      const dueTime = item.payload.dueLocalTime.state === "known" ? item.payload.dueLocalTime.value : null;
      const status = item.payload.status;
      const isTask = item.type === "agenda.task";
      const statusLabels: Record<string, string> = {
        captured: "capturada",
        planned: "planejada",
        in_progress: "em andamento",
        completed: "concluída",
        deferred: "adiada",
        cancelled: "cancelada",
        tentative: "a confirmar",
        confirmed: "confirmada",
      };
      return [{
        id: item.id,
        localDate: plannedStart?.slice(0, 10) ?? dueDate ?? item.localDate,
        time: plannedStart
          ? `${plannedStart.slice(11, 16)}${plannedEnd ? `–${plannedEnd.slice(11, 16)}` : ""}`
          : dueTime ?? "horário não informado",
        title: item.payload.title,
        state: `${isTask ? "Tarefa" : "Evento"} · ${statusLabels[status] ?? status}`,
        confirmed: status === "confirmed" || status === "completed" || status === "in_progress",
      }];
    }
    if (entity.domain !== "agenda" || entity.type !== "generic.event") return [];
    const payload = entity.payload as Record<string, unknown>;
    if (payload.schema === ANNUAL_DATE_SCHEMA || payload.eventKind === "agenda-annual-date") return [];
    const eventKind = knownText(payload.eventKind) ?? (typeof payload.eventKind === "string" ? payload.eventKind : "agenda-item");
    const event = payload.event && typeof payload.event === "object" ? payload.event as Record<string, unknown> : {};
    const task = payload.task && typeof payload.task === "object" ? payload.task as Record<string, unknown> : {};
    const eventConfirmed = knownBoolean(event.confirmation);
    const eventStart = knownText(event.startLocal);
    const eventEnd = knownText(event.endLocal);
    return [{
      id: entity.id,
      localDate: knownText(payload.date) ?? entity.localDate,
      time: eventStart ? `${eventStart}${eventEnd ? `–${eventEnd}` : ""}` : knownText(task.dueLocal) ?? "horário não informado",
      title: knownText(payload.title) ?? (eventKind === "agenda-task" ? "Tarefa sem título" : "Evento sem título"),
      state: eventKind === "agenda-task"
        ? (knownText(task.status) ?? "estado não confirmado")
        : eventConfirmed === true ? "evento confirmado" : eventConfirmed === false ? "evento não confirmado" : "confirmação desconhecida",
      confirmed: eventKind === "agenda-task" ? knownText(task.status) === "done" : eventConfirmed === true,
    }];
  }).filter((item) => item.localDate >= referenceDate).sort((left, right) => `${left.localDate}T${left.time}`.localeCompare(`${right.localDate}T${right.time}`)), [referenceDate, workspace]);

  const annualItems = useMemo(() => projectAnnualDates(workspace?.entities ?? [], referenceDate, shiftLocalDate(referenceDate, 366)).occurrences.map((item) => ({ id: item.key, localDate: item.localDate, time: "Dia inteiro · não reserva horário", title: item.title, state: item.kind === "birthday" ? "Aniversário" : "Compromisso anual", confirmed: true })), [workspace, referenceDate]);
  const selectedItems = [...agendaItems, ...annualItems].filter((item) => item.localDate === selectedDate);
  const selectedLabel = selectedDate === referenceDate ? "Hoje" : formatAgendaDate(selectedDate);
  return <div className="page inner-page" data-testid="agenda-screen">
    <PageHeader eyebrow="Planejamento com folga cognitiva" title="Agenda" copy="O que é certo, o que é próximo e o que ainda não foi confirmado." icon={<CalendarDots size={28} weight="thin" />} />
    <section className="week-strip" aria-label="Próximos sete dias">
      {weekDates.map((date) => { const civil = new Date(`${date}T12:00:00Z`); return <button key={date} type="button" className={date === selectedDate ? "active" : ""} aria-pressed={date === selectedDate} aria-label={`Ver ${formatAgendaDate(date)}`} onClick={() => setSelectedDate(date)}><small>{new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" }).format(civil).replace(".", "")}</small><strong>{Number(date.slice(8, 10))}</strong></button>; })}
    </section>
    <section className="editorial-card agenda-now"><p className="eyebrow">{selectedLabel} · {selectedItems.length} {selectedItems.length === 1 ? "item no calendário" : "itens no calendário"}</p><h2>{selectedItems.length ? "Seu dia, por inteiro" : "Sem escala confirmada"}</h2>{selectedItems.length ? <ul className="agenda-day-list">{selectedItems.map((item) => <li key={item.id}><strong>{item.title}</strong><span>{item.time} · {item.state}</span></li>)}</ul> : <p className="card-lead">Nenhum outro compromisso foi confirmado para este dia; isso não significa folga.</p>}<div className="truth-chip"><Info size={15} />Planejado não vira realizado sem seu registro</div></section>
    <AnnualDatesWorkspace entities={workspace?.entities ?? []} today={referenceDate} onDataChange={onDataChange} />
    <AgendaPlanner key={selectedDate} startLocalDate={selectedDate} onDataChange={onDataChange} className="agenda-screen-planner" />
  </div>;
}

function RegisterScreen({ onDomain, onObstetrics, onClinicalTools, onQuickCapture }: { onDomain: (domain: DomainId) => void; onObstetrics: () => void; onClinicalTools: () => void; onQuickCapture: (text: string) => Promise<void> }) {
  const [quickCapture, setQuickCapture] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const submitQuickCapture = async () => {
    const value = quickCapture.trim();
    if (!value || quickBusy) return;
    setQuickBusy(true);
    try {
      await onQuickCapture(value);
      setQuickCapture("");
    } catch {
      // The parent keeps the existing text and reports the persistence error.
    } finally {
      setQuickBusy(false);
    }
  };
  return <div className="page inner-page" data-testid="register-screen">
    <PageHeader eyebrow="Um gesto de cada vez" title="Registrar" copy="Escolha o contexto. Cada área pergunta apenas o que precisa saber." icon={<Plus size={28} weight="thin" />} />
    <section className="quick-capture editorial-card"><div className="section-title"><NotePencil size={22} weight="thin" /><h2>Captura rápida</h2></div><p>Uma ideia, tarefa ou aprendizado. Você organiza depois.</p><div className="quick-capture-row"><KeyboardInput aria-label="Captura rápida" value={quickCapture} onChange={(event) => setQuickCapture(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void submitQuickCapture(); } }} placeholder="Ex.: revisar desacelerações tardias" /><button type="button" disabled={!quickCapture.trim() || quickBusy} onClick={() => void submitQuickCapture()} aria-label="Guardar captura rápida"><ArrowRight size={20} /></button></div><small className="quick-capture-state">{quickBusy ? "Guardando…" : "Vai para Conhecimento e pode ser organizado depois"}</small></section>
    <button type="button" className="obstetrics-shortcut" onClick={onObstetrics}><Calculator size={25} weight="thin" /><span><small>Ferramentas de maternidade</small><strong>Abrir calculadoras obstétricas</strong><em>DUM, USG, datação, HPP e avaliação neonatal</em></span><CaretRight size={18} /></button>
    <button type="button" className="obstetrics-shortcut clinical-shortcut" onClick={onClinicalTools}><BookOpen size={25} weight="thin" /><span><small>Nomenclatura e escrita clínica</small><strong>Abrir consulta rápida</strong><em>CID, exames, marcas e espaço SOAP</em></span><CaretRight size={18} /></button>
    <section className="section-block domain-picker"><div className="section-title"><CompassRose size={23} weight="thin" /><h2>O que aconteceu?</h2></div><div className="domain-grid">
      {domains.map((item) => { const DomainIcon = item.icon; return <button key={item.id} type="button" data-tone={item.tone} onClick={() => onDomain(item.id)}><DomainIcon size={25} weight="thin" /><span><strong>{item.label}</strong><small>{item.description}</small></span><CaretRight size={16} weight="light" /></button>; })}
    </div></section>
    <section className="register-principle"><ShieldCheck size={22} weight="thin" /><p><strong>Sem culpa automática.</strong> Campo vazio continua desconhecido; só vira ausência, atraso ou não adesão quando você confirmar.</p></section>
  </div>;
}

function MentorScreen({ visualDemo, workspace, onDomain, report, windowDays, onWindowChange, signalId, onSignalChange, reducedMotion, cycles, cycleSelection, onCycleChange }: { visualDemo: boolean; workspace: MentorWorkspace | null; onDomain: (domain: DomainId) => void; cycles: ReviewCycle[]; cycleSelection: string | null; onCycleChange: (selection: string) => void; report: AnalyticsReport; reducedMotion: boolean; windowDays: MentorInsightsWindowDays; onWindowChange: (days: MentorInsightsWindowDays) => void; signalId: MetricSignalId; onSignalChange: (signal: MetricSignalId) => void }) {
  return <div className="page inner-page mentor-page" data-testid="mentor-screen">
    <PageHeader eyebrow="Padrões explicáveis, não um placar" title="Mentor" copy="Fatos entram primeiro; sugestões vêm com janela, amostra e incerteza." icon={<CompassRose size={29} weight="thin" />} />
    <MentorInsights report={report} windowDays={windowDays} onWindowChange={onWindowChange} onDomainSelect={onDomain} onNextActionSelect={(action) => onDomain(action.domain)} demoMode={visualDemo} customWindowLabel={cycleSelection ? (cycleSelection === "current" ? cycles[0] : cycles.find((cycle) => cycle.id === cycleSelection))?.label : undefined} valueContent={<><ReviewCycleStrip cycles={cycles} selection={cycleSelection} onSelect={onCycleChange} />{workspace ? <MetricTrends reducedMotion={reducedMotion} entities={workspace.entities} datasetId={workspace.dataset.id} window={report.window} signalId={signalId} onSignalChange={onSignalChange} onRegister={onDomain} /> : <p role="status">Carregando seus registros…</p>}</>} />
  </div>;
}

function LegacyMentorScreen({ visualDemo, onDomain }: { visualDemo: boolean; onDomain: (domain: DomainId) => void }) {
  const [windowDays, setWindowDays] = useState(60);
  return <div className="page inner-page mentor-page" data-testid="mentor-screen">
    <PageHeader eyebrow="Padrões explicáveis, não um placar" title="Mentor" copy="Fatos entram primeiro; sugestões vêm com janela, amostra e incerteza." icon={<CompassRose size={29} weight="thin" />} />
    <div className="window-switch" role="group" aria-label="Janela das métricas">{[7, 30, 60, 180, 365].map((days) => <button key={days} type="button" aria-pressed={windowDays === days} className={windowDays === days ? "active" : ""} onClick={() => setWindowDays(days)}>{days === 365 ? "1 ano" : `${days}d`}</button>)}</div>
    <section className="analysis-card">
      <div className="analysis-heading"><div><p className="eyebrow">Estudo × energia</p><h2>{visualDemo ? "Blocos curtos favorecem conclusão" : "Aguardando pares comparáveis"}</h2></div><ChartLineUp size={27} weight="thin" /></div>
      <div className="mentor-chart" aria-label="Gráfico de energia e conclusão">{visualDemo ? <ResponsiveContainer width="100%" height="100%"><LineChart data={demoSignal} margin={{ top: 12, right: 8, bottom: 4, left: -25 }}><CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} /><XAxis dataKey="d" tick={{ fill: "#cfc6bb", fontSize: 9 }} axisLine={false} tickLine={false} /><YAxis tick={{ fill: "#cfc6bb", fontSize: 9 }} axisLine={false} tickLine={false} /><Tooltip contentStyle={{ background: "#241f1a", border: "1px solid #c79751", borderRadius: 8, fontSize: 11 }} /><Line type="monotone" dataKey="foco" name="Conclusão" stroke="#f8cf37" strokeWidth={2.4} dot={{ r: 2.5, fill: "#f8cf37", strokeWidth: 0 }} isAnimationActive={false} /><Line type="monotone" dataKey="energia" name="Energia" stroke="#4a89f6" strokeWidth={2.2} dot={{ r: 2.3, fill: "#4a89f6", strokeWidth: 0 }} isAnimationActive={false} /></LineChart></ResponsiveContainer> : <div className="chart-empty"><TrendUp size={28} weight="thin" /><span>0 de 14 pares mínimos</span></div>}</div>
      <div className="evidence-grid"><span><small>Janela</small><strong>{windowDays} dias</strong></span><span><small>Amostra</small><strong>{visualDemo ? "23 dias" : "0 dias"}</strong></span><span><small>Sem dado</small><strong>{visualDemo ? "4 dias" : "—"}</strong></span></div>
      <p className="uncertainty"><Info size={16} />{visualDemo ? "Associação observada; não prova causa." : "Nenhuma associação será exibida antes da amostra mínima."}</p>
    </section>
    <section className="section-block"><div className="section-title"><Lightbulb size={23} weight="thin" /><h2>Áreas para compreender</h2></div><div className="metric-lanes">
      <MetricLane label="Internato" value={visualDemo ? "8 min antecipado" : "planejado hoje"} note="pontualidade e exposição" tone="wine" onClick={() => onDomain("internato")} />
      <MetricLane label="Sono" value={visualDemo ? "6h12" : "sem registro"} note="duração e regularidade" tone="navy" onClick={() => onDomain("sono")} />
      <MetricLane label="Humor" value={visualDemo ? "3/5" : "sem registro"} note="estado + contexto" tone="blue" onClick={() => onDomain("humor")} />
      <MetricLane label="Cefaleia" value={visualDemo ? "ausente" : "não respondido"} note="presença nunca é presumida" tone="red" onClick={() => onDomain("cefaleia")} />
      <MetricLane label="Finanças" value="3 contas a configurar" note="sem saldo inferido" tone="green" onClick={() => onDomain("financas")} />
    </div></section>
    <section className="mentor-method editorial-card"><Brain size={25} weight="thin" /><div><h2>Como o Mentor orienta</h2><p>Ele separa fato, padrão e próxima ação. Nunca diagnostica, muda medicação ou reduz sua vida a uma nota.</p></div></section>
  </div>;
}

function MetricLane({ label, value, note, tone, onClick }: { label: string; value: string; note: string; tone: string; onClick: () => void }) {
  return <button type="button" className="metric-lane" data-tone={tone} onClick={onClick}><span><strong>{label}</strong><small>{note}</small></span><span className="metric-value">{value}</span><CaretRight size={17} /></button>;
}

function ArchiveScreen({ storage, onBackup, onRestore }: { storage: { persisted: boolean | null; quotaBytes: number | null; usageBytes: number | null } | null; onBackup: () => void; onRestore: () => void }) {
  const usage = storage?.usageBytes && storage.quotaBytes ? `${Math.max(1, Math.round(storage.usageBytes / 1024))} KB usados` : "uso será medido neste iPhone";
  return <div className="page inner-page" data-testid="archive-screen">
    <PageHeader eyebrow="Memória privada e recuperável" title="Arquivo" copy="Histórico, segurança, importação e continuidade do seu Mentor." icon={<Archive size={28} weight="thin" />} />
    <section className="retention-card editorial-card"><div className="retention-ring"><strong>365</strong><small>dias</small></div><div><h2>Histórico completo preservado</h2><p>Painéis padrão usam 60 dias. Seus fatos continuam disponíveis por pelo menos um ano.</p></div></section>
    <section className="section-block"><div className="section-title"><ShieldCheck size={23} weight="thin" /><h2>Segurança e recuperação</h2></div>
      <button type="button" className="archive-action" onClick={onBackup}><FileArrowDown size={24} weight="thin" /><span><strong>Criar backup .bauerlife</strong><small>Arquivo cifrado e validado antes de baixar</small></span><CaretRight size={18} /></button>
      <button type="button" className="archive-action" onClick={onRestore}><FileArrowUp size={24} weight="thin" /><span><strong>Preparar restauração .bauerlife</strong><small>Validação isolada, sem substituir os dados ativos</small></span><CaretRight size={18} /></button>
      <div className="storage-state"><LockKey size={18} /><span><strong>{storage?.persisted ? "Armazenamento persistente autorizado" : "Dados locais neste iPhone"}</strong><small>{usage} · sem dados de pacientes</small></span></div>
    </section>
    <section className="section-block"><div className="section-title"><Clock size={23} weight="thin" /><h2>Linha do tempo</h2></div><div className="history-day"><time>01 set 2026</time><div><span className="history-dot planned" /><p><strong>Internato planejado</strong><small>07:00–19:00 · realização ainda desconhecida</small></p></div></div><div className="history-day"><time>03 set 2026</time><div><span className="history-dot future" /><p><strong>Plantão confirmado</strong><small>19:00–07:00 · agenda futura</small></p></div></div></section>
    <section className="section-block settings-block"><div className="section-title"><GearFine size={23} weight="thin" /><h2>Preferências</h2></div><button type="button"><span>Temas e acessibilidade</span><CaretRight size={17} /></button><button type="button"><span>Retenção e privacidade</span><CaretRight size={17} /></button><button type="button"><span>Integrações futuras</span><small>Calendário e lembretes, sempre opcionais</small><CaretRight size={17} /></button></section>
  </div>;
}

function formatAnalyticsMetricValue(metric: AnalyticsMetric): string {
  if (metric.value === null) return "Sem amostra";
  if (metric.unit === "BRL_minor") return Number.isSafeInteger(metric.value) ? formatBRLMinor(metric.value) : "Valor inválido";
  const value = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(metric.value);
  if (metric.unit === "hours") return `${value} h`;
  if (metric.unit === "minutes") return `${value} min`;
  if (metric.unit === "milliliters") return `${value} ml`;
  if (metric.unit === "percent") return `${value}%`;
  return value;
}

function formatPreferenceMinutes(minutes: number | null): string {
  if (minutes === null) return "não definida";
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours}h${String(remainder).padStart(2, "0")}` : `${hours}h`;
}

function DomainScreen({ domain, visualDemo, analytics, sleepGoal, onBack, onRegister }: { domain: DomainId; visualDemo: boolean; analytics: DomainAnalyticsSummary | null; sleepGoal: MentorPreferences["sleepGoal"]; onBack: () => void; onRegister: () => void }) {
  const config = domains.find((item) => item.id === domain)!; const DomainIcon = config.icon;
  if (domain === "financas") return <FinanceScreen visualDemo={visualDemo} analytics={analytics} onBack={onBack} onRegister={onRegister} />;
  const metricRows: [string, string, string][] = analytics?.metrics.length
    ? analytics.metrics.slice(0, 4).map((metric) => [
        metric.label,
        formatAnalyticsMetricValue(metric),
        `n=${metric.n} · ${metric.missing} faltante${metric.missing === 1 ? "" : "s"}`,
      ])
    : domainMetrics(domain);
  return <div className="page inner-page domain-screen" data-tone={config.tone}>
    <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={18} />Voltar</button>
    <PageHeader eyebrow="Núcleo contextual" title={config.label} copy={config.description} icon={<DomainIcon size={28} weight="thin" />} />
    <section className="editorial-card domain-focus-card"><p className="eyebrow">Próxima ação útil</p><h2>{domainNextAction(domain)}</h2><p>{domainGuidance(domain)}</p><button type="button" className="secondary-cta" onClick={onRegister}><Plus size={18} />Registrar agora</button></section>
    {domain === "sono" ? <section className="domain-sleep-reference" aria-label="Referência pessoal de sono"><MoonStars size={24} weight="thin" /><div><p className="eyebrow">Referência pessoal</p><h2>{sleepGoal.targetMinutes === null ? "Meta central não definida" : formatPreferenceMinutes(sleepGoal.targetMinutes)}</h2><p>{sleepGoal.minimumMinutes === null && sleepGoal.maximumMinutes === null ? "Faixa ainda não definida em Arquivo → Preferências." : `Faixa escolhida: ${formatPreferenceMinutes(sleepGoal.minimumMinutes)} – ${formatPreferenceMinutes(sleepGoal.maximumMinutes)}.`}</p><small>{(analytics?.observedDays ?? 0) === 0 ? "Sem amostra: o Mentor ainda não compara o sono real com esta referência." : `Referência sem nota automática · ${analytics?.observedDays ?? 0} dia(s) observado(s) na janela.`}</small></div></section> : null}
    <section className="section-block"><div className="section-title"><ChartLineUp size={23} weight="thin" /><h2>Métricas próprias</h2></div><p className="section-copy">Janela de {analytics?.window.days ?? 60} dias · {analytics ? `${analytics.observedDays} dias observados` : "carregando histórico"}</p><div className="domain-metric-grid">{metricRows.map(([label, value, note]) => <div key={label}><small>{label}</small><strong>{value}</strong><p>{note}</p></div>)}</div></section>
    <section className="register-principle"><Info size={21} weight="thin" /><p>{domainSafety(domain)}</p></section>
  </div>;
}

function FinanceScreen({ visualDemo, analytics, onBack, onRegister }: { visualDemo: boolean; analytics: DomainAnalyticsSummary | null; onBack: () => void; onRegister: () => void }) {
  const accounts = ["Mercado Pago", "Banco do Brasil", "PicPay"].map((name) => [name, "Instituição confirmada", "dados a cadastrar"]);
  const metricValue = (key: string) => {
    const metric = analytics?.metrics.find((item) => item.key === key);
    return metric ? formatAnalyticsMetricValue(metric) : "—";
  };
  return <div className="page inner-page finance-page" data-testid="finance-screen">
    <button type="button" className="back-button" onClick={onBack}><ArrowLeft size={18} />Voltar</button>
    <PageHeader eyebrow="Dinheiro também afeta o bem-estar" title="Finanças" copy="Visão clara de contas, compromissos e juros — sem movimentar dinheiro por você." icon={<Wallet size={28} weight="thin" />} />
    <section className="finance-summary"><div><small>Saldo consolidado</small><strong>Não calculado</strong><p>Informe dados ou conecte uma fonte no futuro.</p></div><ShieldCheck size={27} weight="thin" /></section>
    <section className="section-block"><div className="section-title"><Bank size={23} weight="thin" /><h2>Suas instituições</h2></div><div className="account-list">{accounts.map(([name, type, state]) => <button type="button" key={name}><CreditCard size={24} weight="thin" /><span><strong>{name}</strong><small>{type}</small></span><em>{state}</em><CaretRight size={17} /></button>)}</div><button type="button" className="secondary-cta" onClick={onRegister}><Plus size={18} />Registrar movimentação</button></section>
    <section className="section-block"><div className="section-title"><CurrencyCircleDollar size={23} weight="thin" /><h2>Planejamento mensal</h2></div><p className="section-copy">Planejado e realizado ficam separados. Nada ausente vira zero.</p><div className="budget-grid"><div><small>Receitas</small><strong>{metricValue("income_minor")}</strong><span>informadas</span></div><div><small>Despesas</small><strong>{metricValue("expense_minor")}</strong><span>informadas</span></div><div><small>Fluxo</small><strong>{metricValue("net_flow_minor")}</strong><span>receitas − despesas</span></div><div><small>Registros</small><strong>{analytics?.n ?? 0}</strong><span>janela de 60 dias</span></div></div></section>
    <section className="section-block"><div className="section-title"><TrendUp size={23} weight="thin" /><h2>Dívidas, juros e vencimentos</h2></div><div className="finance-empty"><ChartLineUp size={27} weight="thin" /><div><strong>Nenhuma conclusão sem dados</strong><p>Cadastre valor, taxa, parcela e vencimento para comparar custo e prioridade com transparência.</p></div></div></section>
    <section className="register-principle"><LockKey size={21} weight="thin" /><p>O Mentor não pede senha, CVV ou número completo do cartão; não paga, transfere ou contrata crédito.</p></section>
  </div>;
}

function domainNextAction(domain: DomainId) {
  return ({ internato: "Registrar apenas o que realmente aconteceu no turno", estudos: "Escolher o menor bloco que cabe na energia disponível", medicamentos: "Confirmar tomada, atraso ou omissão explicitamente", sono: "Fechar o episódio principal sem adivinhar horários", alimentacao: "Registrar a próxima refeição, não reconstruir o dia inteiro", humor: "Nomear o estado e o contexto sem transformar em diagnóstico", cefaleia: "Marcar presença, intensidade e duração quando souber", bruxismo: "Relacionar períodos de aperto, dor e sono", financas: "Cadastrar instituições antes de calcular qualquer saldo", rotina: "Proteger três prioridades e deixar espaço de recuperação", agenda: "Confirmar o próximo compromisso e reservar o tempo de transição", ia: "Definir o papel de cada ferramenta antes de manter custos sobrepostos", conhecimento: "Transformar uma captura em aplicação, pergunta e data de revisão", exames: "Guardar o resultado e a unidade exatamente como aparecem no laudo" } satisfies Record<DomainId, string>)[domain];
}
function domainGuidance(domain: DomainId) {
  return ({ internato: "Chegada e saída reais formam a jornada. Horários planejados nunca completam lacunas.", estudos: "Metas mínima, boa e padrão-ouro respeitam dias clínicos e dias de recuperação.", medicamentos: "Nomes, doses e estoque ficam privados; o app não recomenda ajustes.", sono: "Duração, despertares e qualidade são fatos independentes e podem ficar incompletos.", alimentacao: "Regularidade, água e contexto importam mais do que perfeição alimentar.", humor: "Dados servem para sua revisão e para levar ao profissional quando você quiser.", cefaleia: "Gatilhos e associados só aparecem como padrão depois de amostra suficiente.", bruxismo: "O contexto diário é separado dos sintomas ao despertar para evitar falsas relações.", financas: "Mercado Pago, Banco do Brasil e PicPay entram sem saldo presumido.", rotina: "O plano se recalibra, mas não apaga o planejado nem chama lacuna de falha.", agenda: "Evento, tarefa, horário e confirmação ficam separados; o app nunca chama um dia não confirmado de folga.", ia: "Custo, utilidade e sobreposição só entram quando informados, sem enviar seus conteúdos para terceiros.", conhecimento: "Fonte, captura, aplicação e dúvida preservam o caminho do aprendizado, não apenas uma nota solta.", exames: "Valores, unidades, datas e referências são transcritos. O gráfico não determina diagnóstico nem tratamento." } satisfies Record<DomainId, string>)[domain];
}
function domainMetrics(domain: DomainId): [string, string, string][] {
  const map: Record<DomainId, [string, string, string][]> = {
    internato: [["Pontualidade", "—", "dias com chegada real"], ["Horas", "—", "apenas chegada + saída"], ["Exposição", "—", "temas confirmados"], ["Feedback", "—", "áreas e contexto"]],
    estudos: [["Minutos", "—", "por dia e semana"], ["Blocos", "—", "iniciados × concluídos"], ["Revisões", "—", "necessárias e realizadas"], ["Domínio", "—", "autoavaliação separada"]],
    medicamentos: [["No horário", "—", "tomadas confirmadas"], ["Atraso", "—", "minutos reais"], ["Estoque", "—", "dias estimados"], ["Faltando", "—", "confirmação explícita"]],
    sono: [["Duração", "—", "episódio principal"], ["Qualidade", "—", "registro subjetivo"], ["Despertares", "—", "contagem informada"], ["Regularidade", "—", "janela de 60 dias"]],
    alimentacao: [["Refeições", "—", "registradas"], ["Água", "—", "volume informado"], ["Intervalos", "—", "entre registros"], ["Contexto", "—", "plantão ou folga"]],
    humor: [["Humor", "—", "escala escolhida"], ["Energia", "—", "estado atual"], ["Ansiedade", "—", "quando registrada"], ["Contexto", "—", "sono, rotina, eventos"]],
    cefaleia: [["Dias com dor", "—", "presença confirmada"], ["Intensidade", "—", "0–10"], ["Duração", "—", "minutos informados"], ["Gatilhos", "—", "associações explicáveis"]],
    bruxismo: [["Aperto", "—", "períodos confirmados"], ["Ao acordar", "—", "sintomas informados"], ["Dor", "—", "local e intensidade"], ["Sono", "—", "relação sem causalidade"]],
    financas: [["Fluxo", "—", "receitas − despesas"], ["Vencimentos", "—", "próximos 30 dias"], ["Juros", "—", "taxas cadastradas"], ["Dívidas", "—", "saldo informado"]],
    rotina: [["Prioridades", "—", "protegidas por dia"], ["Hábitos", "—", "presença registrada"], ["Carga", "—", "planejada × realizada"], ["Recuperação", "—", "tempo reservado"]],
    agenda: [["Confirmados", "—", "eventos informados"], ["Pendentes", "—", "sem presumir cancelamento"], ["Buffers", "—", "tempo de transição"], ["Tarefas", "—", "abertas × concluídas"]],
    ia: [["Ferramentas", "—", "portfólio informado"], ["Custo", "—", "assinaturas cadastradas"], ["Utilidade", "—", "avaliação contextual"], ["Sobreposição", "—", "sem corte automático"]],
    conhecimento: [["Capturas", "—", "fontes registradas"], ["Aplicações", "—", "uso pretendido"], ["Revisões", "—", "agendadas × feitas"], ["Perguntas", "—", "lacunas explícitas"]],
    exames: [["Coletas", "—", "datas informadas"], ["Resultados", "—", "valores transcritos"], ["Laudos", "—", "originais guardados"], ["Evolução", "—", "mesma unidade"]],
  }; return map[domain];
}
function domainSafety(domain: DomainId) {
  if (domain === "humor") return "O Mentor acompanha padrões para sua revisão; não diagnostica mania, depressão ou qualquer transtorno.";
  if (domain === "medicamentos") return "O app registra e lembra. Mudança de dose, suspensão ou combinação pertence ao profissional responsável.";
  if (domain === "cefaleia" || domain === "bruxismo") return "Sinais intensos, novos ou preocupantes precisam de avaliação profissional; o histórico não substitui atendimento.";
  return "Sem registro continua desconhecido. A métrica só usa fatos confirmados e mostra o tamanho da amostra.";
}

function BottomNav({ active, onChange }: { active: TabId; onChange: (tab: TabId) => void }) {
  return <nav className="bottom-nav" aria-label="Navegação principal">{navItems.map((item) => { const NavIcon = item.icon; return <button key={item.id} type="button" className={active === item.id ? "active" : ""} aria-current={active === item.id ? "page" : undefined} onClick={() => onChange(item.id)}><span className={item.id === "register" ? "register-orb" : "nav-icon"}><NavIcon size={item.id === "register" ? 28 : 24} weight="thin" /></span><small>{item.label}</small></button>; })}</nav>;
}

function ActionSheets({ visualDemo, localDate, entities, state, onClose, onArrival, onDeparture, onOpenMedications, onBackup, onConfirmDownloadedBackup, onRestoreApplied, onLegacyApplied, onLegacyRolledBack, onClinicianReportReady, onSaved, onNotice }: {
  visualDemo: boolean; localDate: LocalDate; entities: readonly MentorEntity[]; state: SheetState; onClose: () => void; onArrival: (value?: string) => void; onDeparture: (value?: string) => void;
  onOpenMedications: () => void; onBackup: (passphrase: string) => Promise<BackupActionResult>; onConfirmDownloadedBackup: (receipt: BackupDeliveryReceipt) => Promise<void>; onRestoreApplied: (result: AppliedBackupMergeResult) => Promise<void>; onLegacyApplied: (result: AppliedLegacyImportResult) => Promise<void>; onLegacyRolledBack: (result: RolledBackLegacyImportResult) => Promise<void>; onSaved: (request: DomainSaveRequest) => Promise<void>;
  onClinicianReportReady: (report: ClinicianReportGeneration) => Promise<void>;
  onNotice: (message: string) => void;
}) {
  const [timeValue, setTimeValue] = useState(""); const [passphrase, setPassphrase] = useState(""); const [backupBusy, setBackupBusy] = useState(false);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [pendingBackupDownload, setPendingBackupDownload] = useState<BackupActionResult | null>(null);
  useEffect(() => {
    if (state?.kind === "backup") return;
    setPassphrase("");
    setBackupError(null);
    setBackupBusy(false);
    setPendingBackupDownload(null);
  }, [state?.kind]);
  const domainConfig = state?.kind === "domain" ? domains.find((item) => item.id === state.domain) : null;
  const title = state?.kind === "moment" ? "Registrar momento" : state?.kind === "medication" ? visualDemo ? "Medicação das 08:00" : "Registrar medicação" : state?.kind === "departure" ? "Registrar saída" : state?.kind === "backup" ? "Criar backup privado" : state?.kind === "restore" ? "Preparar restauração" : state?.kind === "conflicts" ? "Revisar conflitos" : state?.kind === "clinician" ? "Relatório para consulta" : domainConfig ? `Registrar ${domainConfig.label}` : "";
  return <BottomSheet open={Boolean(state)} onOpenChange={(open) => { if (!open) onClose(); }} title={title} description={state?.kind === "domain" ? "Só o que você confirmar vira dado." : state?.kind === "clinician" ? "Você escolhe o período e exatamente quais domínios entram." : undefined} snap={state?.kind === "domain" || state?.kind === "restore" || state?.kind === "conflicts" || state?.kind === "clinician" ? 0.82 : 0.62}>
    <button type="button" className="sheet-close-action" onClick={onClose}><ArrowLeft size={16} />Fechar</button>
    {state?.kind === "moment" ? <div className="sheet-form"><p>O que você precisa marcar agora?</p><button type="button" className="sheet-choice" onClick={() => onArrival()}><Clock size={22} /><span><strong>Cheguei agora</strong><small>Usar o horário deste iPhone</small></span><CaretRight size={17} /></button><button type="button" className="sheet-choice" onClick={onOpenMedications}><Pill size={22} /><span><strong>Abrir trilho de medicamentos</strong><small>Escolher o regime, a dose e o horário exatos</small></span><CaretRight size={17} /></button><label className="field"><span>Outro horário de chegada</span><KeyboardInput type="time" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} /></label><button type="button" className="sheet-primary" disabled={!timeValue} onClick={() => onArrival(timeValue)}>Salvar horário</button></div> : null}
    {state?.kind === "medication" ? <div className="sheet-form"><div className="sheet-callout"><Info size={20} /><p>Cada tomada precisa ficar ligada ao medicamento, dose e horário planejado corretos. Registros sem vínculo não serão criados.</p></div><button type="button" className="sheet-primary" onClick={onOpenMedications}><Pill size={20} />Abrir trilho de medicamentos</button></div> : null}
    {state?.kind === "departure" ? <div className="sheet-form"><button type="button" className="sheet-primary" onClick={() => onDeparture()}><SignOut size={20} />Registrar saída agora</button><label className="field"><span>Outro horário</span><KeyboardInput type="time" value={timeValue} onChange={(event) => setTimeValue(event.target.value)} /></label><button type="button" className="sheet-secondary" disabled={!timeValue} onClick={() => onDeparture(timeValue)}>Salvar horário informado</button></div> : null}
    {state?.kind === "domain" && domainConfig ? <DomainForms key={`${domainConfig.id}:${state.initialMode ?? "default"}`} domain={domainConfig.id} initialMode={state.initialMode} localDate={localDate} onSaved={onSaved} /> : null}
    {state?.kind === "backup" ? <div className="sheet-form">
      <div className="sheet-callout"><LockKey size={20} /><p>O arquivo será cifrado e validado antes de baixar. Guarde a senha: ela não pode ser recuperada.</p></div>
      {!pendingBackupDownload ? <>
        <label className="field"><span>Senha do backup</span><KeyboardInput type="password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} placeholder="mínimo 10 caracteres" /></label>
        {backupError ? <p className="restore-feedback restore-error" role="alert">{backupError}</p> : null}
        <button type="button" className="sheet-primary" disabled={passphrase.length < 10 || backupBusy} onClick={async () => { setBackupBusy(true); setBackupError(null); try { const result = await onBackup(passphrase); if (result.delivery === "downloaded") setPendingBackupDownload(result); } catch (reason) { setBackupError(reason instanceof Error ? reason.message : "Não foi possível criar o backup; seus dados continuam preservados."); } finally { setBackupBusy(false); } }}><FileArrowDown size={20} />{backupBusy ? "Validando…" : "Gerar .bauerlife"}</button>
      </> : <section className="restore-result" role="status">
        <div><FileArrowDown size={20} /><strong>Download solicitado</strong></div>
        <p>O navegador não consegue confirmar se <strong>{pendingBackupDownload.fileName}</strong> apareceu no aparelho. Verifique Arquivos/Downloads antes de registrar este backup como recuperável.</p>
        {backupError ? <p className="restore-feedback restore-error" role="alert">{backupError}</p> : null}
        <button type="button" className="sheet-primary" disabled={backupBusy} onClick={async () => { setBackupBusy(true); setBackupError(null); try { await onConfirmDownloadedBackup(pendingBackupDownload.receipt); } catch (reason) { setBackupError(reason instanceof Error ? reason.message : "Não foi possível confirmar a entrega do backup."); } finally { setBackupBusy(false); } }}><CheckCircle size={20} />{backupBusy ? "Registrando confirmação…" : "Vi o arquivo em Arquivos/Downloads"}</button>
      </section>}
    </div> : null}
    {state?.kind === "restore" ? <RestoreImportForm onApplied={onRestoreApplied} onLegacyApplied={onLegacyApplied} onLegacyRolledBack={onLegacyRolledBack} /> : null}
    {state?.kind === "conflicts" ? <RestoreConflictWorkspace /> : null}
    {state?.kind === "clinician" ? <ClinicianReportBuilder entities={entities} referenceLocalDate={localDate} onReportReady={onClinicianReportReady} onCancel={onClose} /> : null}
  </BottomSheet>;
}

type RestoreSummary = {
  importId: string;
  planDigest: string;
  checksumPrefix: string;
  createCount: number;
  restoreBaseCount: number;
  settingCount: number;
  identicalCount: number;
  conflictCount: number;
  auditRevisionCount: number;
  auditOperationCount: number;
  ignoredInternalCount: number;
};

function RestoreImportForm({ onApplied, onLegacyApplied, onLegacyRolledBack }: { onApplied: (result: AppliedBackupMergeResult) => Promise<void>; onLegacyApplied: (result: AppliedLegacyImportResult) => Promise<void>; onLegacyRolledBack: (result: RolledBackLegacyImportResult) => Promise<void> }) {
  const keyboard = useKeyboard();
  const [file, setFile] = useState<File | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RestoreSummary | null>(null);
  const [applied, setApplied] = useState(false);
  const pendingImportRef = useRef<string | null>(null);

  const discardPendingImport = () => {
    const importId = pendingImportRef.current;
    pendingImportRef.current = null;
    if (importId) void discardStagedImport(importId).catch(() => undefined);
  };

  useEffect(() => () => discardPendingImport(), []);

  const chooseFile = (nextFile: File | null) => {
    discardPendingImport();
    setFile(nextFile);
    setSummary(null);
    setApplied(false);
    setProgress(null);
    if (!nextFile) {
      setError(null);
      return;
    }
    if (!/\.(bauerlife|json)$/i.test(nextFile.name)) {
      setError("Formato não reconhecido. Selecione um backup .bauerlife ou um JSON dos aplicativos beta; nenhum dado foi alterado.");
      return;
    }
    setError(null);
  };

  const updatePassphrase = (value: string) => {
    discardPendingImport();
    setPassphrase(value);
    setSummary(null);
    setApplied(false);
    if (file && /\.(bauerlife|json)$/i.test(file.name)) setError(null);
  };

  const prepareRestore = async () => {
    if (!file || !passphrase || !/\.bauerlife$/i.test(file.name)) return;
    keyboard.hide();
    setBusy(true);
    setError(null);
    setSummary(null);
    setProgress("Validando integridade e senha do backup…");
    try {
      const staged = await stageEncryptedBackup(file, passphrase, file.name);
      pendingImportRef.current = staged.importId;
      const ignoredInternalCount = Object.values(staged.preview.ignoredStoreCounts).reduce(
        (total, count) => total + (typeof count === "number" && Number.isFinite(count) ? count : 0),
        0,
      );
      setSummary({
        importId: staged.importId,
        planDigest: staged.preview.planDigest,
        checksumPrefix: staged.checksumSHA256.slice(0, 12),
        createCount: staged.preview.entityCreateIds.length,
        restoreBaseCount: staged.preview.entitySeedRestoreIds.length,
        settingCount: staged.preview.settingAddKeys.length,
        identicalCount: staged.preview.entityIdenticalIds.length + staged.preview.settingIdenticalKeys.length,
        conflictCount: staged.preview.conflicts.length,
        auditRevisionCount: staged.preview.auditRevisionImportCount,
        auditOperationCount: staged.preview.auditOperationImportCount,
        ignoredInternalCount,
      });
      setProgress(null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível validar e preparar este backup.";
      setError(`${message} Seus dados ativos não foram substituídos.`);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const applyPrepared = async () => {
    if (!summary || applied) return;
    keyboard.hide();
    setBusy(true);
    setError(null);
    setProgress("Mesclando apenas itens novos e preservando conflitos…");
    try {
      const result = await applyStagedImport(summary.importId, {
        expectedPlanDigest: summary.planDigest,
        mode: "safe-only",
      });
      pendingImportRef.current = null;
      setApplied(true);
      setProgress("Mesclagem concluída. Atualizando o Arquivo…");
      await onApplied(result);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Não foi possível aplicar esta cópia.";
      setError(`${message} Nenhum registro existente foi sobrescrito.`);
      setProgress(null);
    } finally {
      setBusy(false);
    }
  };

  const isLegacyJson = Boolean(file && /\.json$/i.test(file.name));
  const supportedFile = Boolean(file && /\.bauerlife$/i.test(file.name));
  return <div className="sheet-form" aria-busy={busy}>
    <div className="sheet-callout"><ShieldCheck size={20} /><p>O backup será validado e guardado como cópia isolada. Esta etapa não substitui seus dados ativos.</p></div>
    <label className="file-field" htmlFor="restore-file">
      <FileArrowUp size={23} />
      <span><strong>{file?.name ?? "Escolher arquivo"}</strong><small id="restore-file-help">.bauerlife cifrado ou JSON exportado dos aplicativos beta</small></span>
      <input id="restore-file" type="file" accept=".bauerlife,.json,application/vnd.bauerlife+json,application/json" disabled={busy} aria-describedby="restore-file-help" onClick={() => keyboard.hide()} onChange={(event) => chooseFile(event.target.files?.[0] ?? null)} />
    </label>
    {!isLegacyJson ? <label className="field" htmlFor="restore-passphrase"><span>Senha do backup</span><KeyboardInput id="restore-passphrase" type="password" value={passphrase} disabled={busy} autoComplete="off" onChange={(event) => updatePassphrase(event.target.value)} placeholder="senha usada ao criar o backup" /></label> : null}
    {progress || error ? <p className={`restore-feedback${error ? " restore-error" : ""}`} role={error ? "alert" : "status"} aria-live={error ? "assertive" : "polite"} aria-atomic="true">{error ?? progress}</p> : null}
    {!isLegacyJson ? <button type="button" className="sheet-secondary" disabled={!supportedFile || !passphrase || busy || Boolean(summary)} aria-busy={busy} onClick={() => void prepareRestore()}>{busy ? "Validando e preparando…" : summary ? "Cópia preparada" : "Validar e preparar cópia"}</button> : null}
    {isLegacyJson && file ? <LegacyImportForm key={`${file.name}:${file.size}:${file.lastModified}`} file={file} onApplied={onLegacyApplied} onRolledBack={onLegacyRolledBack} /> : null}
    {summary ? <section className="restore-result" role="status" aria-live="polite" aria-label="Resultado da preparação do backup">
      <div><CheckCircle size={20} weight="fill" /><strong>Backup validado e preparado</strong></div>
      <dl className="restore-metrics">
        <div><dt>Fatos seguros</dt><dd>{summary.createCount + summary.restoreBaseCount + summary.settingCount}</dd></div>
        <div><dt>Histórico compatível</dt><dd>{summary.auditRevisionCount} versões · {summary.auditOperationCount} operações</dd></div>
        <div><dt>Base recuperável</dt><dd>{summary.restoreBaseCount}</dd></div>
        <div><dt>Idênticos</dt><dd>{summary.identicalCount}</dd></div>
        <div><dt>Conflitos</dt><dd>{summary.conflictCount}</dd></div>
        <div><dt>Internos ignorados</dt><dd>{summary.ignoredInternalCount}</dd></div>
        <div className="restore-checksum"><dt>Checksum SHA-256</dt><dd><code>{summary.checksumPrefix}…</code></dd></div>
      </dl>
      <p>{summary.conflictCount ? "Conflitos serão preservados com os dois snapshots em Arquivo > Conflitos; não serão sobrescritos." : "A prévia não encontrou conflito com os dados ativos."} Outbox, caches e estados de sincronização recebidos nunca viram fatos restaurados.</p>
      <button type="button" className="sheet-primary" disabled={busy || applied} onClick={() => void applyPrepared()}><ShieldCheck size={19} />{applied ? "Mesclagem aplicada" : "Aplicar somente itens seguros"}</button>
    </section> : null}
  </div>;
}
