export interface WorkspaceTourProfile {
  userId: string;
  onboardingRequired: boolean;
  workspaceTourSeen: boolean;
}

export function workspaceTourLocalKey(userId: string): string {
  return `nexpos-workspace-tour-seen:${userId}`;
}

export function shouldShowWorkspaceTour(
  profile: WorkspaceTourProfile | undefined,
  locallySeen: boolean,
): boolean {
  return Boolean(
    profile &&
    !profile.onboardingRequired &&
    !profile.workspaceTourSeen &&
    !locallySeen,
  );
}

export function branchInvalidationPredicate(query: { queryKey: readonly unknown[] }): boolean {
  return query.queryKey[0] !== "me" && query.queryKey[0] !== "branches";
}
