import type { OrderProductReview, StoreOrderStatus } from "@/types";

/* ---------- Photo rules, shared by the server and the review form ---------- */

export const MAX_REVIEW_IMAGES = 3;
export const MAX_REVIEW_IMAGE_BYTES = 5 * 1024 * 1024;
export const REVIEW_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** The same three types, as Cloudinary names them. */
export const REVIEW_IMAGE_FORMATS = ["jpg", "png", "webp"] as const;

export function checkReviewImage(file: { name: string; type: string; size: number }): string | null {
  if (!(REVIEW_IMAGE_TYPES as readonly string[]).includes(file.type)) return `${file.name}: use a JPG, PNG or WebP image.`;
  if (file.size > MAX_REVIEW_IMAGE_BYTES) return `${file.name} is larger than 5 MB.`;
  if (file.size === 0) return `${file.name} is empty.`;
  return null;
}

/** Why the review can't be sent yet because of its photos, or null. */
export function uploadBlocker(images: { status: "uploading" | "done" | "error" }[]): string | null {
  if (images.some((i) => i.status === "uploading")) return "Wait for your photos to finish uploading.";
  if (images.some((i) => i.status === "error")) return "Remove the photo that failed to upload before submitting.";
  return null;
}

/* ---------- What each product on the order page offers ---------- */

export const DELIVERY_MESSAGE = "You can review this product after delivery.";
const ENDED: StoreOrderStatus[] = ["Cancelled", "Expired", "Payment Failed"];

export interface ItemReviewView {
  /** "off" shows the button disabled; "hidden" shows no button. */
  button: "on" | "off" | "hidden";
  message: string | null;
  reviewed: boolean;
  retry?: boolean;
}

/**
 * The button is enabled only after the server has said "eligible" for this product on this
 * delivered order. (The server checks everything again on upload and submit.)
 */
export function itemReviewView(
  auth: "unknown" | "authenticated" | "anonymous",
  orderStatus: StoreOrderStatus,
  entry: OrderProductReview | null,
  failure: "not-yours" | "error" | null = null,
): ItemReviewView {
  const view = (button: ItemReviewView["button"], message: string | null, more: Partial<ItemReviewView> = {}) => ({ button, message, reviewed: false, ...more });
  if (auth === "authenticated" && entry?.status === "reviewed") return view("hidden", null, { reviewed: true });
  // An order that will never be delivered has nothing to offer.
  if (ENDED.includes(orderStatus)) return view("hidden", null);
  if (orderStatus !== "Delivered") return view("off", DELIVERY_MESSAGE);
  if (auth === "unknown") return view("off", null);
  if (auth === "anonymous" || failure === "not-yours") return view("hidden", "Only the account that placed this order can review it. Guest orders can't be reviewed.");
  if (!entry) return failure ? view("off", "We couldn't check whether you can review this product.", { retry: true }) : view("off", null);
  if (entry.status === "eligible") return view("on", null);
  if (entry.status === "awaiting_delivery") return view("off", DELIVERY_MESSAGE);
  return view("hidden", "This item isn't eligible for a review.");
}
