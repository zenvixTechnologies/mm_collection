import "server-only";
import { createHash } from "node:crypto";
import { getEnv } from "@/server/config/env";
import { AppError } from "@/server/http/errors";

/**
 * Minimal Cloudinary client (signed REST calls). The API secret is only ever used here, on the
 * server, to sign requests — it is never sent to the browser.
 */

export const ALLOWED_FORMATS = ["jpg", "png", "webp", "avif"] as const;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const ROOT_FOLDER = "mm-collections";

export function cloudinaryConfig() {
  const env = getEnv("cloudinary");
  return { cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, apiSecret: env.CLOUDINARY_API_SECRET };
}

/** Cloudinary request signature: SHA-1 of the alphabetically sorted params + API secret. */
export function signParams(params: Record<string, string | number | boolean>, apiSecret: string) {
  const payload = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(payload + apiSecret).digest("hex");
}

export interface CloudinaryResource {
  public_id: string;
  format: string;
  bytes: number;
  width: number;
  height: number;
  secure_url: string;
  resource_type: string;
  type: string;
}

async function call<T>(path: string, init: RequestInit & { admin?: boolean } = {}): Promise<T> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const headers = new Headers(init.headers);
  if (init.admin) headers.set("Authorization", `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new AppError(res.status === 404 ? 404 : 502, res.status === 404 ? "NOT_FOUND" : "SERVICE_UNAVAILABLE", res.status === 404 ? "Image not found." : "The image service is unavailable. Please try again.", {
      cause: new Error(`Cloudinary ${res.status}: ${body.error?.message ?? "unknown error"}`),
    });
  }
  return body;
}

/** Details of an uploaded image, read from Cloudinary (never trusted from the browser). */
export function getResource(publicId: string) {
  return call<CloudinaryResource>(`/resources/image/upload/${publicId.split("/").map(encodeURIComponent).join("/")}`, { admin: true });
}

/** Deletes an image and purges it from the CDN. "not found" counts as success. */
export async function destroyImage(publicId: string): Promise<"ok" | "not found"> {
  const { apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const params = { public_id: publicId, timestamp, invalidate: "true" };
  const form = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: apiKey, signature: signParams(params, apiSecret) });
  const res = await call<{ result: string }>("/image/destroy", { method: "POST", body: form });
  if (res.result !== "ok" && res.result !== "not found") throw new Error(`Cloudinary destroy returned "${res.result}"`);
  return res.result as "ok" | "not found";
}
