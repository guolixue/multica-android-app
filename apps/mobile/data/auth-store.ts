/**
 * Mobile auth store — Zustand. Logic mirrors packages/core/auth/store.ts:
 *   - Token written ONLY on successful verifyCode
 *   - 401 → clear token; non-401 (5xx / network blip) → preserve token so
 *     the next launch can retry
 *   - logout = clear token + clear in-memory user + setToken(null)
 *
 * NOT shared with web/desktop (per Sharing Principles in root CLAUDE.md).
 * Storage backend is expo-secure-store (mobile only); web uses HttpOnly
 * cookies, desktop uses localStorage via StorageAdapter.
 */
import { create } from "zustand";
import type { User } from "@multica/core/types";
import { api, ApiError } from "./api";
import {
  clearToken,
  getToken,
  setToken,
  getCachedUser,
  setCachedUser,
  clearCachedUser,
} from "./secure-storage";
import { useWorkspaceStore } from "./workspace-store";

interface AuthState {
  user: User | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  sendCode: (email: string) => Promise<void>;
  verifyCode: (email: string, code: string) => Promise<User>;
  logout: () => Promise<void>;
  /** Overwrite the in-memory user — call after PATCH /api/me so name/avatar
   *  edits land without a refetch. Server response is the source of truth. */
  setUser: (user: User) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,

  initialize: async () => {
    // Restore the persisted workspace slug alongside the auth token so the
    // entry redirect (app/index.tsx) can route directly to the last-used
    // workspace without flashing /select-workspace.
    //
    // All SecureStore reads run in parallel (slug + token + cached user) —
    // they're independent keys, so serialising them only adds cold-start
    // latency for no benefit.
    const [slug, token, cachedUser] = await Promise.all([
      useWorkspaceStore.getState().restoreSlug(),
      getToken(),
      getCachedUser(),
    ]);

    if (!token) {
      set({ isLoading: false });
      return;
    }
    api.setToken(token);

    // Fast path: a cached user lets the home page render instantly from
    // local state. The token is present, so we optimistically trust the
    // cached user for first paint and validate in the background — the
    // server's /api/me response (or a 401) is what we settle on.
    if (cachedUser) {
      set({ user: cachedUser, isLoading: false });
    }

    try {
      const user = await api.getMe();
      set({ user });
      await setCachedUser(user);
    } catch (err) {
      // Only clear token on a genuine 401. Network blips / 5xx keep the
      // token so the next launch (or a manual refresh) can retry.
      if (err instanceof ApiError && err.status === 401) {
        await clearToken();
        await clearCachedUser();
        api.setToken(null);
      }
      // If the fast path already rendered a cached user, a failed refresh
      // keeps it (stale profile is better than blank) — the token is still
      // valid on a blip, and a 401 already cleared everything above.
      if (!cachedUser) {
        set({ user: null });
      }
    } finally {
      set({ isLoading: false });
    }
  },

  sendCode: async (email) => {
    await api.sendCode(email);
  },

  verifyCode: async (email, code) => {
    const { token, user } = await api.verifyCode(email, code);
    await setToken(token);
    await setCachedUser(user);
    api.setToken(token);
    set({ user });
    return user;
  },

  logout: async () => {
    await clearToken();
    await clearCachedUser();
    api.setToken(null);
    set({ user: null });
  },

  setUser: (user) => {
    set({ user });
    void setCachedUser(user);
  },
}));
