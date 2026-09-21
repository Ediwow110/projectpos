"use client";

import type { JSX } from "react";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, apiFetch } from "../../lib/api";

export default function RegisterPage(): JSX.Element {
  const router = useRouter();
  const [ownerName, setOwnerName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/auth/register", {
        init: {
          method: "POST",
          body: JSON.stringify({ ownerName, email, password, businessName }),
        },
      });
      router.push("/onboarding");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Registration failed");
    }
  }

  return (
    <main>
      <h1>Create your business</h1>
      <form onSubmit={submit}>
        <label>
          Your name
          <input value={ownerName} onChange={(e) => setOwnerName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password (12+ characters)
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
        </label>
        <label>
          Business name
          <input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            required
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit">Create business</button>
      </form>
    </main>
  );
}
