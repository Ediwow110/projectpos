import { describe, expect, it } from "vitest";

import {
  branchInvalidationPredicate,
  shouldShowWorkspaceTour,
  workspaceTourLocalKey,
} from "./app-shell-behavior";

describe("AppShell behavior", () => {
  it("shows the workspace tour only when onboarding is complete and neither server nor local state has seen it", () => {
    const profile = {
      userId: "user-1",
      onboardingRequired: false,
      workspaceTourSeen: false,
    };

    expect(shouldShowWorkspaceTour(profile, false)).toBe(true);
    expect(shouldShowWorkspaceTour({ ...profile, onboardingRequired: true }, false)).toBe(false);
    expect(shouldShowWorkspaceTour({ ...profile, workspaceTourSeen: true }, false)).toBe(false);
    expect(shouldShowWorkspaceTour(profile, true)).toBe(false);
    expect(shouldShowWorkspaceTour(undefined, false)).toBe(false);
  });

  it("scopes the local tour suppression flag by user", () => {
    expect(workspaceTourLocalKey("user-1")).toBe("nexpos-workspace-tour-seen:user-1");
  });

  it("keeps identity and branch queries while invalidating branch-sensitive workspace data", () => {
    expect(branchInvalidationPredicate({ queryKey: ["me"] })).toBe(false);
    expect(branchInvalidationPredicate({ queryKey: ["branches"] })).toBe(false);
    expect(branchInvalidationPredicate({ queryKey: ["products"] })).toBe(true);
    expect(branchInvalidationPredicate({ queryKey: ["sale", "sale-1"] })).toBe(true);
  });
});
