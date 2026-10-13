"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Panel, SectionHeader } from "./premium";
import { GhostButton } from "./ui";
import { apiFetch } from "../lib/api";

interface OwnerAuditEvent {
  at: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string;
}

export function OwnerActivityLog(): React.JSX.Element {
  const [draftAction, setDraftAction] = useState("");
  const [action, setAction] = useState("");
  const audit = useQuery({
    queryKey: ["owner-audit", action],
    queryFn: () => apiFetch<{ items: OwnerAuditEvent[] }>(
      `/api/v1/owner/audit?limit=50${action ? `&action=${encodeURIComponent(action)}` : ""}`,
    ),
    retry: false,
  });

  return (
    <Panel className="p-5">
      <SectionHeader
        title="Sensitive activity & audit"
        description="The latest 50 business-scoped actions. Sensitive before/after snapshots and credentials are never displayed."
      />
      <form onSubmit={(event) => { event.preventDefault(); setAction(draftAction.trim()); }} className="mt-4 flex flex-wrap items-end gap-2">
        <label className="flex-1 text-sm font-medium text-[#202826]">
          Filter by action
          <input className="field mt-1.5" value={draftAction} maxLength={80}
            placeholder="e.g. member.permissions" onChange={(event) => setDraftAction(event.target.value)} />
        </label>
        <GhostButton type="submit">Filter</GhostButton>
        <GhostButton type="button" onClick={() => { setDraftAction(""); setAction(""); void audit.refetch(); }}>Reset</GhostButton>
      </form>
      {audit.isLoading ? <p role="status" className="mt-4 text-sm text-[#707b75]">Loading audit history…</p> : null}
      {audit.isError ? (
        <div className="mt-4 space-y-2">
          <p role="alert" className="text-sm text-[#b74945]">Audit history could not load.</p>
          <GhostButton type="button" onClick={() => void audit.refetch()}>Try again</GhostButton>
        </div>
      ) : null}
      {audit.data?.items.length === 0 ? <p className="mt-4 text-sm text-[#707b75]">No actions match this filter.</p> : null}
      {audit.data && audit.data.items.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <caption className="sr-only">Recent owner-visible business audit events</caption>
            <thead><tr className="border-b border-[#e5e9e3] text-[#707b75]">
              <th scope="col" className="p-3">When</th>
              <th scope="col" className="p-3">Action</th>
              <th scope="col" className="p-3">Actor</th>
              <th scope="col" className="p-3">Record</th>
            </tr></thead>
            <tbody>{audit.data.items.map((event, index) => (
              <tr key={event.requestId + event.entityId + index} className="border-b border-[#e5e9e3]/80">
                <td className="p-3 text-[#707b75]">{event.at ? new Date(event.at).toLocaleString("en-PH") : "Unknown"}</td>
                <td className="p-3 font-medium text-[#202826]">{event.action}</td>
                <td className="p-3 font-mono text-[11px] text-[#707b75]">{event.actorId}</td>
                <td className="p-3 text-[#707b75]">{event.entityType}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      ) : null}
    </Panel>
  );
}
