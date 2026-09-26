"use client";

import type { JSX, ReactNode } from "react";
import { Modal } from "./Modal";
import { DangerButton, GhostButton, PrimaryButton } from "./ui";

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = "danger",
  busy = false,
  details,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "danger" | "primary";
  busy?: boolean;
  details?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}): JSX.Element {
  const ConfirmButton = tone === "danger" ? DangerButton : PrimaryButton;
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <GhostButton type="button" onClick={onCancel} disabled={busy}>Cancel</GhostButton>
          <ConfirmButton type="button" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : confirmLabel}
          </ConfirmButton>
        </div>
      }
    >
      {details ? <div className="rounded-xl border border-[#eee4db] bg-white p-4 text-sm text-[#655b53]">{details}</div> : null}
    </Modal>
  );
}
