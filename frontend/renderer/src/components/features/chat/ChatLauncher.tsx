import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useContext,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { Session } from "@renderer/lib/auth";
import { cn } from "@renderer/lib/utils";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  BookIcon,
  CloseIcon,
  DollarIcon,
  SwapIcon,
} from "@renderer/components/ui/icons";
import type { Profile } from "@renderer/components/features/types";
import { petClickAction } from "./petClick";
import { mascotSrc, petIconSrc, usePetKind } from "./petKind";
import { PERCH_SCALE, perchPosition, type PerchRect } from "./petPerch";
import { ExplainContext } from "@renderer/components/features/explain/explainContext";

// The chat, as a button that floats over whatever page you are on rather than a section
// you have to navigate to. Asking "what's low on stock?" is something you do *while*
// looking at something else, and a nav item made it a place you had to leave the page
// for — which is also why the answer is more useful beside the page that prompted the
// question than on a screen of its own.
//
// The panel is kept mounted once it has been opened (hidden, not unmounted) so closing it
// mid-conversation doesn't throw the thread away: chat history lives in component state,
// since there is no server-side session store yet (see ChatPanel).

const ChatPanel = lazy(
  () => import("@renderer/components/features/chat/ChatPanel"),
);

interface Props {
  session: Session;
  profile: Profile | null;
  contextPage: string;
  currentBranchId: string | null;
  onNavigate?: (section: string) => void;
  // Opens the Knowledge page. Only given to accounts that may use it, so the button under the
  // pet's help button appears for them alone.
  onOpenKnowledge?: () => void;
  // A question handed over by the explain bubble: the chat opens and sends it. A new `id` is a new
  // request, so asking the same words twice still works.
  askRequest?: { id: number; text: string } | null;
}

interface PetPosition {
  left: number;
  top: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  initialLeft: number;
  initialTop: number;
  hasMoved: boolean;
}

interface PetMenuPosition {
  left: number;
  top: number;
}

type PetActivity = "idle" | "greeting" | "thinking" | "happy" | "dragging";

const PET_SIZE = 76;
const PET_POSITION_KEY = "branchwise-assistant-pet-position";
const DRAG_THRESHOLD = 4;
const VIEWPORT_PADDING = 12;
const CHAT_PANEL_WIDTH = 416;
const CHAT_PANEL_HEIGHT = 512;
const CHAT_PANEL_GAP = 8;
const EXPANDED_COMPOSER_CLEARANCE = 132;
const EXPANDED_SEND_BUTTON_RIGHT_OFFSET = 40;
const PET_HELP_SIZE = 28;
const PET_HELP_GAP = 6;
// The pet's menu is a short column: Knowledge when available, Usage, then pet switching.

function PanelSizeIcon({ expanded }: { expanded: boolean }): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="w-4 h-4"
    >
      {expanded ? (
        <path d="M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6" />
      ) : (
        <path d="M3 9V3h6m6 0h6v6m0 6v6h-6M9 21H3v-6" />
      )}
    </svg>
  );
}

