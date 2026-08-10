/**
 * Mobile-owned QueryClient.
 *
 * Bridges TanStack Query's two cross-cutting managers to native signals:
 *   - focusManager ← AppState ('active' = focused)
 *   - onlineManager ← NetInfo (isConnected)
 *
 * After this wiring is in place, queries with `refetchOnWindowFocus: true`
 * (the default) refetch on foreground, and queries are automatically paused
 * while offline + replayed when the network returns. The realtime
 * WebSocket layer (data/realtime/) reads the same signals to drive socket
 * connect/disconnect, so the two stay in sync.
 *
 * Web/desktop use a different QueryClient (packages/core/query-client.ts).
 * Mobile maintains its own to keep React Native deps out of shared code.
 *
 * Disk persistence: list-level queries (inbox, my-issues, chat sessions,
 * agents, members, workspaces, projects, pins) plus per-issue detail and
 * timeline, and recently-active chat transcripts are persisted to
 * AsyncStorage so a cold start renders last-known data instantly and
 * refetches in the background. Volatile / per-record caches (pending tasks,
 * live task traces, project detail) are deliberately excluded — they're
 * session-scoped and WS-patched. Issue detail/timeline are the issue
 * screen's cold-start surface; chat transcripts are the chat screen's — so
 * all three persist, while chat transcripts additionally carry a recency
 * window (see CHAT_MESSAGE_PERSIST_WINDOW_MS) to keep the blob bounded.
 */
import { focusManager, onlineManager, QueryClient, type Query } from "@tanstack/react-query";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import {
  persistQueryClient,
  persistQueryClientRestore,
} from "@tanstack/react-query-persist-client";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000, // 1 minute
      // gcTime is the effective disk-cache lifetime too, not just memory:
      // persistQueryClientSave re-dehydrates on every cache event including
      // "removed", and dehydrate() only serializes queries still in the
      // in-memory cache. So when a query is GC'd after gcTime of inactivity,
      // the "removed" event fires and the AsyncStorage blob is re-written
      // WITHOUT it — the intended 7-day PERSIST_MAX_AGE never matters because
      // the query is pruned from disk at gcTime. A 10-minute gcTime meant a
      // viewed issue (detail + timeline) survived cold-start restores for
      // ~10 minutes, which is why reopening the app later still felt slow.
      // 24h keeps the persisted cache usable across same-day/next-day restarts
      // without pinning a week of chat transcripts in memory.
      gcTime: 24 * 60 * 60 * 1000, // 24 hours
      retry: 1,
      refetchOnWindowFocus: true, // honored via focusManager bridge below
    },
    mutations: {
      retry: false,
    },
  },
});

// ── focusManager ← AppState ──────────────────────────────────────────
// Foregrounding the app counts as "focus" → triggers refetchOnWindowFocus
// for any stale queries the user is currently looking at.
focusManager.setEventListener((handleFocus) => {
  const sub = AppState.addEventListener("change", (status: AppStateStatus) => {
    handleFocus(status === "active");
  });
  return () => sub.remove();
});

// ── onlineManager ← NetInfo ──────────────────────────────────────────
// While offline, TanStack Query pauses queries; when isConnected flips
// back to true it replays paused fetches. RealtimeProvider also listens
// to NetInfo to force-reconnect the WS — both flows are driven by the
// same signal so client state and server state catch up together.
onlineManager.setEventListener((setOnline) => {
  return NetInfo.addEventListener((state) => {
    setOnline(state.isConnected === true);
  });
});

// ── Disk persistence (AsyncStorage) ───────────────────────────────────
// List-level queries only — see the header comment for the exclusion
// rationale. Persisted data restores instantly on cold start, then any
// query past its staleTime refetches in the background.
const asyncStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "multica-query-cache",
  throttleTime: 1000,
});

/**
 * Whitelist of query-key shapes worth persisting. Everything else (per-record
 * detail/timeline caches, chat messages, pending tasks, live task traces,
 * presence snapshots) stays memory-only.
 */
