"use client";

import type { JSX } from "react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "../../components/AppShell";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { DataTableFrame, MetricCard, PageHeader, Panel, SectionHeader } from "../../components/premium";
import { GhostButton, PrimaryButton, StatusPill } from "../../components/ui";
import { ApiError, apiFetch } from "../../lib/api";
import { deviceStatusLabel, isCurrentDevice, shortDeviceId, type DeviceFleetRow } from "../../lib/device-view";
import { clearActiveSyncScope } from "../../lib/sync-store";

interface Me {
  userId: string;
  role: string;
  businessName?: string;
}

interface Csrf {
  csrfToken: string;
}

export default function DevicesPage(): JSX.Element {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [deviceLabel, setDeviceLabel] = useState("");
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<DeviceFleetRow | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<Me>("/api/v1/me"),
    retry: false,
  });
  const devicesQuery = useQuery({
    queryKey: ["devices"],
    queryFn: () => apiFetch<{ items: DeviceFleetRow[] }>("/api/v1/devices"),
    retry: false,
    enabled: meQuery.data !== undefined,
  });

  useEffect(() => {
    setCurrentDeviceId(window.localStorage.getItem("pos-device-id"));
  }, []);

  async function enrollDevice(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (enrolling) return;
    const label = deviceLabel.trim();
    setStatus("");
    setError("");
    if (!label) {
      setError("Device label is required.");
      return;
    }
    setEnrolling(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      const device = await apiFetch<DeviceFleetRow>("/api/v1/devices", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST", body: JSON.stringify({ label }) },
      });
      window.localStorage.setItem("pos-device-id", device.id);
      setCurrentDeviceId(device.id);
      setDeviceLabel("");
      await devicesQuery.refetch();
      setStatus("This browser is registered. Future sign-ins will bind sessions to this device.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not register this device.");
    } finally {
      setEnrolling(false);
    }
  }

  async function revokeDevice(): Promise<void> {
    const target = revokeTarget;
    if (!target || revoking) return;
    const current = isCurrentDevice(target.id, currentDeviceId);
    setStatus("");
    setError("");
    setRevoking(true);
    try {
      const csrf = await apiFetch<Csrf>("/api/v1/auth/csrf");
      await apiFetch<DeviceFleetRow>("/api/v1/devices/" + target.id + "/revoke", {
        csrfToken: csrf.csrfToken,
        init: {
          method: "POST",
          headers: { "Idempotency-Key": crypto.randomUUID() },
        },
      });
      setRevokeTarget(null);

      if (current) {
        window.localStorage.removeItem("pos-device-id");
        setCurrentDeviceId(null);
        try {
          await apiFetch<Me>("/api/v1/me");
        } catch (err) {
          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            clearActiveSyncScope();
            queryClient.clear();
            router.replace("/login");
            router.refresh();
            return;
          }
          throw err;
        }
      }

      await devicesQuery.refetch();
      setStatus(current
        ? "This device was revoked. This session was not device-bound, so you can continue until you sign out."
        : "Device revoked. Sessions bound to it were ended.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not revoke the device.");
    } finally {
      setRevoking(false);
    }
  }

  const devices = devicesQuery.data?.items ?? [];
  const activeCount = devices.filter((device) => device.revokedAt === null).length;
  const role = meQuery.data?.role ?? "cashier";
  const managerView = role === "owner" || role === "manager";

  return (
    <AppShell businessName={meQuery.data?.businessName} role={role}>
      <main className="mx-auto max-w-[1240px] space-y-5 px-4 pb-10 pt-3 sm:px-6">
        <PageHeader
          eyebrow="Administration / Devices"
          title="Device Fleet"
          description={managerView
            ? "Review registered tills and workstations across this business, and revoke access when a device should no longer be trusted."
            : "Review and manage the devices registered to your account."}
        />

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Device summary">
          <MetricCard label="Visible devices" value={devices.length} icon="▦" meta={managerView ? "Business fleet" : "Your devices"} />
          <MetricCard label="Active" value={activeCount} icon="✓" tone="success" meta="Can be used for sign-in" />
          <MetricCard label="Revoked" value={devices.length - activeCount} icon="×" tone="warning" meta="Cannot be used for sign-in" />
        </section>

        <Panel className="p-5">
          <SectionHeader
            title="Register this browser"
            description="Give this browser a recognizable till or workstation label. A future sign-in from this browser will bind the session to the registered device."
          />
          <form noValidate onSubmit={(event) => void enrollDevice(event)} className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-[11px] font-semibold text-[#655b53]">
              Device label
              <input
                value={deviceLabel}
                onChange={(event) => setDeviceLabel(event.target.value)}
                placeholder="Till 1"
                className="field mt-1.5"
                aria-invalid={error === "Device label is required." ? true : undefined}
              />
            </label>
            <PrimaryButton type="submit" disabled={enrolling} aria-busy={enrolling} className="self-end">
              {enrolling ? "Registering…" : "Register this device"}
            </PrimaryButton>
          </form>
        </Panel>

        {status ? <p role="status" className="rounded-xl border border-[#b9dfca] bg-[#f0faf5] px-4 py-3 text-sm font-medium text-[#1f6f4b]">{status}</p> : null}
        {error ? <p role="alert" className="rounded-xl border border-[#efb9b9] bg-[#fff0f0] px-4 py-3 text-sm font-medium text-[#c43e3e]">{error}</p> : null}

        <DataTableFrame>
          <div className="px-5 py-4">
            <SectionHeader
              title="Registered devices"
              description={managerView
                ? "Owners and managers see the business fleet. Activity or online status is not shown because the API does not provide it."
                : "You only see devices the server authorizes for your account."}
            />
          </div>
          {devicesQuery.isLoading ? <p className="px-5 pb-6 text-sm text-[#73685f]">Loading devices…</p> : null}
          {devicesQuery.isError ? <p role="alert" className="px-5 pb-6 text-sm text-[#c43e3e]">Could not load registered devices.</p> : null}
          {!devicesQuery.isLoading && !devicesQuery.isError && devices.length === 0 ? (
            <p className="px-5 pb-8 text-sm text-[var(--color-atlas-muted-strong)]">No devices are registered yet.</p>
          ) : null}
          {devices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="premium-table min-w-[720px] text-left text-[12px]">
                <thead>
                  <tr>
                    <th className="px-5 pb-3">Device</th>
                    <th className="px-5 pb-3">Owner</th>
                    <th className="px-5 pb-3">Status</th>
                    <th className="px-5 pb-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((device) => {
                    const current = isCurrentDevice(device.id, currentDeviceId);
                    const revoked = device.revokedAt !== null;
                    return (
                      <tr key={device.id}>
                        <td className="px-5 py-3">
                          <p className="font-semibold text-[#2a241f]">{device.label}</p>
                          <p className="font-data mt-1 text-[9px] text-[var(--color-atlas-muted-strong)]">{shortDeviceId(device.id)}</p>
                          {current ? <span className="mt-1 inline-block text-[10px] font-semibold text-[var(--color-atlas-accent-strong)]">This device</span> : null}
                        </td>
                        <td className="px-5 py-3 text-[#655b53]">{device.userId === meQuery.data?.userId ? "You" : "Team member"}</td>
                        <td className="px-5 py-3">
                          <StatusPill tone={revoked ? "warn" : "ok"}>{deviceStatusLabel(device.revokedAt)}</StatusPill>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {revoked ? (
                            <span className="text-[10px] font-medium text-[var(--color-atlas-muted-strong)]">No action</span>
                          ) : (
                            <GhostButton
                              type="button"
                              className="!min-h-8 !px-3 !py-1.5 text-xs"
                              aria-label={"Revoke " + device.label}
                              onClick={() => setRevokeTarget(device)}
                            >
                              Revoke
                            </GhostButton>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </DataTableFrame>
      </main>

      <ConfirmDialog
        open={revokeTarget !== null}
        title="Revoke device?"
        description="Revoking this device ends sessions bound to it. If this is the current device, you may need to sign in again."
        confirmLabel="Revoke device"
        busy={revoking}
        onCancel={() => setRevokeTarget(null)}
        onConfirm={() => void revokeDevice()}
        details={revokeTarget ? <span>{revokeTarget.label} · {shortDeviceId(revokeTarget.id)}</span> : undefined}
      />
    </AppShell>
  );
}
