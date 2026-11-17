"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  ActivityItem,
  AdminCategory,
  AdminCoupon,
  AdminCustomer,
  AdminNotification,
  AdminOffer,
  AdminOrder,
  AdminOrderStatus,
  AdminProduct,
  HomepageBanner,
  HomepageSection,
  PaymentTransaction,
  ProductStatus,
  ShipmentTracking,
  ShippingSettings,
  StockAdjustment,
  StoreSettings,
} from "@/types/admin";
import { mockActivity, mockNotifications, mockStockAdjustments } from "@/data/admin/activity";
import { mockCategories, mockProducts } from "@/data/admin/catalog";
import { mockCustomers } from "@/data/admin/customers";
import { mockBanners, mockCoupons, mockFeaturedProductIds, mockHomepageSections, mockOffers } from "@/data/admin/marketing";
import { mockOrders, mockPayments } from "@/data/admin/orders";
import { DEMO_ADMIN, mockAdminUser, mockShippingSettings, mockStoreSettings } from "@/data/admin/settings";

/**
 * ADMIN DEMO STATE — frontend only.
 *
 * Every admin screen reads and writes through this store. It starts from the mock data in
 * src/data/admin and keeps changes in memory (a page reload resets the demo). When the Node.js
 * API is ready, each action below becomes an API call; the components won't need to change.
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
  banners: HomepageBanner[];
  featuredProductIds: string[];
  homepageSections: HomepageSection[];
  shipping: ShippingSettings;
  settings: StoreSettings;
  notifications: AdminNotification[];
  activity: ActivityItem[];
}

interface AdminActions {
  /* products */
  saveProduct: (product: AdminProduct) => void;
  deleteProducts: (ids: string[]) => void;
  setProductStatus: (ids: string[], status: ProductStatus) => void;
  adjustStock: (productId: string, change: number, reason: StockAdjustment["reason"]) => void;
  setLowStockThreshold: (productId: string, threshold: number) => void;
  /* categories */
  saveCategory: (category: AdminCategory) => void;
  deleteCategory: (id: string) => void;
  moveCategory: (id: string, direction: -1 | 1) => void;
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

