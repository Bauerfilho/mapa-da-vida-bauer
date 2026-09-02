import {
  BookBookmark,
  BowlFood,
  CalendarDots,
  FirstAid,
  GraduationCap,
  HeadCircuit,
  ListChecks,
  MoonStars,
  Pill,
  Robot,
  Smiley,
  Tooth,
  Wallet,
  TestTube,
  type Icon,
} from "@phosphor-icons/react";
import type { Domain } from "../domain";

export type DomainTone =
  | "wine"
  | "gold"
  | "green"
  | "blue"
  | "navy"
  | "red"
  | "orange";

export interface DomainCatalogEntry {
  id: Domain;
  label: string;
  /** Compact legacy-facing copy used by register grids. */
  note: string;
  description: string;
  anatomy: string;
  tone: DomainTone;
  icon: Icon;
  eventKinds: readonly string[];
}

/**
 * One source for labels, icons and form intent. `anatomy` is deliberately
 * explicit: it prevents future forms from collapsing into the same generic
 * note template while still sharing accessible controls and save semantics.
 */
export const DOMAIN_CATALOG = [
  {
    id: "internato",
    label: "Internato",
    note: "presença, temas e feedback",
    description: "Participação, temas, feedback e próximo gesto técnico.",
    anatomy: "debrief clínico em camadas",
    tone: "wine",
    icon: FirstAid,
    eventKinds: ["internship-debrief"],
  },
  {
    id: "estudos",
    label: "Estudos",
    note: "sessões, questões e revisão",
    description: "Sessão, questões, confiança e revisão programada.",
    anatomy: "bancada de sessão e bilhete de revisão",
    tone: "gold",
    icon: GraduationCap,
    eventKinds: ["study-session"],
  },
  {
    id: "medicamentos",
    label: "Medicações",
    note: "regime, estoque e SOS",
    description: "Cadastro informado, estoque e uso SOS sem sugerir conduta.",
    anatomy: "ficha de regime com gavetas independentes",
    tone: "wine",
    icon: Pill,
    eventKinds: ["medication-regimen", "medication-stock", "medication-sos"],
  },
  {
    id: "sono",
    label: "Sono",
    note: "cronologia e recuperação",
    description: "Cronologia da noite, interrupções, cochilos e recuperação.",
    anatomy: "linha temporal da noite",
    tone: "navy",
    icon: MoonStars,
    eventKinds: ["sleep-chronology"],
  },
  {
    id: "alimentacao",
    label: "Alimentação",
    note: "refeições, água e cafeína",
    description: "Refeição, água, cafeína e contexto de regularidade.",
    anatomy: "bandeja diária e régua de hidratação",
    tone: "green",
    icon: BowlFood,
    eventKinds: ["nutrition-log"],
  },
  {
    id: "humor",
    label: "Humor",
    note: "estado, energia e função",
    description: "Humor × energia e sinais funcionais observáveis.",
    anatomy: "matriz psicométrica sem diagnóstico",
    tone: "blue",
    icon: Smiley,
    eventKinds: ["mood-functional-check-in"],
  },
  {
    id: "cefaleia",
    label: "Cefaleia",
    note: "crises, gatilhos e resposta",
    description: "Crise, cronologia, fenótipo, gatilhos e resposta informada.",
    anatomy: "traçado da crise",
    tone: "red",
    icon: HeadCircuit,
    eventKinds: ["headache-crisis"],
  },
  {
    id: "bruxismo",
    label: "Bruxismo",
    note: "espelho manhã e noite",
    description: "Comparação manhã/noite, aperto, ranger e sintomas.",
    anatomy: "espelho AM/PM",
    tone: "orange",
    icon: Tooth,
    eventKinds: ["bruxism-am-pm"],
  },
  {
    id: "financas",
    label: "Finanças",
    note: "movimentos, dívidas e assinaturas",
    description: "Movimentação, dívida ou assinatura — somente fatos informados.",
    anatomy: "livro-caixa de três vias",
    tone: "green",
    icon: Wallet,
    eventKinds: ["finance-transaction", "finance-debt", "finance-subscription"],
  },
  {
    id: "rotina",
    label: "Rotina",
    note: "âncoras, tarefas e fechamento",
    description: "Âncoras, tarefas e fechamento consciente do dia.",
    anatomy: "trilho do dia",
    tone: "gold",
    icon: ListChecks,
    eventKinds: ["routine-day-plan"],
  },
  {
    id: "agenda",
    label: "Agenda",
    note: "eventos e tarefas manuais",
    description: "Evento ou tarefa manual, com confirmação explícita.",
    anatomy: "cartão de compromisso biface",
    tone: "wine",
    icon: CalendarDots,
    eventKinds: ["agenda-event", "agenda-task"],
  },
  {
    id: "ia",
    label: "Ferramentas de IA",
    note: "portfólio, custo e utilidade",
    description: "Papel, custo informado, utilidade, sobreposição e decisão.",
    anatomy: "dossiê de portfólio",
    tone: "blue",
    icon: Robot,
    eventKinds: ["ai-tool-portfolio"],
  },
  {
    id: "conhecimento",
    label: "Conhecimento",
    note: "capturas, fontes e revisões",
    description: "Captura, fonte, aplicação, pergunta e próxima revisão.",
    anatomy: "ficha de conhecimento frente e verso",
    tone: "gold",
    icon: BookBookmark,
    eventKinds: ["knowledge-capture"],
  },
  {
    id: "exames",
    label: "Meus exames",
    note: "resultados, laudos e evolução",
    description: "Resultados pessoais, referências transcritas e laudos privados.",
    anatomy: "linha do tempo laboratorial com unidades preservadas",
    tone: "blue",
    icon: TestTube,
    eventKinds: ["laboratory-panel"],
  },
] as const satisfies readonly DomainCatalogEntry[];

export const DOMAIN_CATALOG_BY_ID: ReadonlyMap<Domain, DomainCatalogEntry> =
  new Map(DOMAIN_CATALOG.map((entry) => [entry.id, entry]));

export function getDomainCatalogEntry(domain: Domain): DomainCatalogEntry {
  const entry = DOMAIN_CATALOG_BY_ID.get(domain);
  if (!entry) throw new Error(`Domínio sem formulário: ${domain}`);
  return entry;
}
