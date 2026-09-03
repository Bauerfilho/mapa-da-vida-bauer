import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { MoonStars } from "@phosphor-icons/react/dist/csr/MoonStars";
import { Pause } from "@phosphor-icons/react/dist/csr/Pause";
import { Play } from "@phosphor-icons/react/dist/csr/Play";
import { Sun } from "@phosphor-icons/react/dist/csr/Sun";
import {
  createSuiteAurora,
  type AuroraController,
  type AuroraStatus,
} from "./aurora-engine";

// A API pública permanece literal e curta para os três produtos da suíte.
export type SuiteModule = "mentor" | "hub" | "obstetricia";
export type SuiteTheme = "light" | "dark";

export type SuiteAppearance = {
  theme: SuiteTheme;
  setTheme: Dispatch<SetStateAction<SuiteTheme>>;
  paused: boolean;
  setPaused: Dispatch<SetStateAction<boolean>>;
};

export type SuiteBackdropProps = {
  module: SuiteModule;
  theme: SuiteTheme;
  paused: boolean;
};

export type SuiteAppearanceControlsProps = {
  theme: SuiteTheme;
  onThemeChange: (theme: SuiteTheme) => void;
};

type StoredPreferences = {
  theme: SuiteTheme;
  paused: boolean;
};

// Uma única chave exclusiva: nunca mistura aparência com SOAP, receita ou rascunhos.
const STORAGE_KEY = "mentor-suite-appearance-v1";
const DEFAULT_PREFERENCES: StoredPreferences = { theme: "dark", paused: false };

const isTheme = (value: unknown): value is SuiteTheme =>
  value === "light" || value === "dark";

const readPreferences = (): StoredPreferences => {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const value = JSON.parse(raw) as Partial<StoredPreferences>;

    return {
      theme: isTheme(value.theme) ? value.theme : DEFAULT_PREFERENCES.theme,
      paused: typeof value.paused === "boolean" ? value.paused : DEFAULT_PREFERENCES.paused,
    };
  } catch {
    // Preferência corrompida não bloqueia o conteúdo nem cria uma segunda chave.
    return DEFAULT_PREFERENCES;
  }
};

const systemRequestsReducedMotion = () =>
  typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const resolveStateAction = <Value,>(
  action: SetStateAction<Value>,
  previous: Value,
): Value => typeof action === "function"
  ? (action as (current: Value) => Value)(previous)
  : action;

/**
 * Mantém somente as duas preferências de aparência da suíte.
 * Tema começa no B escuro; movimento reduzido pausa a primeira execução.
 */
export function useSuiteAppearance(): SuiteAppearance {
  const [appearance, setAppearance] = useState<StoredPreferences>(() => {
    const stored = readPreferences();

    return {
      theme: stored.theme,
      paused: systemRequestsReducedMotion() ? true : stored.paused,
    };
  });

  const setTheme: Dispatch<SetStateAction<SuiteTheme>> = useCallback((nextTheme) => {
    setAppearance((current) => ({
      ...current,
      theme: resolveStateAction(nextTheme, current.theme),
    }));
  }, []);

  const setPaused: Dispatch<SetStateAction<boolean>> = useCallback((nextPaused) => {
    setAppearance((current) => ({
      ...current,
      paused: resolveStateAction(nextPaused, current.paused),
    }));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
    } catch {
      // Sem armazenamento disponível, a aparência continua funcional nesta sessão.
    }
  }, [appearance]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const reduceMotion = (event: MediaQueryListEvent) => {
      // Se a preferência do sistema passa a pedir redução, a animação cede imediatamente.
      if (event.matches) setAppearance((current) => ({ ...current, paused: true }));
    };

    media.addEventListener("change", reduceMotion);
    return () => media.removeEventListener("change", reduceMotion);
  }, []);

  return {
    theme: appearance.theme,
    setTheme,
    paused: appearance.paused,
    setPaused,
  };
}

/**
 * Monte este componente uma única vez dentro do wrapper da suíte.
 * A grade existe no CSS; a falha de WebGL nunca é apresentada como movimento.
 */
export function SuiteBackdrop({ module, theme, paused }: SuiteBackdropProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<AuroraController | null>(null);
  const [status, setStatus] = useState<AuroraStatus>({
    ready: false,
    renderer: "WebGL 1 · aurora autoral",
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let mounted = true;
    const engine = createSuiteAurora(
      canvas,
      (nextStatus) => {
        if (mounted) setStatus(nextStatus);
      },
      { module, theme },
    );

    engineRef.current = engine;

    return () => {
      mounted = false;
      engine.dispose();
      engineRef.current = null;
    };
    // O motor é criado uma vez; mudanças de estado chegam pelo efeito abaixo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;

    engine.setPalette(module, theme);
    engine.setActive(theme === "dark");
    engine.setPaused(paused);
  }, [module, theme, paused]);

  const fallbackVisible = theme === "dark" && Boolean(status.error);

  return (
    <>
      <div
        aria-hidden="true"
        className="suite-backdrop"
        data-aurora-state={status.ready ? "ready" : fallbackVisible ? "fallback" : "loading"}
        data-suite-module={module}
        data-suite-theme={theme}
      >
        <canvas className="suite-backdrop__canvas" ref={canvasRef} />
        <div className="suite-backdrop__grid" />
        <div className="suite-backdrop__vignette" />
      </div>

      {fallbackVisible ? (
        <p
          aria-live="polite"
          className="suite-backdrop__fallback"
          role="status"
          title={status.error}
        >
          Fundo estático · aurora indisponível
        </p>
      ) : null}
    </>
  );
}

/**
 * Controles deliberadamente sem estado próprio: o chamador continua dono da preferência.
 */
export function SuiteAppearanceControls({
  theme,
  onThemeChange,
}: SuiteAppearanceControlsProps) {
  const next = theme === "dark" ? "light" : "dark";
  const label = next === "light" ? "Ativar tema claro" : "Ativar tema escuro";
  return (
    <button aria-label={label} title={label} className="suite-theme-toggle" onClick={() => onThemeChange(next)} type="button">
      <span key={theme} className="suite-theme-toggle__face" aria-hidden="true">
        {theme === "dark" ? <Sun size={23} weight="thin" /> : <MoonStars size={23} weight="thin" />}
      </span>
    </button>
  );
}

/** Movimento fica nas preferências; o cabeçalho mantém somente o botão de tema. */
export function SuiteMotionControl({ paused, reducedMotion = false, onPausedChange }: { paused: boolean; reducedMotion?: boolean; onPausedChange: (paused: boolean) => void }) {
  const descriptionId = useId();
  const effectivePaused = paused || reducedMotion;
  return <button type="button" className="suite-motion-preference" role="switch" aria-checked={!effectivePaused} aria-label="Movimento da aurora" aria-describedby={descriptionId} disabled={reducedMotion} onClick={() => { if (!reducedMotion) onPausedChange(!paused); }}>
    {effectivePaused ? <Play aria-hidden="true" size={21} weight="thin" /> : <Pause aria-hidden="true" size={21} weight="thin" />}
    <span><strong>Movimento da aurora</strong><small id={descriptionId}>{reducedMotion ? "Pausado pela opção Movimento reduzido" : paused ? "Pausado · toque para retomar" : "Ativo · toque para pausar"}</small></span>
    <span className="suite-motion-preference__state" aria-hidden="true">{effectivePaused ? "Pausado" : "Ativo"}</span>
  </button>;
}
