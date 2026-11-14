import type { AdminUser, ShippingSettings, StoreSettings } from "@/types/admin";
import { SITE } from "@/lib/utils";

export const mockStoreSettings: StoreSettings = {
  storeName: SITE.name,
  tagline: SITE.tagline,
  logo: "/brand/logo-320.webp",
  email: SITE.email,
  phone: SITE.phone,
  whatsapp: SITE.whatsapp,
  address: SITE.address,
  hours: SITE.hours,
  gstin: "32ABCDE1234F1Z5",
  social: {
    instagram: "https://instagram.com/mmcollections",
    facebook: "https://facebook.com/mmcollections",
    youtube: "https://youtube.com/@mmcollections",
  },
  policies: {
    returnWindowDays: 7,
    exchangeOnly: false,
    returnPolicySummary:
      "Unused items with original tags can be returned within 7 days of delivery. Innerwear, customised and sale items are not returnable.",
    privacyContact: SITE.email,
  },
  notifications: { newOrder: true, lowStock: true, paymentFailed: true, dailySummary: false },
};

/**
 * Shipping is shown as "Shipping Charges Applicable" across the store.
 * No amounts or rate rules are configured here on purpose.
 */
export const mockShippingSettings: ShippingSettings = {
  chargesNotice: "Shipping Charges Applicable",
  deliveryEstimate: "Delivered across India in 3–7 working days",
  dispatchTime: "Orders are packed and dispatched within 1–2 working days",
  country: "India",
  couriers: [
    { id: "delhivery", name: "Delhivery", trackingUrlTemplate: "https://www.delhivery.com/track/package/{awb}", enabled: true },
    { id: "bluedart", name: "Blue Dart", trackingUrlTemplate: "https://www.bluedart.com/tracking?awb={awb}", enabled: true },
    { id: "dtdc", name: "DTDC", trackingUrlTemplate: "https://www.dtdc.in/tracking.asp?awb={awb}", enabled: true },
    { id: "indiapost", name: "India Post", trackingUrlTemplate: "https://www.indiapost.gov.in/track?id={awb}", enabled: false },
  ],
};

/** Demo-only admin account. Real admin authentication comes with the backend. */
export const DEMO_ADMIN = {
  email: "admin@mmcollections.in",
  password: "admin123",
};

export const mockAdminUser: AdminUser = {
  name: "Maria Mathew",
  email: DEMO_ADMIN.email,
  role: "Owner",
  avatarInitials: "MM",
};
