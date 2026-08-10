/**
 * Warm the three bottom-tab lists the moment a workspace resolves.
 *
 * The bottom tabs are lazily mounted, so without this each tab pays a cold
 * fetch on first focus — and on cold start that's after the auth + workspace
 * init chain has already done its network round-trips (see WS-9 load-time
 * discussion). Prefetching here overlaps the tab fetches with the moment the
 * user is still landing, so by the time they tap Inbox / My Issues / Chat the
 * data is already in the TanStack Query cache.
 *
 * What we warm:
 *   - inbox:            inboxKeys.list(wsId)
 *   - my-issues:        default scope "assigned" for the current user
 *   - chat:             sessions + agents + members (messages/pendingTask are
 *                       keyed by the active session, which is only known once
 *                       the chat tab hydrates — sessions+agents+members are
 *                       the list-level part and the bulk of the requests)
 *
 * Prefetch failures are swallowed: a failed warm-up just means the tab
 * refetches on focus like today. Never block render on a prefetch.
 */
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { inboxListOptions } from "@/data/queries/inbox";
import { myIssueListOptions, buildMyIssuesFilter } from "@/data/queries/my-issues";
import {
  chatSessionsOptions,
} from "@/data/queries/chat";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useAuthStore } from "@/data/auth-store";

export function usePrefetchWorkspaceTabs(wsId: string | null) {
  const qc = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (!wsId) return;
    const warm = async () => {
      await Promise.allSettled([
        qc.prefetchQuery(inboxListOptions(wsId)),
        qc.prefetchQuery(chatSessionsOptions(wsId)),
        qc.prefetchQuery(agentListOptions(wsId)),
        qc.prefetchQuery(memberListOptions(wsId)),
        // my-issues default scope is "assigned" (my-issues-view-store). Only
        // prefetch once the user id is known — the tab's query is gated on it.
        ...(userId
          ? [
              qc.prefetchQuery(
                myIssueListOptions(
                  wsId,
                  "assigned",
                  buildMyIssuesFilter("assigned", userId),
                ),
              ),
            ]
          : []),
      ]);
    };
    void warm();
  }, [qc, wsId, userId]);
}
