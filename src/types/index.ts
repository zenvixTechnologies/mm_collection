/**
 * Top-level shopping audience — the store's main categories (Women / Men / Kids / Home & Living).
 * Women is the brand's primary focus and the default.
 */
export type Audience = "women" | "men" | "kids" | "home-living";

export type WomenCategoryId =
  | "dresses"
  | "tops"
  | "kurtis"
  | "churidhars"
  | "sarees"
  | "co-ord-sets"
  | "ethnic-wear"
  | "western-wear"
  | "casual-wear"
  | "party-wear"
  | "nightwear"
  | "feeding-wear";

export type MenCategoryId =
  | "men-shirts"
  | "men-t-shirts"
  | "men-jeans"
  | "men-trousers"
  | "men-casual-wear"
  | "men-formal-wear"
  | "men-ethnic-wear"
  | "men-co-ord-sets";

export type KidsCategoryId =
  | "kids-boys"
  | "kids-girls"
  | "kids-dresses"
  | "kids-t-shirts"
  | "kids-sets"
  | "kids-baby"
  | "kids-ethnic-wear"
  | "kids-casual-wear";

export type HomeLivingCategoryId = "home-bedsheets" | "home-pillow-covers" | "home-cushion-covers" | "home-blankets";

/** A sub-category within one audience (e.g. Men → Shirts, Home & Living → Bedsheets). */
export type CategoryId = WomenCategoryId | MenCategoryId | KidsCategoryId | HomeLivingCategoryId;

export interface Category {
  id: CategoryId;
  slug: CategoryId;
  audience: Audience;
  name: string;
  description: string;
  image: string;
}

export interface ProductColor {
  name: string;
  hex: string;
}

export type Size =
  | "XS"
  | "S"
  | "M"
  | "L"
  | "XL"
  | "XXL"
  | "Free Size"
  // Men's jeans / trousers — waist in inches
  | "28"
  | "30"
  | "32"
  | "34"
  | "36"
  // Kids' age sizes
  | "0-6M"
  | "6-12M"
  | "1-2Y"
  | "3-4Y"
  | "5-6Y"
  | "7-8Y"
  | "9-10Y"
  // Home & Living — bed sizes and cushion / pillow dimensions
  | "Single"
  | "Double"
  | "Queen"
  | "King"
  | "Standard"
  | "16 × 16 in"
  | "18 × 18 in"
  | "24 × 24 in";

export interface Product {
  id: string;
  slug: string;
  sku: string;
  name: string;
  /** Primary filter: who the product is for. Always matches the audience of `categoryId`. */
  audienceCategory: Audience;
  /** The product's sub-category within its audience (e.g. "men-shirts"). */
  categoryId: CategoryId;
  /** Additional categories this product also appears in (e.g. a kurti is also Ethnic Wear). */
  tags: CategoryId[];
  shortDescription: string;
  description: string;
  originalPrice: number;
  price: number;
  discount: number;
  images: string[];
  sizes: Size[];
  colors: ProductColor[];
  stock: number;
  rating: number;
  reviewCount: number;
  featured: boolean;
  newArrival: boolean;
  bestSeller: boolean;
  fabric: string;
  care: string[];
  /** Sort key for "Newest" — higher is newer. */
  addedAt: number;
  /** Units sold — used for "Best Selling" sort. */
  sold: number;
  /** Packed shipping weight in grams (always > 0 for shippable products). */
  weight: number;
  /** Weight is stored in grams; kept explicit so future imports can't mix units. */
  weightUnit: "g";
  /** Packed parcel size in centimetres — used for volumetric weight when enabled. */
  packageLength: number;
  packageWidth: number;
  packageHeight: number;
}

export interface CartItem {
  key: string;
  productId: string;
  slug: string;
  name: string;
  image: string;
  price: number;
  originalPrice: number;
  size: Size | null;
  color: string | null;
  quantity: number;
  stock: number;
  /** Optional so bags saved before audiences existed still load. */
  audience?: Audience;
}

export type CouponType = "percent" | "flat";

export interface Coupon {
  code: string;
  type: CouponType;
  value: number;
  minOrder: number;
  maxDiscount?: number;
  description: string;
}

/** Bag and wishlist limits — enforced by the server, mirrored in the UI. */
export const MAX_LINE_QUANTITY = 20;
export const MAX_CART_LINES = 50;
export const MAX_WISHLIST_ITEMS = 200;

/**
 * The bag as returned by /api/v1/cart. Every price is read from MongoDB at request time.
 * In each line `key` is the variant SKU (the line ID in /api/v1/cart/items/:id) and `stock` is
 * that variant's currently available units.
 */
export interface CartSnapshot {
  items: CartItem[];
  itemCount: number;
  /** Rupees, from live variant prices. */
  subtotal: number;
  mrpTotal: number;
  /** What changed since the bag was last seen: sold-out or removed items, reduced quantities. */
  notices: string[];
}

export interface WishlistSnapshot {
  /** Public product IDs, newest first. Products no longer on sale are left out. */
  items: { productId: string; addedAt: string }[];
}

