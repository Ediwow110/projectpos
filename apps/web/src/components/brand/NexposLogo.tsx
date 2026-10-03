import React from "react";
import type { JSX } from "react";

type NexposLogoProps = {
  variant?: "light" | "dark";
  size?: "sm" | "md" | "lg";
  withWordmark?: boolean;
  subtitle?: string;
  className?: string;
};

const MARK_SIZE: Record<NonNullable<NexposLogoProps["size"]>, number> = {
  sm: 32,
  md: 36,
  lg: 44,
};

export function NexposMark({
  size = 36,
  className = "",
}: {
  size?: number;
  className?: string;
}): JSX.Element {
  return (
    <img
      src="/brand/nexpos-mark.svg"
      width={size}
      height={size}
      alt="NexPOS mark"
      className={`shrink-0 rounded-[11px] ${className}`}
    />
  );
}

export function NexposLogo({
  variant = "light",
  size = "md",
  withWordmark = true,
  subtitle = "RETAIL OPERATIONS",
  className = "",
}: NexposLogoProps): JSX.Element {
  const markSize = MARK_SIZE[size];
  const titleColor = variant === "dark" ? "text-white" : "text-[#17130f]";
  const eyebrowColor = variant === "dark" ? "text-[#a79e94]" : "text-[#9a8d83]";

  if (variant === "light" && withWordmark) {
    const width = Math.round(markSize * (240 / 56));
    const height = Math.round(markSize * (56 / 48));
    return (
      <img
        src="/brand/nexpos-logo.svg"
        width={width}
        height={height}
        alt="NexPOS — Retail operations"
        className={`h-auto shrink-0 ${className}`}
      />
    );
  }

  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label="NexPOS dashboard">
      <NexposMark size={markSize} />
      {withWordmark ? (
        <span className="hidden sm:block">
          <span className={`font-display block text-[18px] font-bold leading-none ${titleColor}`}>
            NEXPOS
          </span>
          <span
            className={`font-data mt-1 block text-[7px] font-medium tracking-[0.17em] ${eyebrowColor}`}
          >
            {subtitle}
          </span>
        </span>
      ) : null}
    </span>
  );
}
