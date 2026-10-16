"use client";

import React from "react";
import type { JSX, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DecorativeBackdrop } from "./premium";
import { NexposLogo, NexposMark } from "./brand/NexposLogo";
import { ApiError, apiFetch } from "../lib/api";
import { clearActiveSyncScope } from "../lib/sync-store";
import { workspaceMeRetry, workspaceMeRetryDelay } from "../lib/workspace-me-retry";
import {
  workspaceNavigationForRole,
  type WorkspaceNavigationItem,
} from "../lib/workspace-navigation";
import { branchScopeLabel } from "../lib/workspace-branch";
import { GuidedTour } from "./GuidedTour";
import { AtlasOwnerNavigation } from "./AtlasOwnerNavigation";
import { AtlasManagerNavigation } from "./AtlasManagerNavigation";
import { AtlasPosRail } from "./AtlasPosRail";
import { AtlasApprovalNavigation } from "./AtlasApprovalNavigation";
import { AtlasCashierNavigation } from "./AtlasCashierNavigation";
import { AtlasInventoryNavigation } from "./AtlasInventoryNavigation";
import { useBranchSwitcher } from "./use-branch-switcher";
import { useNavigationProgress } from "./use-navigation-progress";
import { useWorkspaceTour } from "./use-workspace-tour";

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  item,
  pathname,
  compact = false,
  onNavigateStart,
}: {
  item: WorkspaceNavigationItem;
  pathname: string;
  compact?: boolean;
  onNavigateStart: (href: string) => void;
}): JSX.Element {
  const active = isActive(pathname, item.href);
  const router = useRouter();
  const prefetch = (): void => router.prefetch(item.href);
  return (
    <Link
      href={item.href}
      prefetch
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onClick={() => {
        if (!active) onNavigateStart(item.href);
      }}
      aria-current={active ? "page" : undefined}
      data-tour={item.tour}
      className={
        compact
          ? "group relative flex min-h-[40px] items-center gap-2.5 rounded-xl px-3 text-[12px] font-medium transition " +
            (active
              ? "bg-[#fff0ea] font-semibold text-[#e44e34]"
              : "text-[#4d443d] hover:bg-[#f7f1ea] hover:text-[#17130f]")
          : "group relative inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[11px] font-semibold transition " +
            (active
              ? "border-[#f35d3f] text-[#e44e34]"
              : "border-transparent text-[#665b53] hover:border-[#ead7cd] hover:text-[#17130f]")
      }
    >
      <span
        aria-hidden
        className={
          "grid place-items-center rounded-lg font-data " +
          (compact ? "h-7 w-7 text-[11px] " : "h-6 w-6 text-[10px] ") +
          (active ? "bg-[#ffe3d8] text-[#e44e34]" : "bg-[#f4f0ea] text-[#635950]")
        }
      >
        {item.icon}
      </span>
      {item.label}
    </Link>
  );
}