function shouldPersistQuery(query: Query): boolean {
  const key = query.queryKey as readonly unknown[];
  const root = key[0];
  if (root === "workspaces") return true;
  if (root === "inbox") return key[2] === "list";
  // Issues list + every my-issues scope ("my" subtree) + per-issue detail
  // + per-issue timeline. Detail and timeline both make the issue screen
  // open instantly from the Inbox on a cold start; they restore as
  // last-known data and refetch in the background (default 60s staleTime).
  // Timeline is larger, but bounded (server hard-caps at 2000 entries) and
  // is the only part of the issue screen that previously still paid a cold
  // fetch — persisting it closes the last "Activity takes long" gap.
  if (root === "issues")
    return (
      key[2] === "list" ||
      key[2] === "my" ||
      key[2] === "detail" ||
      key[2] === "timeline"
    );
  // Chat sessions list + per-session message transcripts. Sessions are
  // small and always persisted. Transcripts are the largest per-record
  // caches (long conversations with code blocks / images), so they're
  // persisted only while recently active (recency window below) — older
  // sessions cold-fetch on first open instead of bloating the storage
  // blob. pending-task / task-messages stay volatile (WS-patched, and
  // never safe to restore mid-flight).
  if (root === "chat") {
    if (key[2] === "sessions") return true;
    // Key shape: chatKeys.messages(sessionId) = ["chat", "messages",
    // sessionId] — "messages" is at index 1, the sessionId at index 2.
    if (key[1] === "messages") {
      const sessionId = key[2] as string | undefined;
      if (!sessionId) return false;
      // Only persist transcripts whose last update is recent. After the
      // cold-start invalidate below, the mounted session refetches and
      // stays fresh; sessions the user isn't actively in age out of the
      // blob (though they stay in memory for gcTime 24h).
      return (
        Date.now() - query.state.dataUpdatedAt <
        CHAT_MESSAGE_PERSIST_WINDOW_MS
      );
    }
    return false;
  }
  if (root === "agents" || root === "members") return true;
  // Projects list.
  if (root === "projects") return key[2] === "list";
  // Pins list.
  if (root === "pins") return key[3] === "list";
  return false;
}

const PERSIST_MAX_AGE = 168 * 60 * 60 * 1000; // 7 days — drop anything older than a week

// Chat transcripts are persisted only while recently active — they're the
// largest per-record caches, so persisting every session ever opened would
// bloat the AsyncStorage blob. 7 days (168h) covers roughly a week of
// conversations while bounding size; older sessions cold-fetch on first
// open.
const CHAT_MESSAGE_PERSIST_WINDOW_MS = 168 * 60 * 60 * 1000;

let persistenceStarted = false;

/**
 * Restore the disk-persisted query cache, then wire up ongoing persistence.
 *
 * MUST be awaited before the app tree renders (app/_layout.tsx). A plain
 * module-level `persistQueryClient()` call restores asynchronously in the
 * background — the QueryClientProvider mounts immediately and the inbox/chat
 * queries fire with an empty cache, so cold start still shows loading
 * spinners. Awaiting the restore first means persisted lists hydrate into
 * the cache BEFORE any query mounts, giving the "instant last-known data,
 * refreshed behind the scenes" behavior. Idempotent per process.
 */
export async function ensureQueryCacheRestored(): Promise<void> {
  if (persistenceStarted) return;
  persistenceStarted = true;
  await persistQueryClientRestore({
    queryClient,
    persister: asyncStoragePersister,
    maxAge: PERSIST_MAX_AGE,
  });
  // Chat transcripts use `staleTime: Infinity` (WS keeps them fresh), so a
  // restored transcript would otherwise be treated as fresh forever and
  // never refresh. Invalidate restored message queries so the first mount
  // after cold start refetches them in the background — the restored data
  // still renders instantly via placeholderData, but the transcript catches
  // up to whatever the WS stream missed while the app was closed. The
  // restore runs before the app tree mounts (see app/_layout.tsx), so no
  // query is active yet and this just marks them stale.
  queryClient.invalidateQueries({ queryKey: ["chat", "messages"] });
  // Keeps the AsyncStorage blob in sync as queries land / change. Restored
  // data is only shown while fresh-enough; the 60s default staleTime makes
  // most restored lists refetch on mount, so the user gets "instant
  // last-known data, refreshed behind the scenes".
  persistQueryClient({
    queryClient,
    persister: asyncStoragePersister,
    maxAge: PERSIST_MAX_AGE,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
  });
}
