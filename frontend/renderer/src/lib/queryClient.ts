import { useEffect, useRef } from "react";
import { QueryClient, useQueries, useQuery } from "@tanstack/react-query";
import { apiBaseUrl } from "@renderer/lib/auth";
import type { Session } from "@renderer/lib/auth";
import { getConnectionStatus } from "@renderer/lib/connection";
import { useToast } from "@renderer/lib/useToast";
import { queryEnabled, usePageActive } from "@renderer/lib/pageActive";

/** Shared cache for every React Query request. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Writes invalidate queries, so cached data can stay visible between updates.
      staleTime: 24 * 60 * 60 * 1000,
      gcTime: 7 * 24 * 60 * 60 * 1000,
      // fetch already handles retries for this API.
      retry: false,
    },
  },
});

// Lets legacy data watchers update when all queries are invalidated.
const invalidateListeners = new Set<() => void>();

function subscribeToLocalInvalidate(listener: () => void): () => void {
  invalidateListeners.add(listener);
  return () => {
    invalidateListeners.delete(listener);
  };
}

/** Call after a server-side change so visible pages refresh without going blank. */
export function invalidateEverything(): void {
  void queryClient.invalidateQueries();
  invalidateListeners.forEach((listener) => listener());
}

/** Refresh all queries while keeping the current data visible. */
export function refreshEverything(): void {
  void queryClient.refetchQueries();
}

/** Remove cached data when the signed-in account changes. */
export function clearQueryCache(): void {
  queryClient.clear();
}

