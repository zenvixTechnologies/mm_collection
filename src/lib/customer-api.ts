"use client";

import { createApiClient } from "./api-client";

/**
 * Browser client for customer endpoints (/api/v1/auth/*, /api/v1/account/*). Uses the customer
 * session cookies — completely separate from the admin panel's.
 */
const client = createApiClient({ base: "/api/v1", refreshPath: "/api/v1/auth/refresh" });

export const customerApi = client.request;
export const refreshCustomerSession = client.refresh;
export const onCustomerSignedOut = client.onSignedOut;

/** True when the (non-secret) "signed in" hint cookie is present — saves guests a session check. */
export function hasSessionHint() {
  return typeof document !== "undefined" && document.cookie.split("; ").some((c) => c === "mm_signed_in=1");
}
