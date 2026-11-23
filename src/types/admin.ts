/**
 * Admin dashboard data contracts.
 *
 * These describe what the future Node.js API will return. The admin UI only ever reads and
 * writes these shapes (through src/store/admin-store.ts), so swapping the mock data for real
 * API calls later doesn't require touching the components.
 */
import type {
  Address,
  Audience,
  Category,
  Coupon,
  CustomerDetails,
  Offer,
  Order,
  OrderStatus,
  PaymentMethod,
  Product,
} from "./index";

/* ---------- Products & categories ---------- */

export type ProductStatus = "active" | "draft" | "archived";

/**
 * A catalogue product as the admin sees it. Category ids are plain strings here because the
 * admin can create new categories that the storefront's `CategoryId` union doesn't know yet.
 */
export interface AdminProduct extends Omit<Product, "categoryId" | "tags"> {
  categoryId: string;
  tags: string[];
  status: ProductStatus;
  /** Stock at or below this number is flagged as low stock (sum of the variants' alert levels). */
  lowStockThreshold: number;
  updatedAt: string;
  /** Size × colour variants with their own SKU and stock (from the API). */
  variants?: AdminVariant[];
  /** Image details matching `images` by position (Cloudinary public ID etc.). */
  imageMeta?: AdminImage[];
  /** Units held by unpaid checkouts. */
  reserved?: number;
}

export interface AdminImage {
  url: string;
  publicId?: string | null;
  width?: number | null;
  height?: number | null;
  alt?: string;
}

export interface AdminVariant {
  sku: string;
  size: string | null;
  color: { name: string; hex: string } | null;
  /** Units on hand (including reserved). */
  stock: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isActive: boolean;
  pricePaise: number;
  mrpPaise: number;
}

/** One row of the inventory screen: a single variant of a product. */
export interface InventoryItem {
  id: string;
  productId: string;
  productName: string;
  slug: string;
  image: string | null;
  audienceCategory: Audience;
  status: ProductStatus;
  sku: string;
  size: string | null;
  color: string | null;
  stock: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  /** Selling price in rupees, for stock value. */
  price: number;
}

export interface AdminCategory extends Omit<Category, "id" | "slug"> {
  /** The slug — the same identifier the storefront uses. */
  id: string;
  slug: string;
  visible: boolean;
  sortOrder: number;
  /** Products whose main sub-category this is (from the API). */
  productCount?: number;
  imagePublicId?: string | null;
}

/* ---------- Orders, customers, payments ---------- */

/** "Cancelled" exists only on the admin side until the storefront learns to show it. */
export type AdminOrderStatus = OrderStatus | "Cancelled";

export type PaymentStatus = "created" | "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";

export interface ShipmentTracking {
  courier: string;
  awb: string;
  url?: string;
  shippedAt?: string;
}

export interface AdminOrder extends Omit<Order, "status" | "history"> {
  status: AdminOrderStatus;
  history: Partial<Record<AdminOrderStatus, string>>;
  customerId: string;
  paymentStatus: PaymentStatus;
  tracking?: ShipmentTracking;
  /** Private notes visible only to staff. */
  notes: AdminNote[];
}

export interface AdminNote {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export type CustomerStatus = "active" | "blocked";

export interface AdminCustomer extends CustomerDetails {
  id: string;
  joinedAt: string;
  status: CustomerStatus;
  addresses: Address[];
  /** Audience they buy for most — used for segments. */
  primaryAudience: Audience;
  marketingOptIn: boolean;
  notes: string;
}

/** Customer joined with figures computed from their orders. */
export interface CustomerWithStats extends AdminCustomer {
  orderCount: number;
  totalSpent: number;
  lastOrderAt: string | null;
}

export interface PaymentTransaction {
  id: string;
  razorpayPaymentId: string;
  razorpayOrderId: string;
  /** null when the payment failed, so no store order was created. */
  orderId: string | null;
  customerId: string;
  customerName: string;
  email: string;
  method: Exclude<PaymentMethod, "cod">;
  /** Bank, card network or UPI app — display only. */
  methodDetail: string;
  amount: number;
  /** Razorpay fee + GST, in rupees (mock figures). */
  fee: number;
  refundedAmount: number;
  status: PaymentStatus;
  mode: "test" | "live";
  createdAt: string;
  errorReason?: string;
}

/* ---------- Coupons & offers ---------- */

export interface AdminCoupon extends Coupon {
  id: string;
  active: boolean;
  usageCount: number;
  /** null = unlimited */
  usageLimit: number | null;
  startsAt: string;
  endsAt: string | null;
}

export interface AdminOffer extends Offer {
  active: boolean;
}

/* ---------- Inventory ---------- */

export interface StockAdjustment {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  change: number;
  reason: "Restock" | "Sale" | "Return" | "Damaged" | "Correction";
  stockAfter: number;
  by: string;
  at: string;
}

/* ---------- Homepage ---------- */

export type BannerPlacement = "hero" | "promo";

export interface HomepageBanner {
  id: string;
  placement: BannerPlacement;
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  image: string;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
}

export interface HomepageSection {
  id: string;
  label: string;
  description: string;
  visible: boolean;
}

/* ---------- Shipping & settings ---------- */

export interface CourierPartner {
  id: string;
  name: string;
  trackingUrlTemplate: string;
  enabled: boolean;
}

export interface ShippingSettings {
  /** Text shown wherever a shipping amount would appear. No amounts are configured yet. */
  chargesNotice: string;
  deliveryEstimate: string;
  dispatchTime: string;
  country: "India";
  couriers: CourierPartner[];
}

export interface StoreSettings {
  storeName: string;
  tagline: string;
  logo: string;
  email: string;
  phone: string;
  whatsapp: string;
  address: string;
  hours: string;
  gstin: string;
  social: { instagram: string; facebook: string; youtube: string };
  policies: { returnWindowDays: number; exchangeOnly: boolean; returnPolicySummary: string; privacyContact: string };
  notifications: { newOrder: boolean; lowStock: boolean; paymentFailed: boolean; dailySummary: boolean };
}

/* ---------- Dashboard ---------- */

export interface AdminNotification {
  id: string;
  kind: "order" | "stock" | "payment" | "customer";
  title: string;
  body: string;
  href: string;
  at: string;
  read: boolean;
}

export interface ActivityItem {
  id: string;
  actor: string;
  action: string;
  target: string;
  href?: string;
  at: string;
}

export interface DailySales {
  /** ISO date, yyyy-mm-dd */
  date: string;
  revenue: number;
  orders: number;
}

/** The signed-in admin, as returned by GET /api/v1/admin/auth/me. */
export interface AdminUser {
  id: string;
  name: string;
  email: string;
  /** Role display name: "Owner", "Manager", "Staff" or a custom role. */
  role: string;
  roleKey: string;
  permissions: string[];
  avatarInitials: string;
}
