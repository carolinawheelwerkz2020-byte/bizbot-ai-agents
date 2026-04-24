import { initializeApp, type FirebaseApp, type FirebaseOptions } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

function optionsFromEnv(): FirebaseOptions | null {
  const apiKey = import.meta.env.VITE_FIREBASE_API_KEY?.trim();
  const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN?.trim();
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID?.trim();
  const storageBucket = import.meta.env.VITE_FIREBASE_STORAGE_BUCKET?.trim();
  const messagingSenderId = import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID?.trim();
  const appId = import.meta.env.VITE_FIREBASE_APP_ID?.trim();
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    appId,
    ...(storageBucket ? { storageBucket } : {}),
    ...(messagingSenderId ? { messagingSenderId } : {}),
  };
}

function isFirebaseHostingHostname(): boolean {
  if (typeof window === "undefined") return false;
  const host = window.location.hostname;
  return host.endsWith(".web.app") || host.endsWith(".firebaseapp.com");
}

/** Reserved Hosting URL — same config as the Firebase Console web app for this site. */
async function optionsFromHosting(): Promise<FirebaseOptions | null> {
  if (!isFirebaseHostingHostname()) return null;
  try {
    const res = await fetch("/__/firebase/init.json", { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    const apiKey = String(data.apiKey ?? "").trim();
    const authDomain = String(data.authDomain ?? "").trim();
    const projectId = String(data.projectId ?? "").trim();
    const appId = String(data.appId ?? "").trim();
    if (!apiKey || !authDomain || !projectId || !appId) return null;
    const storageBucket = String(data.storageBucket ?? "").trim();
    const messagingSenderId = String(data.messagingSenderId ?? "").trim();
    return {
      apiKey,
      authDomain,
      projectId,
      appId,
      ...(storageBucket ? { storageBucket } : {}),
      ...(messagingSenderId ? { messagingSenderId } : {}),
    };
  } catch {
    return null;
  }
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;

let initPromise: Promise<boolean> | null = null;

/**
 * Initializes Firebase from Vite env, or on Firebase Hosting from /__/firebase/init.json
 * (so production builds work without baking VITE_FIREBASE_* into CI).
 */
export function initializeFirebase(): Promise<boolean> {
  if (app) return Promise.resolve(true);
  if (!initPromise) {
    initPromise = (async () => {
      let options = optionsFromEnv();
      if (!options) {
        options = await optionsFromHosting();
      }
      if (!options) {
        return false;
      }
      try {
        app = initializeApp(options);
        auth = getAuth(app);
        db = getFirestore(app);
        return true;
      } catch {
        return false;
      }
    })();
  }
  return initPromise;
}

export { app, auth, db };
