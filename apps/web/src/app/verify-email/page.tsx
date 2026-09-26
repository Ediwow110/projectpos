"use client";

import type { JSX } from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, apiFetch } from "../../lib/api";

export default function VerifyEmailPage(): JSX.Element {
  const router = useRouter();
  const started = useRef(false);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("Check your inbox for a verification link.");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  useEffect(() => {
    const remembered = window.sessionStorage.getItem("nexpos-verification-email") ?? "";
    setEmail(remembered);
    const token = new URLSearchParams(window.location.search).get("token");
    if (!token || started.current) return;
    started.current = true;
    setMessage("Verifying your email…");
    void apiFetch<{ verified: true }>("/api/v1/auth/verify-email", {
      init: { method: "POST", body: JSON.stringify({ token }) },
    })
      .then(() => {
        window.sessionStorage.removeItem("nexpos-verification-email");
        setVerified(true);
        setMessage("Email verified. Your NexPOS account is ready.");
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Verification failed");
        setMessage("");
      });
  }, []);

  async function resend(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    try {
      const result = await apiFetch<{ message: string }>("/api/v1/auth/verify-email/resend", {
        init: { method: "POST", body: JSON.stringify({ email }) },
      });
      window.sessionStorage.setItem("nexpos-verification-email", email);
      setMessage(result.message);
    } catch (err) {
      setError(err instanceof ApiError ? `${err.code}: ${err.message}` : "Could not resend verification email");
    }
  }

  return (
    <main className="min-h-screen bg-[#fcf8f3] px-5 py-12 text-[#211814]">
      <section className="mx-auto max-w-xl rounded-[24px] border border-[#eadfd6] bg-white p-7 shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#f35d3f]">NexPOS account</p>
        <h1 className="mt-2 text-3xl font-semibold">Verify your email</h1>
        {message && <p className="mt-4 text-sm leading-6 text-[#6f625b]">{message}</p>}
        {error && <p className="mt-5 rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#9d2f1e]" role="alert">{error}</p>}

        {verified ? (
          <button className="mt-7 rounded-xl bg-[#f35d3f] px-5 py-3 font-semibold text-[#211814]" onClick={() => router.push("/onboarding")}>
            Continue to onboarding
          </button>
        ) : (
          <form onSubmit={resend} className="mt-7 space-y-4">
            <label className="block text-sm font-medium">
              Email
              <input
                className="mt-2 w-full rounded-xl border border-[#ded3ca] px-4 py-3 outline-none focus:border-[#f35d3f]"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </label>
            <button className="rounded-xl border border-[#f35d3f] px-5 py-3 font-semibold text-[#b94029]" type="submit">Resend verification email</button>
          </form>
        )}
      </section>
    </main>
  );
}
