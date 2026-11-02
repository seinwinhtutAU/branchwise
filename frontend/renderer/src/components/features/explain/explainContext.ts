import { createContext, useContext, useEffect } from "react";
import { usePageActive } from "@renderer/lib/pageActive";
import { NO_SCREEN, type ExplainScreen } from "./explainHelpers";

export interface ExplainContextValue {
  allowed: boolean;
  on: boolean;
  toggle: () => void;
  setScreen: (screen: ExplainScreen | null) => void;
  /** True once a page has reported its state, i.e. the page takes part in explain mode. */
  hasScreen: boolean;
  /** Mode on, allowed, and on a page that takes part: the pet sits in the header. */
  live: boolean;
}

export const ExplainContext = createContext<ExplainContextValue>({
  allowed: false,
  on: false,
  toggle: () => undefined,
  setScreen: () => undefined,
  hasScreen: false,
  live: false,
});

/** A page calls this to take part in explain mode, reporting what it is showing. */
export function useExplainScreen(screen: ExplainScreen): void {
  const { setScreen } = useContext(ExplainContext);
  const { tab, branchId, dateFrom, dateTo } = screen;
  // A page kept mounted while hidden (see shell/KeptPage) must not speak for the page on screen.
  const active = usePageActive();
  useEffect(() => {
    if (!active) return;
    setScreen({ ...NO_SCREEN, tab, branchId, dateFrom, dateTo });
    return () => setScreen(null);
  }, [active, setScreen, tab, branchId, dateFrom, dateTo]);
}
