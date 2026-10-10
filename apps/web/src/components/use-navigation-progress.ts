"use client";

import * as React from "react";

export function useNavigationProgress(pathname: string): {
  showNavigationProgress: boolean;
  beginNavigation: (href: string) => void;
} {
  const [pendingHref, setPendingHref] = React.useState<string | null>(null);
  const [showNavigationProgress, setShowNavigationProgress] = React.useState(false);

  React.useEffect(() => {
    setPendingHref(null);
    setShowNavigationProgress(false);
  }, [pathname]);

  React.useEffect(() => {
    if (pendingHref === null) {
      setShowNavigationProgress(false);
      return;
    }
    const timer = window.setTimeout(() => setShowNavigationProgress(true), 120);
    return () => window.clearTimeout(timer);
  }, [pendingHref]);

  return { showNavigationProgress, beginNavigation: setPendingHref };
}
