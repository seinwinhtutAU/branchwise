import type { ComponentProps, ReactNode } from "react";
import { FieldDensityProvider } from "@renderer/components/ui/fieldDensity";
import { ExplainProvider } from "@renderer/components/features/explain/ExplainProvider";

interface Props {
  density: ComponentProps<typeof FieldDensityProvider>["value"];
  session: ComponentProps<typeof ExplainProvider>["session"];
  /** The section the user is on. */
  page: string;
  /** Whether this account may use the explain mode (the accounts that may use the assistant). */
  canExplain: boolean;
  onAskAssistant: (text: string) => void;
  children: ReactNode;
}

// What every screen sits inside. One component so App.tsx's tree stays one level deep.
export function AppProviders({
  density,
  session,
  page,
  canExplain,
  onAskAssistant,
  children,
}: Props): React.JSX.Element {
  return (
    <FieldDensityProvider value={density}>
      <ExplainProvider
        session={session}
        page={page}
        allowed={canExplain}
        onAskAssistant={onAskAssistant}
      >
        {children}
      </ExplainProvider>
    </FieldDensityProvider>
  );
}
