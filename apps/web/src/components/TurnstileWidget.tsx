"use client";

import type { JSX } from "react";
import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

type TurnstileApi = {
  render(
    container: HTMLElement,
    options: {
      sitekey: string;
      action: string;
      theme: "light" | "dark" | "auto";
      size: "normal" | "compact" | "flexible";
      callback(token: string): void;
      "expired-callback"(): void;
      "error-callback"(): void;
    },
  ): string;
  remove(widgetId: string): void;
};

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

export function TurnstileWidget(props: {
  siteKey: string;
  action: string;
  onToken(token: string): void;
  onExpire(): void;
  onError(): void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const callbacksRef = useRef({ onToken: props.onToken, onExpire: props.onExpire, onError: props.onError });

  useEffect(() => {
    callbacksRef.current = { onToken: props.onToken, onExpire: props.onExpire, onError: props.onError };
  }, [props.onToken, props.onExpire, props.onError]);

  const renderWidget = useCallback(() => {
    const container = containerRef.current;
    const api = (window as TurnstileWindow).turnstile;
    if (!container || !api || widgetIdRef.current) return;
    widgetIdRef.current = api.render(container, {
      sitekey: props.siteKey,
      action: props.action,
      theme: "light",
      size: "flexible",
      callback: (token) => callbacksRef.current.onToken(token),
      "expired-callback": () => callbacksRef.current.onExpire(),
      "error-callback": () => callbacksRef.current.onError(),
    });
  }, [props.action, props.siteKey]);

  useEffect(() => {
    return () => {
      const api = (window as TurnstileWindow).turnstile;
      if (api && widgetIdRef.current) api.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    };
  }, []);

  return (
    <>
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onReady={renderWidget}
      />
      <div ref={containerRef} className="min-h-[65px] w-full overflow-hidden rounded-xl" />
    </>
  );
}
