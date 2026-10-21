export interface AtlasAdminDestination {
  href: string;
  title: string;
  description: string;
  icon: string;
}

const OWNER: readonly AtlasAdminDestination[] = [
  { href: "/admin/owner-controls", title: "Owner controls", description: "Review financial policies, sensitive requests, and account safeguards.", icon: "◆" },
  { href: "/team", title: "Team & permissions", description: "Manage employees, role access, branch and register assignments.", icon: "◎" },
  { href: "/branches", title: "Branches & registers", description: "Maintain business locations and the registers assigned to them.", icon: "⌘" },
  { href: "/customer-concerns", title: "Approval inbox", description: "Review authorized customer concerns and pending manager actions.", icon: "✓" },
  { href: "/admin/support", title: "Guest support & consent", description: "Grant narrowly scoped access for verified customer support cases.", icon: "?" },
  { href: "/devices", title: "Devices", description: "Register, review and revoke trusted point-of-sale workstations.", icon: "▦" },
  { href: "/printers", title: "Printers", description: "Manage receipt-printer defaults and print queues.", icon: "▧" },
  { href: "/admin/loyalty", title: "Loyalty settings", description: "Review earning and redemption policies.", icon: "✦" },
  { href: "/admin/online-ordering", title: "Online ordering", description: "Manage storefront and fulfillment settings.", icon: "◫" },
  { href: "/reports/ledger", title: "Ledger export", description: "Download the accounting journal for a chosen date range.", icon: "▤" },
  { href: "/reports/stored-value", title: "Stored-value liability", description: "Review outstanding gift-card, store-credit and loyalty liability.", icon: "▦" },
  { href: "/admin/api-tokens", title: "API credentials", description: "Issue and revoke public API tokens and see what each one can reach.", icon: "⚿" },
  { href: "/businesses", title: "Business workspaces", description: "Switch the business this session works in when you belong to more than one.", icon: "◈" },
];

const MANAGER: readonly AtlasAdminDestination[] = [
  { href: "/customer-concerns", title: "Approval inbox", description: "Review sensitive operations requiring a manager decision.", icon: "✓" },
  { href: "/exceptions", title: "Exception center", description: "Investigate unresolved operational exceptions.", icon: "⚑" },
  { href: "/sales", title: "Sales & refunds", description: "Find recorded transactions and review available refund actions.", icon: "↗" },
  { href: "/inventory", title: "Stock operations", description: "Review inventory, counts and stock adjustments.", icon: "□" },
  { href: "/purchase-orders", title: "Procurement", description: "Review and receive purchase orders within granted permissions.", icon: "▱" },
  { href: "/shifts", title: "Shifts", description: "Review tills and reconcile authorized shift closings.", icon: "▤" },
  { href: "/reports/sales", title: "Reports", description: "Investigate sales and operational performance.", icon: "▥" },
  { href: "/devices", title: "Devices", description: "Review available workstation and device controls.", icon: "▦" },
  { href: "/reports/ledger", title: "Ledger export", description: "Download the accounting journal for a chosen date range.", icon: "▤" },
  { href: "/reports/stored-value", title: "Stored-value liability", description: "Review outstanding gift-card, store-credit and loyalty liability.", icon: "▧" },
  { href: "/admin/api-tokens", title: "API credentials", description: "Issue and revoke public API tokens and see what each one can reach.", icon: "⚿" },
  { href: "/businesses", title: "Business workspaces", description: "Switch the business this session works in when you belong to more than one.", icon: "◈" },
];

/** Navigation offers likely workflows, never permission grants; API remains authoritative. */
export function atlasAdminDestinationsForRole(role: string): readonly AtlasAdminDestination[] {
  if (role === "owner") return OWNER;
  if (role === "manager") return MANAGER;
  return [];
}
