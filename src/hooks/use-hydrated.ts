"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * Returns false during SSR and the first client render, true afterwards.
 * Use it to gate UI that reads from localStorage-persisted stores so the
 * server and client markup always match.
 */
export function useHydrated() {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
