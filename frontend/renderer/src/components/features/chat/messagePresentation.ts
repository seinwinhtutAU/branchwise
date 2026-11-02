export type AssistantMessageLayout = "brief" | "structured";

/**
 * Keeps a conversational answer visually light, while giving a longer answer enough
 * surface and spacing to scan. This only changes presentation: the saved Markdown and
 * the model's wording remain untouched.
 */
export function assistantMessageLayout(text: string): AssistantMessageLayout {
  const trimmed = text.trim();
  const listItems = trimmed.match(/^\s*(?:[-*+] |\d+[.)] )/gm)?.length ?? 0;
  const hasTable = /^\s*\|.*\|\s*$/m.test(trimmed);
  const hasCodeBlock = /```/.test(trimmed);
  const hasHeading = /^#{1,6}\s+/m.test(trimmed);
  const paragraphCount = trimmed.split(/\n\s*\n/).filter(Boolean).length;

  if (
    hasTable ||
    hasCodeBlock ||
    hasHeading ||
    listItems >= 2 ||
    paragraphCount >= 3 ||
    trimmed.length > 320
  ) {
    return "structured";
  }

  return "brief";
}
