import ChatMarkdown from "@renderer/components/features/chat/ChatMarkdown";
import { useEffect, useMemo, useState } from "react";
import type { Session } from "@renderer/lib/auth";
import { useToast } from "@renderer/lib/useToast";
import { Button } from "@renderer/components/ui/Button";
import { Card, CardHeader } from "@renderer/components/ui/Card";
import { ConfirmDialog } from "@renderer/components/ui/ConfirmDialog";
import { Field } from "@renderer/components/ui/Field";
import { Input } from "@renderer/components/ui/Input";
import { Pill } from "@renderer/components/ui/Pill";
import { Select } from "@renderer/components/ui/Select";
import { Spinner } from "@renderer/components/ui/Spinner";
import { Switch } from "@renderer/components/ui/Switch";
import { ChevronLeftIcon } from "@renderer/components/ui/icons";
import {
  knowledgeApi,
  type ArticleDetail,
  type ArticleVersion,
  type ArticleWrite,
  type KnowledgeStatus,
} from "@renderer/components/features/knowledge/knowledgeApi";
import {
  askedLabel,
  type InboxPrefill,
} from "@renderer/components/features/knowledge/inboxHelpers";
import {
  KIND_OPTIONS,
  PIN_LIMIT_FALLBACK,
  pinCost,
  pinMeter,
  reviewLabel,
  type Kind,
  type Status,
} from "@renderer/components/features/knowledge/knowledgeHelpers";

interface Props {
  session: Session;
  // "new" starts an empty note; otherwise the id of the note to open.
  articleId: string | "new";
  status: KnowledgeStatus | null;
  // Set when the note is being written to answer a question from the inbox.
  prefill?: InboxPrefill | null;
  onBack: () => void;
  // Called after a save, a review or a restore so the list and the budget can refresh.
  onChanged: (id: string) => void;
}

const EMPTY: ArticleWrite = {
  title: "",
  body: "",
  kind: "note",
  aliases: "",
  pinned: false,
  status: "draft",
};

const toForm = (article: ArticleDetail): ArticleWrite => ({
  title: article.title,
  body: article.body,
  kind: article.kind,
  aliases: article.aliases,
  pinned: article.pinned,
  status: article.status,
});

