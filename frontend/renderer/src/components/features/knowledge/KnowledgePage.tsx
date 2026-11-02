import { useExplainScreen } from "@renderer/components/features/explain/explainContext";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Card } from "@renderer/components/ui/Card";
import { EmptyState } from "@renderer/components/ui/EmptyState";
import { Input } from "@renderer/components/ui/Input";
import { Pill } from "@renderer/components/ui/Pill";
import { Select } from "@renderer/components/ui/Select";
import { Spinner } from "@renderer/components/ui/Spinner";
import {
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  PlusIcon,
  RefreshIcon,
  SearchIcon,
} from "@renderer/components/ui/icons";
import { ArticleEditor } from "@renderer/components/features/knowledge/ArticleEditor";
import { InboxPanel } from "@renderer/components/features/knowledge/InboxPanel";
import {
  prefillFromItem,
  type InboxPrefill,
} from "@renderer/components/features/knowledge/inboxHelpers";
import {
  knowledgeApi,
  type ArticleSummary,
  type DismissedItem,
  type InboxItem,
  type KnowledgeStatus,
} from "@renderer/components/features/knowledge/knowledgeApi";
import {
  KIND_OPTIONS,
  kindLabel,
  reviewLabel,
} from "@renderer/components/features/knowledge/knowledgeHelpers";

interface Props {
  session: Session;
  // Set when the assistant sent the reader here from one of its sources.
  openArticleId?: string | null;
  onOpenArticleHandled?: () => void;
}

