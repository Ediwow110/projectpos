"use client";

import type { JSX } from "react";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "../../lib/api";
import { money } from "../../lib/reports";

interface Feed {
  businessName: string;
  shiftStatus: "OPEN" | "CLOSED" | "NONE";
  lastSale: { id: string; receiptNo: string; totalMinor: number; createdAt: string } | null;
}

function moneyMinor(minor: number): string {
  return money(minor);
}

export default function DisplayPage(): JSX.Element {
  const params = useSearchParams();
  const registerId = params.get("registerId") ?? "";
  const token = params.get("token") ?? "";
  const businessId = params.get("businessId") ?? "";
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!registerId || !token || !businessId) {
      setError("This display link is incomplete.");
      return;
    }
    let alive = true;
    const load = async (): Promise<void> => {
      try {
        const next = await apiFetch<Feed>(
          `/api/v1/display/${registerId}?token=${encodeURIComponent(token)}&businessId=${encodeURIComponent(businessId)}`,
        );
        if (alive) {
          setFeed(next);
          setError("");
        }
      } catch {
        if (alive) setError("Display unavailable. Check the link or register a new display token.");
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [registerId, token, businessId]);

  return (
    <main>
      <h1>{feed?.businessName ?? "Customer display"}</h1>
      {error !== "" && <p role="alert">{error}</p>}
      {feed && (
        <section aria-label="Register status">
          <p>
            Shift: <span style={{ fontVariantNumeric: "tabular-nums" }}>{feed.shiftStatus}</span>
          </p>
          {feed.lastSale ? (
            <p>
              Last sale {feed.lastSale.receiptNo}:{" "}
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{moneyMinor(feed.lastSale.totalMinor)}</span>
            </p>
          ) : (
            <p>Welcome! No sales yet on this register.</p>
          )}
        </section>
      )}
    </main>
  );
}
