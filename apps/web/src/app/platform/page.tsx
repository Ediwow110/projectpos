"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { ApiError, apiFetch } from "../../lib/api";

interface Csrf {
  csrfToken: string;
}

export default function PlatformPage(): JSX.Element {
  const [platformKey, setPlatformKey] = useState("");
  const [businessId, setBusinessId] = useState("");
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
