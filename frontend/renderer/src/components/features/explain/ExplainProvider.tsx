import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@renderer/lib/auth";
import { apiBaseUrl } from "@renderer/lib/auth";
import { readSseEvents } from "@renderer/components/features/chat/stream";
import { ExplainContext } from "./explainContext";
import { ExplainBubble, type BubbleState } from "./ExplainBubble";
import { SparklesIcon } from "@renderer/components/ui/icons";
import {
  assistantPrompt,
  buildExplainBody,
  explainSubject,
  LANGUAGE_KEY,
  readLanguage,
  nextSteps,
  tableClick,
  type ExplainAnswer,
  type ExplainClick,
  type ExplainLanguage,
  type ExplainScreen,
  type Rect,
} from "./explainHelpers";

// Explain mode: with the switch on, clicking any card on a page that has opted in opens a small
// bubble with a short, plain answer from the assistant. The page only reports its *state* (tab,
// branch, dates); the assistant looks the figures up itself. Nothing is added to the page while the
// switch is off. See docs/assistant-explain.md.

interface ProviderProps {
  session: Session;
  /** The section the user is on (the app's own section id). */
  page: string;
  /** Only the accounts that may use the assistant. */
  allowed: boolean;
  /** Hands a question to the full assistant, which opens with it. */
  onAskAssistant: (text: string) => void;
  children: ReactNode;
}

interface Active {
  id: number;
  anchor: Rect;
  click: ExplainClick;
  state: BubbleState;
}

const cellText = (cell: Element): string =>
  (cell as HTMLElement).innerText ?? "";

// A column header or a table row sends only itself and the column names, not the whole table.
function readTableClick(target: HTMLElement): ExplainClick | null {
  const table = target.closest("table");
  const kind =
    target.tagName === "TH" ? "column" : target.tagName === "TR" ? "row" : null;
  if (!table || !kind) return null;
  const headRow = table.querySelector("thead tr") ?? table.querySelector("tr");
  const headers = headRow ? Array.from(headRow.children).map(cellText) : [];
  const row = target.tagName === "TR" ? target : null;
  const index = row
    ? -1
    : Array.from(target.parentElement?.children ?? []).indexOf(target);
  const sample = row ?? table.querySelector<HTMLElement>("tbody tr");
  const cells = sample ? Array.from(sample.children).map(cellText) : [];
  const section = table.closest("section, [data-explain]:not(tr):not(th)");
  const title =
    section?.querySelector("h1, h2, h3, h4, [data-explain-title]")
      ?.textContent ??
    table.querySelector("caption")?.textContent ??
    "";
  return tableClick(kind, headers, cells, index, title);
}

// The thing being explained stays marked while its bubble is open (see globals.css).
function markSelected(target: HTMLElement | null): void {
  document
    .querySelectorAll("[data-explain-selected]")
    .forEach((element) => element.removeAttribute("data-explain-selected"));
  target?.setAttribute("data-explain-selected", "");
}

function readClick(target: HTMLElement): ExplainClick {
  const table = readTableClick(target);
  if (table) return table;
  const named = target.getAttribute("data-explain") ?? "";
  const heading = target.querySelector("h1, h2, h3, h4, [data-explain-title]");
  const root = document.querySelector<HTMLElement>("[data-app-content]");
  return {
    focus: target.innerText,
    focusTitle: heading?.textContent ?? named,
    visibleText: root?.innerText ?? "",
  };
}

/** Shown while the mode is on and nothing is open: says what a click does. */
function ExplainHint(): React.JSX.Element {
  return (
    <div
      data-explain-ui=""
      role="status"
      className="explain-pop pointer-events-none fixed bottom-5 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-brand-pill bg-bg-base/95 px-3.5 py-2 text-xs font-medium text-text-secondary shadow-lg backdrop-blur"
    >
      <SparklesIcon className="h-3.5 w-3.5 text-brand" />
      Click a card, a row or a column heading to have it explained
    </div>
  );
}

