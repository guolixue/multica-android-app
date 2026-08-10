import { describe, expect, it } from "vitest";
import { buildTimelineRows } from "./timeline-thread";

type Entry = {
  type: string;
  id: string;
  actor_type: string;
  actor_id: string;
  created_at: string;
  content?: string;
  parent_id?: string | null;
};

function comment(
  id: string,
  created_at: string,
  parent_id: string | null,
  actor: string = "member",
): Entry {
  return {
    type: "comment",
    id,
    actor_type: actor,
    actor_id: "u1",
    created_at,
    content: id,
    parent_id,
  };
}

describe("buildTimelineRows thread bundling", () => {
  it("keeps a shared-root thread in chronological order (A, replyA, B, replyB)", () => {
    // The user's exact report: they send A, cloud replies A, they send B,
    // cloud replies B. In the timeline these are threaded under one root:
    // root → A → replyA, root → B → replyB. BFS grouping used to emit
    // A, B, replyA, replyB (all siblings before their replies), which is
    // what the user saw. The bundle must read in wall-clock order.
    const entries = [
      comment("root", "2026-08-10T09:00:00Z", null),
      comment("A", "2026-08-10T09:01:00Z", "root"),
      comment("replyA", "2026-08-10T09:02:00Z", "A", "agent"),
      comment("B", "2026-08-10T09:03:00Z", "root"),
      comment("replyB", "2026-08-10T09:04:00Z", "B", "agent"),
    ];
    const rows = buildTimelineRows(entries as any);
    expect(rows).toHaveLength(1);
    expect(rows[0].entry.id).toBe("root");
    expect(rows[0].replies.map((r) => r.id)).toEqual([
      "A",
      "replyA",
      "B",
      "replyB",
    ]);
  });

  it("interleaves nested reply chains by created_at, not depth", () => {
    // reply-to-reply chain (A → replyA → replyA2) plus a later sibling B.
    const entries = [
      comment("root", "2026-08-10T09:00:00Z", null),
      comment("A", "2026-08-10T09:01:00Z", "root"),
      comment("replyA", "2026-08-10T09:02:00Z", "A", "agent"),
      comment("B", "2026-08-10T09:03:00Z", "root"),
      comment("replyA2", "2026-08-10T09:03:30Z", "replyA", "agent"),
      comment("replyB", "2026-08-10T09:04:00Z", "B", "agent"),
    ];
    const rows = buildTimelineRows(entries as any);
    expect(rows[0].replies.map((r) => r.id)).toEqual([
      "A",
      "replyA",
      "B",
      "replyA2",
      "replyB",
    ]);
  });

  it("promotes orphan replies to top-level (parent not in batch)", () => {
    // Orphan rescue: reply references a parent outside the loaded set.
    const entries = [
      comment("root", "2026-08-10T09:00:00Z", null),
      comment("A", "2026-08-10T09:01:00Z", "root"),
      comment("orphanReply", "2026-08-10T09:02:00Z", "missing-parent", "agent"),
    ];
    const rows = buildTimelineRows(entries as any);
    const topIds = rows.map((r) => r.entry.id);
    expect(topIds).toEqual(["root", "orphanReply"]);
    expect(rows[0].replies.map((r) => r.id)).toEqual(["A"]);
  });

  it("preserves caller-sorted top-level order and bundles replies in place", () => {
    // Top-level ordering is the caller's job (timeline-list.tsx sorts by
    // (created_at, id) before calling). buildTimelineRows must keep that
    // order while folding each reply into its parent's bundle.
    const entries = [
      comment("root1", "2026-08-10T09:00:00Z", null),
      comment("A", "2026-08-10T09:01:00Z", "root1"),
      comment("replyA", "2026-08-10T09:02:00Z", "A", "agent"),
      comment("root2", "2026-08-10T09:03:00Z", null),
      comment("B", "2026-08-10T09:04:00Z", "root2"),
    ];
    const rows = buildTimelineRows(entries as any);
    expect(rows.map((r) => r.entry.id)).toEqual(["root1", "root2"]);
    expect(rows[0].replies.map((r) => r.id)).toEqual(["A", "replyA"]);
    expect(rows[1].replies.map((r) => r.id)).toEqual(["B"]);
  });
});
