import { auth } from "./firebase";

/** Headers to send with `/api/*` when Firebase Auth is enabled. */
export async function authHeaderObject(): Promise<Record<string, string>> {
  if (!auth) return {};
  const user = auth.currentUser;
  if (!user) return {};
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}
