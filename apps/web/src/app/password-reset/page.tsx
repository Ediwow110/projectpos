"use client";

import type { JSX } from "react";

import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

export default function PasswordResetPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function requestReset(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    try {
      const res = await apiFetch<{ message: string }>("/api/v1/auth/password-reset/request", {
        init: { method: "POST", body: JSON.stringify({ email }) },
      });
      setMessage(res.message);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Request failed");
    }
  }

  async function confirmReset(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    try {
      await apiFetch("/api/v1/auth/password-reset/confirm", {
        init: { method: "POST", body: JSON.stringify({ token, newPassword }) },
      });
      setMessage("Password updated. You can sign in now.");
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Reset failed");
    }
  }

  return (
    <main>
      <h1>Reset password</h1>
      <form onSubmit={requestReset}>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit">Send reset link</button>
      </form>
      <form onSubmit={confirmReset}>
        <label>
          Reset token
          <input value={token} onChange={(e) => setToken(e.target.value)} required />
        </label>
        <label>
          New password (12+ characters)
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
            minLength={12}
          />
        </label>
        <button type="submit">Set new password</button>
      </form>
      {message && <p>{message}</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
