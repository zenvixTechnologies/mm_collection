/** Top-level shopping audience. Women is the brand's primary focus and the default. */
export type Audience = "women" | "men" | "kids";

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

/** A sub-category within one audience (e.g. Men → Shirts). */
export type CategoryId = WomenCategoryId | MenCategoryId | KidsCategoryId;

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
  | "9-10Y";

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

export interface OrderItem {
  productId: string;
  audience?: Audience;
  slug: string;
  name: string;
  image: string;
  price: number;
  size: Size | null;
  color: string | null;
  quantity: number;
}

export interface Order {
  id: string;
  createdAt: string;
  items: OrderItem[];
  customer: CustomerDetails;
  address: Address;
  paymentMethod: PaymentMethod;
  /** Present for orders paid through Razorpay; absent on older/sample orders. */
  payment?: PaymentRecord;
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

export interface Offer {
  id: string;
  title: string;
  subtitle: string;
  code?: string;
  href: string;
}

export interface User {
  id: string;
  fullName: string;
  email: string;
  mobile: string;
  password: string;
  addresses: Address[];
}