/* ---------- Checkout (POST /api/v1/checkout/validate) ---------- */

/** What is being bought: the server-side bag, or one "Buy Now" line that leaves the bag alone. */
export type CheckoutSource =
  | { type: "cart" }
  | { type: "buy-now"; item: { productId: string; size: Size | null; color: string | null; quantity: number } };

export type CheckoutIssueCode = "unavailable" | "out_of_stock" | "insufficient_stock" | "price_changed" | "empty";

/** A problem with one line (or the whole bag) that must be fixed before the order can be placed. */
export interface CheckoutIssue {
  code: CheckoutIssueCode;
  /** Variant SKU of the affected line, when there is one. */
  sku: string | null;
  message: string;
  /** False for informational notices (a price changed — the quote already shows the new price). */
  blocking: boolean;
}

export interface CheckoutCoupon {
  code: string;
  /** applied → discount is in the totals; rejected → `message` says why (nothing is discounted). */
  status: "applied" | "rejected";
  description: string;
  message: string | null;
  /** Rupees. */
  discount: number;
}

/** A server-computed price quote. Every amount comes from MongoDB at request time. */
export interface CheckoutQuote {
  /** One line per variant; `key` is the variant SKU, `price` its current selling price. */
  items: CartItem[];
  totals: CartTotals;
  /** Exact integer paise — send `totalPaise` back as `expectedTotalPaise` when placing the order. */
  amounts: { subtotalPaise: number; mrpTotalPaise: number; discountPaise: number; totalPaise: number };
  coupon: CheckoutCoupon | null;
  issues: CheckoutIssue[];
  canPlaceOrder: boolean;
  currency: "INR";
}

/** A homepage banner the storefront shows (active and within its dates). */
export interface StorefrontBanner {
  eyebrow: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  image: string;
}

/** A coupon the storefront may advertise (GET /api/v1/coupons). */
export interface PublicCoupon {
  code: string;
  description: string;
  type: CouponType;
  /** Percent, or rupees for flat coupons. */
  value: number;
  /** Rupees. */
  minOrder: number;
  maxDiscount: number | null;
}

export interface CartTotals {
  itemCount: number;
  subtotal: number;
  mrpTotal: number;
  couponDiscount: number;
  /**
   * Shipping charges are applicable but not calculated yet (rates will be configured in the
   * admin dashboard), so this is always null for now and the total excludes shipping.
   */
  shipping: number | null;
  total: number;
  savings: number;
}

export interface Address {
  house: string;
  street: string;
  city: string;
  district: string;
  state: string;
  pincode: string;
}

export interface CustomerDetails {
  fullName: string;
  mobile: string;
  email: string;
}

/**
 * Domestic (India-only) payment methods, collected through Razorpay.
 * "cod" is no longer offered at checkout; it stays in the type so older saved orders still display.
 */
export type PaymentMethod = "cod" | "upi" | "card" | "netbanking";

/** The only country we deliver to and accept payments from. */
export const STORE_COUNTRY = "India" as const;
export const STORE_CURRENCY = "INR" as const;

/** Server-verified Razorpay payment reference stored with an order. */
export interface PaymentRecord {
  provider: "razorpay";
  mode: "test" | "live";
  razorpayOrderId: string;
  razorpayPaymentId: string;
  currency: typeof STORE_CURRENCY;
  /** Amount actually captured, in rupees — taken from Razorpay, never from the browser. */
  amount: number;
}

