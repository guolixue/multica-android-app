/**
 * Last-active chat session persistence.
 *
 * When the user re-enters the Chat tab (or cold-starts the app), we want to
 * resume the conversation they were actually last in — "上次聊的对话" — not
 * just whatever the sessions list happens to sort first. The server orders
 * the list by pinned-first then recency, so a pinned chat or a freshly
 * created-but-empty session can sit above the conversation the user last
 * used. Persisting the last-active session id per workspace is the only way
 * to resume the real one.
 *
 * Storage: expo-secure-store, one key per workspace (a UUID is well under
 * the 2KB value cap). Writes are fire-and-forget from the chat tab.
 */
import { create } from "zustand";
import * as SecureStore from "expo-secure-store";

const key = (wsId: string) => `multica_last_chat_session_${wsId}`;

interface LastChatSessionState {
  /** Persist the user's last-active session for a workspace. Pass `null`
   *  to clear (e.g. the user explicitly chose a brand-new chat). */
  persist: (wsId: string, sessionId: string | null) => Promise<void>;
  /** Restore the persisted last-active session id, or `null` when none. */
  restore: (wsId: string) => Promise<string | null>;
}

export const useLastChatSessionStore = create<LastChatSessionState>(() => ({
  persist: async (wsId, sessionId) => {
    if (!wsId) return;
    if (sessionId) {
      await SecureStore.setItemAsync(key(wsId), sessionId);
    } else {
      await SecureStore.deleteItemAsync(key(wsId));
    }
  },
  restore: async (wsId) => {
    if (!wsId) return null;
    return SecureStore.getItemAsync(key(wsId));
  },
}));
