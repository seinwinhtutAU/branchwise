import { useEffect, useLayoutEffect, type ReactNode } from "react";
import { PageActiveContext } from "@renderer/lib/pageActive";
import { recallScroll, rememberScroll } from "./scrollMemory";

interface KeptPageProps {
  /** The page has been on screen at least once; until then nothing is built. */
  visited: boolean;
  /** The page is on screen right now. */
  active: boolean;
  /** Names this page's scroll position (pages that share a component share a key). */
  scrollKey: string;
  children: ReactNode;
}

// What scrolls: the app's content area when the shell has one, otherwise the document.
function scroller(): {
  top: () => number;
  scrollTo: (top: number) => void;
  target: EventTarget;
} {
  const area = document.querySelector<HTMLElement>("[data-app-content]");
  if (area) {
    return {
      top: () => area.scrollTop,
      scrollTo: (top) => {
        area.scrollTop = top;
      },
      target: area,
    };
  }
  return {
    top: () => window.scrollY,
    scrollTo: (top) => window.scrollTo(0, top),
    target: window,
  };
}

/** A page that stays mounted, hidden, once it has been visited, so its filters, search, tab,
 *  page number and expanded rows are still there when you come back, and that is put back at the
 *  scroll position it was left at. While hidden it tells its queries to pause (see
 *  lib/pageActive.ts) so six mounted pages don't all refetch after every import. */
export default function KeptPage({
  visited,
  active,
  scrollKey,
  children,
}: KeptPageProps): React.JSX.Element | null {
  // While on screen, keep noting where it is scrolled to. (Noting it on the way out is too late:
  // by then the page may already be hidden and the container's offset clamped.)
  useEffect(() => {
    if (!active) return;
    const area = scroller();
    const onScroll = (): void => rememberScroll(scrollKey, area.top());
    area.target.addEventListener("scroll", onScroll, { passive: true });
    return () => area.target.removeEventListener("scroll", onScroll);
  }, [active, scrollKey]);

  // Coming on screen: back to where it was (the top, the first time).
  useLayoutEffect(() => {
    if (active) scroller().scrollTo(recallScroll(scrollKey));
  }, [active, scrollKey]);

  if (!visited && !active) return null;
  return (
    <PageActiveContext.Provider value={active}>
      <div className={active ? "contents" : "hidden"}>{children}</div>
    </PageActiveContext.Provider>
  );
}
