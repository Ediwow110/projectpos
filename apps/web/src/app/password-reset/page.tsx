"use client";

import type { JSX } from "react";

import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

export default function PasswordResetPage(): JSX.Element {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get("token");
    if (fromLink) setToken(fromLink);
  }, []);

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
    <main className="min-h-screen bg-[#fcf8f3] px-5 py-12 text-[#211814]">
      <section className="mx-auto max-w-xl rounded-[24px] border border-[#eadfd6] bg-white p-7 shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f35d3f]">NexPOS security</p>
        <h1 className="mt-2 text-3xl font-semibold">Reset password</h1>
        <p className="mt-3 text-sm leading-6 text-[#6f625b]">Request a secure reset link, or set a new password if you arrived from your email.</p>

        {!token && (
          <form onSubmit={requestReset} className="mt-7 space-y-4">
            <label className="block text-sm font-medium">
              Email
              <input className="mt-2 w-full rounded-xl border border-[#ded3ca] px-4 py-3 outline-none focus:border-[#f35d3f]" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </label>
            <button className="rounded-xl bg-[#f35d3f] px-5 py-3 font-semibold text-[#211814]" type="submit">Send reset link</button>
          </form>
        )}

        {token && (
          <form onSubmit={confirmReset} className="mt-7 space-y-4">
            <label className="block text-sm font-medium">
              New password (12+ characters)
              <input
                className="mt-2 w-full rounded-xl border border-[#ded3ca] px-4 py-3 outline-none focus:border-[#f35d3f]"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={12}
                autoComplete="new-password"
              />
            </label>
            <button className="rounded-xl bg-[#f35d3f] px-5 py-3 font-semibold text-[#211814]" type="submit">Set new password</button>
          </form>
        )}

        {message && <p className="mt-5 rounded-xl bg-[#f5f0ea] px-4 py-3 text-sm">{message}</p>}
        {error && <p className="mt-5 rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#9d2f1e]" role="alert">{error}</p>}
      </section>
    </main>
  );
}
