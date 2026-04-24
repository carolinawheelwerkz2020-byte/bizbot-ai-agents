import { auth } from "./firebase";

async function ensureAuthHydrated(): Promise<void> {
  if (!auth) return;
  const maybeReady = auth as unknown as { authStateReady?: () => Promise<void> };
  if (typeof maybeReady.authStateReady === "function") {
    await maybeReady.authStateReady();
  }
}

/** Headers to send with `/api/*` when Firebase Auth is enabled. */
export async function authHeaderObject(): Promise<Record<string, string>> {
  if (!auth) return {};
  await ensureAuthHydrated();
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

/**
 * Same-origin / configured API fetch with Firebase ID token.
 * Waits for restored sessions, then retries once with a forced token refresh on 401.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const a = auth;
  if (!a) {
    return fetch(input, init);
  }

  await ensureAuthHydrated();

  const withAuth = async (forceRefresh: boolean): Promise<Response> => {
    const headers = new Headers(init?.headers ?? undefined);
    const user = a.currentUser;
    if (user) {
      const token = await user.getIdToken(forceRefresh);
      headers.set("Authorization", `Bearer ${token}`);
    }
    return fetch(input, { ...init, headers });
  };

  let res = await withAuth(false);
  if (res.status === 401 && a.currentUser) {
    res = await withAuth(true);
  }
  return res;
}