export function ExplainProvider({
  session,
  page,
  allowed,
  onAskAssistant,
  children,
}: ProviderProps): React.JSX.Element {
  const [on, setOn] = useState(false);
  const [screen, setScreenState] = useState<ExplainScreen | null>(null);
  const [active, setActive] = useState<Active | null>(null);
  const [language, setLanguageState] = useState<ExplainLanguage>(() => {
    try {
      return readLanguage(window.localStorage.getItem(LANGUAGE_KEY));
    } catch {
      return "en";
    }
  });
  // The card the open bubble is about, so a change of language asks about the same card again.
  const lastTarget = useRef<HTMLElement | null>(null);
  const counter = useRef(0);
  const abort = useRef<AbortController | null>(null);

  const close = useCallback(() => {
    abort.current?.abort();
    markSelected(null);
    setActive(null);
  }, []);

  const toggle = useCallback(() => setOn((value) => !value), []);
  const setScreen = useCallback((next: ExplainScreen | null) => {
    setScreenState(next);
  }, []);

  const hasScreen = screen !== null;
  const live = allowed && on && hasScreen;

  // A page that stops taking part (or a different page) ends the explanation on screen.
  useEffect(() => {
    if (!live) close();
  }, [live, close]);
  useEffect(() => {
    close();
  }, [
    page,
    screen?.tab,
    screen?.branchId,
    screen?.dateFrom,
    screen?.dateTo,
    close,
  ]);

  useEffect(() => {
    document.body.dataset.explainMode = live ? "on" : "off";
    if (!live) markSelected(null);
    return () => {
      delete document.body.dataset.explainMode;
    };
  }, [live]);

  const ask = useCallback(
    async (target: HTMLElement, answerIn: ExplainLanguage) => {
      if (!screen) return;
      lastTarget.current = target;
      markSelected(target);
      const click = readClick(target);
      const id = ++counter.current;
      const rect = target.getBoundingClientRect();
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;
      setActive({
        id,
        anchor: {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        },
        click,
        state: { status: "loading", steps: [] },
      });
      const finish = (state: BubbleState): void =>
        setActive((current) =>
          current?.id === id ? { ...current, state } : current,
        );
      try {
        const response = await fetch(`${apiBaseUrl}/api/chat/explain/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(buildExplainBody(page, screen, click, answerIn)),
          signal: controller.signal,
        });
        if (!response.ok || !response.body) {
          const detail = (await response.json().catch(() => null)) as {
            detail?: string;
          } | null;
          finish({
            status: "error",
            message: detail?.detail ?? "Couldn't explain this just now.",
          });
          return;
        }
        // Each step the assistant takes arrives as a "status" line, shown while it works.
        for await (const { event, data } of readSseEvents(response.body)) {
          if (event === "status") {
            const text = (data as { text: string }).text;
            setActive((current) =>
              current?.id === id && current.state.status === "loading"
                ? {
                    ...current,
                    state: {
                      status: "loading",
                      steps: nextSteps(current.state.steps, text),
                    },
                  }
                : current,
            );
          } else if (event === "answer") {
            finish({ status: "done", result: data as ExplainAnswer });
            return;
          } else if (event === "error") {
            finish({
              status: "error",
              message:
                (data as { detail?: string }).detail ??
                "Couldn't explain this just now.",
            });
            return;
          }
        }
        finish({ status: "error", message: "Couldn't explain this just now." });
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        finish({ status: "error", message: "Couldn't explain this just now." });
      }
    },
    [page, screen, session.access_token],
  );

  // While the switch is on, a click on a card explains it instead of doing what it normally does
  // (a card that opens a page must not navigate away from the question). Anything else closes the
  // bubble and behaves as usual.
  useEffect(() => {
    if (!live) return;
    function onClick(event: MouseEvent): void {
      const element = event.target instanceof Element ? event.target : null;
      if (!element || element.closest("[data-explain-ui]")) return;
      const target = element.closest<HTMLElement>("[data-explain]");
      if (!target) {
        close();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      void ask(target, language);
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") close();
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [live, ask, close, language]);

  const value = useMemo(
    () => ({ allowed, on, toggle, setScreen, hasScreen, live }),
    [allowed, on, toggle, setScreen, hasScreen, live],
  );

  function changeLanguage(next: ExplainLanguage): void {
    if (next === language) return;
    setLanguageState(next);
    try {
      window.localStorage.setItem(LANGUAGE_KEY, next);
    } catch {
      // The choice just isn't remembered.
    }
    if (lastTarget.current && active) void ask(lastTarget.current, next);
  }

  function handOver(question: string | null): void {
    if (!active) return;
    onAskAssistant(assistantPrompt(question, active.click));
    close();
  }

  return (
    <ExplainContext.Provider value={value}>
      {children}
      {live && (
        <div
          aria-hidden="true"
          data-explain-ui=""
          className="pointer-events-none fixed inset-0 z-30 bg-brand transition-opacity duration-200"
          style={{ opacity: active ? 0.045 : 0.025 }}
        />
      )}
      {live && !active && <ExplainHint />}
      {live && active && (
        <ExplainBubble
          // Same card, same bubble (a language change keeps where it was dragged to); another card, a new one.
          key={`${active.anchor.left}:${active.anchor.top}`}
          anchor={active.anchor}
          subject={explainSubject(active.click)}
          state={active.state}
          language={language}
          onLanguageChange={changeLanguage}
          onClose={close}
          onFollowUp={(question) => handOver(question)}
          onContinue={() => handOver(null)}
        />
      )}
    </ExplainContext.Provider>
  );
}