function CatSprite({
  activity,
  className,
}: {
  activity: PetActivity;
  className: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "branchwise-cat-pet-container",
        `branchwise-cat-mode-${activity}`,
        className,
      )}
    >
      <span className="branchwise-cat-ground-shadow" />
      <span className="branchwise-cat-pet-shell">
        <span className="branchwise-cat-pet block w-full h-full">
          <img
            src={mascotSrc("branchwise-cat-idle.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-idle"
          />
          <img
            src={mascotSrc("branchwise-cat-blink.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-blink"
          />
          <img
            src={mascotSrc("branchwise-cat-tail.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-tail"
          />
          <img
            src={mascotSrc("branchwise-cat-wave.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-wave"
          />
          <img
            src={mascotSrc("branchwise-cat-alert.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-alert"
          />
          <img
            src={mascotSrc("branchwise-cat-thinking.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-thinking"
          />
          <img
            src={mascotSrc("branchwise-cat-sleep.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-sleep"
          />
          <img
            src={mascotSrc("branchwise-cat-wash.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-wash"
          />
          <img
            src={mascotSrc("branchwise-cat-happy.png")}
            alt=""
            draggable={false}
            className="branchwise-cat-frame branchwise-cat-frame-happy"
          />
        </span>
      </span>
    </span>
  );
}

function RobotSprite({
  activity,
  className,
}: {
  activity: PetActivity;
  className: string;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "branchwise-robot-pet",
        `branchwise-robot-mode-${activity}`,
        className,
      )}
    >
      <span className="branchwise-robot-pet-shell">
        <img
          src={mascotSrc("branchwise-robot-idle.png")}
          alt=""
          draggable={false}
          className="branchwise-robot-frame branchwise-robot-frame-idle"
        />
        <img
          src={mascotSrc("branchwise-robot-blink.png")}
          alt=""
          draggable={false}
          className="branchwise-robot-frame branchwise-robot-frame-blink"
        />
        <img
          src={mascotSrc("branchwise-robot-thinking.png")}
          alt=""
          draggable={false}
          className="branchwise-robot-frame branchwise-robot-frame-thinking"
        />
        <img
          src={mascotSrc("branchwise-robot-happy.png")}
          alt=""
          draggable={false}
          className="branchwise-robot-frame branchwise-robot-frame-happy"
        />
        <img
          src={mascotSrc("branchwise-robot-effort.png")}
          alt=""
          draggable={false}
          className="branchwise-robot-frame branchwise-robot-frame-effort"
        />
      </span>
    </span>
  );
}

function clampPetPosition(left: number, top: number): PetPosition {
  return {
    left: Math.max(0, Math.min(left, window.innerWidth - PET_SIZE)),
    top: Math.max(0, Math.min(top, window.innerHeight - PET_SIZE)),
  };
}

function readPetPosition(): PetPosition | null {
  try {
    const stored = localStorage.getItem(PET_POSITION_KEY);
    if (!stored) return null;
    const position = JSON.parse(stored) as PetPosition;
    if (!Number.isFinite(position.left) || !Number.isFinite(position.top)) {
      return null;
    }
    return clampPetPosition(position.left, position.top);
  } catch {
    return null;
  }
}

function getDefaultPetPosition(): PetPosition {
  return {
    left: window.innerWidth - PET_SIZE - VIEWPORT_PADDING,
    top: window.innerHeight - PET_SIZE - VIEWPORT_PADDING,
  };
}

function getExpandedPetPosition(): PetPosition {
  return clampPetPosition(
    window.innerWidth - PET_SIZE - EXPANDED_SEND_BUTTON_RIGHT_OFFSET,
    window.innerHeight -
      PET_SIZE -
      VIEWPORT_PADDING -
      EXPANDED_COMPOSER_CLEARANCE,
  );
}

function getChatPanelPosition(petPosition: PetPosition | null): PetPosition {
  const pet = petPosition ?? getDefaultPetPosition();
  const panelHeight = Math.min(
    CHAT_PANEL_HEIGHT,
    window.innerHeight - VIEWPORT_PADDING * 2,
  );
  const hasSpaceAbove = pet.top >= panelHeight + CHAT_PANEL_GAP;
  // The normal relationship is a familiar chat-widget arrangement: the cat sits just
  // beneath the panel's bottom-right corner. If it is dragged near the top edge, the
  // panel opens below instead so it remains fully usable.
  const desiredLeft = pet.left + PET_SIZE - CHAT_PANEL_WIDTH;
  const desiredTop = hasSpaceAbove
    ? pet.top - panelHeight - CHAT_PANEL_GAP
    : pet.top + PET_SIZE + CHAT_PANEL_GAP;

  return {
    left: Math.max(
      VIEWPORT_PADDING,
      Math.min(
        desiredLeft,
        window.innerWidth - CHAT_PANEL_WIDTH - VIEWPORT_PADDING,
      ),
    ),
    top: Math.max(
      VIEWPORT_PADDING,
      Math.min(desiredTop, window.innerHeight - panelHeight - VIEWPORT_PADDING),
    ),
  };
}

// Focus mode remains inside the application's content area, but must be pinned to the
// viewport. An absolute panel uses the document's full height, which lets a long
// conversation scroll its title and composer out of view.
function getExpandedPanelStyle(): React.CSSProperties {
  const content = document.querySelector<HTMLElement>("[data-app-content]");
  const header = document.querySelector<HTMLElement>("[data-app-header]");
  const contentRect = content?.getBoundingClientRect();
  const headerRect = header?.getBoundingClientRect();
  const inset = window.innerWidth < 640 ? 12 : 16;
  const top = headerRect
    ? Math.max(inset, headerRect.bottom + inset)
    : Math.max(inset, (contentRect?.top ?? 0) + inset);

  return {
    left: Math.max(inset, (contentRect?.left ?? 0) + inset),
    right: Math.max(
      inset,
      window.innerWidth - (contentRect?.right ?? window.innerWidth) + inset,
    ),
    top,
    bottom: inset,
  };
}

function getPetHelpPosition(
  rect: DOMRect,
  menuItemCount: number,
): PetMenuPosition {
  // Beside the pet, but never so low that the column runs off the bottom of the window.
  const menuHeight =
    PET_HELP_SIZE * menuItemCount + PET_HELP_GAP * (menuItemCount - 1);
  const lowestTop = window.innerHeight - VIEWPORT_PADDING - menuHeight;
  const right = rect.right + PET_HELP_GAP;
  if (right + PET_HELP_SIZE <= window.innerWidth - VIEWPORT_PADDING) {
    return { left: right, top: Math.min(rect.top + PET_HELP_GAP, lowestTop) };
  }
  const left = rect.left - PET_HELP_GAP - PET_HELP_SIZE;
  if (left >= VIEWPORT_PADDING) {
    return { left, top: Math.min(rect.top + PET_HELP_GAP, lowestTop) };
  }
  return {
    left: Math.max(VIEWPORT_PADDING, rect.left + rect.width - PET_HELP_SIZE),
    top: Math.max(VIEWPORT_PADDING, rect.top - PET_HELP_GAP - menuHeight),
  };
}

export function ChatLauncher({
  session,
  profile,
  contextPage,
  currentBranchId,
  onNavigate,
  onOpenKnowledge,
  askRequest,
}: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  // Bumped each time the menu asks for the Usage view; the panel opens it when this changes.
  const [usageRequest, setUsageRequest] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [petActivity, setPetActivity] = useState<PetActivity>("idle");
  const [petKind, setPetKind] = usePetKind();
  const [expandedPetPosition, setExpandedPetPosition] =
    useState<PetPosition | null>(null);
  const [petPosition, setPetPosition] = useState<PetPosition | null>(
    readPetPosition,
  );
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  // Only here to re-render when the window's height changes (the pet's default spot uses it).
  const [, setViewportHeight] = useState(() => window.innerHeight);
  // Explain mode on: the pet leaves its spot and sits on the Explain switch in the header.
  const { live: perched, toggle: toggleExplain } = useContext(ExplainContext);
  const [perchRect, setPerchRect] = useState<PerchRect | null>(null);
  // True while the pet is walking to or from the header, so the walk is animated but a drag is not.
  const [travelling, setTravelling] = useState(false);
  const [petMenuPosition, setPetMenuPosition] =
    useState<PetMenuPosition | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const shouldIgnoreClickRef = useRef(false);
  // True right after a click that took the expanded panel back to its normal size.
  const restoredByClickRef = useRef(false);
  const petActivityTimerRef = useRef<number | null>(null);
  const isSendingRef = useRef(false);
  // Nothing is loaded or mounted until the first open — the chat bundle is only fetched
  // by someone who actually wants it.
  const [opened, setOpened] = useState(false);
  // The explain bubble's question, held until the panel (which may still be loading) has sent it.
  const [pendingAsk, setPendingAsk] = useState<{
    id: number;
    text: string;
  } | null>(null);
  useEffect(() => {
    if (!askRequest) return;
    setPendingAsk(askRequest);
    setOpened(true);
    setOpen(true);
  }, [askRequest]);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        openExpanded();
        return;
      }
      if (event.key !== "Escape") return;
      if (expanded) {
        setExpanded(false);
        setExpandedPetPosition(null);
      } else setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded, open]);

  useEffect(() => {
    if (!petMenuPosition) return;
    function closeMenu(): void {
      setPetMenuPosition(null);
    }
    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") closeMenu();
    }
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [petMenuPosition]);

  useEffect(() => {
    if (!petPosition) return;
    localStorage.setItem(PET_POSITION_KEY, JSON.stringify(petPosition));
  }, [petPosition]);

  // Where the Explain switch's slot is, kept up to date while the pet is sitting on it.
  useEffect(() => {
    if (!perched) {
      setPerchRect(null);
      return;
    }
    const slot = document.querySelector<HTMLElement>("[data-explain-perch]");
    if (!slot) return;
    function measure(): void {
      const rect = slot!.getBoundingClientRect();
      setPerchRect({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    observer.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [perched]);

  // The walk, there and back, is animated for a moment after the mode changes, then the animation
  // is switched off again so dragging the pet stays immediate. The flag is raised while rendering
  // (not in an effect) so the very first frame of the walk home already has its transition; raised
  // in an effect, the way back would jump. The pet waves once it has arrived, in either direction.
  const [lastPerched, setLastPerched] = useState(perched);
  if (perched !== lastPerched) {
    setLastPerched(perched);
    setTravelling(true);
  }
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const arrived = window.setTimeout(() => {
      setTravelling(false);
      showGreeting();
    }, 520);
    return () => window.clearTimeout(arrived);
  }, [perched]);

  useEffect(() => {
    function keepPetInViewport(): void {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
      setPetPosition((position) =>
        position ? clampPetPosition(position.left, position.top) : position,
      );
      setExpandedPetPosition((position) =>
        position ? clampPetPosition(position.left, position.top) : position,
      );
    }
    window.addEventListener("resize", keepPetInViewport);
    return () => window.removeEventListener("resize", keepPetInViewport);
  }, []);

  useEffect(
    () => () => {
      if (petActivityTimerRef.current) {
        window.clearTimeout(petActivityTimerRef.current);
      }
    },
    [],
  );

  function showGreeting(): void {
    if (petActivityTimerRef.current) {
      window.clearTimeout(petActivityTimerRef.current);
    }
    setPetActivity("greeting");
    petActivityTimerRef.current = window.setTimeout(() => {
      setPetActivity("idle");
      petActivityTimerRef.current = null;
    }, 1800);
  }

  function showHappy(): void {
    if (petActivityTimerRef.current) {
      window.clearTimeout(petActivityTimerRef.current);
    }
    setPetActivity("happy");
    petActivityTimerRef.current = window.setTimeout(() => {
      setPetActivity("idle");
      petActivityTimerRef.current = null;
    }, 1400);
  }

  function handleSendingChange(isSending: boolean): void {
    isSendingRef.current = isSending;
    if (!isSending) return;
    if (petActivityTimerRef.current) {
      window.clearTimeout(petActivityTimerRef.current);
      petActivityTimerRef.current = null;
    }
    setPetActivity("thinking");
  }

  function handleReplyFinished(succeeded: boolean): void {
    isSendingRef.current = false;
    if (succeeded) showHappy();
    else setPetActivity("idle");
  }

  function toggle(): void {
    if (open) {
      closeChat();
      return;
    }
    setOpened(true);
    setOpen(true);
  }

  function closeChat(): void {
    setExpanded(false);
    setExpandedPetPosition(null);
    setOpen(false);
  }

  function toggleExpanded(): void {
    if (expanded) {
      setExpanded(false);
      setExpandedPetPosition(null);
      return;
    }
    setExpandedPetPosition(getExpandedPetPosition());
    setExpanded(true);
  }

  function openExpanded(): void {
    setOpened(true);
    setOpen(true);
    setExpandedPetPosition(getExpandedPetPosition());
    setExpanded(true);
  }

  function handlePointerDown(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    if (event.button !== 0 || perched) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      initialLeft: rect.left,
      initialTop: rect.top,
      hasMoved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handlePointerMove(
    event: ReactPointerEvent<HTMLButtonElement>,
  ): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const offsetX = event.clientX - dragState.startX;
    const offsetY = event.clientY - dragState.startY;
    if (!dragState.hasMoved && Math.hypot(offsetX, offsetY) < DRAG_THRESHOLD) {
      return;
    }
    dragState.hasMoved = true;
    setPetActivity("dragging");
    const nextPosition = clampPetPosition(
      dragState.initialLeft + offsetX,
      dragState.initialTop + offsetY,
    );
    if (expanded) setExpandedPetPosition(nextPosition);
    else setPetPosition(nextPosition);
  }

  function handlePointerEnd(event: ReactPointerEvent<HTMLButtonElement>): void {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    shouldIgnoreClickRef.current = dragState.hasMoved;
    dragStateRef.current = null;
    if (dragState.hasMoved) {
      setPetActivity(isSendingRef.current ? "thinking" : "idle");
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function handlePetClick(event: ReactMouseEvent<HTMLButtonElement>): void {
    if (perched) {
      // On duty in the header, the pet's one job is to be put back: this turns Explain mode off.
      toggleExplain();
      return;
    }
    if (shouldIgnoreClickRef.current) {
      shouldIgnoreClickRef.current = false;
      return;
    }
    showGreeting();
    // Two clicks in a row on an expanded panel: the first took it back to its normal size, so by
    // the time the second arrives it is no longer expanded — remember that, to close the chat.
    const followsRestore = restoredByClickRef.current;
    restoredByClickRef.current = false;
    const action = petClickAction({
      expanded,
      detail: event.detail,
      followsRestore,
    });
    if (action === "restore") {
      // The pet stays where it is under the pointer (its expanded spot becomes its normal one), so
      // a second click lands on it again instead of on the place it would have jumped from.
      if (visiblePetPosition) setPetPosition(visiblePetPosition);
      setExpanded(false);
      setExpandedPetPosition(null);
      restoredByClickRef.current = true;
    } else if (action === "close") {
      closeChat();
    } else if (action === "expand") {
      openExpanded();
    } else {
      toggle();
    }
  }

  function handlePetContextMenu(
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    event.preventDefault();
    setPetMenuPosition(
      getPetHelpPosition(
        event.currentTarget.getBoundingClientRect(),
        onOpenKnowledge ? 3 : 2,
      ),
    );
  }

  function handleOpenKnowledge(): void {
    setPetMenuPosition(null);
    closeChat();
    onOpenKnowledge?.();
  }

  function handleOpenUsage(): void {
    setPetMenuPosition(null);
    setOpened(true);
    setOpen(true);
    setUsageRequest((count) => count + 1);
  }

  function handleSwitchPet(event: ReactMouseEvent<HTMLButtonElement>): void {
    event.stopPropagation();
    setPetMenuPosition(null);
    setPetKind((kind) => (kind === "cat" ? "robot" : "cat"));
  }

  const isCompactViewport = viewportWidth < 640;
  const chatPanelPosition = isCompactViewport
    ? undefined
    : getChatPanelPosition(petPosition);
  const visiblePetPosition = expanded
    ? (expandedPetPosition ?? getExpandedPetPosition())
    : petPosition;
  // Always an explicit spot (never CSS bottom/right), so moving between spots can be animated.
  const restingPosition = visiblePetPosition ?? getDefaultPetPosition();
  const sitting = perched && perchRect !== null;
  const petBoxPosition = sitting ? perchPosition(perchRect) : restingPosition;
  const expandedPanelStyle = expanded ? getExpandedPanelStyle() : undefined;
  const canUseAssistant =
    profile?.role === "admin" || profile?.role === "development";

  if (!canUseAssistant) return <></>;

  return (
    <>
      {opened && (
        <div
          role="complementary"
          aria-label="Branchwise assistant"
          // Hidden by a display class, not the `hidden` attribute: the attribute's
          // display:none comes from the UA stylesheet and loses to any author display
          // rule, so `hidden` next to `flex` left the panel on screen and nothing could
          // close it. Hidden rather than unmounted, per the note above about the thread.
          className={cn(
            expanded ? "fixed z-30" : "fixed z-40",
            "bg-bg-base border border-border rounded-xl shadow-lg overflow-hidden",
            open ? "flex flex-col" : "hidden",
            expanded
              ? ""
              : isCompactViewport
                ? "inset-x-3 bottom-24 top-16"
                : "sm:w-[26rem] sm:h-[32rem] sm:max-h-[calc(100vh-9rem)]",
          )}
          style={expanded ? expandedPanelStyle : chatPanelPosition}
        >
          <div className="z-10 flex items-center justify-between gap-2 px-6 h-12 shrink-0 border-b border-border bg-bg-subtle">
            <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <img
                src={petIconSrc(petKind)}
                alt=""
                aria-hidden="true"
                draggable={false}
                className="w-6 h-6 object-contain"
              />
              Branchwise assistant
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleExpanded}
                aria-label={expanded ? "Restore chat size" : "Expand chat"}
                title={
                  expanded
                    ? "Restore chat size"
                    : "Expand chat (Ctrl/⌘ + Enter)"
                }
                className="inline-flex items-center gap-1 p-1 rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <PanelSizeIcon expanded={expanded} />
                {!expanded && (
                  <span className="hidden sm:inline text-xs">Focus</span>
                )}
              </button>
              <button
                type="button"
                onClick={closeChat}
                aria-label="Close chat"
                className="p-1 rounded text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            </div>
          </div>
          <div className="flex-1 min-h-0">
            <Suspense
              fallback={
                <div className="h-full flex items-center justify-center">
                  <Spinner className="w-5 h-5 text-text-muted" />
                </div>
              }
            >
              <ChatPanel
                session={session}
                profile={profile}
                contextPage={contextPage}
                currentBranchId={currentBranchId}
                onSendingChange={handleSendingChange}
                onReplyFinished={handleReplyFinished}
                onNavigate={onNavigate}
                showUsageRequest={usageRequest}
                askRequest={pendingAsk}
                onAskHandled={() => setPendingAsk(null)}
              />
            </Suspense>
          </div>
        </div>
      )}

      {petMenuPosition && (
        <div
          className="fixed z-[100] flex flex-col"
          style={{ ...petMenuPosition, gap: PET_HELP_GAP }}
        >
          {onOpenKnowledge && (
            <button
              type="button"
              aria-label="Open Knowledge"
              title="What the assistant knows (Knowledge)"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={handleOpenKnowledge}
              className="flex h-7 w-7 items-center justify-center rounded-full border border-brand/30 bg-bg-base text-brand shadow-md transition-transform hover:scale-110 hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <BookIcon className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            type="button"
            aria-label="Open Usage"
            title="What the assistant has used (Usage)"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleOpenUsage}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-brand/30 bg-bg-base text-brand shadow-md transition-transform hover:scale-110 hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <DollarIcon className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label={
              petKind === "cat"
                ? "Switch to BranchWise Robot"
                : "Switch to Pixel Cat"
            }
            title={
              petKind === "cat"
                ? "Switch to BranchWise Robot"
                : "Switch to Pixel Cat"
            }
            onPointerDown={(event) => event.stopPropagation()}
            onClick={handleSwitchPet}
            className="flex h-7 w-7 items-center justify-center rounded-full border border-brand/30 bg-bg-base text-brand shadow-md transition-transform hover:scale-110 hover:bg-brand-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            <SwapIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div
        className={cn(
          "fixed z-[90] h-[4.75rem] w-[4.75rem] overflow-visible",
          travelling &&
            "transition-[left,top,transform] duration-500 ease-in-out motion-reduce:transition-none",
        )}
        style={{
          ...petBoxPosition,
          transform: sitting ? `scale(${PERCH_SCALE})` : undefined,
        }}
      >
        <button
          type="button"
          onClick={handlePetClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
          onContextMenu={handlePetContextMenu}
          aria-expanded={open}
          // With the chat open the pet is only for the mouse (greet, drag): it sits after the panel in
          // the page, so letting Tab reach it would take the focus off the message box.
          tabIndex={open ? -1 : 0}
          aria-label={
            open
              ? "Greet from Branchwise assistant"
              : "Open Branchwise assistant"
          }
          title={
            sitting
              ? "Explain mode is on · click to turn it off"
              : expanded
                ? "Click for normal size · Double-click to close · Drag to move"
                : "Click to chat · Double-click to expand"
          }
          className="flex h-full w-full touch-none select-none items-center justify-center overflow-visible rounded-none border-0 bg-transparent p-0 shadow-none transition-transform duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 cursor-grab active:cursor-grabbing"
        >
          {petKind === "cat" ? (
            <CatSprite
              activity={petActivity}
              className="h-[4.4rem] w-[4.4rem]"
            />
          ) : (
            <RobotSprite
              activity={petActivity}
              className="h-[4.4rem] w-[4.4rem]"
            />
          )}
        </button>
      </div>
    </>
  );
}

export default ChatLauncher;