export function ArticleEditor({
  session,
  articleId,
  status,
  prefill,
  onBack,
  onChanged,
}: Props): React.JSX.Element {
  const showToast = useToast();
  const isNew = articleId === "new";
  const [article, setArticle] = useState<ArticleDetail | null>(null);
  const [form, setForm] = useState<ArticleWrite>(EMPTY);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "review" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [versions, setVersions] = useState<ArticleVersion[] | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    if (isNew) {
      setArticle(null);
      // An answer to an inbox question starts with the question as its title and published,
      // because the person came here to fix a gap.
      setForm(
        prefill
          ? { ...EMPTY, title: prefill.title, status: "published" }
          : EMPTY,
      );
      return;
    }
    let cancelled = false;
    setLoadError(null);
    knowledgeApi
      .get(session, articleId)
      .then((loaded) => {
        if (cancelled) return;
        setArticle(loaded);
        setForm(toForm(loaded));
      })
      .catch((error: Error) => {
        if (!cancelled) setLoadError(error.message);
      });
    return () => {
      cancelled = true;
    };
    // The token refreshing must not throw away what is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [articleId]);

  const readOnly = article?.read_only ?? false;
  const dirty = useMemo(
    () =>
      article
        ? JSON.stringify(form) !== JSON.stringify(toForm(article))
        : isNew,
    [article, form, isNew],
  );

  // What the other pinned notes already take: the total, less this note's saved share.
  const usedByOthers = useMemo(() => {
    const total = status?.pin_used ?? 0;
    if (!article || !article.pinned || article.status !== "published")
      return total;
    return Math.max(0, total - pinCost(article.title, article.body));
  }, [status, article]);
  const meter = pinMeter(
    usedByOthers,
    status?.pin_limit ?? PIN_LIMIT_FALLBACK,
    form,
  );

  function set<K extends keyof ArticleWrite>(
    key: K,
    value: ArticleWrite[K],
  ): void {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function leave(): void {
    if (
      dirty &&
      !readOnly &&
      !window.confirm("Leave without saving your changes?")
    ) {
      return;
    }
    onBack();
  }

  async function save(): Promise<void> {
    setBusy("save");
    try {
      const saved = isNew
        ? await knowledgeApi.create(session, {
            ...form,
            ...(prefill ? { inbox_key: prefill.inboxKey } : {}),
          })
        : await knowledgeApi.update(session, articleId, form);
      setArticle(saved);
      setForm(toForm(saved));
      setVersions(null);
      showToast(
        "success",
        isNew && prefill ? "Saved — the assistant can use this answer now" : "Information saved",
      );
      onChanged(saved.id);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't save",
      );
    } finally {
      setBusy(null);
    }
  }

  async function markReviewed(): Promise<void> {
    if (!article) return;
    setBusy("review");
    try {
      setArticle(await knowledgeApi.review(session, article.id));
      showToast("success", "Marked as reviewed today");
      onChanged(article.id);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't update",
      );
    } finally {
      setBusy(null);
    }
  }

  async function remove(): Promise<void> {
    if (!article) return;
    setBusy("delete");
    try {
      await knowledgeApi.remove(session, article.id);
      showToast("success", "Information removed");
      onChanged("");
      onBack();
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't delete",
      );
      setBusy(null);
      setConfirmDelete(false);
    }
  }

  async function toggleHistory(): Promise<void> {
    const next = !showHistory;
    setShowHistory(next);
    if (next && article && versions === null) {
      try {
        setVersions(await knowledgeApi.versions(session, article.id));
      } catch (error) {
        showToast(
          "error",
          error instanceof Error ? error.message : "Couldn't load history",
        );
      }
    }
  }

  async function restore(version: number): Promise<void> {
    if (!article) return;
    try {
      const restored = await knowledgeApi.restore(session, article.id, version);
      setArticle(restored);
      setForm(toForm(restored));
      setVersions(null);
      setShowHistory(false);
      showToast("success", `Went back to version ${version}`);
      onChanged(restored.id);
    } catch (error) {
      showToast(
        "error",
        error instanceof Error ? error.message : "Couldn't restore",
      );
    }
  }

  if (loadError) {
    return (
      <div className="flex flex-col gap-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={onBack}
          className="self-start"
        >
          <ChevronLeftIcon className="h-4 w-4" /> Back to Knowledge
        </Button>
        <p className="text-sm text-error">{loadError}</p>
      </div>
    );
  }
  if (!isNew && !article) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-5 w-5 text-text-muted" />
      </div>
    );
  }

  const review = article
    ? reviewLabel(article.reviewed_at, article.updated_at)
    : null;
  const canSave = !readOnly && dirty && !meter.over && form.title.trim() !== "";

  return (
    <div className="flex w-full flex-col gap-5 px-1.5 pb-6 sm:px-2.5 lg:px-3">
      <div className="flex items-center justify-between gap-3">
        <Button variant="secondary" size="sm" onClick={leave}>
          <ChevronLeftIcon className="h-4 w-4" /> Back to Knowledge
        </Button>
        {review && (
          <Pill tone={review.stale ? "warning" : "neutral"} size="sm">
            {review.stale
              ? `${review.text} - check it is still true`
              : review.text}
          </Pill>
        )}
      </div>

      {readOnly && (
        <div className="rounded-xl border border-brand/20 bg-brand-subtle/50 px-4 py-3 text-sm text-text-secondary">
          This information comes from built-in app help ({article?.source_path}). To update it, edit its source file and choose{" "}
          <strong>Sync Knowledge</strong> on the previous page.
        </div>
      )}

      {isNew && prefill && (
        <div className="rounded-xl border border-brand/20 bg-brand-subtle/50 px-4 py-3.5 text-sm shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
            A real question needs an answer
          </p>
          <p className="mt-1 font-semibold text-text-primary">
            Answering: {prefill.question}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {askedLabel(prefill.count)}
            {prefill.missing.length > 0
              ? ` · Missing: ${prefill.missing.join("; ")}`
              : ""}
          </p>
          {prefill.wrongAnswer && (
            <div className="mt-2 text-[13px] text-text-secondary">
              <p className="font-medium">What the assistant said:</p>
              <div className="mt-1 rounded-lg border border-border bg-bg-base px-3 py-2">
                <ChatMarkdown text={prefill.wrongAnswer} />
              </div>
              {prefill.wrongReasons.length > 0 && (
                <p className="mt-2">
                  <span className="font-medium">
                    Why the answer did not help:
                  </span>{" "}
                  {prefill.wrongReasons.join("; ")}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <Card className="overflow-hidden p-0">
        <div className="border-b border-border bg-bg-subtle/50 px-5 py-4 sm:px-6">
          <CardHeader
            title="Knowledge details"
            description="Add a clear explanation below. You choose when the assistant is allowed to use it."
            className="mb-0"
          />
        </div>
        <div className="flex flex-col gap-5 px-5 py-5 sm:px-6 sm:py-6">
        <Field label="What is this about?" required>
          <Input
            value={form.title}
            disabled={readOnly}
            maxLength={200}
            placeholder="e.g. Our opening hours"
            onChange={(event) => set("title", event.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Topic" hint="This only helps your team keep information organised.">
            <Select
              value={form.kind}
              disabled={readOnly}
              onChange={(event) => set("kind", event.target.value as Kind)}
            >
              {KIND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label} - {option.hint}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="When can the assistant use this?">
            <Select
              value={form.status}
              disabled={readOnly}
              onChange={(event) => set("status", event.target.value as Status)}
            >
              <option value="draft">Not yet — keep this private</option>
              <option value="published">
                Ready — the assistant can use it
              </option>
            </Select>
          </Field>
        </div>

        <Field
          label="Other words people might use (optional)"
          hint="Add common English or Burmese names, languages, or nicknames. This helps the assistant understand different ways people ask the same question."
        >
          <Input
            value={form.aliases}
            disabled={readOnly}
            maxLength={1000}
            placeholder="e.g. closing day, ပိတ်ရက်"
            onChange={(event) => set("aliases", event.target.value)}
          />
        </Field>

        <Field label="What should the assistant know?">
          <textarea
            value={form.body}
            readOnly={readOnly}
            maxLength={20000}
            rows={14}
            placeholder="Write the answer you would give a new member of staff or a customer."
            onChange={(event) => set("body", event.target.value)}
            className="w-full rounded-md border bg-bg-base px-3 py-2 text-sm leading-6 text-text-primary placeholder:text-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          />
        </Field>

        {!readOnly && (
          <div className="rounded-xl border border-brand/15 bg-brand-subtle/30 px-4 py-3.5">
            <Switch
              checked={form.pinned}
              onChange={(checked) => set("pinned", checked)}
              label="Always remember this"
            />
            <p className="mt-1.5 text-xs text-text-muted">
              Use this for short facts that should be considered in every answer, such as a key rule or a term everyone uses. Your always-remembered information has a shared space limit of {meter.limit.toLocaleString()} characters.
            </p>
            {(form.pinned || meter.used > 0) && (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-bg-raised">
                  <div
                    className={
                      meter.over ? "h-full bg-error" : "h-full bg-brand"
                    }
                    style={{ width: `${meter.percent}%` }}
                  />
                </div>
                <p
                  className={`mt-1 text-xs ${meter.over ? "text-error" : "text-text-muted"}`}
                >
                  Always-remembered information uses {meter.used.toLocaleString()} of{" "}
                  {meter.limit.toLocaleString()} characters
                  {meter.over ? " — shorten this information or turn off Always remember on another item." : "."}
                </p>
              </div>
            )}
          </div>
        )}

        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-bg-base px-5 py-4 sm:px-6">
            <Button
              onClick={() => void save()}
              loading={busy === "save"}
              disabled={!canSave}
            >
              Save information
            </Button>
            {!isNew && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void markReviewed()}
                  loading={busy === "review"}
                >
                  Confirm still correct
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void toggleHistory()}
                >
                  {showHistory ? "Hide previous changes" : "Previous changes"}
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setConfirmDelete(true)}
                  className="ml-auto"
                >
                  Remove
                </Button>
              </>
            )}
          </div>
        )}
      </Card>

      {showHistory && (
        <Card className="p-5 sm:p-6">
          <CardHeader
            title="Previous changes"
            description="Every save keeps what came before. You can return to an earlier version at any time."
          />
          {versions === null ? (
            <Spinner className="h-4 w-4 text-text-muted" />
          ) : versions.length === 0 ? (
            <p className="text-sm text-text-muted">
              Nothing has been changed yet.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {versions.map((version) => (
                <li
                  key={version.version}
                  className="flex items-start justify-between gap-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-text-primary">
                      Version {version.version}
                      <span className="ml-2 text-xs font-normal text-text-muted">
                        {new Date(version.changed_at).toLocaleString()}
                        {version.changed_by_name
                          ? ` by ${version.changed_by_name}`
                          : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 line-clamp-3 whitespace-pre-wrap text-[13px] text-text-secondary">
                      {version.body}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void restore(version.version)}
                  >
                    Go back to this
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Remove this information?"
        message={`"${form.title}" and its previous changes will be removed. The assistant will stop using it straight away.`}
        confirmLabel="Remove"
        confirmVariant="destructive"
        loading={busy === "delete"}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
