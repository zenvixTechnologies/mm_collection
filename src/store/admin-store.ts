"use client";

import { create } from "zustand";
import type {
  ActivityItem,
  AdminCategory,
  AdminCoupon,
  AdminCustomer,
  AdminImage,
  AdminNotification,
  AdminOffer,
  AdminOrder,
  AdminOrderStatus,
  AdminProduct,
  AdminUser,
  HomepageBanner,
  HomepageSection,
  InventoryItem,
  PaymentTransaction,
  ProductStatus,
  ShipmentTracking,
  ShippingSettings,
  StockAdjustment,
  StoreSettings,
} from "@/types/admin";
import { mockActivity, mockNotifications } from "@/data/admin/activity";
import { mockCustomers } from "@/data/admin/customers";
import { mockBanners, mockCoupons, mockFeaturedProductIds, mockHomepageSections, mockOffers } from "@/data/admin/marketing";
import { mockOrders, mockPayments } from "@/data/admin/orders";
import { mockShippingSettings, mockStoreSettings } from "@/data/admin/settings";
import { adminApi, errorMessage, onAdminSignedOut, refreshAdminSession } from "@/lib/admin-api";

import { rememberImages } from "@/lib/admin-upload";

/**
 * ADMIN STATE. Every admin screen reads and writes through this store.
 *
 * Catalogue data — products, categories, inventory and stock history — is loaded from and saved
 * to the API (MongoDB) here. Customers, orders, payments, coupons & offers, homepage and settings
 * screens load their data straight from the API (useAdminQuery) and no longer use this store.
 * The sample `orders`/`customers`/`notifications`/`activity` below only feed the dashboard
 * overview, which isn't connected to the backend yet.
 */

