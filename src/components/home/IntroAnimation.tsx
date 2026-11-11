"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { SITE } from "@/lib/utils";
import { useIntroStore } from "@/store/intro-store";

/**
 * M&M COLLECTIONS brand intro → homepage hero hand-off.
 *
 * Timeline (from hydration, typically ~0.2–0.3s after the first paint):
 *   0.0–0.3s   warm gold glow fades into the ivory backdrop
 *   0.15–0.7s  logo fades + scales in, soft gold halo
 *   0.55–1.3s  light reflection sweeps across the logo
 *   0.6–1.15s  tagline rises from a mask, gold line expands
 *   ≥1.25s     exit: logo scales down/fades while the curtain wipes downward
 *              (clip-path), revealing the hero top→bottom (see Hero.tsx)
 *
 * The exit waits for the page's priority images (window "load") but never longer
 * than MAX_HOLD_MS — no fake loading. Any tap, scroll or key skips straight in.
 * Whether to play at all is decided before paint by <IntroGate />.
 */

const MIN_HOLD_MS = 1250;
const MAX_HOLD_MS = 2400;
const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const EASE_CURTAIN = [0.65, 0.05, 0.25, 1] as const; // moves immediately, settles softly

type Phase = "intro" | "exit" | "done";

export function IntroAnimation() {
  const [phase, setPhase] = useState<Phase>("intro");
  const reveal = useIntroStore((s) => s.reveal);
  const exitedRef = useRef(false);

  const exit = useCallback(() => {
    if (exitedRef.current) return;
    exitedRef.current = true;
    setPhase("exit");
    reveal(true); // hero starts revealing as the curtain lifts
  }, [reveal]);

  const finish = useCallback(() => {
    document.documentElement.classList.remove("mm-intro-play");
    setPhase("done");
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    // Not playing this load (already seen, reduced motion, or client-side navigation).
    if (!root.classList.contains("mm-intro-play")) {
      exitedRef.current = true;
      setPhase("done");
      reveal(false);
      return;
    }

    const mountedAt = performance.now();
    const timers: number[] = [];
    const onLoad = () => {
      const held = performance.now() - mountedAt;
      timers.push(window.setTimeout(exit, Math.max(0, MIN_HOLD_MS - held)));
    };
    if (document.readyState === "complete") onLoad();
    else window.addEventListener("load", onLoad, { once: true });
    timers.push(window.setTimeout(exit, MAX_HOLD_MS));

    // Never block shopping: any intent to interact skips the intro.
    const skip = () => exit();
    window.addEventListener("keydown", skip, { once: true });
    window.addEventListener("wheel", skip, { once: true, passive: true });
    window.addEventListener("touchmove", skip, { once: true, passive: true });

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener("load", onLoad);
      window.removeEventListener("keydown", skip);
      window.removeEventListener("wheel", skip);
      window.removeEventListener("touchmove", skip);
    };
  }, [exit, reveal]);

  if (phase === "done") return null;

  return (
    <motion.div
      className="mm-intro"
      aria-hidden="true"
      onPointerDown={exit}
      // While the curtain is leaving, let taps/clicks fall straight through to the store.
      style={{ pointerEvents: phase === "exit" ? "none" : "auto" }}
      initial={{ clipPath: "inset(0% 0% 0% 0%)" }}
      animate={{ clipPath: phase === "exit" ? "inset(100% 0% 0% 0%)" : "inset(0% 0% 0% 0%)" }}
      transition={{ duration: 0.8, ease: EASE_CURTAIN, delay: phase === "exit" ? 0.06 : 0 }}
      onAnimationComplete={() => {
        if (exitedRef.current && phase === "exit") finish();
      }}
    >
      {/* Backdrop: solid ivory from the first paint (hides the page), glow fades in */}
      <div className="absolute inset-0 bg-canvas" />
      <motion.div
        className="absolute inset-0 bg-[radial-gradient(50%_42%_at_50%_44%,rgb(201_165_76/0.26),transparent_72%)]"
        initial={{ opacity: 0 }}
        animate={{ opacity: phase === "exit" ? 0 : 1 }}
        transition={{ duration: phase === "exit" ? 0.4 : 0.3, ease: "easeOut" }}
      />

      <div className="relative grid h-full place-items-center px-6">
        <AnimatePresence>
          {phase === "intro" && (
            <motion.div
              key="brand"
              className="flex flex-col items-center"
              exit={{ opacity: 0, scale: 0.9, y: 10, transition: { duration: 0.4, ease: EASE_OUT } }}
            >
              <motion.div
                className="relative h-[clamp(132px,38vw,176px)] w-[clamp(132px,38vw,176px)]"
                initial={{ opacity: 0, scale: 0.86 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: 0.15, duration: 0.55, ease: EASE_OUT }}
              >
                {/* Soft gold halo */}
                <motion.span
                  className="absolute -inset-6 rounded-full bg-[radial-gradient(closest-side,rgb(232_205_126/0.55),transparent)] blur-md"
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: [0, 0.9, 0.55], scale: [0.8, 1.05, 1] }}
                  transition={{ delay: 0.2, duration: 1.1, ease: "easeOut" }}
                />
                {/* Plain <img>: the original artwork, untouched and not re-encoded */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/brand/logo-320.webp"
                  srcSet="/brand/logo-320.webp 320w, /brand/logo-640.webp 640w"
                  sizes="176px"
                  alt=""
                  width={176}
                  height={176}
                  fetchPriority="high"
                  className="relative h-full w-full object-contain drop-shadow-[0_12px_28px_rgb(138_101_22/0.35)]"
                />
                {/* Light reflection sweeping across the emblem */}
                <span className="pointer-events-none absolute inset-[4%] overflow-hidden rounded-full">
                  <motion.span
                    className="absolute inset-y-[-20%] w-[38%] rotate-[18deg] bg-gradient-to-r from-transparent via-white/70 to-transparent mix-blend-soft-light"
                    initial={{ left: "-60%" }}
                    animate={{ left: "130%" }}
                    transition={{ delay: 0.55, duration: 0.75, ease: "easeInOut" }}
                  />
                </span>
              </motion.div>

              {/* Tagline: rises from a mask */}
              <span className="mt-7 block overflow-hidden">
                <motion.span
                  className="block max-w-[300px] text-center text-[10.5px] leading-relaxed font-semibold tracking-[0.3em] text-ink/80 uppercase sm:max-w-none sm:text-[11.5px] sm:tracking-[0.42em]"
                  initial={{ y: "110%" }}
                  animate={{ y: "0%" }}
                  transition={{ delay: 0.6, duration: 0.5, ease: EASE_OUT }}
                >
                  {SITE.tagline}
                </motion.span>
              </span>

              {/* Gold line expands from the centre */}
              <motion.span
                className="mt-4 block h-px w-36 origin-center bg-gradient-to-r from-transparent via-gold to-transparent sm:w-44"
                initial={{ scaleX: 0, opacity: 0 }}
                animate={{ scaleX: 1, opacity: 1 }}
                transition={{ delay: 0.65, duration: 0.5, ease: EASE_OUT }}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
