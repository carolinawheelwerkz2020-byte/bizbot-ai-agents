import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, initializeFirebase } from "./lib/firebase";
import { isClientAuthBypassEnabled } from "./lib/clientAuthBypass";
import { AuthUserProvider } from "./AuthContext";
import LoginScreen from "./components/LoginScreen";
import { Loader2 } from "lucide-react";

function FirebaseConfigMissing() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-lg rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">Firebase is not configured</h1>
        <p className="text-sm text-zinc-400 leading-relaxed">
          This build has no <code className="text-zinc-300">VITE_FIREBASE_*</code> values and could not load{" "}
          <code className="text-zinc-300">/__/firebase/init.json</code> from Firebase Hosting. Without a web app
          config, the API cannot attach your sign-in token.
        </p>
        <ul className="text-sm text-zinc-400 list-disc pl-5 space-y-2">
          <li>
            <strong className="text-zinc-200">Local:</strong> copy <code className="text-zinc-300">.env.example</code> to{" "}
            <code className="text-zinc-300">.env.local</code> and set the Firebase web app keys from the Firebase Console.
          </li>
          <li>
            <strong className="text-zinc-200">Hosted:</strong> deploy this app to Firebase Hosting linked to your Firebase
            project (reserved <code className="text-zinc-300">init.json</code> is served automatically).
          </li>
        </ul>
        <a
          className="inline-flex text-sm font-medium text-indigo-400 hover:text-indigo-300"
          href="https://console.firebase.google.com/project/cww-agents/settings/general"
          target="_blank"
          rel="noreferrer"
        >
          Open Firebase project settings →
        </a>
      </div>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [boot, setBoot] = useState<"loading" | "missing" | "ready">("loading");
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const isAuthDisabled = isClientAuthBypassEnabled();

  useEffect(() => {
    let unsub: (() => void) | undefined;

    void (async () => {
      const firebaseOk = await initializeFirebase();
      if (!firebaseOk && !isAuthDisabled) {
        setBoot("missing");
        return;
      }
      setBoot("ready");

      if (isAuthDisabled || !auth) {
        setAuthLoading(false);
        return;
      }

      unsub = onAuthStateChanged(auth, (u) => {
        setUser(u);
        setAuthLoading(false);
      });
    })();

    return () => {
      unsub?.();
    };
  }, [isAuthDisabled]);

  if (boot === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" aria-label="Loading" />
      </div>
    );
  }

  if (boot === "missing") {
    return <FirebaseConfigMissing />;
  }

  if (isAuthDisabled || !auth) {
    return <AuthUserProvider value={null}>{children}</AuthUserProvider>;
  }

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-400" aria-label="Loading" />
      </div>
    );
  }

  if (!user) {
    return <LoginScreen />;
  }

  return <AuthUserProvider value={user}>{children}</AuthUserProvider>;
}
