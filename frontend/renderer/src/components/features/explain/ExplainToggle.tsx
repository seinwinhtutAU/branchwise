import { useContext } from "react";
import { cn } from "@renderer/lib/utils";
import {
  petIconSrc,
  usePetKind,
} from "@renderer/components/features/chat/petKind";
import { ExplainContext } from "./explainContext";

/** The explain-mode switch, in the app header. Its icon is the pet the person chose. While the mode
 *  is on the pet itself comes and sits in the icon's place (see ChatLauncher), so the picture here
 *  fades out. Renders nothing for an account that may not use the assistant, or on a page that does
 *  not take part. */
export function ExplainToggle({
  className,
}: {
  className?: string;
}): React.JSX.Element | null {
  const { allowed, on, live, toggle, hasScreen } = useContext(ExplainContext);
  const [petKind] = usePetKind();
  if (!allowed || !hasScreen) return null;
  return (
    <button
      type="button"
      data-explain-ui=""
      aria-pressed={on}
      title={
        on
          ? "Explain mode is on: click a card"
          : "Explain mode: click a card to have it explained"
      }
      onClick={toggle}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border pl-1.5 pr-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
        on
          ? "border-brand bg-brand-subtle text-brand"
          : "border-border bg-bg-base text-text-secondary hover:bg-bg-raised hover:text-text-primary",
        className,
      )}
    >
      {/* Where the pet sits while the mode is on. */}
      <span
        data-explain-perch=""
        className="flex h-6 w-6 items-center justify-center"
      >
        <img
          src={petIconSrc(petKind)}
          alt=""
          aria-hidden="true"
          draggable={false}
          className={cn(
            "h-6 w-6 object-contain transition-opacity duration-300 motion-reduce:transition-none",
            live && "opacity-0",
          )}
        />
      </span>
      Explain
    </button>
  );
}
