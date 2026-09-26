export function syncStatusPresentation(status: string): {
  label: string;
  tone: "ok" | "warn" | "bad" | "info";
  final: boolean;
} {
  switch (status) {
    case "SYNCED":
      return { label: "Synced", tone: "ok", final: true };
    case "RESOLVED":
      return { label: "Resolved", tone: "ok", final: true };
    case "CONFLICT":
      return { label: "Conflict", tone: "bad", final: false };
    case "SENDING":
      return { label: "Syncing", tone: "warn", final: false };
    case "FAILED":
      return { label: "Retry needed", tone: "warn", final: false };
    case "QUEUED":
      return { label: "Queued", tone: "info", final: false };
    default:
      return { label: status.replaceAll("_", " "), tone: "info", final: false };
  }
}
