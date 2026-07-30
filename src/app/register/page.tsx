"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function Register() {
  const [inviteCode, setInviteCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode, username, password, name }),
      });
      if (res.ok) router.push("/");
      else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Registration failed");
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto mt-24 max-w-sm p-4">
      <h1 className="mb-4 text-xl font-bold">Join the race</h1>
      <p className="mb-4 text-sm text-gray-500">
        First time playing? <Link href="/#rules" className="font-semibold text-indigo-700 underline dark:text-indigo-300">Read the rules</Link>.
      </p>
      <form onSubmit={submit} className="space-y-3">
        <input value={inviteCode} onChange={(e) => setInviteCode(e.target.value)}
          placeholder="Invite code" className="w-full rounded border p-2" autoFocus />
        <input value={username} onChange={(e) => setUsername(e.target.value)}
          placeholder="Username" autoComplete="username" className="w-full rounded border p-2" />
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" autoComplete="new-password" className="w-full rounded border p-2" />
        <input value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Display name (optional)" className="w-full rounded border p-2" />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={busy} className="w-full rounded bg-gray-800 p-2 text-white disabled:opacity-50">
          {busy ? "Registering…" : "Register"}
        </button>
      </form>
      <p className="mt-4 text-sm text-gray-500">
        Already registered? <Link href="/login" className="underline">Log in</Link>
      </p>
    </main>
  );
}
