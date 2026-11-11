"use client";

import { useEffect } from "react";
import { SPLASH_SEEN_KEY } from "./SplashScreen";

const MIN_VISIBLE_MS = 1200; // lets the intro (logo pop → wordmark → gold line) finish once
const MAX_VISIBLE_MS = 2200; // never hold the customer back longer than this

/** Fades the splash out once the page (incl. priority hero images) has loaded. */
export function SplashController() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.classList.contains("mm-splash-off")) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const minMs = reduced ? 250 : MIN_VISIBLE_MS;
    let finished = false;
    const timers: number[] = [];

    const finish = (immediate = false) => {
      if (finished) return;
      finished = true;
      // performance.now() counts from navigation start, so the minimum includes load time.
      const wait = immediate ? 0 : Math.max(0, minMs - performance.now());
      timers.push(
        window.setTimeout(() => {
          root.classList.add("mm-splash-done");
          try {
            sessionStorage.setItem(SPLASH_SEEN_KEY, "1");
          } catch {
            /* storage unavailable */
          }
          // Take it out of the accessibility/paint tree after the fade.
          timers.push(window.setTimeout(() => root.classList.add("mm-splash-off"), 700));
        }, wait),
      );
    };

    const onLoad = () => finish();
    // Impatient shoppers can tap / press any key to skip straight to the store.
    const skip = () => finish(true);
    const splash = document.getElementById("mm-splash");

    if (document.readyState === "complete") finish();
    else window.addEventListener("load", onLoad, { once: true });
    splash?.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("keydown", skip, { once: true });
    timers.push(window.setTimeout(onLoad, MAX_VISIBLE_MS));

    return () => {
      window.removeEventListener("load", onLoad);
      window.removeEventListener("keydown", skip);
      splash?.removeEventListener("pointerdown", skip);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return null;
}
