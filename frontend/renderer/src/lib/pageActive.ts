import { createContext, useContext } from "react";

// Whether the page a component sits in is the one on screen. A page that is kept mounted while
// you are elsewhere (see features/shell/KeptPage.tsx) says `false`, so its queries pause instead of
// refetching in the background; the default is `true`, for everything not inside a kept page.
export const PageActiveContext = createContext(true);

export function usePageActive(): boolean {
  return useContext(PageActiveContext);
}

/** A query may run when it has what it needs (a URL, a signed-in session) and its page is on screen. */
export function queryEnabled(ready: boolean, pageActive: boolean): boolean {
  return ready && pageActive;
}
