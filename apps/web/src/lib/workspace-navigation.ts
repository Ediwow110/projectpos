export interface WorkspaceNavigationItem {
  href: string;
  label: string;
  icon: string;
  tour: string;
}

export interface WorkspaceNavigationGroup {
  label: string;
  items: WorkspaceNavigationItem[];
}

const ITEMS = {
  dashboard: { href: "/", label: "Dashboard", icon: "⌂", tour: "dashboard" },
  pos: { href: "/pos", label: "POS", icon: "▣", tour: "pos" },
  sales: { href: "/sales", label: "Sales", icon: "↗", tour: "sales" },
  customers: { href: "/customers", label: "Customers", icon: "○", tour: "customers" },
  products: { href: "/products", label: "Products", icon: "◇", tour: "products" },
  categories: { href: "/categories", label: "Categories", icon: "◈", tour: "categories" },
  inventory: { href: "/inventory", label: "Inventory", icon: "□", tour: "inventory" },
  stockCounts: { href: "/inventory/counts", label: "Stock Counts", icon: "#", tour: "stock-counts" },
  replenishment: { href: "/inventory/replenishment", label: "Replenishment", icon: "↟", tour: "replenishment" },
  registers: { href: "/registers", label: "Registers", icon: "▦", tour: "registers" },
  shifts: { href: "/shifts", label: "Shifts", icon: "▤", tour: "shifts" },
  transfers: { href: "/transfers", label: "Transfers", icon: "⇄", tour: "transfers" },
  expenses: { href: "/expenses", label: "Expenses", icon: "−", tour: "expenses" },
  reports: { href: "/reports/sales", label: "Reports", icon: "▥", tour: "reports" },
  branches: { href: "/branches", label: "Branches", icon: "⌘", tour: "branches" },
  sync: { href: "/sync", label: "Sync", icon: "↻", tour: "sync" },
  team: { href: "/team", label: "Team", icon: "◎", tour: "team" },
  devices: { href: "/devices", label: "Devices", icon: "▦", tour: "devices" },
  printers: { href: "/printers", label: "Printers", icon: "▧", tour: "printers" },
  admin: { href: "/admin", label: "Administration / Help", icon: "?", tour: "admin" },
  suppliers: { href: "/suppliers", label: "Suppliers", icon: "⌁", tour: "suppliers" },
  purchaseOrders: { href: "/purchase-orders", label: "Purchase Orders", icon: "▱", tour: "purchase-orders" },
  supplierReturns: { href: "/supplier-returns", label: "Supplier Returns", icon: "↩", tour: "supplier-returns" },
} as const satisfies Record<string, WorkspaceNavigationItem>;

function group(label: string, keys: Array<keyof typeof ITEMS>): WorkspaceNavigationGroup {
  return { label, items: keys.map((key) => ITEMS[key]) };
}

export function workspaceNavigationForRole(role?: string): WorkspaceNavigationGroup[] {
  if (role === "cashier") {
    return [
      group("Sell", ["dashboard", "pos", "sales", "customers"]),
      group("Operations", ["inventory", "stockCounts", "replenishment", "registers", "shifts", "devices", "sync"]),
    ];
  }
  if (role === "inventory") {
    return [
      group("Catalog & stock", ["dashboard", "products", "categories", "inventory", "stockCounts", "replenishment"]),
      group("Procurement", ["suppliers", "purchaseOrders", "supplierReturns"]),
      group("Operations", ["transfers", "branches", "devices", "sync"]),
      group("Insights", ["reports"]),
    ];
  }
  if (role === "manager") {
    return [
      group("Sell", ["dashboard", "pos", "sales", "customers"]),
      group("Catalog & stock", ["products", "categories", "inventory", "stockCounts", "replenishment"]),
      group("Procurement", ["suppliers", "purchaseOrders", "supplierReturns"]),
      group("Operations", ["registers", "shifts", "transfers", "expenses"]),
      group("Insights", ["reports"]),
      group("Administration", ["branches", "devices", "printers", "sync", "admin"]),
    ];
  }
  return [
    group("Sell", ["dashboard", "pos", "sales", "customers"]),
    group("Catalog & stock", ["products", "categories", "inventory", "stockCounts", "replenishment"]),
    group("Procurement", ["suppliers", "purchaseOrders", "supplierReturns"]),
    group("Operations", ["registers", "shifts", "transfers", "expenses"]),
    group("Insights", ["reports"]),
    group("Administration", ["branches", "devices", "printers", "sync", "team", "admin"]),
  ];
}

export function flattenedWorkspaceNavigation(role?: string): WorkspaceNavigationItem[] {
  return workspaceNavigationForRole(role).flatMap((entry) => entry.items);
}
