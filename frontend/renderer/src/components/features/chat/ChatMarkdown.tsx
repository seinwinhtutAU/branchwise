import { Children, isValidElement, useMemo } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowRightIcon } from "@renderer/components/ui/icons";
import { cn } from "@renderer/lib/utils";
import { pageRouteFor } from "./pageRoutes";

function plainText(node: React.ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number")
        return String(child);
      if (isValidElement<{ children?: React.ReactNode }>(child)) {
        return plainText(child.props.children);
      }
      return "";
    })
    .join("");
}

// The assistant writes light Markdown: short paragraphs, bold figures, bullet and numbered
// steps, and a table when comparing rows. This turns it into the app's own styling.
//
// It is safe by construction: react-markdown builds React elements and never injects HTML,
// raw HTML in the text is shown as text, and a link is shown as plain words (a model-written
// address must never be one click from opening).
function buildComponents(onNavigate?: (section: string) => void): Components {
  return {
    ...baseComponents,
    strong: ({ children }) => {
      const route = onNavigate ? pageRouteFor(plainText(children)) : null;
      if (route && onNavigate) {
        return (
          <button
            type="button"
            onClick={() => onNavigate(route)}
            title="Open this page"
            className="mx-0.5 inline-flex items-center gap-1 rounded-md border border-brand-pill bg-brand-subtle px-1.5 py-px align-baseline text-[12.5px] font-semibold leading-5 text-brand hover:bg-brand-pill focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            {children}
            <ArrowRightIcon className="h-3 w-3" />
          </button>
        );
      }
      return (
        <strong className="font-semibold text-text-primary">{children}</strong>
      );
    },
  };
}

const baseComponents: Components = {
  p: ({ children }) => (
    <p className="my-2.5 text-pretty first:mt-0 last:mb-0">{children}</p>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-text-primary">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  // The chat is narrow, so every heading level is one step up from body text.
  h1: ({ children }) => <Heading>{children}</Heading>,
  h2: ({ children }) => <Heading>{children}</Heading>,
  h3: ({ children }) => <Heading>{children}</Heading>,
  h4: ({ children }) => <Heading>{children}</Heading>,
  h5: ({ children }) => <Heading>{children}</Heading>,
  h6: ({ children }) => <Heading>{children}</Heading>,
  ul: ({ children }) => (
    <ul className="my-2.5 list-disc space-y-1.5 pl-5 marker:text-brand">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2.5 list-decimal space-y-1.5 pl-5 marker:font-semibold marker:text-brand">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1">{children}</li>,
  hr: () => <hr className="my-4 border-border" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2.5 rounded-r-lg border-l-2 border-brand bg-brand-subtle/50 py-2 pl-3 pr-2 text-text-secondary">
      {children}
    </blockquote>
  ),
  a: ({ children }) => <span>{children}</span>,
  code: ({ children, className }) => {
    // A fenced block arrives as <pre><code class="language-x">; an inline span has no class
    // and sits inside text.
    const isBlock = Boolean(className);
    return (
      <code
        className={cn(
          "font-mono text-[12px]",
          !isBlock && "rounded bg-bg-subtle px-1 py-0.5 text-text-primary",
        )}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2.5 overflow-x-auto rounded-lg border border-border bg-bg-subtle p-3 text-[12px] leading-5">
      {children}
    </pre>
  ),
  // Tables keep the spreadsheet look (gridlines) and scroll sideways rather than squeeze.
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border">
      <table className="w-max min-w-full border-collapse text-[12.5px] leading-5">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-brand-subtle/70">{children}</thead>
  ),
  // Only the final table row loses its bottom border. Applying `last:border-b-0` to a
  // cell would match the last cell in every row and leave one column without row lines.
  tbody: ({ children }) => (
    <tbody className="[&>tr:last-child>td]:border-b-0">{children}</tbody>
  ),
  th: ({ children, style }) => (
    <th
      style={style}
      className="whitespace-nowrap border-b border-r border-border px-2.5 py-1.5 text-left font-semibold text-text-primary last:border-r-0"
    >
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td
      style={style}
      className="border-b border-r border-border px-2.5 py-1.5 align-top tabular-nums last:border-r-0"
    >
      {children}
    </td>
  ),
};

function Heading({
  children,
}: {
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className="mb-1.5 mt-5 text-[13px] font-semibold tracking-tight text-text-primary first:mt-0">
      {children}
    </p>
  );
}

function ChatMarkdown({
  text,
  onNavigate,
}: {
  text: string;
  onNavigate?: (section: string) => void;
}): React.JSX.Element {
  const components = useMemo(() => buildComponents(onNavigate), [onNavigate]);
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </Markdown>
  );
}

export default ChatMarkdown;
