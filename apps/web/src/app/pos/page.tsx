"use client";

import type { JSX } from "react";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, apiFetch } from "../../lib/api";
import { buildProductSearch } from "../../lib/catalog";
import { buildCompletePayload, cartTotal } from "../../lib/sales";

interface Me {
  role: string;
}

interface Csrf {
  csrfToken: string;
}

interface ProductRow {
  id: string;
  name: string;
  sku: string | null;
  priceMinor: number;
  isActive: boolean;
}

interface SearchResult {
  items: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface CartEntry {
  productId: string;
  name: string;
  priceMinor: number;
  qty: number;
}

interface PaymentRow {
  method: string;
  amountMinor: number;
}

const METHODS = ["cash", "card", "gcash", "maya", "bank_transfer", "other"];

function money(minor: number): string {
  return (minor / 100).toFixed(2);
}

export default function PosPage(): JSX.Element {
  const [q, setQ] = useState("");
  const [cart, setCart] = useState<CartEntry[]>([]);
  const [method, setMethod] = useState("cash");
  const [received, setReceived] = useState("");
  const [status, setStatus] = useState("");
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [reconcileId, setReconcileId] = useState<string | null>(null);
  const [registerId, setRegisterId] = useState("");
  const [customerQ, setCustomerQ] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [walkIn, setWalkIn] = useState("");

  const meQuery = useQuery({ queryKey: ["me"], queryFn: () => apiFetch<Me>("/api/v1/me"), retry: false });
  const customersQuery = useQuery({
    queryKey: ["pos-customers", customerQ],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; phone: string | null }> }>(
      "/api/v1/customers?" + new URLSearchParams({ q: customerQ, active: "true", page: "1", pageSize: "10" }).toString(),
    ),
    retry: false,
  });
  const registersQuery = useQuery({
    queryKey: ["pos-registers"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; isActive: boolean }> }>("/api/v1/registers"),
    retry: false,
  });
  const searchQuery = useQuery({
    queryKey: ["pos-products", q],
    queryFn: () => apiFetch<SearchResult>(buildProductSearch({ q, active: "true", page: 1, pageSize: 20 })),
    retry: false,
  });

  const role = meQuery.data?.role ?? "cashier";
  const canSell = role === "owner" || role === "manager" || role === "cashier";
  const due = cartTotal(cart.map((c) => ({ qty: c.qty, priceMinor: c.priceMinor, lineDiscountMinor: 0 })));

  function addToCart(p: ProductRow): void {
    setCart((prev) => {
      const found = prev.find((c) => c.productId === p.id);
      if (found) return prev.map((c) => (c.productId === p.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { productId: p.id, name: p.name, priceMinor: p.priceMinor, qty: 1 }];
    });
  }

  function setQty(productId: string, delta: number): void {
    setCart((prev) =>
      prev
        .map((c) => (c.productId === productId ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0),
    );
  }

  async function holdCart(): Promise<void> {
    setStatus("");
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const draft = await apiFetch<{ id: string }>("/api/v1/sales/drafts", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            lines: cart.map((c) => ({ productId: c.productId, qty: c.qty })),
            ...(registerId !== "" ? { registerId } : {}),
            ...(customerId !== "" ? { customerId } : {}),
            ...(customerId === "" && walkIn.trim() !== "" ? { customerName: walkIn.trim() } : {}),
          }),
        },
      });
      await apiFetch("/api/v1/sales/" + draft.id + "/hold", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({}) },
      });
      setCart([]);
      setStatus("Cart held. Resume it from the held sale " + draft.id + ".");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Hold failed");
    }
  }

  async function pay(): Promise<void> {
    setStatus("");
    setReceiptId(null);
    setReconcileId(null);
    if (cart.length === 0) {
      setStatus("Cart is empty.");
      return;
    }
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const draft = await apiFetch<{ id: string; totalMinor: number }>("/api/v1/sales/drafts", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          body: JSON.stringify({
            lines: cart.map((c) => ({ productId: c.productId, qty: c.qty })),
            ...(registerId !== "" ? { registerId } : {}),
            ...(customerId !== "" ? { customerId } : {}),
            ...(customerId === "" && walkIn.trim() !== "" ? { customerName: walkIn.trim() } : {}),
          }),
        },
      });
      const total = draft.totalMinor;
      const tendered = received.trim() === "" ? total : Math.round(Number(received) * 100);
      const payments: PaymentRow[] =
        method === "cash" && tendered >= total
          ? [{ method, amountMinor: tendered }]
          : [{ method, amountMinor: total }];
      const key = crypto.randomUUID();
      const payload = buildCompletePayload(draft.id, payments, key);
      const done = await apiFetch<{ id: string; status: string; payments: Array<{ id: string }> }>(
        "/api/v1/sales/complete",
        {
          csrfToken: csrf.csrfToken,
          init: {
            method: "POST",
            body: JSON.stringify(registerId !== "" ? { ...payload, registerId } : payload),
            headers: { "Idempotency-Key": key },
          },
        },
      );
      if (done.status === "PAYMENT_UNKNOWN") {
        setReconcileId(done.payments[0]?.id ?? null);
        setStatus("Payment status unknown. Do not retry blindly — reconcile payment " + (done.payments[0]?.id ?? "") + " when the provider responds.");
        return;
      }
      setCart([]);
      setReceived("");
      setReceiptId(done.id);
      setStatus("Sale completed.");
    } catch (err) {
      setStatus(err instanceof ApiError ? err.code + ": " + err.message : "Payment failed");
    }
  }

  return (
    <main>
      <Link href="/">Back to dashboard</Link>
      <h1>Point of sale</h1>
      {!canSell && <p role="alert">Your role cannot complete sales.</p>}
      <label>
        Register
        <select value={registerId} onChange={(e) => setRegisterId(e.target.value)}>
          <option value="">No register (cash will not post to a shift)</option>
          {(registersQuery.data?.items ?? [])
            .filter((r) => r.isActive)
            .map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
        </select>
      </label>
      <label>
        Customer
        <input
          value={customerQ}
          onChange={(e) => {
            setCustomerQ(e.target.value);
            setCustomerId("");
          }}
          placeholder="Search customers"
        />
      </label>
      {customerQ.trim() !== "" && (
        <ul>
          {(customersQuery.data?.items ?? []).map((c) => (
            <li key={c.id}>
              <button onClick={() => { setCustomerId(c.id); setCustomerQ(c.name); setWalkIn(""); }}>
                {c.name}{c.phone ? " — " + c.phone : ""}
              </button>
            </li>
          ))}
        </ul>
      )}
      <label>
        Walk-in name (used when no customer selected)
        <input
          value={walkIn}
          onChange={(e) => {
            setWalkIn(e.target.value);
            if (e.target.value.trim() !== "") setCustomerId("");
          }}
          placeholder="Optional"
        />
      </label>
      {customerId !== "" && (
        <button onClick={() => { setCustomerId(""); setCustomerQ(""); }}>Clear customer</button>
      )}
      {status.includes("SHIFT_NO_OPEN_SHIFT") && (
        <p role="alert">
          No open shift on this register. <Link href="/shifts">Open a shift</Link> first.
        </p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: "1rem" }}>
        <section aria-label="Products">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void searchQuery.refetch();
            }}
          >
            <label>
              Search or scan
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Name, SKU, or exact barcode"
                autoFocus
              />
            </label>
            <button type="submit">Search</button>
          </form>
          {searchQuery.isLoading && <p>Loading products…</p>}
          {searchQuery.data && (
            <ul>
              {searchQuery.data.items.map((p) => (
                <li key={p.id}>
                  <button onClick={() => addToCart(p)}>
                    {p.name} — {money(p.priceMinor)}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {searchQuery.data?.items.length === 0 && <p>No products found.</p>}
        </section>
        <section aria-label="Cart">
          <h2>Cart</h2>
          {cart.length === 0 && <p>Cart is empty. Select products to begin.</p>}
          <ul>
            {cart.map((c) => (
              <li key={c.productId}>
                {c.name} × {c.qty} — <span style={{ fontVariantNumeric: "tabular-nums" }}>{money(c.qty * c.priceMinor)}</span>{" "}
                <button onClick={() => setQty(c.productId, 1)} aria-label={"Increase " + c.name}>+</button>
                <button onClick={() => setQty(c.productId, -1)} aria-label={"Decrease " + c.name}>−</button>
              </li>
            ))}
          </ul>
          <p>
            Total due: <strong style={{ fontVariantNumeric: "tabular-nums" }}>{money(due)}</strong>
          </p>
          <label>
            Method
            <select value={method} onChange={(e) => setMethod(e.target.value)}>
              {METHODS.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label>
            Amount received (cash)
            <input
              value={received}
              onChange={(e) => setReceived(e.target.value)}
              placeholder={money(due)}
              inputMode="decimal"
            />
          </label>
          <div>
            <button onClick={() => void pay()} disabled={!canSell || cart.length === 0}>
              Pay
            </button>
            <button onClick={() => void holdCart()} disabled={cart.length === 0}>
              Hold cart
            </button>
          </div>
        </section>
      </div>
      {status !== "" && <p role={status.includes("unknown") ? "alert" : "status"}>{status}</p>}
      {receiptId && <Link href={"/receipts/" + receiptId}>View receipt</Link>}
      {reconcileId && <p>Reconcile from the sale record once the provider confirms.</p>}
    </main>
  );
}