export const ORDER_STATUSES = [
  "Order Placed",
  "Confirmed",
  "Processing",
  "Shipped",
  "Out for Delivery",
  "Delivered",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Statuses outside the delivery timeline: waiting for payment (stock is reserved), or an order
 * that ended before it was paid.
 */
export const ORDER_SIDE_STATUSES = ["Payment Pending", "Payment Failed", "Expired", "Cancelled"] as const;
/** "Packed" is an optional step between Processing and Shipped (see timelineSteps). */
export type StoreOrderStatus = OrderStatus | "Packed" | (typeof ORDER_SIDE_STATUSES)[number];

export interface OrderItem {
  productId: string;
  audience?: Audience;
  slug: string;
  name: string;
  image: string;
  /** Unit selling price paid, in rupees (frozen at checkout). */
  price: number;
  /** Unit MRP at checkout, in rupees. Absent on older/sample orders. */
  mrp?: number;
  /** Variant SKU. Absent on older/sample orders. */
  sku?: string;
  size: Size | null;
  color: string | null;
  quantity: number;
}

export interface Order {
  /** Customer-facing order number, e.g. MM7K2Q9XW4. */
  id: string;
  createdAt: string;
  items: OrderItem[];
  customer: CustomerDetails;
  address: Address;
  paymentMethod: PaymentMethod;
  /** Present for orders paid through Razorpay; absent on older/sample orders. */
  payment?: PaymentRecord;
  /** While payment is pending: when the reserved stock is released (ISO). */
  reservedUntil?: string | null;
  couponCode: string | null;
  subtotal: number;
  discount: number;
  /** null = shipping charges applicable, amount not calculated at checkout. */
  shipping: number | null;
  total: number;
  status: OrderStatus;
  /** ISO timestamps per reached status, for the tracking timeline. */
  history: Partial<Record<OrderStatus, string>>;
}

/**
 * An order as the storefront shows it (from /api/v1/orders), which may also be waiting for
 * payment or have ended unpaid. Every `Order` is a valid `StoreOrder`.
 */
export interface StoreOrder extends Omit<Order, "status" | "history"> {
  status: StoreOrderStatus;
  history: Partial<Record<StoreOrderStatus, string>>;
  /**
   * Payment as far as the customer is concerned: pending (not paid yet), failed (the last attempt
   * failed — they can try again while the order is reserved), paid or refunded.
   */
  paymentState?: "pending" | "failed" | "paid" | "refunded";
  /** Latest status change (ISO). */
  lastUpdatedAt?: string;
}

/** POST /api/v1/payments/razorpay/create and /payments/:id/retry — what Razorpay Checkout needs. */
export interface PaymentStart {
  /** Public Key ID only — never the secret. */
  keyId: string;
  mode: "test" | "live";
  razorpayOrderId: string;
  /** Exactly the stored order total, in paise. */
  amountPaise: number;
  currency: "INR";
  orderId: string;
  attempt: number;
  /** When the stock hold ends (ISO); Checkout closes itself before then. */
  reservedUntil: string;
  timeoutSeconds: number;
  prefill: { name: string; email: string; contact: string };
}

/** GET /api/v1/payments/:id/status */
export interface PaymentStatusView {
  orderId: string;
  status: StoreOrderStatus;
  paymentState: NonNullable<StoreOrder["paymentState"]>;
  reservedUntil: string | null;
  /** Payment can be started (or retried) now. */
  canPay: boolean;
  attempts: { attempt: number; status: string; createdAt: string; failure: string | null }[];
}

/** POST /api/v1/checkout/orders response. */
export interface PlacedOrder {
  order: StoreOrder;
  /**
   * Guests only: proves this browser placed the order (send as the X-Order-Token header to read
   * it again). Never put it in a URL.
   */
  accessToken: string | null;
}

export interface Review {
  id: string;
  name: string;
  location: string;
  rating: number;
  title: string;
  comment: string;
  date: string;
  productName?: string;
}

export interface ReviewImage {
  url: string;
  width: number;
  height: number;
}

/** A verified-purchase review as shoppers see it — no order or account details. */
export interface ProductReview {
  id: string;
  /** First name and last initial. */
  authorName: string;
  rating: number;
  title: string;
  comment: string;
  createdAt: string;
  images: ReviewImage[];
}

export interface ProductReviewList {
  average: number;
  count: number;
  /** Reviews per star, 5★ first. */
  distribution: number[];
  items: ProductReview[];
  page: number;
  totalPages: number;
}

/** The signed-in customer's position on one product of their order, decided by the server. */
export interface OrderProductReview {
  productId: string;
  status: "awaiting_delivery" | "eligible" | "reviewed" | "unavailable";
  review: ProductReview | null;
}

/** How much of an order's payment has really been returned. "pending" = nothing issued yet. */
export interface RefundSummary {
  state: "none" | "pending" | "processing" | "partial" | "refunded";
  /** Completed and in-progress amounts, in rupees. */
  refunded: number;
  processing: number;
}

/** One order line, and whether a return can be requested for it now. */
export interface ReturnLine {
  itemId: string;
  name: string;
  size: string | null;
  color: string | null;
  quantity: number;
  returnableQuantity: number;
  reasons: import("@/lib/after-sales").ReturnReason[];
  message: string | null;
}

/** A return request as its customer sees it — never staff notes or names. */
export interface CustomerReturnRequest {
  id: string;
  name: string;
  size: string | null;
  color: string | null;
  quantity: number;
  reason: string;
  explanation: string;
  comments: string;
  status: import("@/lib/after-sales").ReturnStatus;
  statusLabel: string;
  requestedAt: string;
  history: { status: string; at: string }[];
}

export interface CustomerCancellation {
  reason: string;
  otherReason: string;
  details: string;
  requestedAt: string;
}

export interface AfterSalesView {
  orderStatus: StoreOrderStatus;
  cancel: "on" | "off" | "hidden";
  cancellation: CustomerCancellation | null;
  refund: RefundSummary | null;
  returnWindowEndsAt: string | null;
  lines: ReturnLine[];
  requests: CustomerReturnRequest[];
}

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  code?: string;
  href: string;
}

/** A saved delivery address on a customer account. */
export interface SavedAddress extends Address {
  id: string;
  label: string;
  /** Recipient, when different from the account holder. */
  fullName?: string;
  mobile?: string;
  isDefault: boolean;
}

/** The signed-in customer, as returned by GET /api/v1/auth/me. Never contains secrets. */
export interface User {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  /** Default address first. */
  addresses: SavedAddress[];
  emailVerified: boolean;
  marketingOptIn: boolean;
  createdAt: string;
}
