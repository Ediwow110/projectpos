"use client";

import type { JSX } from "react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "../../lib/api";

export default function LoginPage(): JSX.Element {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    try {
      const deviceId = window.localStorage.getItem("pos-device-id");
      await apiFetch("/api/v1/auth/login", {
        init: { method: "POST", body: JSON.stringify({ email, password, ...(deviceId ? { deviceId } : {}) }) },
      });
      router.push("/");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Login failed");
    }
  }

  return (
    <main>
      <h1>Sign in</h1>
      <form onSubmit={submit}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Sign in</button>
      </form>
    </main>
  );
}