function initialData(): AdminData {
  // structuredClone so edits never leak into the shared mock modules.
  return structuredClone({
    products: mockProducts,
    categories: mockCategories,
    orders: mockOrders,
    customers: mockCustomers,
    payments: mockPayments,
    coupons: mockCoupons,
    offers: mockOffers,
    stockAdjustments: mockStockAdjustments,
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

  return {
    ...initialData(),

    saveProduct: (product) => {
      const exists = get().products.some((p) => p.id === product.id);
      const saved = { ...product, updatedAt: now() };
      set({
        products: upsert(get().products, saved),
        activity: log(exists ? "updated product" : "added product", product.name, "/admin/products"),
      });
    },
    deleteProducts: (ids) => {
      const names = get().products.filter((p) => ids.includes(p.id)).map((p) => p.name);
      set({
        products: get().products.filter((p) => !ids.includes(p.id)),
        featuredProductIds: get().featuredProductIds.filter((id) => !ids.includes(id)),
        activity: log("deleted", names.length === 1 ? names[0] : `${names.length} products`, "/admin/products"),
      });
    },
    setProductStatus: (ids, status) =>
      set({
        products: get().products.map((p) => (ids.includes(p.id) ? { ...p, status, updatedAt: now() } : p)),
        activity: log(`set ${ids.length} product${ids.length > 1 ? "s" : ""} to`, status, "/admin/products"),
      }),
    adjustStock: (productId, change, reason) => {
      const p = get().products.find((x) => x.id === productId);
      if (!p) return;
      const stockAfter = Math.max(0, p.stock + change);
      set({
        products: get().products.map((x) => (x.id === productId ? { ...x, stock: stockAfter, updatedAt: now() } : x)),
        stockAdjustments: [
          {
            id: uid("adj"),
            productId,
            productName: p.name,
            sku: p.sku,
            change: stockAfter - p.stock,
            reason,
            stockAfter,
            by: useAdminSession.getState().user?.name ?? "Admin",
            at: now(),
          },
          ...get().stockAdjustments,
        ],
        activity: log(`adjusted stock (${change > 0 ? "+" : ""}${change}) for`, p.name, "/admin/inventory"),
      });
    },
    setLowStockThreshold: (productId, threshold) =>
      set({ products: get().products.map((p) => (p.id === productId ? { ...p, lowStockThreshold: threshold } : p)) }),

    saveCategory: (category) => {
      const exists = get().categories.some((c) => c.id === category.id);
      set({
        categories: exists
          ? get().categories.map((c) => (c.id === category.id ? category : c))
          : [...get().categories, { ...category, sortOrder: get().categories.length }],
        activity: log(exists ? "updated category" : "added category", category.name, "/admin/categories"),
      });
    },
    deleteCategory: (id) => {
      const c = get().categories.find((x) => x.id === id);
      set({ categories: get().categories.filter((x) => x.id !== id), activity: log("deleted category", c?.name ?? id, "/admin/categories") });
    },
    moveCategory: (id, direction) => {
      const target = get().categories.find((c) => c.id === id);
      if (!target) return;
      const siblings = get()
        .categories.filter((c) => c.audience === target.audience)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const i = siblings.findIndex((c) => c.id === id);
      const swap = siblings[i + direction];
      if (!swap) return;
      set({
        categories: get().categories.map((c) =>
          c.id === id ? { ...c, sortOrder: swap.sortOrder } : c.id === swap.id ? { ...c, sortOrder: target.sortOrder } : c,
        ),
      });
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
        activity: log(`marked ${status.toLowerCase()}`, id, `/admin/orders/${id}`),
      }),
    setTracking: (id, tracking) =>
      set({
        orders: get().orders.map((o) => (o.id === id ? { ...o, tracking } : o)),
        activity: log("added tracking to", id, `/admin/orders/${id}`),
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
        activity: patch.status && c ? log(patch.status === "blocked" ? "blocked customer" : "unblocked customer", c.fullName, `/admin/customers/${id}`) : get().activity,
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
        activity: log("recorded a demo refund for", p.orderId ?? p.razorpayPaymentId, "/admin/payments"),
      });
    },

    saveCoupon: (coupon) => {
      const exists = get().coupons.some((c) => c.id === coupon.id);
      set({ coupons: upsert(get().coupons, coupon), activity: log(exists ? "updated coupon" : "created coupon", coupon.code, "/admin/coupons") });
    },
    deleteCoupon: (id) => {
      const c = get().coupons.find((x) => x.id === id);
      set({ coupons: get().coupons.filter((x) => x.id !== id), activity: log("deleted coupon", c?.code ?? id, "/admin/coupons") });
    },
    saveOffer: (offer) => set({ offers: upsert(get().offers, offer), activity: log("saved offer", offer.title, "/admin/coupons?tab=offers") }),
    deleteOffer: (id) => set({ offers: get().offers.filter((x) => x.id !== id) }),

    saveBanner: (banner) => {
      const exists = get().banners.some((b) => b.id === banner.id);
      set({
        banners: exists ? get().banners.map((b) => (b.id === banner.id ? banner : b)) : [...get().banners, banner],
        activity: log(exists ? "updated banner" : "added banner", banner.title, "/admin/homepage"),
      });
    },
    deleteBanner: (id) => set({ banners: get().banners.filter((b) => b.id !== id) }),
    setFeaturedProducts: (featuredProductIds) =>
      set({ featuredProductIds, activity: log("updated featured products", `${featuredProductIds.length} products`, "/admin/homepage") }),
    toggleSection: (id) =>
      set({ homepageSections: get().homepageSections.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)) }),

    updateShipping: (patch) => set({ shipping: { ...get().shipping, ...patch }, activity: log("updated", "shipping settings", "/admin/shipping") }),
    updateSettings: (patch) => set({ settings: { ...get().settings, ...patch }, activity: log("updated", "store settings", "/admin/settings") }),

    markNotificationRead: (id) => set({ notifications: get().notifications.map((n) => (n.id === id ? { ...n, read: true } : n)) }),
    markAllNotificationsRead: () => set({ notifications: get().notifications.map((n) => ({ ...n, read: true })) }),
    resetDemo: () => set(initialData()),
  };
});

/* ---------- Admin session (MOCK — replace with real admin auth) ---------- */

interface AdminSessionState {
  user: typeof mockAdminUser | null;
  login: (email: string, password: string) => { ok: true } | { ok: false; error: string };
  logout: () => void;
}

export const useAdminSession = create<AdminSessionState>()(
  persist(
    (set) => ({
      user: null,
      login: (email, password) => {
        if (email.trim().toLowerCase() !== DEMO_ADMIN.email || password !== DEMO_ADMIN.password) {
          return { ok: false, error: "Incorrect email or password." };
        }
        set({ user: mockAdminUser });
        return { ok: true };
      },
      logout: () => set({ user: null }),
    }),
    // sessionStorage: closing the browser signs the demo admin out.
    { name: "mm-admin-session", storage: createJSONStorage(() => sessionStorage) },
  ),
);
