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

/** Fulfilment statuses plus the ones an order can have before or instead of being paid. */
export type AdminOrderStatus = OrderStatus | "Packed" | "Cancelled" | "Payment Pending" | "Payment Failed" | "Expired";

export type PaymentStatus = "created" | "pending" | "authorized" | "captured" | "failed" | "refunded" | "partially_refunded";

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
  /** Present when the customer cancelled the order themselves. */
  cancellation?: import("./index").CustomerCancellation & { statusAtRequest: AdminOrderStatus };
  /** From the API: placed without an account. */
  guest?: boolean;
  /** Rupees refunded so far (from Razorpay-confirmed refunds). */
  refunded?: number;
  /** Something that needs staff attention (e.g. paid after the stock was released). */
  exception?: { code: string; message: string; at: string | null } | null;
  /** Every status change with who made it. */
  timeline?: { status: AdminOrderStatus; from?: AdminOrderStatus; at: string; by: string; note: string }[];
  /** Statuses the server will accept next for this order. */
  allowedTransitions?: AdminOrderStatus[];
}

/** One page of a server-paginated admin list. */
export interface AdminPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/** A review in the admin list. Staff can view and delete, never edit. */
export interface AdminReview {
  id: string;
  productName: string;
  productSlug: string | null;
  authorName: string;
  rating: number;
  title: string;
  comment: string;
  createdAt: string;
  images: { url: string; width: number; height: number }[];
  verified: boolean;
  orderNumber: string | null;
  /** Set if the order that proved the purchase was cancelled or fully refunded afterwards. */
  orderNow: "cancelled" | "refunded" | null;
}

export interface AdminReturnRequest extends Omit<import("./index").CustomerReturnRequest, "history"> {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  sku: string;
  unitPrice: number;
  deliveredAt: string;
  withinClaimWindow: boolean | null;
  refund: import("./index").RefundSummary | null;
  allowedStatuses: import("@/lib/after-sales").ReturnStatus[];
  history: { status: string; at: string; by: string }[];
  /** Staff only. */
  adminNotes: AdminNote[];
}

export interface AdminCancellation {
  /** The order number. */
  id: string;
  customerName: string;
  customerEmail: string;
  products: string[];
  total: number;
  reason: string;
  otherReason: string;
  details: string;
  requestedAt: string;
  statusAtRequest: string;
  refund: import("./index").RefundSummary;
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
  /** From the API: attempt number for the store order (1, 2… after retries). */
  attempt?: number;
  /** How the success was confirmed: checkout signature check, webhook or reconciliation. */
  verifiedBy?: "verify" | "webhook" | "reconcile" | null;
  capturedAt?: string | null;
}

export interface PaymentRefund {
  razorpayRefundId: string;
  amount: number;
  status: "pending" | "processed" | "failed";
  reason: string;
  source: "admin" | "webhook" | "sync";
  by: string | null;
  createdAt: string | null;
  processedAt: string | null;
}

/** GET /api/v1/admin/payments/:id */
export interface PaymentDetailView {
  payment: PaymentTransaction;
  failures: { razorpayPaymentId: string; code: string | null; description: string | null; method: string | null; source: string; at: string }[];
  refunds: PaymentRefund[];
  webhooks: { type: string; status: string; attempts: number; at: string; processedAt: string | null; error: string | null }[];
  order: { id: string; status: AdminOrderStatus; total: number; paymentStatus: PaymentStatus } | null;
  refundable: number;
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
  /** Uses allowed per customer (by account or email); null = unlimited. */
  perCustomerLimit?: number | null;
  /** Shown in the storefront's "available coupons" list. */
  listed?: boolean;
  /** Public product IDs / category slugs the coupon is limited to (empty = everything). */
  products?: string[];
  categories?: string[];
  /** Never discounted. */
  excludedProducts?: string[];
  excludedCategories?: string[];
}

export interface CouponUsage {
  orderId: string;
  customer: string;
  email: string;
  discount: number;
  status: "reserved" | "redeemed" | "released";
  at: string;
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
  /** From the API: Cloudinary public ID of the image (absent for older, non-Cloudinary images). */
  imagePublicId?: string | null;
  sortOrder?: number;
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
  /** From the API: default search title/description. */
  seo?: { title: string; description: string };
}

/** GET /api/v1/admin/settings — editable settings plus read-only facts that can't be changed here. */
export interface AdminSettingsView {
  settings: StoreSettings;
  shipping: ShippingSettings;
  /** Payment gateway status from the server environment — never any secret, key ID masked. */
  payments: { configured: boolean; mode: "test" | "live" | null; keyIdMasked: string | null; webhookConfigured: boolean };
  locked: { currency: "INR"; country: "India"; codEnabled: false; shippingNotice: "Shipping Charges Applicable" };
  /** Send back as `version` to avoid overwriting someone else's newer changes. */
  version: string;
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
