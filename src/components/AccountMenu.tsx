"use client";

import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { useEffect, useState, type FormEvent } from "react";
import { api } from "../../convex/_generated/api";
import { authClient } from "@/lib/auth-client";
import { getLearnerKey } from "@/lib/learnerKey";

/*
 * Sign in / create account, so progress follows the learner across devices.
 * Signing in also claims the sessions practiced on this device before
 * signing in, so nothing done anonymously is lost.
 */

type Mode = "sign-in" | "sign-up";

export default function AccountMenu() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const user = useQuery(api.auth.getCurrentUser);
  const claimDeviceSessions = useMutation(api.sessions.claimDeviceSessions);
  const [open, setOpen] = useState(false);

  // Idempotent: only sessions not yet attached to an account are claimed.
  useEffect(() => {
    if (!isAuthenticated) return;
    claimDeviceSessions({ learnerKey: getLearnerKey() }).catch((error) =>
      console.warn("Couldn't attach this device's sessions", error),
    );
  }, [isAuthenticated, claimDeviceSessions]);

  if (isLoading) return <span className="h-8 w-20" aria-hidden />;

  if (isAuthenticated && user) {
    return (
      <div className="relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="flex items-center gap-2 rounded-full border border-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:border-zinc-600"
        >
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-[11px] font-semibold text-emerald-300">
            {(user.name || user.email).slice(0, 1).toUpperCase()}
          </span>
          {user.name || user.email}
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-zinc-800 bg-zinc-950 p-3 text-sm shadow-xl">
            <p className="truncate text-zinc-300">{user.email}</p>
            <p className="mt-1 text-xs text-zinc-500">
              Your progress is saved to this account on every device.
            </p>
            <button
              onClick={() => {
                setOpen(false);
                void authClient.signOut();
              }}
              className="mt-3 w-full rounded-lg border border-zinc-700 py-1.5 text-zinc-200 hover:bg-zinc-800"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-black hover:bg-zinc-200"
      >
        Sign in
      </button>
      {open && <AuthForm onDone={() => setOpen(false)} />}
    </div>
  );
}

function AuthForm({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("sign-up");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setPending(true);
    const result =
      mode === "sign-up"
        ? await authClient.signUp.email({ name: name.trim() || email, email, password })
        : await authClient.signIn.email({ email, password });
    setPending(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Try again.");
      return;
    }
    onDone();
  };

  const input =
    "w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:border-zinc-400 focus:outline-none";

  return (
    <form
      onSubmit={submit}
      className="absolute right-0 z-20 mt-2 flex w-72 flex-col gap-2 rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm shadow-xl"
    >
      <p className="font-medium text-white">
        {mode === "sign-up" ? "Create an account" : "Welcome back"}
      </p>
      <p className="text-xs text-zinc-500">
        Keep your progress across devices. Practice you&apos;ve already done here comes
        with you.
      </p>
      {mode === "sign-up" && (
        <input
          className={input}
          placeholder="Name"
          autoComplete="name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      )}
      <input
        className={input}
        type="email"
        placeholder="Email"
        autoComplete="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className={input}
        type="password"
        placeholder="Password (8+ characters)"
        autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        required
        minLength={8}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-1 rounded-lg bg-white py-2 font-medium text-black hover:bg-zinc-200 disabled:opacity-60"
      >
        {pending ? "One moment…" : mode === "sign-up" ? "Create account" : "Sign in"}
      </button>
      <button
        type="button"
        onClick={() => {
          setMode(mode === "sign-up" ? "sign-in" : "sign-up");
          setError(null);
        }}
        className="text-xs text-zinc-400 hover:text-white"
      >
        {mode === "sign-up" ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
    </form>
  );
}