/** Fetch authenticated JSON. Network retries and timeouts come from the fetch wrapper. */
export async function fetchJson<T>(url: string, session: Session): Promise<T> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Show one clear load error unless the offline banner already explains it. */
export function useLoadErrorToast(isError: boolean, label: string): void {
  const showToast = useToast();
  useEffect(() => {
    if (!isError) return;
    // The offline banner is enough; a toast for every failed query is noisy.
    if (getConnectionStatus() === "offline") return;
    showToast("error", `Could not load ${label}. Please check your connection and try again.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isError, label]);
}

/** Use the URL as the cache key for simple GET requests. */
function urlQueryKey(url: string | null): readonly [string, string | null] {
  return ["fetchJson", url] as const;
}

interface UrlQueryResult<T> {
  data: T | undefined;
  isRefreshing: boolean;
  failed: boolean;
  reload: () => Promise<void>;
}

/** Load one URL and share its cached result. A null URL waits until the request is ready. */
export function useUrlQuery<T>(
  url: string | null,
  session: Session,
  label: string,
): UrlQueryResult<T> {
  // A page kept mounted but hidden does not fetch; shown again, a stale query refetches at once.
  const pageActive = usePageActive();
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: urlQueryKey(url),
    queryFn: () => fetchJson<T>(url as string, session),
    enabled: queryEnabled(url !== null, pageActive),
  });
  useLoadErrorToast(isError, label);
  async function reload(): Promise<void> {
    await refetch();
  }
  return { data, isRefreshing: isFetching, failed: isError, reload };
}

interface UrlQueriesResult<T> {
  /** Keyed by URL, so the caller keeps whatever it already knows about each one. */
  data: Record<string, T>;
  /** URLs with no cached data yet, still fetching for the first time. */
  pendingUrls: string[];
  /** URLs with no cached data, whose request has failed. */
  failedUrls: string[];
  /** True only while there is nothing at all to show yet. */
  isLoading: boolean;
  isRefreshing: boolean;
  failedCount: number;
  reload: () => Promise<void>;
  /** Retries a single URL — for a per-item retry action rather than reloading everything. */
  refetchUrl: (url: string) => Promise<void>;
}

/** The several-URL replacement for useCachedFetchMany — the Alerts page needs every
 *  retail branch's overview in one view. Each URL is its own query, keyed the same way
 *  useUrlQuery keys a single one, so this shares cache entries with (and gets shared by)
 *  every single-URL page asking for the same URLs — opening Alerts after the dashboard's
 *  branch cards costs nothing. `session: null` means "nobody signed in yet" (App calls
 *  this for the sidebar badge before that), matching the old hook. */
export function useUrlQueries<T>(
  urls: string[],
  session: Session | null,
  label: string,
  /** For figures that change with the clock rather than with an import — see App's
   *  Business Alerts badge. Omitted, a query keeps the long default staleTime. */
  refresh?: { everyMs: number },
): UrlQueriesResult<T> {
  const showToast = useToast();
  const pageActive = usePageActive();
  const results = useQueries({
    queries: urls.map((url) => ({
      queryKey: urlQueryKey(url),
      queryFn: () => fetchJson<T>(url, session as Session),
      enabled: queryEnabled(session !== null, pageActive),
      ...(refresh ? { staleTime: refresh.everyMs, refetchInterval: refresh.everyMs } : {}),
    })),
  });

  const data: Record<string, T> = {};
  const pendingUrls: string[] = [];
  const failedUrls: string[] = [];
  let failedCount = 0;
  let isRefreshing = false;
  for (const [index, result] of results.entries()) {
    const url = urls[index];
    if (result.data !== undefined) {
      data[url] = result.data;
      if (result.isFetching) isRefreshing = true;
    } else if (result.isFetching) {
      pendingUrls.push(url);
    } else if (result.isError) {
      failedUrls.push(url);
    }
    if (result.isError) failedCount += 1;
  }

  useEffect(() => {
    if (failedCount === 0 || getConnectionStatus() === "offline") return;
    showToast(
      "error",
      `Couldn't load ${failedCount} of ${urls.length} for the ${label}`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [failedCount]);

  async function reload(): Promise<void> {
    await Promise.all(
      urls.map((url) =>
        queryClient.invalidateQueries({ queryKey: urlQueryKey(url) }),
      ),
    );
  }

  async function refetchUrl(url: string): Promise<void> {
    await queryClient.refetchQueries({ queryKey: urlQueryKey(url) });
  }

  return {
    data,
    pendingUrls,
    failedUrls,
    isLoading: urls.length > 0 && Object.keys(data).length === 0 && failedCount === 0,
    isRefreshing,
    failedCount,
    reload,
    refetchUrl,
  };
}

// Check once a minute for changes made by other users.
const DATA_VERSION_POLL_MS = 60 * 1000;
const VERSION_TOKEN_KEY = "branchwise:data-version";

/** The server data-version token this machine last saw, from a previous run. */
function loadDataVersionToken(): string | null {
  try {
    return localStorage.getItem(VERSION_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeDataVersionToken(token: string): void {
  try {
    localStorage.setItem(VERSION_TOKEN_KEY, token);
  } catch {
    // Without storage, the next poll simply refreshes restored cache data.
  }
}

/** Refresh cached data when another account imports or reverts data. */
export function useImportedDataWatch(session: Session | null): void {
  // Compare restored cache data with the last server version after launch.
  const seen = useRef<string | null>(loadDataVersionToken());

  useEffect(() => {
    if (!session) {
      seen.current = null;
      return;
    }
    let cancelled = false;

    // Local changes already invalidated the cache, so only update the saved version.
    async function check(resyncOnly = false): Promise<void> {
      try {
        const response = await fetch(`${apiBaseUrl}/api/imports/data-version`, {
          headers: { Authorization: `Bearer ${session!.access_token}` },
        });
        if (!response.ok || cancelled) return;
        const { version } = (await response.json()) as { version: string };
        if (cancelled) return;
        // The first reading sets the baseline.
        if (!resyncOnly && seen.current !== null && seen.current !== version) {
          invalidateEverything();
        }
        seen.current = version;
        storeDataVersionToken(version);
      } catch {
        // Try again later; cached data is still better than an error toast.
      }
    }

    void check();
    // Skip hidden windows and check again as soon as the app is visible.
    const timer = setInterval(() => {
      if (document.hidden) return;
      void check();
    }, DATA_VERSION_POLL_MS);
    const onFocus = (): void => void check();
    window.addEventListener("focus", onFocus);
    const onVisibilityChange = (): void => {
      if (!document.hidden) void check();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    const unsubscribe = subscribeToLocalInvalidate(() => void check(true));

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.access_token]);
}
