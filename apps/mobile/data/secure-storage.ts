/**
 * Thin wrapper around expo-secure-store for the auth token and a cached
 * user profile.
 *
 * Token keyed identically to web/desktop ("multica_token") so logic stays
 * aligned with packages/core/auth/store.ts even though storage backends
 * differ.
 *
 * The cached user exists so a cold start can render the app instantly from
 * local state (app/index.tsx gates on `isLoading`) instead of blocking on
 * `GET /api/me`. It is a display-level cache only: the server response is
 * the source of truth, and the auth store refreshes it in the background
 * on every launch (see useAuthStore.initialize). A failed refresh clears it
 * so stale profile data never lingers.
 */
import * as SecureStore from "expo-secure-store";
import type { User } from "@multica/core/types";

const TOKEN_KEY = "multica_token";
const USER_KEY = "multica_cached_user";

export async function getToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(token: string): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function getCachedUser(): Promise<User | null> {
  const raw = await SecureStore.getItemAsync(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    // Corrupt cache — drop it so the next successful getMe re-seeds it.
    await clearCachedUser();
    return null;
  }
}

export async function setCachedUser(user: User): Promise<void> {
  await SecureStore.setItemAsync(USER_KEY, JSON.stringify(user));
}

export async function clearCachedUser(): Promise<void> {
  await SecureStore.deleteItemAsync(USER_KEY);
}
