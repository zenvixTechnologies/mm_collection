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
export const UPI_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

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
  if (!f.pincode.trim()) e.pincode = "PIN code is required.";
  else if (!PIN_RE.test(f.pincode.trim())) e.pincode = "Enter a valid 6-digit PIN code.";
  return e;
}
