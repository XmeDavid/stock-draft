"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) router.push("/admin");
    else setError(((await res.json()) as { error?: string }).error ?? "Login failed");
  }

  return (
    <main className="mx-auto mt-24 max-w-sm p-4">
      <h1 className="mb-4 text-xl font-bold">Admin login</h1>
      <form onSubmit={submit} className="space-y-3">
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Password" className="w-full rounded border p-2" autoFocus />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded bg-gray-800 p-2 text-white">Log in</button>
      </form>
    </main>
  );
}