let idSeq = 0;
export function uid(prefix: string) {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}${idSeq}`;
}

const now = () => new Date().toISOString();

interface AdminData {
  products: AdminProduct[];
  categories: AdminCategory[];
  orders: AdminOrder[];
  customers: AdminCustomer[];
  payments: PaymentTransaction[];
  coupons: AdminCoupon[];
  offers: AdminOffer[];
  stockAdjustments: StockAdjustment[];
  /** One row per product variant. */
  inventory: InventoryItem[];
  catalogStatus: "idle" | "loading" | "ready" | "error";
  banners: HomepageBanner[];
  featuredProductIds: string[];
  homepageSections: HomepageSection[];
  shipping: ShippingSettings;
  settings: StoreSettings;
  notifications: AdminNotification[];
  activity: ActivityItem[];
}

interface AdminActions {
  /* catalogue (API) */
  loadCatalog: (force?: boolean) => Promise<Result>;
  saveProduct: (payload: ProductPayload, existingId: string | null) => Promise<Result<AdminProduct>>;
  deleteProducts: (ids: string[]) => Promise<Result>;
  setProductStatus: (ids: string[], status: ProductStatus) => Promise<Result<{ skipped: string[] }>>;
  adjustStock: (input: StockAdjustInput) => Promise<Result<InventoryItem>>;
  setLowStockThreshold: (productId: string, variantSku: string, threshold: number) => Promise<Result>;
  saveCategory: (category: AdminCategory, isNew: boolean, image?: AdminImage | null) => Promise<Result<AdminCategory>>;
  deleteCategory: (id: string) => Promise<Result>;
  moveCategory: (id: string, direction: -1 | 1) => Promise<Result>;
  /* orders */
  updateOrderStatus: (id: string, status: AdminOrderStatus) => void;
  setTracking: (id: string, tracking: ShipmentTracking) => void;
  addOrderNote: (id: string, text: string) => void;
  /* customers */
  updateCustomer: (id: string, patch: Partial<AdminCustomer>) => void;
  /* payments */
  refundPayment: (id: string, amount: number) => void;
  /* coupons & offers */
  saveCoupon: (coupon: AdminCoupon) => void;
  deleteCoupon: (id: string) => void;
  saveOffer: (offer: AdminOffer) => void;
  deleteOffer: (id: string) => void;
  /* homepage */
  saveBanner: (banner: HomepageBanner) => void;
  deleteBanner: (id: string) => void;
  setFeaturedProducts: (ids: string[]) => void;
  toggleSection: (id: string) => void;
  /* settings */
  updateShipping: (patch: Partial<ShippingSettings>) => void;
  updateSettings: (patch: Partial<StoreSettings>) => void;
  /* notifications */
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  resetDemo: () => void;
}

export type Result<T = undefined> = { ok: true; data: T; message?: string } | { ok: false; error: string };

/** Body of POST/PUT /api/v1/admin/products (money in paise). */
export interface ProductPayload {
  name: string;
  slug: string;
  sku: string;
  audience: string;
  category: string;
  tags: string[];
  shortDescription: string;
  description: string;
  images: AdminImage[];
  pricePaise: number;
  mrpPaise: number;
  variants: { size: string | null; color: { name: string; hex: string } | null; initialStock?: number; lowStockThreshold: number }[];
  fabric: string;
  care: string[];
  status: ProductStatus;
  featured: boolean;
  newArrival: boolean;
  bestSeller: boolean;
  weightGrams?: number;
}

export interface StockAdjustInput {
  productId: string;
  variantSku: string;
  mode: "add" | "remove" | "set";
  quantity: number;
  reason: StockAdjustment["reason"];
}

/** Every page of a paginated admin list. */
async function fetchAll<T>(path: string) {
  const items: T[] = [];
  for (let page = 1; page < 100; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const res = await adminApi<T[]>(`${path}${sep}page=${page}&limit=500`);
    items.push(...res.data);
    if (!res.pagination || page >= res.pagination.totalPages) break;
  }
  return items;
}

const fail = (err: unknown) => ({ ok: false as const, error: errorMessage(err) });

function initialData(): AdminData {
  // structuredClone so edits never leak into the shared mock modules.
  return structuredClone({
    products: [] as AdminProduct[],
    categories: [] as AdminCategory[],
    orders: mockOrders,
    customers: mockCustomers,
    payments: mockPayments,
    coupons: mockCoupons,
    offers: mockOffers,
    stockAdjustments: [] as StockAdjustment[],
    inventory: [] as InventoryItem[],
    catalogStatus: "idle" as AdminData["catalogStatus"],
    banners: mockBanners,
    featuredProductIds: mockFeaturedProductIds,
    homepageSections: mockHomepageSections,
    shipping: mockShippingSettings,
    settings: mockStoreSettings,
    notifications: mockNotifications,
    activity: mockActivity,
  });
}

function upsert<T extends { id: string }>(list: T[], item: T) {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list];
}

export const useAdminStore = create<AdminData & AdminActions>()((set, get) => {
  /** Record an entry in the dashboard's "Recent activity" feed. */
  const log = (action: string, target: string, href?: string): ActivityItem[] =>
    [{ id: uid("act"), actor: useAdminSession.getState().user?.name ?? "Admin", action, target, href, at: now() }, ...get().activity].slice(
      0,
      40,
    );

  const refreshInventory = async () => {
    try {
      set({ inventory: (await adminApi<InventoryItem[]>("/inventory")).data });
    } catch {
      /* the next full load will catch up */
    }
  };
  const refreshCategories = async () => {
    try {
      set({ categories: (await adminApi<AdminCategory[]>("/categories")).data });
    } catch {
      /* ignore */
    }
  };
  const refreshMovements = async () => {
    try {
      set({ stockAdjustments: (await adminApi<StockAdjustment[]>("/inventory/movements?limit=40")).data });
    } catch {
      /* ignore */
    }
  };

  return {
    ...initialData(),

    loadCatalog: async (force = false) => {
      const status = get().catalogStatus;
      if (!force && (status === "loading" || status === "ready")) return { ok: true, data: undefined };
      set({ catalogStatus: "loading" });
      try {
        const [products, categories, inventory, movements] = await Promise.all([
          fetchAll<AdminProduct>("/products"),
          adminApi<AdminCategory[]>("/categories"),
          adminApi<InventoryItem[]>("/inventory"),
          adminApi<StockAdjustment[]>("/inventory/movements?limit=40"),
        ]);
        products.forEach((p) => rememberImages(p.imageMeta));
        set({ products, categories: categories.data, inventory: inventory.data, stockAdjustments: movements.data, catalogStatus: "ready" });
        return { ok: true, data: undefined };
      } catch (err) {
        set({ catalogStatus: "error" });
        return fail(err);
      }
    },

    saveProduct: async (payload, existingId) => {
      try {
        const { data: saved } = existingId
          ? await adminApi<AdminProduct>(`/products/${encodeURIComponent(existingId)}`, { method: "PUT", body: payload })
          : await adminApi<AdminProduct>("/products", { method: "POST", body: payload });
        rememberImages(saved.imageMeta);
        const others = get().products.filter((p) => p.id !== saved.id && p.id !== existingId);
        set({ products: [saved, ...others], activity: log(existingId ? "updated product" : "added product", saved.name, "/mm-hub/products") });
        // Variant list and stock may have changed — refresh the dependent views.
        void refreshInventory();
        void refreshCategories();
        return { ok: true, data: saved };
      } catch (err) {
        return fail(err);
      }
    },

    deleteProducts: async (ids) => {
      try {
        const names = get().products.filter((p) => ids.includes(p.id)).map((p) => p.name);
        const { data } = await adminApi<{ deleted: string[] }>("/products/bulk", { method: "POST", body: { action: "delete", ids } });
        set({
          products: get().products.filter((p) => !data.deleted.includes(p.id)),
          featuredProductIds: get().featuredProductIds.filter((id) => !data.deleted.includes(id)),
          inventory: get().inventory.filter((i) => !data.deleted.includes(i.productId)),
          activity: log("deleted", names.length === 1 ? names[0] : `${names.length} products`, "/mm-hub/products"),
        });
        void refreshCategories();
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    setProductStatus: async (ids, status) => {
      try {
        const { data } = await adminApi<{ updated: string[]; skipped: string[] }>("/products/bulk", { method: "POST", body: { action: "status", ids, status } });
        const at = now();
        set({
          products: get().products.map((p) => (data.updated.includes(p.id) ? { ...p, status, updatedAt: at } : p)),
          inventory: get().inventory.map((i) => (data.updated.includes(i.productId) ? { ...i, status } : i)),
          activity: log(`set ${data.updated.length} product${data.updated.length === 1 ? "" : "s"} to`, status, "/mm-hub/products"),
        });
        return { ok: true, data: { skipped: data.skipped } };
      } catch (err) {
        return fail(err);
      }
    },

    adjustStock: async (input) => {
      try {
        const { data: item } = await adminApi<InventoryItem>("/inventory/adjust", { method: "POST", body: input });
        const before = get().inventory.find((i) => i.id === item.id)?.stock ?? item.stock;
        set({
          inventory: get().inventory.map((i) => (i.id === item.id ? item : i)),
          products: get().products.map((p) =>
            p.id === item.productId
              ? {
                  ...p,
                  stock: p.stock + (item.stock - before),
                  variants: p.variants?.map((v) => (v.sku === item.sku ? { ...v, stock: item.stock, available: item.available } : v)),
                }
              : p,
          ),
          activity: log(`adjusted stock (${item.stock - before > 0 ? "+" : ""}${item.stock - before}) for`, item.productName, "/mm-hub/inventory"),
        });
        void refreshMovements();
        return { ok: true, data: item };
      } catch (err) {
        return fail(err);
      }
    },

    setLowStockThreshold: async (productId, variantSku, threshold) => {
      try {
        const { data: item } = await adminApi<InventoryItem>("/inventory/threshold", { method: "PATCH", body: { productId, variantSku, threshold } });
        set({ inventory: get().inventory.map((i) => (i.id === item.id ? item : i)) });
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    saveCategory: async (category, isNew, image) => {
      try {
        const img = image === undefined ? (category.image ? { url: category.image, publicId: category.imagePublicId ?? null } : null) : image;
        const { data: saved } = isNew
          ? await adminApi<AdminCategory>("/categories", {
              method: "POST",
              body: { name: category.name, slug: category.slug, audience: category.audience, description: category.description, image: img, visible: category.visible },
            })
          : await adminApi<AdminCategory>(`/categories/${encodeURIComponent(category.id)}`, {
              method: "PATCH",
              body: { name: category.name, description: category.description, image: img, visible: category.visible },
            });
        set({
          categories: isNew ? [...get().categories, saved] : get().categories.map((c) => (c.id === saved.id ? saved : c)),
          activity: log(isNew ? "added category" : "updated category", saved.name, "/mm-hub/categories"),
        });
        return { ok: true, data: saved };
      } catch (err) {
        return fail(err);
      }
    },

    deleteCategory: async (id) => {
      try {
        const c = get().categories.find((x) => x.id === id);
        await adminApi(`/categories/${encodeURIComponent(id)}`, { method: "DELETE" });
        set({ categories: get().categories.filter((x) => x.id !== id), activity: log("deleted category", c?.name ?? id, "/mm-hub/categories") });
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    moveCategory: async (id, direction) => {
      try {
        const { data } = await adminApi<AdminCategory[]>(`/categories/${encodeURIComponent(id)}/move`, { method: "POST", body: { direction } });
        set({ categories: data });
        return { ok: true, data: undefined };
      } catch (err) {
        return fail(err);
      }
    },

    updateOrderStatus: (id, status) =>
      set({
        orders: get().orders.map((o) =>
          o.id === id
            ? {
                ...o,
                status,
                history: { ...o.history, [status]: o.history[status] ?? now() },
              }
            : o,
        ),
        activity: log(`marked ${status.toLowerCase()}`, id, `/mm-hub/orders/${id}`),
      }),
    setTracking: (id, tracking) =>
      set({
        orders: get().orders.map((o) => (o.id === id ? { ...o, tracking } : o)),
        activity: log("added tracking to", id, `/mm-hub/orders/${id}`),
      }),
    addOrderNote: (id, text) =>
      set({
        orders: get().orders.map((o) =>
          o.id === id
            ? { ...o, notes: [{ id: uid("note"), author: useAdminSession.getState().user?.name ?? "Admin", text, createdAt: now() }, ...o.notes] }
            : o,
        ),
      }),

    updateCustomer: (id, patch) => {
      const c = get().customers.find((x) => x.id === id);
      set({
        customers: get().customers.map((x) => (x.id === id ? { ...x, ...patch } : x)),
        activity: patch.status && c ? log(patch.status === "blocked" ? "blocked customer" : "unblocked customer", c.fullName, `/mm-hub/customers/${id}`) : get().activity,
      });
    },

    refundPayment: (id, amount) => {
      const p = get().payments.find((x) => x.id === id);
      if (!p) return;
      const refundedAmount = Math.min(p.amount, p.refundedAmount + amount);
      const status = refundedAmount >= p.amount ? "refunded" : "partially_refunded";
      set({
        payments: get().payments.map((x) => (x.id === id ? { ...x, refundedAmount, status } : x)),
        orders: get().orders.map((o) => (o.id === p.orderId ? { ...o, paymentStatus: status } : o)),
        activity: log("recorded a demo refund for", p.orderId ?? p.razorpayPaymentId, "/mm-hub/payments"),
      });
    },

    saveCoupon: (coupon) => {
      const exists = get().coupons.some((c) => c.id === coupon.id);
      set({ coupons: upsert(get().coupons, coupon), activity: log(exists ? "updated coupon" : "created coupon", coupon.code, "/mm-hub/coupons") });
    },
    deleteCoupon: (id) => {
      const c = get().coupons.find((x) => x.id === id);
      set({ coupons: get().coupons.filter((x) => x.id !== id), activity: log("deleted coupon", c?.code ?? id, "/mm-hub/coupons") });
    },
    saveOffer: (offer) => set({ offers: upsert(get().offers, offer), activity: log("saved offer", offer.title, "/mm-hub/coupons?tab=offers") }),
    deleteOffer: (id) => set({ offers: get().offers.filter((x) => x.id !== id) }),

    saveBanner: (banner) => {
      const exists = get().banners.some((b) => b.id === banner.id);
      set({
        banners: exists ? get().banners.map((b) => (b.id === banner.id ? banner : b)) : [...get().banners, banner],
        activity: log(exists ? "updated banner" : "added banner", banner.title, "/mm-hub/homepage"),
      });
    },
    deleteBanner: (id) => set({ banners: get().banners.filter((b) => b.id !== id) }),
    setFeaturedProducts: (featuredProductIds) =>
      set({ featuredProductIds, activity: log("updated featured products", `${featuredProductIds.length} products`, "/mm-hub/homepage") }),
    toggleSection: (id) =>
      set({ homepageSections: get().homepageSections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)) }),

    updateShipping: (patch) => set({ shipping: { ...get().shipping, ...patch }, activity: log("updated", "shipping settings", "/mm-hub/shipping") }),
    updateSettings: (patch) => set({ settings: { ...get().settings, ...patch }, activity: log("updated", "store settings", "/mm-hub/settings") }),

    markNotificationRead: (id) => set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }),
    markAllNotificationsRead: () => set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) }),
    resetDemo: () => {
      // Only the sample-data modules reset; the catalogue lives in the database.
      const { products, categories, inventory, stockAdjustments, catalogStatus } = get();
      set({ ...initialData(), products, categories, inventory, stockAdjustments, catalogStatus });
    },
  };
});

/* ---------- Admin session (real: HttpOnly cookies + /api/v1/admin/auth) ---------- */

interface AdminProfileDto {
  id: string;
  name: string;
  username: string | null;
  email: string | null;
  role: { key: string; name: string };
  permissions: string[];
}

function toAdminUser(p: AdminProfileDto): AdminUser {
  const initials = p.name
    .split(/s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return { id: p.id, name: p.name, email: p.email ?? p.username ?? "", role: p.role.name, roleKey: p.role.key, permissions: p.permissions, avatarInitials: initials || "A" };
}

type AuthStatus = "unknown" | "authenticated" | "anonymous";

interface AdminSessionState {
  user: AdminUser | null;
  status: AuthStatus;
  /** Restores the session from cookies (silently refreshing if the access token expired). */
  load: () => Promise<void>;
  login: (identifier: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  logout: () => Promise<void>;
  can: (permission: string) => boolean;
}

export const useAdminSession = create<AdminSessionState>()((set, get) => ({
  user: null,
  status: "unknown",

  load: async () => {
    try {
      const { data } = await adminApi<{ admin: AdminProfileDto }>("/auth/me");
      set({ user: toAdminUser(data.admin), status: "authenticated" });
    } catch {
      // No access token (or it expired with the tab closed) — try the refresh cookie once.
      if (await refreshAdminSession()) {
        try {
          const { data } = await adminApi<{ admin: AdminProfileDto }>("/auth/me");
          set({ user: toAdminUser(data.admin), status: "authenticated" });
          return;
        } catch {
          /* fall through */
        }
      }
      set({ user: null, status: "anonymous" });
    }
  },

  login: async (identifier, password) => {
    try {
      const { data } = await adminApi<{ admin: AdminProfileDto }>("/auth/login", { method: "POST", body: { identifier, password } });
      set({ user: toAdminUser(data.admin), status: "authenticated" });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  },

  logout: async () => {
    try {
      await adminApi("/auth/logout", { method: "POST" });
    } catch {
      /* cookies are cleared server-side when possible; sign out locally regardless */
    }
    set({ user: null, status: "anonymous" });
  },

  can: (permission) => !!get().user?.permissions.includes(permission),
}));

// Any API call that finds the session gone (revoked, expired, signed out elsewhere) signs out here too.
if (typeof window !== "undefined") {
  onAdminSignedOut(() => useAdminSession.setState({ user: null, status: "anonymous" }));
}
