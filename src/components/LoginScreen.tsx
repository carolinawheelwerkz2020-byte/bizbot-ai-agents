import { useState } from "react";
import { signInWithEmailAndPassword, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { auth } from "../lib/firebase";
import { Loader2 } from "lucide-react";

export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (import.meta.env.VITE_AUTH_DISABLED === "true") {
      // In dev mode with auth disabled, we skip Firebase sign in
      // Since AuthGate already checks this flag, we just need to refresh or move on
      window.location.reload(); 
      return;
    }
    if (!auth) return;
    setError("");
    setBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function onGoogle() {
    if (!auth) return;
    setError("");
    setBusy(true);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sign in failed";
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 text-zinc-100 p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/80 p-8 shadow-xl">
        <h1 className="text-xl font-semibold tracking-tight mb-1">BizBot AI</h1>
        <p className="text-sm text-zinc-400 mb-6">Sign in to continue. Only invited team accounts can use this app.</p>

        <form onSubmit={onEmailSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Email</label>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">Password</label>
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl bg-zinc-950 border border-zinc-700 px-3 py-2 text-sm outline-none focus:border-indigo-500"
              required
            />
          </div>
          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={busy}
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 py-2.5 text-sm font-medium"
          >
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Sign in
          </button>
        </form>

        {import.meta.env.VITE_AUTH_DISABLED === "true" && (
          <div className="mt-4">
            <button
              onClick={() => {
                // Since AUTH_DISABLED is true, AuthGate will handle the bypass
                // We just need to trigger a re-render or state change if needed
                // But AuthGate already checks this flag on every render.
                window.location.reload(); 
              }}
              className="w-full rounded-xl border border-cyber-blue/30 bg-cyber-blue/10 text-cyber-blue hover:bg-cyber-blue/20 py-2.5 text-sm font-medium"
            >
              Bypass Auth (Dev Mode)
            </button>
          </div>
        )}

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-700" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-zinc-900/80 px-2 text-zinc-500">or</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onGoogle}
          disabled={busy}
          className="w-full rounded-xl border border-zinc-600 hover:bg-zinc-800 disabled:opacity-50 py-2.5 text-sm font-medium"
        >
          Continue with Google
        </button>
      </div>
    </div>
  );
}
