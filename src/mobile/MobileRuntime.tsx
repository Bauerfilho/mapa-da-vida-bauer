import { useEffect, useState, type PropsWithChildren } from "react";
import { MobileDeviceProvider, useMobileDevice } from "./Device";
import { KeyboardDock, KeyboardProvider, useKeyboard } from "./Keyboard";
import {
  MobileRuntimeModeProvider,
  PhoneFrame,
  type MobileRuntimeMode,
  useMobileRuntimeMode,
} from "./PhoneFrame";
import { HomeIndicator, StatusBar } from "./components";

type StandaloneNavigator = Navigator & { standalone?: boolean };

function hasExplicitPreviewOverride(search: string) {
  return new URLSearchParams(search).get("preview") === "1";
}

function hasExplicitNativeOverride(search: string) {
  return new URLSearchParams(search).get("native") === "1";
}

export function resolveMobileRuntimeMode(): MobileRuntimeMode {
  if (typeof window === "undefined") return "preview";

  const { search } = window.location;
  if (hasExplicitPreviewOverride(search)) return "preview";
  if (hasExplicitNativeOverride(search)) return "native";

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    Boolean((window.navigator as StandaloneNavigator).standalone);
  const smallCoarseScreen =
    window.matchMedia("(max-width: 767px)").matches &&
    window.matchMedia("(pointer: coarse)").matches;

  return standalone || smallCoarseScreen ? "native" : "preview";
}

function subscribeMediaQuery(query: MediaQueryList, listener: () => void) {
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function useResolvedRuntimeMode() {
  const [mode, setMode] = useState<MobileRuntimeMode>(() => resolveMobileRuntimeMode());

  useEffect(() => {
    const { search } = window.location;
    if (hasExplicitPreviewOverride(search) || hasExplicitNativeOverride(search)) {
      setMode(resolveMobileRuntimeMode());
      return;
    }

    const standalone = window.matchMedia("(display-mode: standalone)");
    const small = window.matchMedia("(max-width: 767px)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => setMode(resolveMobileRuntimeMode());
    const unsubscribe = [standalone, small, coarse].map((query) =>
      subscribeMediaQuery(query, update),
    );

    window.addEventListener("resize", update, { passive: true });

    return () => {
      for (const remove of unsubscribe) remove();
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    const previousHtmlMode = document.documentElement.dataset.mobileRuntime;
    const previousBodyMode = document.body.dataset.mobileRuntime;
    document.documentElement.dataset.mobileRuntime = mode;
    document.body.dataset.mobileRuntime = mode;

    return () => {
      if (previousHtmlMode === undefined) {
        delete document.documentElement.dataset.mobileRuntime;
      } else {
        document.documentElement.dataset.mobileRuntime = previousHtmlMode;
      }

      if (previousBodyMode === undefined) {
        delete document.body.dataset.mobileRuntime;
      } else {
        document.body.dataset.mobileRuntime = previousBodyMode;
      }
    };
  }, [mode]);

  return mode;
}

export function MobileRuntime({ children }: PropsWithChildren) {
  const mode = useResolvedRuntimeMode();

  return (
    <MobileRuntimeModeProvider mode={mode}>
      <MobileDeviceProvider>
        <PhoneFrame>
          <KeyboardProvider>
            <RuntimeChrome>{children}</RuntimeChrome>
          </KeyboardProvider>
        </PhoneFrame>
      </MobileDeviceProvider>
    </MobileRuntimeModeProvider>
  );
}

function RuntimeChrome({ children }: PropsWithChildren) {
  const { isNative } = useMobileRuntimeMode();

  return (
    <>
      {isNative ? null : <KeyboardPreview />}
      {isNative ? null : <StatusBar />}
      <MobileAppViewport>{children}</MobileAppViewport>
      {isNative ? null : <HomeIndicator />}
      {isNative ? null : <KeyboardDock />}
    </>
  );
}

function MobileAppViewport({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const { mode } = useMobileRuntimeMode();
  const keyboard = useKeyboard();

  return (
    <div
      className="mobile-app-viewport"
      data-keyboard-visible={keyboard.visible ? "true" : "false"}
      data-platform={device.platform}
      data-runtime-mode={mode}
      data-testid="mobile-app-viewport"
    >
      {children}
    </div>
  );
}

function KeyboardPreview() {
  const keyboard = useKeyboard();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("keyboard") === "1") {
      keyboard.show();
    }
  }, [keyboard]);

  return null;
}
