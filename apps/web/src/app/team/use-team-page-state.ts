"use client";

import { useState } from "react";
import type { TeamMemberRow } from "../../lib/team-view";

interface TemporaryCredential {
  name: string;
  email: string;
  password: string;
}

export function useTeamPageState() {
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("cashier");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [temporaryCredential, setTemporaryCredential] = useState<TemporaryCredential | null>(null);
  const [copyStatus, setCopyStatus] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<TeamMemberRow | null>(null);
  const [pinTarget, setPinTarget] = useState<TeamMemberRow | null>(null);
  const [approvalPin, setApprovalPin] = useState("");
  const [approvalPinConfirm, setApprovalPinConfirm] = useState("");

  return {
    createOpen, setCreateOpen, name, setName, email, setEmail, role, setRole,
    busy, setBusy, error, setError, success, setSuccess,
    temporaryCredential, setTemporaryCredential, copyStatus, setCopyStatus,
    deactivateTarget, setDeactivateTarget, pinTarget, setPinTarget,
    approvalPin, setApprovalPin, approvalPinConfirm, setApprovalPinConfirm,
  };
}
