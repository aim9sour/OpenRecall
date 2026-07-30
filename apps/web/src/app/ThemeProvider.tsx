import type {
  AppearancePreferences,
  ThemePreference,
} from "@openrecall/contracts";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ApiClient } from "../api/client.js";

type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  readonly preference: ThemePreference;
  readonly resolved: ResolvedTheme;
  readonly busy: boolean;
  readonly error: string | null;
  readonly setPreference: (
    preference: ThemePreference,
  ) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);

function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function ThemeProvider({
  api,
  children,
}: {
  readonly api: ApiClient;
  readonly children: ReactNode;
}) {
  const [appearance, setAppearance] =
    useState<AppearancePreferences>({
      theme: "system",
      updatedAtMs: 0,
    });
  const [systemDark, setSystemDark] = useState(systemPrefersDark);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .get<AppearancePreferences>("/api/v1/settings/appearance")
      .then((loaded) => {
        if (active) setAppearance(loaded);
      })
      .catch(() => {
        if (active) setError("THEME_LOAD_FAILED");
      });
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const update = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    setSystemDark(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const resolved: ResolvedTheme =
    appearance.theme === "system"
      ? systemDark
        ? "dark"
        : "light"
      : appearance.theme;

  useEffect(() => {
    document.documentElement.dataset["theme"] = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference: appearance.theme,
      resolved,
      busy,
      error,
      async setPreference(theme) {
        if (busy || theme === appearance.theme) return;
        setBusy(true);
        setError(null);
        try {
          const saved = await api.put<AppearancePreferences>(
            "/api/v1/settings/appearance",
            {
              expectedUpdatedAtMs: appearance.updatedAtMs,
              theme,
            },
          );
          setAppearance(saved);
        } catch {
          setError("THEME_SAVE_FAILED");
        } finally {
          setBusy(false);
        }
      },
    }),
    [api, appearance, busy, error, resolved],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value === undefined) throw new Error("THEME_PROVIDER_MISSING");
  return value;
}