export function AppShell({
  children,
  businessName,
  role,
  offline,
  topbar,
  posMode = false,
  atlasPos = false,
  atlasOwner = false,
  atlasManager = false,
  atlasApprovals = false,
  atlasCashier = false,
  atlasInventory = false,
}: {
  children: ReactNode;
  businessName?: string;
  role?: string;
  offline?: boolean;
  topbar?: ReactNode;
  posMode?: boolean;
  atlasPos?: boolean;
  atlasOwner?: boolean;
  atlasManager?: boolean;
  atlasApprovals?: boolean;
  atlasCashier?: boolean;
  atlasInventory?: boolean;
}): JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const shellMe = useQuery({
    queryKey: ["me"],
    queryFn: () => apiFetch<{
      userId: string;
      businessId: string;
      businessName: string;
      role: string;
      onboardingRequired: boolean;
      workspaceTourSeen: boolean;
      activeBranchId: string | null;
      activeBranchName: string | null;
    }>("/api/v1/me"),
    retry: workspaceMeRetry,
    retryDelay: workspaceMeRetryDelay,
  });
  const signInRequired = shellMe.error instanceof ApiError && (shellMe.error.status === 401 || shellMe.error.status === 403);
  const meUnavailable = shellMe.isError && !signInRequired && shellMe.data === undefined && !(posMode && offline);
  const branchesQuery = useQuery({
    queryKey: ["branches"],
    queryFn: () => apiFetch<{ items: Array<{ id: string; name: string; isActive: boolean }> }>("/api/v1/branches"),
    retry: false,
    enabled: shellMe.data !== undefined && !shellMe.data.onboardingRequired,
  });
  const [signingOut, setSigningOut] = React.useState(false);
  const [signOutError, setSignOutError] = React.useState("");
  const [showMobileMenu, setShowMobileMenu] = React.useState(false);
  const atlasMenuButtonRef = React.useRef<HTMLButtonElement>(null);
  const { branchError, switchingBranch, switchBranch } = useBranchSwitcher(shellMe.data, queryClient);
  const { showNavigationProgress, beginNavigation } = useNavigationProgress(pathname);
  const { showTour, setShowTour, dismissTour } = useWorkspaceTour(shellMe.data, queryClient);
  const today = new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const year = new Date().getFullYear();
  const name = businessName ?? "NexPOS";
  const currentRole = shellMe.data?.role ?? role ?? "owner";
  const ownerAtlas = atlasOwner && currentRole === "owner";
  const managerAtlas = atlasManager && currentRole === "manager";
  const approvalAtlas = atlasApprovals && (currentRole === "manager" || currentRole === "owner");
  const cashierAtlas = atlasCashier && currentRole === "cashier";
  const inventoryAtlas = atlasInventory && ["inventory", "manager", "owner"].includes(currentRole);
  const atlasLayout = ownerAtlas || managerAtlas || approvalAtlas || cashierAtlas || inventoryAtlas || atlasPos;
  const activeBranchId = shellMe.data?.activeBranchId ?? null;
  const activeBranchName = shellMe.data?.activeBranchName ?? null;
  const activeBranches = (branchesQuery.data?.items ?? []).filter((branch) => branch.isActive);
  const navigationGroups = workspaceNavigationForRole(currentRole);
  const primaryMobileNavigation = navigationGroups[0]?.items ?? [];
  const secondaryNavigationGroups = navigationGroups.slice(1);
  const secondaryMobileNavigation = secondaryNavigationGroups.flatMap((group) => group.items);
  const activeSecondaryItem = secondaryMobileNavigation.find((item) => isActive(pathname, item.href));
  const initial = name.slice(0, 1).toUpperCase();
  const mobileHeaderHeight = posMode ? "min-h-[62px]" : "min-h-[60px]";
  const showSessionControls = businessName !== undefined || role !== undefined;

  React.useEffect(() => {
    setShowMobileMenu(false);
  }, [pathname]);

  React.useEffect(() => {
    if (!showMobileMenu) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setShowMobileMenu(false);
        if (atlasLayout) atlasMenuButtonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showMobileMenu, atlasLayout]);

  // Redirect exactly once per signed-out denial. Clearing the ["me"] query
  // forces an immediate refetch, which settles back into the same denial;
  // without this guard the effect would clear + replace on every cycle,
  // starving the in-flight navigation to /login.
  const signInRedirected = React.useRef(false);
  React.useEffect(() => {
    if (signInRequired) {
      if (signInRedirected.current) return;
      signInRedirected.current = true;
      clearActiveSyncScope();
      queryClient.clear();
      router.replace("/login");
    } else if (shellMe.data?.onboardingRequired) {
      router.replace("/onboarding");
    }
  }, [queryClient, router, signInRequired, shellMe.data?.onboardingRequired]);

  async function signOut(): Promise<void> {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError("");
    try {
      await apiFetch("/api/v1/auth/logout", { init: { method: "POST" } });
    } catch (error) {
      if (!(error instanceof ApiError) || (error.status !== 401 && error.status !== 403)) {
        setSignOutError("Sign out needs a connection.");
        setSigningOut(false);
        return;
      }
    }
    clearActiveSyncScope();
    queryClient.clear();
    router.replace("/login");
  }

  if (meUnavailable) {
    return (
      <main
        data-ui="workspace-reconnect"
        className="grid min-h-screen place-items-center bg-[#fcf8f3] px-6 text-center"
      >
        <div>
          <p role="status" className="text-sm font-medium text-[#73685f]">
            Connecting to your workspace…
          </p>
          <p className="mt-2 text-xs text-[#8b8077]">
            The service is starting. We will retry automatically.
          </p>
          <button
            type="button"
            onClick={() => void shellMe.refetch()}
            className="mt-5 inline-flex items-center justify-center rounded-[10px] bg-[#f35d3f] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#d94a30]"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  if (shellMe.isLoading || signInRequired || shellMe.data?.onboardingRequired) {
    return (
      <main
        data-ui="workspace-access-check"
        className="grid min-h-screen place-items-center bg-[#fcf8f3] px-6 text-center"
      >
        <div>
          <span aria-hidden className="mx-auto block h-1.5 w-16 overflow-hidden rounded-full bg-[#ffe3d8]">
            <span className="navigation-progress-bar block h-full w-[42%] bg-[#f35d3f]" />
          </span>
          <p role="status" className="mt-4 text-sm font-medium text-[#73685f]">
            {signInRequired ? "Returning to sign in…" : shellMe.data?.onboardingRequired ? "Returning to business setup…" : "Checking workspace…"}
          </p>
        </div>
      </main>
    );
  }


  return (
    <div data-ui={atlasPos ? "atlas-pos-shell" : ownerAtlas ? "atlas-owner-shell" : managerAtlas ? "atlas-manager-shell" : approvalAtlas ? "atlas-approval-shell" : cashierAtlas ? "atlas-cashier-shell" : inventoryAtlas ? "atlas-inventory-shell" : undefined} className={"relative flex min-h-screen flex-col overflow-x-clip " + (atlasLayout ? "bg-[#f7f8f5]" : "bg-[#fcf8f3]")}>
      {!atlasLayout ? <DecorativeBackdrop /> : null}
      <a
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          const main = document.querySelector("main");
          if (!(main instanceof HTMLElement)) return;
          main.id = "main-content";
          main.tabIndex = -1;
          main.focus();
        }}
        className="absolute left-4 top-2 z-[100] -translate-y-20 rounded-lg bg-[#202826] px-4 py-2.5 text-sm font-semibold text-white shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#f35d3f] focus-visible:ring-offset-2"
      >
        Skip to main content
      </a>

      <div className="sticky top-0 z-50">
        {atlasLayout ? (
          <header data-ui="atlas-mobile-header" className="flex min-h-[77px] items-center justify-between gap-3 border-b border-[#e5e9e3] bg-white px-[18px] xl:hidden">
            <Link href="/" aria-label="NexPOS dashboard" className="inline-flex min-w-0 items-center gap-2.5 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
              <span aria-hidden className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[10px] bg-[#29332d] font-display text-[24px] font-semibold text-white">N</span>
              <span className="font-display text-[21px] font-semibold tracking-tight text-[#202826]">NexPOS</span>
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <span className="rounded-[7px] bg-[#f0f3ef] px-3 py-2 text-[10px] font-medium uppercase tracking-[0.05em] text-[#53615a]">{currentRole}</span>
              <button ref={atlasMenuButtonRef} type="button" aria-label={showMobileMenu ? "Close workspace menu" : "Open workspace menu"} aria-expanded={showMobileMenu} aria-controls="atlas-mobile-navigation"
                onClick={() => setShowMobileMenu((open) => !open)}
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[#e5e9e3] bg-white text-sm font-semibold text-[#29332d] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#da614c]">
                <span aria-hidden>{showMobileMenu ? "×" : "☰"}</span>
              </button>
            </div>
          </header>
        ) : null}
        <header
          data-ui="shell-header"
          className={
            (atlasLayout ? "hidden border-b border-[#e5e9e3] bg-white px-4 backdrop-blur sm:px-6 " + (atlasPos ? "xl:hidden " : "xl:block ") + (ownerAtlas ? "xl:pl-[264px] " : managerAtlas ? "xl:pl-[253px] " : inventoryAtlas ? "xl:pl-[251px] " : "xl:pl-[255px] ") : "border-b border-[#eadfd6] bg-[#fcf8f3]/95 px-4 backdrop-blur sm:px-6 ") +
            mobileHeaderHeight
          }
        >
          <div className={"mx-auto flex w-full items-center gap-4 " + (atlasLayout ? "min-h-[78px] max-w-none" : "min-h-[64px] max-w-[1480px]")}>
            <Link href="/" className={"flex min-w-0 shrink-0 items-center " + (atlasLayout ? "xl:hidden" : "")} aria-label="NexPOS dashboard">
              <span className="hidden sm:block">
                <NexposLogo variant="light" size="md" withWordmark />
              </span>
              <span className="sm:hidden">
                <NexposMark size={36} />
              </span>
            </Link>
            {ownerAtlas ? <span className="hidden min-w-0 truncate text-[15px] font-medium text-[#202826] xl:block">{activeBranchName ?? name} / Owner workspace</span> : null}
            {managerAtlas ? <span className="hidden min-w-0 truncate text-[15px] font-medium text-[#202826] xl:block">{activeBranchName ?? name} / Manager workspace</span> : null}
            {approvalAtlas ? <span className="hidden min-w-0 truncate text-[14px] font-medium text-[#202826] xl:block">{currentRole === "owner" ? "Owner" : "Manager"} desk / {activeBranchName ?? name}</span> : null}

            <div className={posMode ? "hidden items-center gap-2 lg:flex" : "hidden items-center gap-2 md:flex"}>
              <label className="rounded-[10px] border border-[#eee4db] bg-white px-2.5 py-1.5 text-[9px] font-semibold text-[#2a241f]">
                <span className="sr-only">Active branch</span>
                <select
                  aria-label="Active branch"
                  value={activeBranchId ?? ""}
                  onChange={(event) => void switchBranch(event.target.value)}
                  disabled={switchingBranch}
                  className="max-w-36 bg-transparent text-[10px] font-semibold outline-none disabled:cursor-wait"
                >
                  <option value="">All branches</option>
                  {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              {offline !== undefined ? (
                <span
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[9px] font-semibold " +
                    (offline ? "bg-[#fff4df] text-[#b56d0c]" : "bg-[#eaf7f0] text-[#1f8a5b]")
                  }
                >
                  <span aria-hidden>{offline ? "!" : "●"}</span>
                  {offline ? "Offline" : "Online"}
                </span>
              ) : null}
              <span className="hidden text-[10px] font-medium text-[#5d534b] lg:inline">▣ Today</span>
              <span className="hidden text-[9px] text-[#8b8077] xl:inline">{today}</span>
            </div>

            {posMode ? (
              <div data-ui="pos-tablet-header" className="flex min-w-0 items-center gap-2 xl:hidden">
                {offline !== undefined ? (
                  <span
                    className={
                      "inline-flex shrink-0 items-center gap-1 text-[8px] font-semibold " +
                      (offline ? "text-[#b56d0c]" : "text-[#1f8a5b]")
                    }
                  >
                    <span aria-hidden>●</span>
                    {offline ? "Offline" : "Online"}
                  </span>
                ) : null}
              </div>
            ) : null}

            <div className="ml-auto flex min-w-0 items-center gap-2">
              {topbar ? <div className="hidden min-w-0 md:block">{topbar}</div> : null}
              <label className="md:hidden">
                <span className="sr-only">Active branch</span>
                <select
                  aria-label="Active branch"
                  value={activeBranchId ?? ""}
                  onChange={(event) => void switchBranch(event.target.value)}
                  disabled={switchingBranch}
                  className="max-w-24 rounded-lg border border-[#eadfd6] bg-white px-2 py-1.5 text-[8px] font-semibold text-[#665b53]"
                >
                  <option value="">All branches</option>
                  {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </label>
              {branchError || signOutError ? <span role="alert" className="max-w-28 text-right text-[8px] font-medium text-[#c43e3e]">{branchError || signOutError}</span> : null}
              <span aria-hidden className="hidden text-sm text-[#2a241f] sm:inline">⌕</span>
              <span aria-hidden className="hidden text-sm text-[#2a241f] sm:inline">♢</span>
              {showSessionControls ? (
                <button
                  type="button"
                  data-tour="tour-restart"
                  onClick={() => setShowTour(true)}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#eadfd6] bg-white text-[11px] font-bold text-[#665b53] hover:border-[#f2b8a9] hover:text-[#d94a30]"
                  aria-label="Restart system tour"
                  title="Restart system tour"
                >
                  ?
                </button>
              ) : null}
              <div className="font-display grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#f35d3f] text-[11px] font-bold text-white">
                {initial}
              </div>
              <div className="hidden max-w-40 min-w-0 lg:block">
                <p className="truncate text-[9px] font-semibold text-[#2a241f]">{name}</p>
                <p className="truncate text-[8px] capitalize text-[#84786e]">{currentRole} · {branchScopeLabel(activeBranchName)}</p>
              </div>
              {showSessionControls ? (
                <button
                  type="button"
                  onClick={() => void signOut()}
                  disabled={signingOut}
                  className="min-h-8 shrink-0 rounded-lg border border-[#eadfd6] bg-white px-2.5 text-[9px] font-semibold text-[#665b53] transition hover:border-[#f2b8a9] hover:text-[#d94a30] disabled:cursor-wait disabled:opacity-60"
                >
                  {signingOut ? "Signing out…" : "Sign out"}
                </button>
              ) : null}
            </div>
          </div>
        </header>

        <nav
          id="atlas-mobile-navigation"
          data-ui="shell-mobile-nav"
          aria-label="Primary navigation"
          className={atlasLayout && !showMobileMenu ? "hidden xl:hidden" : "border-b border-[#e5e9e3] bg-white/95 px-3 shadow-[0_4px_14px_-10px_rgb(28_20_15/0.12)] backdrop-blur xl:hidden"}
        >
          <div className="mx-auto flex w-full items-center overflow-x-auto">
            {primaryMobileNavigation.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                onNavigateStart={(href) => {
                  setShowMobileMenu(false);
                  beginNavigation(href);
                }}
              />
            ))}
            {secondaryMobileNavigation.length > 0 && !atlasLayout ? (
              <button
                type="button"
                aria-expanded={showMobileMenu}
                aria-controls="workspace-more-menu"
                aria-label={activeSecondaryItem ? `More workspace navigation, current page ${activeSecondaryItem.label}` : "More workspace navigation"}
                onClick={() => setShowMobileMenu((open) => !open)}
                className={
                  "relative inline-flex h-11 shrink-0 items-center gap-2 border-b-2 px-3 text-[11px] font-semibold transition " +
                  (activeSecondaryItem || showMobileMenu
                    ? "border-[#f35d3f] text-[#e44e34]"
                    : "border-transparent text-[#665b53] hover:border-[#ead7cd] hover:text-[#17130f]")
                }
              >
                <span aria-hidden className="grid h-6 w-6 place-items-center rounded-lg bg-[#f4f0ea] font-data text-[10px] text-[#635950]">•••</span>
                {activeSecondaryItem ? activeSecondaryItem.label : "More"}
              </button>
            ) : null}
          </div>
        </nav>
        {showMobileMenu ? (
          <div
            id="workspace-more-menu"
            data-ui="shell-mobile-more"
            className={"max-h-[calc(100vh-132px)] overflow-y-auto border-b px-4 py-4 shadow-[0_14px_26px_-18px_rgb(28_20_15/0.35)] xl:hidden " + (atlasLayout ? "border-[#e5e9e3] bg-[#f7f8f5]" : "border-[#eadfd6] bg-[#fcf8f3]")}
          >
            {atlasLayout ? (
              <div className="mx-auto mb-4 grid max-w-[920px] gap-3 border-b border-[#e5e9e3] pb-4 sm:grid-cols-3 sm:items-end">
                <label className="text-xs font-semibold text-[#53615a]">
                  Active branch
                  <select aria-label="Active branch" value={activeBranchId ?? ""} onChange={(event) => void switchBranch(event.target.value)} disabled={switchingBranch}
                    className="mt-1 block min-h-11 w-full rounded-lg border border-[#dce3dc] bg-white px-3 text-sm text-[#202826]">
                    <option value="">All branches</option>
                    {activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => { setShowMobileMenu(false); setShowTour(true); }}
                  className="min-h-11 rounded-lg border border-[#dce3dc] bg-white px-4 text-sm font-semibold text-[#29332d]">Restart system tour</button>
                <button type="button" disabled={signingOut} onClick={() => void signOut()}
                  className="min-h-11 rounded-lg border border-[#dce3dc] bg-white px-4 text-sm font-semibold text-[#29332d] disabled:opacity-60">{signingOut ? "Signing out…" : "Sign out"}</button>
                {branchError || signOutError ? <p role="alert" className="text-xs text-[#a34132] sm:col-span-3">{branchError || signOutError}</p> : null}
              </div>
            ) : null}
            <nav aria-label="More workspace navigation" className="mx-auto grid w-full max-w-[920px] gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {secondaryNavigationGroups.map((group) => (
                <section key={group.label} aria-label={group.label}>
                  <p className="px-2 pb-1.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#a0948b]">{group.label}</p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <NavLink
                        key={item.href}
                        item={item}
                        pathname={pathname}
                        compact
                        onNavigateStart={(href) => {
                          setShowMobileMenu(false);
                          beginNavigation(href);
                        }}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </nav>
          </div>
        ) : null}
        {showNavigationProgress ? (
          <div
            data-ui="navigation-progress"
            role="progressbar"
            aria-label="Loading page"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-[#ffe3d8]"
          >
            <span className="navigation-progress-bar block h-full w-[42%] bg-[#f35d3f]" />
          </div>
        ) : null}
      </div>

      <div
        data-ui="shell-body"
        className={"relative mx-auto grid w-full flex-1 " + (atlasPos ? "max-w-none xl:grid-cols-[78px_minmax(0,1fr)]" : ownerAtlas ? "max-w-none xl:grid-cols-[239px_minmax(0,1fr)]" : managerAtlas ? "max-w-none xl:grid-cols-[228px_minmax(0,1fr)]" : approvalAtlas || cashierAtlas ? "max-w-none xl:grid-cols-[230px_minmax(0,1fr)]" : inventoryAtlas ? "max-w-none xl:grid-cols-[226px_minmax(0,1fr)]" : "max-w-[1480px] xl:grid-cols-[220px_minmax(0,1fr)]")}
      >
        <aside
          data-ui="shell-sidebar"
          className={atlasLayout ? (atlasPos ? "z-[60] hidden bg-[#252e2b] xl:sticky xl:top-0 xl:block xl:h-screen xl:self-start" : "z-[60] hidden border-r border-[#e5e9e3] bg-white xl:sticky xl:top-0 xl:-mt-[78px] xl:block xl:h-screen xl:self-start") : "hidden border-r border-[#eadfd6] bg-white/55 xl:sticky xl:top-[65px] xl:block xl:h-[calc(100vh-65px)] xl:self-start"}
          aria-label="Workspace navigation"
        >
          {atlasPos ? (
            <AtlasPosRail pathname={pathname} onNavigate={beginNavigation} onSignOut={() => void signOut()} signingOut={signingOut} />
          ) : ownerAtlas ? (
            <AtlasOwnerNavigation pathname={pathname} onNavigate={beginNavigation} onSignOut={() => void signOut()} signingOut={signingOut} />
          ) : managerAtlas ? (
            <AtlasManagerNavigation pathname={pathname} onNavigate={beginNavigation} onSignOut={() => void signOut()} signingOut={signingOut} />
          ) : approvalAtlas ? (
            <AtlasApprovalNavigation role={currentRole} pathname={pathname} onNavigate={beginNavigation} onSignOut={() => void signOut()} signingOut={signingOut} />
          ) : cashierAtlas ? (
            <AtlasCashierNavigation pathname={pathname} onNavigate={beginNavigation} onSignOut={() => void signOut()} signingOut={signingOut} />
          ) : inventoryAtlas ? (
            <AtlasInventoryNavigation pathname={pathname} onNavigate={beginNavigation} onSignOut={() => void signOut()} signingOut={signingOut} />
          ) : <div className="flex h-full min-h-[540px] flex-col overflow-y-auto p-4 xl:pt-5">
            <div className="mb-3 px-2">
              <p className="font-data text-[8px] font-semibold uppercase tracking-[0.16em] text-[#9a8d83]">Workspace</p>
              <p className="mt-1 text-[11px] leading-4 text-[#746960]">Store operations and administration.</p>
            </div>

            <nav className="space-y-4" aria-label="Primary navigation">
              {navigationGroups.map((group) => (
                <div key={group.label}>
                  <p className="px-2 pb-1.5 text-[8px] font-semibold uppercase tracking-[0.14em] text-[#a0948b]">
                    {group.label}
                  </p>
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <NavLink key={item.href} item={item} pathname={pathname} compact onNavigateStart={beginNavigation} />
                    ))}
                  </div>
                </div>
              ))}
            </nav>

            <div className="mt-auto pt-6">
              <button
                type="button"
                onClick={() => setShowTour(true)}
                className="mb-3 flex w-full items-center justify-between rounded-xl border border-[#eee4db] bg-white px-3 py-2.5 text-left text-[10px] font-semibold text-[#655b53] hover:border-[#f2b8a9] hover:text-[#d94a30]"
              >
                <span>Help · Restart tour</span>
                <span aria-hidden>?</span>
              </button>
              <div className="rounded-2xl border border-[#f0e4da] bg-[#fff6f1] p-3">
                <div className="flex items-center gap-2.5">
                  <div className="font-display grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#f35d3f] text-xs font-bold text-white">
                    {initial}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-[10px] font-semibold text-[#2a241f]">{name}</p>
                    <p className="truncate text-[8px] capitalize text-[#84786e]">{currentRole} · {branchScopeLabel(activeBranchName)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>}
        </aside>

        <div data-ui="shell-main" className="min-w-0">
          {children}
        </div>
      </div>

      <footer
        data-ui="shell-footer"
        className={"relative z-20 border-t border-[#eadfd6] bg-white/80 px-4 py-4 backdrop-blur sm:px-6 " + (atlasPos ? "xl:hidden" : "")}
      >
        <div className="mx-auto flex w-full max-w-[1480px] flex-wrap items-center justify-between gap-2 text-[9px] text-[#8b8077]">
          <p><span className="font-display font-semibold text-[#3b342e]">NEXPOS</span> · Retail operations workspace</p>
          <p className="font-data">© {year} · Secure session workspace</p>
        </div>
      </footer>
      <GuidedTour
        open={showTour}
        role={currentRole}
        onDismiss={() => void dismissTour()}
      />
    </div>
  );
}
