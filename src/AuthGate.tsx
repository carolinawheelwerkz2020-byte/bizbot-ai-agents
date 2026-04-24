import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, isFirebaseConfigured } from "./lib/firebase";
import { isClientAuthBypassEnabled } from "./lib/clientAuthBypass";
import { AuthUserProvider } from "./AuthContext";
import LoginScreen from "./components/LoginScreen";
import { Loader2 } from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  const isAuthDisabled = isClientAuthBypassEnabled();

  useEffect(() => {
    if (isAuthDisabled || !auth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, [isAuthDisabled]);

  if (isAuthDisabled || !isFirebaseConfigured) {
    return <AuthUserProvider value={null}>{children}</AuthUserProvider>;
  }

  if (loading) {
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
