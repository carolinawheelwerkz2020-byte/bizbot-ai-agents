/**
 * Client-side auth bypass: only when VITE_AUTH_DISABLED=true AND (Vite dev server
 * OR explicit VITE_ALLOW_INSECURE_CLOUD_AUTH_BYPASS for production builds).
 * Prevents shipping a production bundle that skips Firebase Auth by accident.
 */
export function isClientAuthBypassEnabled(): boolean {
  if (import.meta.env.VITE_AUTH_DISABLED !== "true") return false;
  if (import.meta.env.DEV) return true;
  return import.meta.env.VITE_ALLOW_INSECURE_CLOUD_AUTH_BYPASS === "true";
}
