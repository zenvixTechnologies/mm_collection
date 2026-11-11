"use client";

import { create } from "zustand";

/**
 * Hand-off between <IntroAnimation /> and the homepage <Hero />.
 * The hero waits (hidden) until `heroReady`, so its reveal plays exactly as the
 * intro curtain lifts — or immediately when there is no intro.
 */
interface IntroState {
  heroReady: boolean;
  /** True when the brand intro actually played on this load. */
  introPlayed: boolean;
  reveal: (introPlayed: boolean) => void;
}

export const useIntroStore = create<IntroState>()((set, get) => ({
  heroReady: false,
  introPlayed: false,
  reveal: (introPlayed) => {
    if (!get().heroReady) set({ heroReady: true, introPlayed });
  },
}));
