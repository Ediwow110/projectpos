export const BUSINESS_ADMIN_DESTINATIONS = [
  { href: "/admin/owner-controls", title: "Owner controls", description: "Review staff access, branches, account security and sensitive-action safeguards.", icon: "◆", ownerOnly: true },
  { href: "/team", title: "Team", description: "Add staff, review roles, and deactivate access.", icon: "◎", ownerOnly: true },
  { href: "/devices", title: "Devices", description: "Register, review, and revoke trusted tills or workstations.", icon: "▦", ownerOnly: false },
  { href: "/branches", title: "Branches", description: "Manage the store locations used by operational records.", icon: "⌘", ownerOnly: false },
  { href: "/registers", title: "Registers", description: "Maintain the registers used for shifts and selling.", icon: "▣", ownerOnly: false },
  { href: "/printers", title: "Printers", description: "Pair receipt printers, choose defaults, test output, and review print queues.", icon: "▧", ownerOnly: false },
  { href: "/admin/loyalty", title: "Loyalty settings", description: "Configure earn and redeem rules for the customer loyalty program.", icon: "✦", ownerOnly: false },
] as const;

export function businessAdminDestinationsForRole(role: string) {
  if (role === "owner") return BUSINESS_ADMIN_DESTINATIONS;
  if (role === "manager") return BUSINESS_ADMIN_DESTINATIONS.filter((item) => !item.ownerOnly);
  return [];
}
