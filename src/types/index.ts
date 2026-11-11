export type CategoryId =
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

export interface Category {
  id: CategoryId;
  slug: CategoryId;
  name: string;
  description: string;
  image: string;
}

export interface ProductColor {
  name: string;
  hex: string;
}

export type Size = "XS" | "S" | "M" | "L" | "XL" | "XXL" | "Free Size";

export interface Product {
  id: string;
  slug: string;
  sku: string;
  name: string;
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
}

export type CouponType = "percent" | "flat" | "freeship";

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
  shipping: number;
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

export type PaymentMethod = "cod" | "upi" | "card";

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
  couponCode: string | null;
  subtotal: number;
  discount: number;
  shipping: number;
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
