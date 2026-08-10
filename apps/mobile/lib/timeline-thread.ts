/**
 * Group timeline entries by reply thread for the mobile flat list.
 *
 * Mirrors the partition step of web's
 * `packages/views/issues/components/issue-detail.tsx:301-339`, but the output
 * shape differs: instead of emitting each reply as its own row (web renders a
 * recursive tree with indentation), we **bundle a comment's entire descendant
 * chain into the parent row** so the renderer can draw one bubble that
 * contains the whole thread. This matches the visual rule the user asked for
 * — no "Replying to" headers, the bubble boundary itself indicates the
 * thread.
 *
 * Two important rules carried over from web:
 *
 *   - **Orphan rescue (web #1857):** a reply whose parent is NOT in the
 *     loaded timeline gets promoted to top-level instead of disappearing.
 *     Without this the entire reply subtree would silently vanish and break
 *     the "Counts must agree" parity rule from apps/mobile/CLAUDE.md.
 *   - **Reply-to-reply still belongs to the same bundle.** A nested chain
 *     (A → B → C) gets flattened into A's row with `replies: [B, C]`. Mobile
 *     is a flat list (CLAUDE.md), so we don't preserve depth — just keep
 *     them all inside the same bubble in chronological order.
 *
 * **Bundle ordering is strictly chronological** (`created_at`, then `id`),
 * not tree-depth-first. A BFS that emits every depth-1 sibling before its
 * replies would scramble a shared-root thread like A, replyA, B, replyB into
 * A, B, replyA, replyB — the replies would land after every later sibling
 * even though their timestamps belong earlier. Sorting the flattened chain
 * by the same (created_at, id) key the top-level rows use keeps every row in
 * the bubble reading top-to-bottom in wall-clock time, which matches the
 * relative "21m ago / 36m ago" labels the UI draws next to each message.
 *
 * Total comment+activity count emitted is identical to the input (just
 * fewer rows because replies are folded into parents). That preserves the
 * "Counts must agree" parity rule against web.
 */
import type { TimelineEntry } from "@multica/core/types";

export interface TimelineRow {
  entry: TimelineEntry;
  /** Flattened descendant chain in chronological order. Empty for activity
   *  rows and for top-level comments without replies. */
  replies: TimelineEntry[];
}

export function buildTimelineRows(
  entries: TimelineEntry[],
): TimelineRow[] {
  const commentIds = new Set<string>();
  for (const e of entries) {
    if (e.type === "comment") commentIds.add(e.id);
  }

  const topLevel: TimelineEntry[] = [];
  const childrenByParent = new Map<string, TimelineEntry[]>();

  for (const e of entries) {
    if (
      e.type === "comment" &&
      e.parent_id &&
      commentIds.has(e.parent_id)
    ) {
      const list = childrenByParent.get(e.parent_id) ?? [];
      list.push(e);
      childrenByParent.set(e.parent_id, list);
    } else {
      // Activity OR top-level comment OR orphan reply (parent not in batch).
      topLevel.push(e);
    }
  }

  function collectDescendants(parentId: string): TimelineEntry[] {
    // Gather the whole descendant subtree, then sort chronologically.
    // Children arrays are already in insertion order (the scan above pushes
    // in input order, which the caller keeps sorted by (created_at, id)), so
    // a BFS gives "every depth-1 sibling first, then their replies" — wrong
    // for a shared-root thread where replies interleave between siblings
    // (A, replyA, B, replyB). Sorting the flattened set by the same key as
    // the top-level rows fixes the bundle to wall-clock order.
    const out: TimelineEntry[] = [];
    const stack: string[] = [parentId];
    while (stack.length > 0) {
      const pid = stack.pop()!;
      const kids = childrenByParent.get(pid);
      if (!kids) continue;
      for (const child of kids) {
        out.push(child);
        stack.push(child.id);
      }
    }
    out.sort((a, b) => {
      if (a.created_at !== b.created_at) {
        return a.created_at < b.created_at ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    });
    return out;
  }

  return topLevel.map((entry) => ({
    entry,
    replies:
      entry.type === "comment" ? collectDescendants(entry.id) : [],
  }));
}
