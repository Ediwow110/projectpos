"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import { ApiError, apiFetch } from "../lib/api";
import { removeProductImage, uploadProductImage, type ProductMediaCapabilities, type ProductMediaStatus } from "../lib/product-media-client";

const MAX_SIZE = 3 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

async function squareCrop(file: File, zoom: number): Promise<File> {
  const bitmap = await createImageBitmap(file);
  try {
    const cropSide = Math.min(bitmap.width, bitmap.height) / zoom;
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Your browser cannot crop this photo.");
    ctx.drawImage(bitmap,
      (bitmap.width - cropSide) / 2, (bitmap.height - cropSide) / 2,
      cropSide, cropSide, 0, 0, 1024, 1024);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("Could not export cropped photo.")), "image/webp", 0.85);
    });
    return new File([blob], "product-photo.webp", { type: "image/webp" });
  } finally {
    bitmap.close();
  }
}

export function ProductMediaEditor({
  productId, productName, role, imageUrl, onChanged,
}: {
  productId: string;
  productName: string;
  role: string;
  imageUrl: string | null;
  onChanged: (imageUrl: string | null) => void | Promise<void>;
}) {
  const [capabilities, setCapabilities] = useState<ProductMediaCapabilities | null>(null);
  const [status, setStatus] = useState<ProductMediaStatus>({ imageUrl, assetId: null });
  const [source, setSource] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (role !== "owner") return;
    let cancelled = false;
    void apiFetch<ProductMediaCapabilities>("/api/v1/product-media/capabilities").then(async (caps) => {
      if (cancelled) return;
      setCapabilities(caps);
      if (!caps.enabled) return;
      const current = await apiFetch<ProductMediaStatus>(`/api/v1/products/${productId}/image`);
      if (!cancelled) setStatus(current);
    }).catch((cause) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load photo manager.");
    });
    return () => { cancelled = true; };
  }, [productId, role]);

  useEffect(() => {
    if (!source) { setPreview(null); return; }
    const url = URL.createObjectURL(source);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [source]);

  function selectPhoto(file: File | undefined): void {
    setError("");
    setSuccess("");
    if (!file) { setSource(null); return; }
    if (!TYPES.has(file.type) || file.size <= 0 || file.size > MAX_SIZE) {
      setError("Choose a JPEG, PNG or WebP photo smaller than 3 MiB.");
      setSource(null);
      return;
    }
    setSource(file);
    setZoom(1);
  }

  async function csrf(): Promise<string> {
    const response = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
    return response.csrfToken;
  }

  async function upload(): Promise<void> {
    if (!source || busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const cropped = await squareCrop(source, zoom);
      if (cropped.size > MAX_SIZE) throw new Error("The cropped image is too large.");
      const response = await uploadProductImage(productId, cropped, status.assetId, await csrf());
      setStatus(response);
      setSource(null);
      setSuccess("Product photo saved.");
      await onChanged(response.imageUrl);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : cause instanceof Error ? cause.message : "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const response = await removeProductImage(productId, status.assetId, await csrf());
      setStatus(response);
      setSource(null);
      setConfirmRemove(false);
      setSuccess("Product photo removed.");
      await onChanged(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove photo.");
    } finally { setBusy(false); }
  }

  if (role !== "owner") return null;

  const available = capabilities?.enabled === true;
  const shownUrl = preview ?? status.imageUrl ?? imageUrl;
  return (
    <section aria-label="Owner-managed photo" className="space-y-4 rounded-xl border border-[#e5e9e3] bg-white p-5">
      <div>
        <h2 className="font-display text-lg font-semibold text-[#202826]">Product photo</h2>
        <p className="mt-1 text-xs text-[#53615a]">Owner-managed photo — crop, preview, upload, replace or remove.</p>
      </div>
      <div className="flex flex-wrap items-start gap-4">
        <div className="relative grid size-44 shrink-0 place-items-center overflow-hidden rounded-lg bg-[#eff2ed] text-[#53615a]">
          {shownUrl ? <Image unoptimized src={shownUrl} alt={`${productName} photo preview`} fill sizes="176px"
            className="object-cover" style={preview ? { transform: `scale(${zoom})` } : undefined} /> :
            <span className="text-center text-sm">No product photo</span>}
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          {available ? <>
            <label className="block text-sm font-medium text-[#202826]">
              {status.imageUrl ? "Replace photo" : "Upload photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy}
                onChange={(event) => selectPhoto(event.target.files?.[0])}
                className="mt-2 block w-full min-w-0 text-xs file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-[#eff2ed] file:px-3 file:text-[#202826]" />
            </label>
            {source ? <>
              <label className="block text-xs text-[#53615a]">Crop zoom: {zoom.toFixed(1)}×
                <input type="range" aria-label="Crop zoom" min={1} max={2} step={0.1} value={zoom}
                  onChange={(event) => setZoom(Number(event.target.value))}
                  className="mt-1 block w-full accent-[#267552]" />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={busy} onClick={() => void upload()}
                  className="min-h-11 rounded-lg bg-[#202826] px-4 text-xs font-semibold text-white disabled:opacity-40">
                  {busy ? "Saving…" : "Save cropped photo"}
                </button>
                <button type="button" onClick={() => setSource(null)} disabled={busy}
                  className="min-h-11 rounded-lg border border-[#e5e9e3] px-4 text-xs text-[#202826]">Cancel preview</button>
              </div>
            </> : null}
            {status.imageUrl && !source ? (
              confirmRemove ? <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-[#a34132]">Remove this product photo?</span>
                <button type="button" disabled={busy} onClick={() => void remove()}
                  className="min-h-11 rounded-lg bg-[#b84f3c] px-3 text-xs text-white">Yes, remove</button>
                <button type="button" disabled={busy} onClick={() => setConfirmRemove(false)}
                  className="min-h-11 rounded-lg border px-3 text-xs">Cancel</button>
              </div> :
                <button type="button" disabled={busy} onClick={() => setConfirmRemove(true)}
                  className="min-h-11 rounded-lg border border-[#b84f3c] px-3 text-xs font-medium text-[#a34132]">Remove photo</button>
            ) : null}
          </> : <p className="rounded-lg bg-[#f7f8f5] p-3 text-xs text-[#53615a]">Photo uploads are not enabled for this workspace. Existing image URLs remain available in product editing.</p>}
          <p className="text-xs text-[#53615a]">JPEG, PNG or WebP, up to 3 MiB. Cropped to a square. Product sale data is unchanged.</p>
        </div>
      </div>
      {error ? <p role="alert" className="rounded-lg bg-[#fff0eb] p-3 text-xs text-[#a34132]">{error}</p> : null}
      {success ? <p role="status" className="rounded-lg bg-[#eaf7f0] p-3 text-xs text-[#267552]">{success}</p> : null}
    </section>
  );
}
