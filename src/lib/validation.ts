import type { Address, CustomerDetails } from "@/types";

export const INDIAN_STATES = [
  "Andaman and Nicobar Islands", "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chandigarh",
  "Chhattisgarh", "Dadra and Nagar Haveli and Daman and Diu", "Delhi", "Goa", "Gujarat", "Haryana",
  "Himachal Pradesh", "Jammu and Kashmir", "Jharkhand", "Karnataka", "Kerala", "Ladakh", "Lakshadweep",
  "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Puducherry",
  "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand",
  "West Bengal",
];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PIN_RE = /^[1-9]\d{5}$/;

/** Normalises +91 / 0 prefixes and returns the 10-digit number. */
export function normalizeMobile(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function isValidMobile(value: string) {
  return /^[6-9]\d{9}$/.test(normalizeMobile(value));
}

export type CheckoutForm = CustomerDetails & Address;
export type FormErrors<T> = Partial<Record<keyof T, string>>;

export function validateCheckout(f: CheckoutForm): FormErrors<CheckoutForm> {
  const e: FormErrors<CheckoutForm> = {};
  if (f.fullName.trim().length < 3) e.fullName = "Please enter your full name.";
  else if (!/^[\p{L} .'-]+$/u.test(f.fullName.trim())) e.fullName = "Name can only contain letters and spaces.";
  if (!f.mobile.trim()) e.mobile = "Mobile number is required.";
  else if (!isValidMobile(f.mobile)) e.mobile = "Enter a valid 10-digit Indian mobile number (starting with 6–9).";
  if (!f.email.trim()) e.email = "Email address is required.";
  else if (!EMAIL_RE.test(f.email.trim())) e.email = "Enter a valid email address.";
  if (!f.house.trim()) e.house = "House / building is required.";
  if (!f.street.trim()) e.street = "Street / area is required.";
  if (!f.city.trim()) e.city = "City is required.";
  if (!f.district.trim()) e.district = "District is required.";
  if (!f.state) e.state = "Please select your state.";
  else if (!INDIAN_STATES.includes(f.state)) e.state = "We currently deliver within India only — please pick an Indian state.";
  if (!f.pincode.trim()) e.pincode = "PIN code is required.";
  else if (!PIN_RE.test(f.pincode.trim())) e.pincode = "Enter a valid 6-digit PIN code.";
  return e;
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Server-side: coerce an untrusted JSON body into a checkout form and validate it.
 * Only Indian delivery addresses are accepted (Indian state + 6-digit PIN + optional country "India").
 */
export function parseCheckoutInput(input: unknown):
  | { ok: true; customer: CustomerDetails; address: Address }
  | { ok: false; errors: FormErrors<CheckoutForm> | { country: string } } {
  const body = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const c = (body.customer && typeof body.customer === "object" ? body.customer : {}) as Record<string, unknown>;
  const a = (body.address && typeof body.address === "object" ? body.address : {}) as Record<string, unknown>;
  const country = str(a.country ?? "India").trim();
  if (country.toLowerCase() !== "india" && country.toUpperCase() !== "IN") {
    return { ok: false, errors: { country: "We currently deliver within India only." } };
  }
  const form: CheckoutForm = {
    fullName: str(c.fullName).trim(),
    mobile: str(c.mobile, 20).trim(),
    email: str(c.email).trim(),
    house: str(a.house).trim(),
    street: str(a.street).trim(),
    city: str(a.city).trim(),
    district: str(a.district).trim(),
    state: str(a.state).trim(),
    pincode: str(a.pincode, 10).trim(),
  };
  const errors = validateCheckout(form);
  if (Object.keys(errors).length) return { ok: false, errors };
  return {
    ok: true,
    customer: { fullName: form.fullName, mobile: normalizeMobile(form.mobile), email: form.email },
    address: { house: form.house, street: form.street, city: form.city, district: form.district, state: form.state, pincode: form.pincode },
  };
}
