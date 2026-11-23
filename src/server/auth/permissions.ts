import "server-only";

/**
 * Every permission an admin role can hold. API routes check permissions, never role names,
 * so Manager and Staff access can be tuned per store without code changes.
 */
export const PERMISSIONS = [
  "dashboard:read",
  "products:read",
  "products:write",
  "products:delete",
  "categories:read",
  "categories:write",
  "inventory:read",
  "inventory:write",
  "orders:read",
  "orders:write",
  "customers:read",
  "customers:write",
  "coupons:read",
  "coupons:write",
  "payments:read",
  "payments:refund",
  "reviews:moderate",
  "homepage:write",
  "shipping:write",
  "settings:read",
  "settings:write",
  "uploads:write",
  "admins:read",
  "admins:write",
  "roles:write",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const SYSTEM_ROLES = ["owner", "manager", "staff"] as const;
export type SystemRole = (typeof SYSTEM_ROLES)[number];

/** Starting permissions for the three built-in roles. Owner always has everything. */
export const DEFAULT_ROLE_PERMISSIONS: Record<SystemRole, readonly Permission[]> = {
  owner: PERMISSIONS,
  manager: PERMISSIONS.filter((p) => !["admins:write", "roles:write", "settings:write"].includes(p)),
  staff: [
    "dashboard:read",
    "products:read",
    "categories:read",
    "inventory:read",
    "inventory:write",
    "orders:read",
    "orders:write",
    "customers:read",
    "reviews:moderate",
  ],
};
