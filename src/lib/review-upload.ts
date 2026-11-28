"use client";

import { ApiError } from "./api-client";
import { customerApi } from "./customer-api";

/**
 * One review photo: our API signs a one-time upload, the browser sends the file straight to
 * Cloudinary, then our API checks it and answers with the ID to submit with the review.
 * The Cloudinary API secret never reaches the browser.
 */
export async function uploadReviewPhoto(orderId: string, productId: string, file: File): Promise<string> {
  const base = `/orders/${encodeURIComponent(orderId)}/reviews/uploads`;
  const { data: signed } = await customerApi<{ uploadId: string; uploadUrl: string; fields: Record<string, string> }>(`${base}/sign`, {
    method: "POST",
    body: { productId, contentType: file.type, size: file.size },
  });

  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(signed.fields)) form.append(k, v);
  let res: Response;
  try {
    res = await fetch(signed.uploadUrl, { method: "POST", body: form });
  } catch {
    throw new ApiError("Upload failed. Check your connection and try again.", 0, "NETWORK_ERROR");
  }
  if (!res.ok) throw new ApiError("The photo couldn't be uploaded. Please try another one.", res.status, "BAD_REQUEST");

  const { data } = await customerApi<{ id: string }>(`${base}/confirm`, { method: "POST", body: { productId, uploadId: signed.uploadId } });
  return data.id;
}