export function KnowledgePage({
  session,
  openArticleId,
  onOpenArticleHandled,
}: Props): React.JSX.Element {
  // Takes part in explain mode; the page where the owner's own notes are kept.
  useExplainScreen({
    tab: null,
    branchId: null,
    dateFrom: null,
    dateTo: null,
  });
  const showToast = useToast();
  const [articles, setArticles] = useState<ArticleSummary[] | null>(null);
  const [status, setStatus] = useState<KnowledgeStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [dismissed, setDismissed] = useState<DismissedItem[]>([]);
  const [inboxBusy, setInboxBusy] = useState<string | null>(null);
  // Set while the editor is open to answer a question from the inbox.
  const [prefill, setPrefill] = useState<InboxPrefill | null>(null);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("");
  const [state, setState] = useState("");
  const [source, setSource] = useState("");

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      const [list, current, questions, hidden] = await Promise.all([
        knowledgeApi.list(session, { search, kind, status: state, source }),
        knowledgeApi.status(session),
        knowledgeApi.inbox(session),
        knowledgeApi.dismissed(session),
      ]);
      setArticles(list);
      setStatus(current);
      setInbox(questions);
      setDismissed(hidden);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : "Couldn't load assistant information",
      );
    }
    // The token refreshing must not reload the list under the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, kind, state, source]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  useEffect(() => {
    if (openArticleId) {
      setEditing(openArticleId);
      onOpenArticleHandled?.();
    }
  }, [openArticleId, onOpenArticleHandled]);

  async function dismissQuestion(item: InboxItem): Promise<void> {
    setInboxBusy(item.key);
    try {
      await knowledgeApi.dismiss(session, item.key);
      await load();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't dismiss it",
      );
    } finally {
      setInboxBusy(null);
    }
  }

  async function bringBack(item: DismissedItem): Promise<void> {
    try {
      await knowledgeApi.reopen(session, item.key);
      await load();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't bring it back",
      );
    }
  }

  async function refreshFromGuides(): Promise<void> {
    setSyncing(true);
    try {
      const result = await knowledgeApi.syncDocs(session);
      if (!result.found_docs) {
        showToast(
          "error",
          "The built-in app help could not be found.",
        );
      } else {
        const changed = result.created + result.updated + result.removed;
        showToast(
          "success",
          changed === 0
            ? "The built-in app help is already up to date"
            : `App help updated: ${result.created} added, ${result.updated} changed, ${result.removed} removed`,
        );
      }
      await load();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't update the app help",
      );
    } finally {
      setSyncing(false);
    }
  }

  if (editing) {
    return (
      <ArticleEditor
        session={session}
        articleId={editing}
        status={status}
        prefill={editing === "new" ? prefill : null}
        onBack={() => {
          setEditing(null);
          setPrefill(null);
          void load();
        }}
        onChanged={(id) => {
          if (id) {
            setEditing(id);
            setPrefill(null);
          }
          void knowledgeApi
            .status(session)
            .then(setStatus)
            .catch(() => undefined);
        }}
      />
    );
  }

  const filtered =
    search !== "" || kind !== "" || state !== "" || source !== "";
  const manualCount =
    articles?.filter((article) => article.source === "manual").length ?? 0;
  const publishedCount =
    articles?.filter((article) => article.status === "published").length ?? 0;
  const hasArticles = articles !== null && articles.length > 0;

  function clearFilters(): void {
    setSearch("");
    setKind("");
    setState("");
    setSource("");
  }

  return (
    <div className="flex w-full flex-col gap-5 px-1.5 pb-6 sm:px-2.5 lg:px-3">
      <div className="flex flex-col justify-between gap-4 border-b border-border pb-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">
            Knowledge
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Add the business information your assistant should use when answering people.
          </p>
          {status && (
            <p className="mt-2 flex flex-wrap gap-x-1.5 gap-y-1 text-xs text-text-muted">
              <span>{publishedCount} published Knowledge items</span>
              <span className="text-border-strong">·</span>
              <span>{manualCount} added by your team</span>
              <span className="text-border-strong">·</span>
              <span>
                {status.embeddings_enabled
                  ? `Semantic search: ${status.embedded_chunks}/${status.total_chunks} chunks indexed`
                  : "Keyword search only"}
              </span>
              <span className="text-border-strong">·</span>
              <span>
                {status.pin_used.toLocaleString()}/{status.pin_limit.toLocaleString()} pinned characters
              </span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void refreshFromGuides()}
            loading={syncing}
          >
            {!syncing && <RefreshIcon className="h-3.5 w-3.5" />} Sync Knowledge
          </Button>
          <Button size="sm" onClick={() => setEditing("new")}>
            <PlusIcon className="h-4 w-4" /> Add information
          </Button>
        </div>
      </div>

      <InboxPanel
        items={inbox}
        dismissed={dismissed}
        busyKey={inboxBusy}
        onWrite={(item) => {
          setPrefill(prefillFromItem(item));
          setEditing("new");
        }}
        onDismiss={(item) => void dismissQuestion(item)}
        onBringBack={(item) => void bringBack(item)}
      />

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-bg-subtle/50 px-4 py-4 sm:px-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-base font-semibold tracking-tight text-text-primary">
                Your Knowledge
              </h2>
              <p className="mt-0.5 text-sm text-text-muted">
                Mark an item as ready when you want the assistant to start using it.
              </p>
            </div>
            {hasArticles && (
              <span className="text-sm font-medium text-text-secondary">
                {articles.length} {articles.length === 1 ? "item" : "items"}
              </span>
            )}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.5fr)_minmax(9rem,0.7fr)_minmax(10rem,0.75fr)_minmax(10rem,0.8fr)]">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Find business information"
              startIcon={<SearchIcon className="h-4 w-4" />}
              aria-label="Search notes"
            />
            <Select
              value={kind}
              onChange={(event) => setKind(event.target.value)}
              aria-label="Kind"
            >
              <option value="">All topics</option>
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
            <Select
              value={state}
              onChange={(event) => setState(event.target.value)}
              aria-label="Status"
            >
              <option value="">Ready and private</option>
              <option value="published">Ready for assistant</option>
              <option value="draft">Still private</option>
            </Select>
            <Select
              value={source}
              onChange={(event) => setSource(event.target.value)}
              aria-label="Where it comes from"
            >
              <option value="">Your information and app help</option>
              <option value="manual">Added by your team</option>
              <option value="docs">Built-in app help</option>
            </Select>
          </div>
          {filtered && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-3 text-left text-xs font-semibold text-brand hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              Show everything
            </button>
          )}
        </div>

        {loadError ? (
          <EmptyState
            icon={<BookIcon />}
            title="Couldn't load your assistant information"
            description={loadError}
            action={<Button onClick={() => void load()}>Try again</Button>}
          />
        ) : articles === null ? (
          <div className="flex items-center justify-center py-16">
            <Spinner className="h-5 w-5 text-text-muted" />
          </div>
        ) : articles.length === 0 ? (
          <EmptyState
            icon={<BookIcon />}
            title={filtered ? "No information matches" : "Your assistant has nothing to learn yet"}
            description={
              filtered
                ? "Try another search, or show everything again."
                : "Add a piece of business information, or update the built-in app help to get started."
            }
            action={
              filtered ? undefined : (
                <Button onClick={() => setEditing("new")}>Add information</Button>
              )
            }
          />
        ) : (
          <div className="divide-y divide-border">
            {articles.map((article) => {
                const review = reviewLabel(
                  article.reviewed_at,
                  article.updated_at,
                );
                return (
                  <button
                    key={article.id}
                    type="button"
                    onClick={() => setEditing(article.id)}
                    className="group flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-bg-subtle/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand sm:px-5"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                      <BookIcon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text-primary group-hover:text-brand">
                          {article.title}
                        </span>
                        {article.pinned && (
                          <span title="Pinned for every assistant answer">
                            <CheckIcon className="h-3.5 w-3.5 text-brand" />
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
                        <span>{kindLabel(article.kind)}</span>
                        <span className="text-border-strong">•</span>
                        <span>{article.source === "docs" ? "App help · managed for you" : "Added by your team"}</span>
                      </span>
                    </span>
                    <span className="hidden min-w-[7.5rem] text-right sm:block">
                      <Pill
                        tone={article.status === "published" ? "success" : "neutral"}
                        size="sm"
                        className="justify-center"
                      >
                        {article.status === "published" ? "Ready to use" : "Not ready yet"}
                      </Pill>
                      <span className={review.stale ? "mt-1 block text-xs text-warning" : "mt-1 block text-xs text-text-muted"}>
                        {review.text}{review.stale ? " · review" : ""}
                      </span>
                    </span>
                    <ArrowRightIcon className="h-4 w-4 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-brand" />
                  </button>
                );
              })}
          </div>
        )}
      </Card>
    </div>
  );
}

export default KnowledgePage;
