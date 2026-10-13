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
  const [roleTarget, setRoleTarget] = useState<TeamMemberRow | null>(null);
  const [nextRole, setNextRole] = useState<"manager" | "cashier" | "inventory">("cashier");
  const [roleConfirmation, setRoleConfirmation] = useState("");
  const [permissionTarget, setPermissionTarget] = useState<TeamMemberRow | null>(null);
  const [permissionOptions, setPermissionOptions] = useState<string[]>([]);
  const [deniedPermissions, setDeniedPermissions] = useState<string[]>([]);
  const [permissionConfirmation, setPermissionConfirmation] = useState("");
  const [permissionLoading, setPermissionLoading] = useState(false);
  const [approvalPin, setApprovalPin] = useState("");
  const [approvalPinConfirm, setApprovalPinConfirm] = useState("");

  return {
    createOpen, setCreateOpen, name, setName, email, setEmail, role, setRole,
    busy, setBusy, error, setError, success, setSuccess,
    temporaryCredential, setTemporaryCredential, copyStatus, setCopyStatus,
    deactivateTarget, setDeactivateTarget, pinTarget, setPinTarget,
    roleTarget, setRoleTarget, nextRole, setNextRole, roleConfirmation, setRoleConfirmation,
    permissionTarget, setPermissionTarget, permissionOptions, setPermissionOptions,
    deniedPermissions, setDeniedPermissions, permissionConfirmation, setPermissionConfirmation,
    permissionLoading, setPermissionLoading,
    approvalPin, setApprovalPin, approvalPinConfirm, setApprovalPinConfirm,
  };
}
