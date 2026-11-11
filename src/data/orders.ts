import type { Order, OrderItem, OrderStatus } from "@/types";
import { ORDER_STATUSES } from "@/types";
import { products } from "./products";

/** Demo account used for mock sign-in and pre-filled order history. */
export const DEMO_USER = {
  id: "u-demo",
  fullName: "Anjali Menon",
  email: "demo@mmcollections.in",
  mobile: "9876543210",
  password: "demo1234",
  addresses: [
    {
      house: "Flat 4B, Lotus Residency",
      street: "Panampilly Nagar",
      city: "Kochi",
      district: "Ernakulam",
      state: "Kerala",
      pincode: "682036",
    },
  ],
};

function item(index: number, quantity: number, size: OrderItem["size"], colorIndex = 0): OrderItem {
  const p = products[index];
  return {
    productId: p.id,
    slug: p.slug,
    name: p.name,
    image: p.images[0],
    price: p.price,
    size: p.sizes.includes(size as never) ? size : p.sizes[0],
    color: p.colors[colorIndex]?.name ?? null,
    quantity,
  };
}

function history(createdAt: string, status: OrderStatus) {
  const reached = ORDER_STATUSES.slice(0, ORDER_STATUSES.indexOf(status) + 1);
  const start = new Date(createdAt).getTime();
  const gapsInHours = [0, 2, 20, 30, 70, 80];
  return Object.fromEntries(
    reached.map((s, i) => [s, new Date(start + gapsInHours[i] * 3600_000).toISOString()]),
  ) as Order["history"];
}

function order(
  id: string,
  createdAt: string,
  items: OrderItem[],
  status: OrderStatus,
  paymentMethod: Order["paymentMethod"],
  couponCode: string | null = null,
  discount = 0,
): Order {
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shipping = subtotal >= 999 ? 0 : 79;
  return {
    id,
    createdAt,
    items,
    customer: { fullName: DEMO_USER.fullName, mobile: DEMO_USER.mobile, email: DEMO_USER.email },
    address: DEMO_USER.addresses[0],
    paymentMethod,
    couponCode,
    subtotal,
    discount,
    shipping,
    total: subtotal - discount + shipping,
    status,
    history: history(createdAt, status),
  };
}

/** Sample order history shown for the demo account and searchable on the tracking page. */
export const sampleOrders: Order[] = [
  order("MM24A7K1", "2026-11-08T10:24:00+05:30", [item(0, 1, "M"), item(8, 2, "M", 1)], "Shipped", "upi"),
  order("MM24A3F9", "2026-11-02T18:05:00+05:30", [item(23, 1, "Free Size")], "Out for Delivery", "cod", "WELCOME10", 300),
  order("MM24931C", "2026-10-21T12:40:00+05:30", [item(2, 2, "L", 1)], "Delivered", "card", "FIRSTORDER", 100),
  order("MM248Q2D", "2026-10-03T09:15:00+05:30", [item(7, 1, "M"), item(5, 1, "M", 1)], "Delivered", "cod"),
  order("MM2471ZX", "2026-11-10T21:30:00+05:30", [item(6, 1, "S")], "Processing", "upi"),
  order("MM246P0B", "2026-11-11T08:55:00+05:30", [item(27, 1, "M"), item(16, 1, "S")], "Confirmed", "cod"),
];
