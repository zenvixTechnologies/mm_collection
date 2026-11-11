"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Thin gold→red bar across the top while moving between pages.
 * Starts on any internal link click, completes when the new route renders.
 */
export function RouteProgress() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const timers = useRef<number[]>([]);
  const firstRender = useRef(true);

  const clear = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  // Start: intercept clicks on internal links that change the URL.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      clear();
      setState("loading");
      // Safety net: never leave the bar hanging if a navigation is cancelled.
      timers.current.push(
        window.setTimeout(() => {
          setState("done");
          timers.current.push(window.setTimeout(() => setState("idle"), 450));
        }, 8000),
      );
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // Finish: the new route has rendered.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    clear();
    setState("done");
    timers.current.push(window.setTimeout(() => setState("idle"), 450));
    return clear;
  }, [pathname, searchParams]);

  return (
    <div
      aria-hidden
      className="mm-route-progress"
      data-state={state}
    >
      <span />
    </div>
  );
}
