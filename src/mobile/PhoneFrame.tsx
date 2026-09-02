import {
  createContext,
  type CSSProperties,
  type DragEvent,
  type PropsWithChildren,
  type RefObject,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { DevicePicker, useMobileDevice } from "./Device";
import { useMobileCursor } from "./MobileCursor";

type ScreenPortalContextValue = {
  screenRef: RefObject<HTMLDivElement | null>;
};

const ScreenPortalContext = createContext<ScreenPortalContextValue | null>(null);

export type MobileRuntimeMode = "native" | "preview";

type MobileRuntimeModeContextValue = {
  mode: MobileRuntimeMode;
  isNative: boolean;
};

const MobileRuntimeModeContext = createContext<MobileRuntimeModeContextValue | null>(null);

export function MobileRuntimeModeProvider({
  mode,
  children,
}: PropsWithChildren<{ mode: MobileRuntimeMode }>) {
  const value = useMemo(() => ({ mode, isNative: mode === "native" }), [mode]);

  return (
    <MobileRuntimeModeContext.Provider value={value}>
      {children}
    </MobileRuntimeModeContext.Provider>
  );
}

export function useMobileRuntimeMode() {
  const context = useContext(MobileRuntimeModeContext);

  if (!context) {
    throw new Error("useMobileRuntimeMode must be used inside MobileRuntimeModeProvider");
  }

  return context;
}

function suppressNativeDrag(event: DragEvent<HTMLElement>) {
  if (event.target instanceof Element && event.target.closest('[data-native-drag="true"]')) {
    return;
  }

  event.preventDefault();
}

export function useScreenPortal() {
  const context = useContext(ScreenPortalContext);

  if (!context) {
    throw new Error("useScreenPortal must be used inside PhoneFrame");
  }

  return context;
}

function getDeviceScale(deviceWidth: number, deviceHeight: number) {
  if (typeof window === "undefined") return 1;

  const horizontal = (window.innerWidth - 48) / deviceWidth;
  const vertical = (window.innerHeight - 48) / deviceHeight;

  return Math.max(0.42, Math.min(horizontal, vertical, 1));
}

function useDeviceScale(deviceWidth: number, deviceHeight: number, enabled: boolean) {
  const [scale, setScale] = useState(() =>
    enabled ? getDeviceScale(deviceWidth, deviceHeight) : 1,
  );

  useEffect(() => {
    if (!enabled) {
      setScale(1);
      return;
    }

    const update = () => setScale(getDeviceScale(deviceWidth, deviceHeight));

    update();
    window.addEventListener("resize", update);

    return () => window.removeEventListener("resize", update);
  }, [deviceHeight, deviceWidth, enabled]);

  return scale;
}

export function PhoneFrame({ children }: PropsWithChildren) {
  const { device } = useMobileDevice();
  const { isNative, mode } = useMobileRuntimeMode();
  const { geometry } = device;
  const scale = useDeviceScale(geometry.device.width, geometry.device.height, !isNative);
  const screenRef = useRef<HTMLDivElement | null>(null);
  const contextValue = useMemo(() => ({ screenRef }), []);
  const mobileCursor = useMobileCursor();

  return (
    <ScreenPortalContext.Provider value={contextValue}>
      <div className="phone-stage" data-runtime-mode={mode} data-testid="phone-stage">
        {isNative ? null : <DevicePicker />}
        <div
          className="phone-scale-box"
          style={
            isNative
              ? undefined
              : {
                  width: geometry.device.width * scale,
                  height: geometry.device.height * scale,
                }
          }
        >
          <div
            className="phone-device"
            data-device={device.id}
            data-platform={device.platform}
            data-testid="phone-frame"
            onDragStartCapture={suppressNativeDrag}
            style={
              isNative
                ? undefined
                : {
                    width: geometry.device.width,
                    height: geometry.device.height,
                    transform: `scale(${scale})`,
                  }
            }
          >
            {isNative ? null : (
              <img
                className="phone-bezel"
                src={device.bezel}
                alt=""
                aria-hidden="true"
                draggable={false}
                style={{ zIndex: device.bezelLayer === "above-screen" ? 2 : 1 }}
              />
            )}
            <div
              ref={screenRef}
              className="device-screen"
              data-cursor-debug={mobileCursor.cursorDebug ? "true" : "false"}
              data-device={device.id}
              data-phone-screen
              data-testid="device-screen"
              {...(isNative ? {} : mobileCursor.cursorHandlers)}
              style={
                {
                  "--device-safe-area-top": isNative
                    ? "env(safe-area-inset-top, 0px)"
                    : `${geometry.safeArea.top}px`,
                  "--device-safe-area-bottom": isNative
                    ? "env(safe-area-inset-bottom, 0px)"
                    : `${geometry.safeArea.bottom}px`,
                  ...(isNative
                    ? {
                        inset: 0,
                        width: "100%",
                        height: "100%",
                        borderRadius: 0,
                        zIndex: 1,
                      }
                    : {
                        left: geometry.screen.x,
                        top: geometry.screen.y,
                        width: geometry.screen.width,
                        height: geometry.screen.height,
                        borderRadius: geometry.screen.radius,
                        zIndex: device.bezelLayer === "above-screen" ? 1 : 2,
                      }),
                } as CSSProperties & Record<`--${string}`, string | number>
              }
            >
              {children}
              {!isNative && device.camera ? (
                <span
                  className="device-camera"
                  data-testid="device-camera"
                  aria-hidden="true"
                  style={{
                    width: device.camera.size,
                    height: device.camera.size,
                    top: device.camera.top,
                    left: `calc(50% - ${device.camera.size / 2}px)`,
                  }}
                />
              ) : null}
              {isNative ? null : mobileCursor.cursorElement}
            </div>
          </div>
        </div>
      </div>
    </ScreenPortalContext.Provider>
  );
}
