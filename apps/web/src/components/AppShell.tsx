"use client";

import React from "react";
import type { JSX, ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DecorativeBackdrop } from "./premium";
import { ApiError, apiFetch } from "../lib/api";
import { clearActiveSyncScope } from "../lib/sync-store";
import { workspaceMeRetry, workspaceMeRetryDelay } from "../lib/workspace-me-retry";
import {
  workspaceNavigationForRole,
  type WorkspaceNavigationItem,
} from "../lib/workspace-navigation";
import { branchScopeLabel } from "../lib/workspace-branch";
import { GuidedTour } from "./GuidedTour";

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
}: {
  children: ReactNode;
  businessName?: string;
  role?: string;
  offline?: boolean;
  topbar?: ReactNode;
  posMode?: boolean;
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
  const [branchError, setBranchError] = React.useState("");
  const [switchingBranch, setSwitchingBranch] = React.useState(false);
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const [showNavigationProgress, setShowNavigationProgress] = React.useState(false);
  const [showTour, setShowTour] = React.useState(false);
  const [showMobileMenu, setShowMobileMenu] = React.useState(false);
  const today = new Date().toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" });
  const year = new Date().getFullYear();
  const name = businessName ?? "NexPOS";
  const currentRole = shellMe.data?.role ?? role ?? "owner";
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
    setPendingHref(null);
    setShowNavigationProgress(false);
    setShowMobileMenu(false);
  }, [pathname]);

  React.useEffect(() => {
    const restartTour = (): void => setShowTour(true);
    window.addEventListener("nexpos:restart-tour", restartTour);
    return () => window.removeEventListener("nexpos:restart-tour", restartTour);
  }, []);

  React.useEffect(() => {
    if (!showMobileMenu) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setShowMobileMenu(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [showMobileMenu]);

  React.useEffect(() => {
    if (pendingHref === null) {
      setShowNavigationProgress(false);
      return;
    }
    const timer = window.setTimeout(() => setShowNavigationProgress(true), 120);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

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

  React.useEffect(() => {
    const profile = shellMe.data;
    if (!profile || profile.onboardingRequired || profile.workspaceTourSeen) return;
    const localKey = `nexpos-workspace-tour-seen:${profile.userId}`;
    if (window.localStorage.getItem(localKey) === "1") return;
    setShowTour(true);
  }, [shellMe.data]);

  async function dismissTour(): Promise<void> {
    const profile = shellMe.data;
    setShowTour(false);
    if (!profile) return;
    window.localStorage.setItem(`nexpos-workspace-tour-seen:${profile.userId}`, "1");
    queryClient.setQueryData(["me"], { ...profile, workspaceTourSeen: true });
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      await apiFetch("/api/v1/me/tour/seen", {
        csrfToken: csrf.csrfToken,
        init: { method: "POST" },
      });
    } catch {
      // Local suppression prevents a failed preference write from interrupting
      // daily work; the server remains the cross-device source of truth.
    }
  }

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
    router.refresh();
  }

  async function switchBranch(branchId: string): Promise<void> {
    const profile = shellMe.data;
    if (!profile || switchingBranch) return;
    setSwitchingBranch(true);
    setBranchError("");
    try {
      const csrf = await apiFetch<{ csrfToken: string }>("/api/v1/auth/csrf");
      const result = await apiFetch<{ activeBranchId: string | null; activeBranchName: string | null }>(
        "/api/v1/me/active-branch",
        {
          csrfToken: csrf.csrfToken,
          init: {
            method: "POST",
            body: JSON.stringify({ branchId: branchId || null }),
          },
        },
      );
      queryClient.setQueryData(["me"], {
        ...profile,
        activeBranchId: result.activeBranchId,
        activeBranchName: result.activeBranchName,
      });
      await queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== "me" && query.queryKey[0] !== "branches",
      });
    } catch (error) {
      setBranchError(error instanceof ApiError ? error.message : "Could not switch branch.");
    } finally {
      setSwitchingBranch(false);
    }
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
    <div className="relative flex min-h-screen flex-col overflow-x-clip bg-[#fcf8f3]">
      <DecorativeBackdrop />

      <div className="sticky top-0 z-50">
        <header
          data-ui="shell-header"
          className={
            "border-b border-[#eadfd6] bg-[#fcf8f3]/95 px-4 backdrop-blur sm:px-6 " +
            mobileHeaderHeight
          }
        >
          <div className="mx-auto flex min-h-[64px] w-full max-w-[1480px] items-center gap-4">
            <Link href="/" className="flex min-w-0 shrink-0 items-center gap-3" aria-label="NexPOS dashboard">
              <span className="font-display grid h-9 w-9 place-items-center rounded-xl bg-[#f35d3f] text-sm font-bold text-white shadow-[0_8px_18px_-10px_rgb(243_93_63/0.75)]">
                N
              </span>
              <span className="hidden sm:block">
                <span className="font-display block text-[18px] font-bold leading-none text-[#17130f]">NEXPOS</span>
                <span className="font-data mt-1 block text-[7px] font-medium tracking-[0.17em] text-[#9a8d83]">RETAIL OPERATIONS</span>
              </span>
            </Link>

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
          data-ui="shell-mobile-nav"
          aria-label="Primary navigation"
          className="border-b border-[#eadfd6] bg-white/95 px-3 shadow-[0_4px_14px_-10px_rgb(28_20_15/0.12)] backdrop-blur xl:hidden"
        >
          <div className="mx-auto flex w-full items-center overflow-x-auto">
            {primaryMobileNavigation.map((item) => (
              <NavLink
                key={item.href}
                item={item}
                pathname={pathname}
                onNavigateStart={(href) => {
                  setShowMobileMenu(false);
                  setPendingHref(href);
                }}
              />
            ))}
            {secondaryMobileNavigation.length > 0 ? (
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
            className="max-h-[calc(100vh-132px)] overflow-y-auto border-b border-[#eadfd6] bg-[#fcf8f3] px-4 py-4 shadow-[0_14px_26px_-18px_rgb(28_20_15/0.35)] xl:hidden"
          >
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
                          setPendingHref(href);
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
        className="relative mx-auto grid w-full max-w-[1480px] flex-1 xl:grid-cols-[220px_minmax(0,1fr)]"
      >
        <aside
          data-ui="shell-sidebar"
          className="hidden border-r border-[#eadfd6] bg-white/55 xl:sticky xl:top-[65px] xl:block xl:h-[calc(100vh-65px)] xl:self-start"
          aria-label="Workspace navigation"
        >
          <div className="flex h-full min-h-[540px] flex-col overflow-y-auto p-4 xl:pt-5">
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
                      <NavLink key={item.href} item={item} pathname={pathname} compact onNavigateStart={setPendingHref} />
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
          </div>
        </aside>

        <div data-ui="shell-main" className="min-w-0">
          {children}
        </div>
      </div>

      <footer
        data-ui="shell-footer"
        className="relative z-20 border-t border-[#eadfd6] bg-white/80 px-4 py-4 backdrop-blur sm:px-6"
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
