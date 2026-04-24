export type RuntimeSurface = "hosted_limited" | "local_desktop";

/** True when the SPA is served from Firebase Hosting (relay/shell tools are not available here). */
export function getRuntimeSurface(): RuntimeSurface {
  if (typeof window === "undefined") return "local_desktop";
  const host = window.location.hostname;
  if (host.endsWith(".web.app") || host.endsWith(".firebaseapp.com")) {
    return "hosted_limited";
  }
  return "local_desktop";
}

export function runtimeSurfaceLabel(surface: RuntimeSurface): {
  short: string;
  detail: string;
} {
  if (surface === "hosted_limited") {
    return {
      short: "Hosted",
      detail:
        "Firebase-hosted UI: chat, uploads, and cloud history. Shell, file relay, npm, and Playwright run only in the desktop app with the local server.",
    };
  }
  return {
    short: "Full runtime",
    detail: "Local or self-hosted stack: auxiliary tools, workers, and relay run when configured.",
  };
}
