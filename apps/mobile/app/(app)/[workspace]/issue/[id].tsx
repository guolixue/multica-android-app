/**
 * Issue detail screen.
 *
 * Read-mostly timeline with an inline comment composer pinned to the
 * bottom (`<InlineCommentComposer>`). The composer is a single
 * `<TextInput>` + mention suggestion bar — no modal route, no toolbar,
 * no draft persistence. Sticks to the keyboard via `KeyboardStickyView`.
 *
 * Header note: the parent _layout.tsx already declares the `issue/[id]`
 * Stack.Screen with title "Issue". We override that here once the data
 * lands so the navigation bar shows `MUL-123` (Linear-style).
 */
import { useCallback, useEffect, useState } from "react";
import { Alert, Linking, View } from "react-native";
import { Stack, router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import type { Issue } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { TimelineList } from "@/components/issue/timeline-list";
import { AgentHeaderBadge } from "@/components/issue/agent-header-badge";
import { InlineCommentComposer } from "@/components/issue/inline-comment-composer";
import {
  issueDetailOptions,
  issueKeys,
  issueTimelineOptions,
} from "@/data/queries/issues";
import { useDeleteIssue } from "@/data/mutations/issues";
import { pinListOptions } from "@/data/queries/pins";
import { useCreatePin, useDeletePin } from "@/data/mutations/pins";
import { useAuthStore } from "@/data/auth-store";
import { useIssueRealtime } from "@/data/realtime/use-issue-realtime";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useViewedIssuesStore } from "@/data/viewed-issues-store";
import { useCommentSelectStore } from "@/data/comment-select-store";
import { useReplyTargetStore } from "@/data/stores/reply-target-store";
import { showActionSheet } from "@/lib/action-sheet";

export default function IssueDetail() {
  // `highlight` + `h` come from inbox deep-link (apps/mobile/app/(app)/
  // [workspace]/(tabs)/inbox.tsx). `highlight` is the target comment id;
  // `h` is a per-tap nonce so re-tapping the same row re-fires the
  // scroll-and-flash effect.
  const { id, workspace: wsSlug, highlight, h } = useLocalSearchParams<{
    id: string;
    workspace: string;
    highlight?: string;
    h?: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const qc = useQueryClient();

  const detail = useQuery(issueDetailOptions(wsId, id));
  const timeline = useQuery(issueTimelineOptions(wsId, id));

  // Subscribe to per-issue WS events: status/priority/assignee/label
  // changes, comments, activity, reactions, agent task progress.
  // Mounted with `id` — cleans up automatically on navigate-away.
  // If another client deletes the issue we're viewing, pop back so the
  // user isn't stranded on a 404 detail page.
  useIssueRealtime(id, () => router.back());

  // Track viewed issues so the chat composer's `@` suggestion bar can
  // surface "Recent" — the user just looked at MUL-123, likely wants to
  // ask the agent about it next. Workspace-scoped + in-memory; see
  // data/viewed-issues-store.ts.
  useEffect(() => {
    if (wsId && id) {
      useViewedIssuesStore.getState().push(wsId, id);
    }
  }, [wsId, id]);

  // Screen-scoped composer state — clear on unmount so re-entering the
  // issue starts from a clean slate (no stale text-selection comment id,
  // no stale "Replying to X" target). Both stores are singletons used by
  // the long-press action sheet.
  useEffect(() => {
    return () => {
      useCommentSelectStore.getState().clear();
      useReplyTargetStore.getState().clear();
    };
  }, []);

  // TimelineList's `refreshing` is controlled — binding it to isRefetching
  // would show the pull-to-refresh spinner during background refetches
  // (WS events, cache restore). Only show it on user-initiated pulls.
  const [userRefreshing, setUserRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setUserRefreshing(true);
    try {
      await Promise.all([
        detail.refetch(),
        qc.invalidateQueries({ queryKey: issueKeys.timeline(wsId, id) }),
      ]);
    } finally {
      setUserRefreshing(false);
    }
  }, [detail, qc, wsId, id]);

  const issue = detail.data;
  const deleteIssue = useDeleteIssue();
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const { data: pins } = useQuery(pinListOptions(wsId, userId));
  const isPinned =
    !!issue &&
    !!pins?.some((p) => p.item_type === "issue" && p.item_id === issue.id);
  const createPin = useCreatePin();
  const deletePin = useDeletePin();

  // Three-dot menu: Pin/Unpin / Copy link / Open on web (if web URL set) /
  // Delete. Mirrors apps/mobile/app/(app)/[workspace]/project/[id].tsx — same
  // ActionSheetIOS + Alert.alert confirm pattern. Property edits (status,
  // priority, assignee, due_date) live on the IssueHeaderCard chips inside
  // the timeline list, not in this menu — one entry per action.
  const onPressMore = useCallback(() => {
    if (!issue || !wsSlug) return;
    const webUrl = process.env.EXPO_PUBLIC_WEB_URL;
    const issueLink = webUrl
      ? `${webUrl}/${wsSlug}/issue/${issue.identifier}`
      : null;
    const options: string[] = ["Cancel"];
    options.push(isPinned ? "Unpin" : "Pin");
    options.push("Edit details");
    if (issueLink) options.push("Copy link");
    if (issueLink) options.push("Open on web");
    options.push("Delete issue");
    const destructiveIndex = options.length - 1;
    showActionSheet(
      {
        options,
        cancelButtonIndex: 0,
        destructiveButtonIndex: destructiveIndex,
        title: issue.identifier,
      },
      (i) => {
        const label = options[i];
        if (label === "Pin") {
          createPin.mutate({ item_type: "issue", item_id: issue.id });
        } else if (label === "Unpin") {
          deletePin.mutate({ itemType: "issue", itemId: issue.id });
        } else if (label === "Edit details") {
          if (wsSlug) router.push(`/${wsSlug}/issue/${issue.id}/edit`);
        } else if (label === "Copy link" && issueLink) {
          Clipboard.setStringAsync(issueLink);
        } else if (label === "Open on web" && issueLink) {
          Linking.openURL(issueLink);
        } else if (label === "Delete issue") {
          confirmDelete(issue, () =>
            deleteIssue.mutate(issue.id, {
              onSuccess: () => router.back(),
            }),
          );
        }
      },
    );
  }, [issue, wsSlug, deleteIssue, isPinned, createPin, deletePin]);

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen
        options={{
          title: issue?.identifier ?? "Issue",
          headerBackTitle: "Back",
          headerRight: issue
            ? () => (
                <View className="flex-row items-center gap-2">
                  {/* Ambient agent-working badge — renders null when no
                   *  active tasks, so it doesn't crowd the header in the
                   *  common case. See agent-header-badge.tsx. */}
                  <AgentHeaderBadge issueId={id} />
                  <IconButton
                    name="ellipsis-horizontal"
                    onPress={onPressMore}
                    accessibilityLabel="Issue actions"
                  />
                </View>
              )
            : undefined,
        }}
      />
      {detail.isLoading ? (
        <IssueDetailLoading />
      ) : detail.error || !issue ? (
        <View className="flex-1 items-center justify-center px-6 gap-3">
          <Text className="text-sm text-destructive text-center">
            Failed to load issue:{" "}
            {detail.error instanceof Error
              ? detail.error.message
              : "not found"}
          </Text>
          <Button variant="outline" onPress={() => detail.refetch()}>
            <Text>Retry</Text>
          </Button>
        </View>
      ) : (
        <View className="flex-1">
          <TimelineList
            issue={issue}
            entries={timeline.data}
            timelineLoading={timeline.isLoading}
            refreshing={userRefreshing}
            onRefresh={onRefresh}
            highlightCommentId={highlight}
            highlightNonce={h}
          />
          <InlineCommentComposer issueId={id} />
        </View>
      )}
    </View>
  );
}

