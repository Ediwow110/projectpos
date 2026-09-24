"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

interface Csrf {
  csrfToken: string;
}

const PLAN_KEYS = ["free", "basic", "pro", "enterprise"];

export default function PlatformPage(): JSX.Element {
  const [platformKey, setPlatformKey] = useState("");
  const [businessId, setBusinessId] = useState("");
  const [planKey, setPlanKey] = useState("pro");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [flagKey, setFlagKey] = useState("");
  const [flagEnabled, setFlagEnabled] = useState(true);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  function headers(): Record<string, string> {
    return { "x-platform-key": platformKey };
  }

  async function call<T>(path: string, method: string, body: unknown): Promise<T> {
    const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
    return apiFetch<T>(path, {
      csrfToken: csrf.csrfToken,
      init: { method, body: JSON.stringify(body), headers: headers() },
    });
  }

  async function changePlan(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setStatus("");
    try {
      const out = await call<{ key: string }>(`/api/v1/platform/businesses/${businessId}/plan`, "PATCH", { planKey });
      setStatus(`Plan changed to ${out.key}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Plan change failed");
    }
  }

  async function issueInvoice(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setStatus("");
    try {
      const out = await call<{ id: string; amountMinor: number }>(`/api/v1/platform/invoices/issue`, "POST", {
        businessId,
        periodStart,
        periodEnd,
      });
      setStatus(`Invoice issued: ${out.id}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Invoice issue failed");
    }
  }

  async function setFlag(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setError("");
    setStatus("");
    try {
      await call(`/api/v1/platform/businesses/${businessId}/flags`, "PATCH", {
        key: flagKey,
        enabled: flagEnabled,
      });
      setStatus(`Flag ${flagKey} set to ${flagEnabled}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.code + ": " + err.message : "Flag update failed");
    }
  }

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Platform operations</h1>
      <p>Operator key is kept in memory for this page only and never stored.</p>
      <label>
        Platform key
        <input
          type="password"
          value={platformKey}
          onChange={(e) => setPlatformKey(e.target.value)}
          placeholder="Required for every action below"
        />
      </label>
      <label>
        Business ID
        <input value={businessId} onChange={(e) => setBusinessId(e.target.value)} placeholder="Target business" />
      </label>
      <section aria-label="Change plan">
        <h2>Change plan</h2>
        <form onSubmit={(e) => void changePlan(e)}>
          <label>
            Plan
            <select value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
              {PLAN_KEYS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <button type="submit">Change plan</button>
        </form>
      </section>
      <section aria-label="Issue invoice">
        <h2>Issue invoice</h2>
        <form onSubmit={(e) => void issueInvoice(e)}>
          <label>
            Period start (ISO)
            <input value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} placeholder="2026-09-01T00:00:00.000Z" />
          </label>
          <label>
            Period end (ISO)
            <input value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder="2026-10-01T00:00:00.000Z" />
          </label>
          <button type="submit">Issue invoice</button>
        </form>
      </section>
      <section aria-label="Feature flag">
        <h2>Feature flag override</h2>
        <form onSubmit={(e) => void setFlag(e)}>
          <label>
            Flag key
            <input value={flagKey} onChange={(e) => setFlagKey(e.target.value)} placeholder="reports" />
          </label>
          <label>
            Enabled
            <input type="checkbox" checked={flagEnabled} onChange={(e) => setFlagEnabled(e.target.checked)} />
          </label>
          <button type="submit">Set flag</button>
        </form>
      </section>
      {status !== "" && <p role="status">{status}</p>}
      {error !== "" && <p role="alert">{error}</p>}
    </main>
  );
}
