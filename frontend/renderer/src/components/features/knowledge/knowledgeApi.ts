import { apiBaseUrl, type Session } from "@renderer/lib/auth";
import type {
  Kind,
  Status,
} from "@renderer/components/features/knowledge/knowledgeHelpers";

export interface ArticleSummary {
  id: string;
  title: string;
  kind: Kind;
  status: Status;
  source: "manual" | "docs";
  pinned: boolean;
  version: number;
  reviewed_at: string | null;
  updated_at: string;
  stale: boolean;
}

export interface ArticleDetail extends ArticleSummary {
  body: string;
  aliases: string;
  source_path: string | null;
  read_only: boolean;
  chunk_count: number;
  embedded_chunks: number;
}

export interface ArticleWrite {
  title: string;
  body: string;
  kind: Kind;
  aliases: string;
  pinned: boolean;
  status: Status;
}

// A question the assistant failed on: it said the knowledge base doesn't cover it ("gap"), or an
// answer was marked wrong ("wrong"). One row per question, however often it was asked.
export interface InboxItem {
  key: string;
  question: string;
  tags: ("gap" | "wrong")[];
  count: number;
  last_at: string;
  missing: string[];
  wrong_answer: string | null;
  wrong_reasons: string[];
}

export interface DismissedItem {
  key: string;
  question: string;
  handled_at: string;
}

export interface ArticleVersion {
  version: number;
  title: string;
  body: string;
  aliases: string;
  changed_at: string;
  changed_by_name: string | null;
}

export interface KnowledgeStatus {
  embeddings_enabled: boolean;
  total_chunks: number;
  embedded_chunks: number;
  manual_articles: number;
  docs_articles: number;
  pin_used: number;
  pin_limit: number;
  open_questions: number;
}

export interface SyncResult {
  found_docs: boolean;
  created: number;
  updated: number;
  unchanged: number;
  removed: number;
  embedded: number;
  still_to_embed: number;
  embeddings_enabled: boolean;
}

async function call<T>(
  session: Session,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${apiBaseUrl}/api/knowledge${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    const message =
      typeof detail?.detail === "string"
        ? detail.detail
        : `Something went wrong (${response.status})`;
    throw new Error(message);
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}

export interface ArticleFilters {
  search?: string;
  kind?: string;
  status?: string;
  source?: string;
}

export const knowledgeApi = {
  list: (session: Session, filters: ArticleFilters) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return call<ArticleSummary[]>(session, query ? `?${query}` : "");
  },
  get: (session: Session, id: string) => call<ArticleDetail>(session, `/${id}`),
  create: (session: Session, body: ArticleWrite & { inbox_key?: string }) =>
    call<ArticleDetail>(session, "", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  update: (session: Session, id: string, body: ArticleWrite) =>
    call<ArticleDetail>(session, `/${id}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  remove: (session: Session, id: string) =>
    call<void>(session, `/${id}`, { method: "DELETE" }),
  review: (session: Session, id: string) =>
    call<ArticleDetail>(session, `/${id}/review`, { method: "POST" }),
  versions: (session: Session, id: string) =>
    call<ArticleVersion[]>(session, `/${id}/versions`),
  restore: (session: Session, id: string, version: number) =>
    call<ArticleDetail>(session, `/${id}/restore/${version}`, {
      method: "POST",
    }),
  status: (session: Session) => call<KnowledgeStatus>(session, "/status"),
  inbox: (session: Session) => call<InboxItem[]>(session, "/inbox"),
  dismissed: (session: Session) =>
    call<DismissedItem[]>(session, "/inbox/dismissed"),
  dismiss: (session: Session, key: string) =>
    call<void>(session, `/inbox/${key}/dismiss`, { method: "POST" }),
  reopen: (session: Session, key: string) =>
    call<void>(session, `/inbox/${key}/reopen`, { method: "POST" }),
  syncDocs: (session: Session) =>
    call<SyncResult>(session, "/sync-docs", { method: "POST" }),
};