function confirmDelete(issue: Issue, onConfirm: () => void) {
  Alert.alert(
    "Delete issue?",
    `${issue.identifier} and its comments, reactions, and attachments will be permanently deleted. This cannot be undone.`,
    [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: onConfirm },
    ],
  );
}

/**
 * Skeleton for the issue detail screen — shown while the detail query is
 * cold-loading (no restored cache, no in-memory data). Mirrors the real
 * layout: IssueHeaderCard (identifier / title / attribute chips), the
 * description block, an "Activity" heading, then comment-bubble rows.
 *
 * Replaces the previous full-screen spinner so the eye sees the page
 * structure immediately (same rationale as InboxLoading in
 * app/(app)/[workspace]/(tabs)/inbox.tsx). When the detail query was
 * restored from the disk-persisted cache, this never renders — the
 * last-known issue shows instantly and refreshes behind the scenes.
 */
function IssueDetailLoading() {
  return (
    <View className="flex-1 bg-background">
      {/* IssueHeaderCard shape */}
      <View className="px-4 pt-4 pb-3 gap-3">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-4/5" />
        {/* Attribute chip row — Status / Priority / Assignee / Label… */}
        <View className="flex-row flex-wrap gap-2 pt-1">
          <Skeleton className="h-8 w-20 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-28 rounded-full" />
          <Skeleton className="h-8 w-16 rounded-full" />
        </View>
      </View>

      {/* Description block */}
      <View className="px-4 gap-2">
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-11/12" />
        <Skeleton className="h-3.5 w-2/3" />
      </View>

      {/* Activity heading */}
      <View className="px-4 pt-5 pb-2">
        <Skeleton className="h-3 w-20" />
      </View>

      {/* Comment bubbles — avatar + name + body lines */}
      <View className="px-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <View key={i} className="flex-row gap-3">
            <Skeleton className="size-8 rounded-full" />
            <View className="flex-1 gap-2 pt-1">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3.5 w-full rounded-lg" />
              <Skeleton className="h-3.5 w-5/6 rounded-lg" />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
