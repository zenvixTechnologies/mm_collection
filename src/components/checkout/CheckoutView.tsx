"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { CreditCard, Info, Landmark, Loader2, Lock, ShoppingBag, Smartphone } from "lucide-react";
import { useRef, useState } from "react";
import {
  STORE_COUNTRY,
  type Address,
  type CartItem,
  type CartTotals,
  type Order,
  type OrderItem,
  type PaymentMethod,
  type PaymentRecord,
} from "@/types";
import { useHydrated } from "@/hooks/use-hydrated";
import { calculateTotals } from "@/lib/pricing";
import { DOMESTIC_ONLY_CONFIG, loadRazorpay, openRazorpay, type RazorpaySuccess } from "@/lib/razorpay/checkout";
import { SITE, cn, formatPrice } from "@/lib/utils";
import {
  INDIAN_STATES,
  normalizeMobile,
  validateCheckout,
  type CheckoutForm,
  type FormErrors,
} from "@/lib/validation";
import { useCurrentUser, useAuthStore } from "@/store/auth-store";
import { useCartStore } from "@/store/cart-store";
import { useCheckoutStore } from "@/store/checkout-store";
import { useOrderStore } from "@/store/order-store";
import { toast } from "@/store/ui-store";
import { CouponForm } from "@/components/cart/CouponForm";
import { OrderSummary } from "@/components/cart/OrderSummary";
import { Breadcrumbs } from "@/components/ui/Breadcrumbs";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { LineSkeleton } from "@/components/ui/Skeletons";
import { ProductImage } from "@/components/ui/ProductImage";

const EMPTY: CheckoutForm = {
  fullName: "",
  mobile: "",
  email: "",
  house: "",
  street: "",
  city: "",
  district: "",
  state: "Kerala",
  pincode: "",
};

type OnlineMethod = Extract<PaymentMethod, "upi" | "card" | "netbanking">;

// Prepaid only, through Razorpay, for Indian customers — no Cash on Delivery, no international payments.
const PAYMENT_OPTIONS: { id: OnlineMethod; label: string; desc: string; icon: typeof CreditCard }[] = [
  { id: "upi", label: "UPI", desc: "Google Pay, PhonePe, Paytm or any UPI app", icon: Smartphone },
  { id: "card", label: "Credit / Debit Card", desc: "Indian Visa, Mastercard and RuPay cards", icon: CreditCard },
  { id: "netbanking", label: "Net Banking", desc: "All major Indian banks", icon: Landmark },
];

interface CreateOrderResponse {
  orderId: string;
  razorpayOrderId: string;
  amount: number;
  currency: "INR";
  keyId: string;
  mode: "test" | "live";
  totals: CartTotals;
}

interface VerifyResponse {
  orderId: string;
  paymentMethod: PaymentMethod;
  payment: PaymentRecord;
  items: OrderItem[];
  totals: CartTotals;
  couponCode: string | null;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

export function CheckoutView({ mode }: { mode: "cart" | "buy-now" }) {
  const hydrated = useHydrated();
  const router = useRouter();
  const cartItems = useCartStore((s) => s.items);
  const couponCode = useCartStore((s) => s.couponCode);
  const clearCart = useCartStore((s) => s.clear);
  const buyNowItem = useCheckoutStore((s) => s.buyNowItem);
  const clearBuyNow = useCheckoutStore((s) => s.clearBuyNow);
  const addOrder = useOrderStore((s) => s.addOrder);
  const user = useCurrentUser();
  const addAddress = useAuthStore((s) => s.addAddress);

  const isBuyNow = mode === "buy-now" && !!buyNowItem;
  const lines: CartItem[] = isBuyNow && buyNowItem ? [buyNowItem] : cartItems;
  // Shipping charges apply but aren't calculated yet — the total excludes shipping.
  const totals = calculateTotals(lines, couponCode);

  const [form, setForm] = useState<CheckoutForm>(EMPTY);
  const [prefilledFor, setPrefilledFor] = useState<string | null>(null);
  const [errors, setErrors] = useState<FormErrors<CheckoutForm>>({});
  const [payment, setPayment] = useState<OnlineMethod>("upi");
  const [placing, setPlacing] = useState(false);
  const [saveAddress, setSaveAddress] = useState(true);
  const formRef = useRef<HTMLFormElement>(null);

  // Prefill once from the signed-in (mock) account.
  if (hydrated && user && prefilledFor !== user.id) {
    setPrefilledFor(user.id);
    setForm((f) => ({
      ...f,
      fullName: f.fullName || user.fullName,
      email: f.email || user.email,
      mobile: f.mobile || user.mobile,
      ...(user.addresses[0] && !f.house ? user.addresses[0] : {}),
    }));
  }

  const set = (key: keyof CheckoutForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = key === "pincode" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value;
    setForm((f) => ({ ...f, [key]: value }));
    if (errors[key]) setErrors((er) => ({ ...er, [key]: undefined }));
  };

  const applySaved = (a: Address) => {
    setForm((f) => ({ ...f, ...a }));
    setErrors({});
  };

  const placeOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (placing) return;
    const errs = validateCheckout(form);
    setErrors(errs);
    if (Object.keys(errs).length) {
      toast.error("Please fix the highlighted fields");
      // Move focus to the first invalid field.
      window.setTimeout(() => {
        formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
      }, 0);
      return;
    }

    setPlacing(true);
    const address: Address = {
      house: form.house.trim(),
      street: form.street.trim(),
      city: form.city.trim(),
      district: form.district.trim(),
      state: form.state,
      pincode: form.pincode.trim(),
    };
    const customer = { fullName: form.fullName.trim(), mobile: normalizeMobile(form.mobile), email: form.email.trim() };
    // Only item IDs, variants and quantities are sent — the server prices the order itself.
    const items = lines.map((l) => ({ productId: l.productId, size: l.size, color: l.color, quantity: l.quantity }));
    const appliedCoupon = totals.couponDiscount > 0 ? couponCode : null;
    const fail = (message: string) => {
      setPlacing(false);
      toast.error(message);
    };

    let created: CreateOrderResponse;
    try {
      created = await postJson<CreateOrderResponse>("/api/payments/razorpay/order", {
        items,
        couponCode: appliedCoupon,
        customer,
        address: { ...address, country: STORE_COUNTRY },
      });
    } catch (err) {
      return fail((err as Error).message);
    }

    if (!(await loadRazorpay())) return fail("Couldn't load the payment window. Check your connection and try again.");

    const onPaid = async (res: RazorpaySuccess) => {
      try {
        const v = await postJson<VerifyResponse>("/api/payments/razorpay/verify", { ...res, items, couponCode: appliedCoupon });
        const now = new Date().toISOString();
        const order: Order = {
          id: v.orderId,
          createdAt: now,
          items: v.items,
          customer,
          address,
          paymentMethod: v.paymentMethod,
          payment: v.payment,
          couponCode: v.couponCode,
          subtotal: v.totals.subtotal,
          discount: v.totals.couponDiscount,
          // Shipping charges are applicable but not calculated yet, so they are not part of the total.
          shipping: null,
          // The amount Razorpay actually captured, as confirmed by our server.
          total: v.payment.amount,
          status: "Order Placed",
          history: { "Order Placed": now },
        };
        addOrder(order);
        if (user && saveAddress) addAddress(address);
        if (isBuyNow) clearBuyNow();
        else clearCart();
        router.replace(`/order-success?id=${order.id}`);
      } catch (err) {
        fail((err as Error).message);
      }
    };

    try {
      openRazorpay(
        {
          key: created.keyId,
          amount: created.amount,
          currency: "INR",
          order_id: created.razorpayOrderId,
          name: SITE.name,
          description: `Order ${created.orderId}`,
          prefill: { name: customer.fullName, email: customer.email, contact: `+91${customer.mobile}`, method: payment },
          notes: { store_order_id: created.orderId },
          theme: { color: "#b3121b" },
          config: DOMESTIC_ONLY_CONFIG,
          modal: { ondismiss: () => fail("Payment cancelled. Your bag is saved — you can try again.") },
          handler: (res) => void onPaid(res),
        },
        (message) => toast.error(message),
      );
    } catch {
      fail("Couldn't open the payment window. Please try again.");
    }
  };

  if (!hydrated) {
    return (
      <Shell>
        <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_400px]">
          <div className="skeleton h-[520px] rounded-2xl" />
          <LineSkeleton rows={2} />
        </div>
      </Shell>
    );
  }

  if (!lines.length && !placing) {
    return (
      <Shell>
        <EmptyState
          icon={<ShoppingBag size={40} />}
          title="Nothing to check out"
          description="Your bag is empty. Add a few favourites and come back here to place your order."
          actionLabel="Shop Now"
          actionHref="/shop"
        />
      </Shell>
    );
  }

  return (
    <Shell>
      {!user && (
        <p className="mt-5 rounded-xl bg-canvas px-4 py-3 text-sm text-muted">
          Checking out as a guest.{" "}
          <Link href="/login?next=/checkout" className="font-semibold text-ink underline underline-offset-2">
            Log in
          </Link>{" "}
          to use saved addresses — or just continue below, no account needed.
        </p>
      )}
      {isBuyNow && (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted">
          <Info size={15} className="text-accent" /> Buying this item directly — items in your bag are kept for later.
        </p>
      )}

      <form ref={formRef} onSubmit={placeOrder} noValidate className="mt-6 grid gap-8 pb-28 lg:grid-cols-[1fr_400px] lg:gap-12 lg:pb-0">
        <div className="space-y-8">
          <Step n={1} title="Contact details">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name" name="fullName" autoComplete="name" value={form.fullName} onChange={set("fullName")} error={errors.fullName} className="sm:col-span-2" />
              <Field
                label="Mobile number"
                name="mobile"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="10-digit mobile"
                value={form.mobile}
                onChange={set("mobile")}
                error={errors.mobile}
                hint="For delivery updates"
              />
              <Field label="Email address" name="email" type="email" autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} hint="We'll email your order confirmation" />
            </div>
          </Step>

          <Step n={2} title="Delivery address">
            {user && user.addresses.length > 0 && (
              <div className="mb-5">
                <p className="mb-2 text-sm font-medium">Saved addresses</p>
                <div className="flex flex-wrap gap-2">
                  {user.addresses.map((a, i) => {
                    const active = a.house === form.house && a.pincode === form.pincode;
                    return (
                      <button
                        key={i}
                        type="button"
                        onClick={() => applySaved(a)}
                        aria-pressed={active}
                        className={cn(
                          "rounded-xl border px-4 py-2.5 text-left text-[13px] transition-colors",
                          active ? "border-ink bg-sand" : "border-line hover:border-ink",
                        )}
                      >
                        <span className="block font-medium">{a.house}</span>
                        <span className="text-muted">
                          {a.city}, {a.pincode}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="House / Building" name="house" autoComplete="address-line1" placeholder="Flat no., building name" value={form.house} onChange={set("house")} error={errors.house} className="sm:col-span-2" />
              <Field label="Street / Area" name="street" autoComplete="address-line2" placeholder="Street, locality, landmark" value={form.street} onChange={set("street")} error={errors.street} className="sm:col-span-2" />
              <Field label="City" name="city" autoComplete="address-level2" value={form.city} onChange={set("city")} error={errors.city} />
              <Field label="District" name="district" value={form.district} onChange={set("district")} error={errors.district} />
              <div>
                <label htmlFor="state" className="field-label">
                  State<span className="text-accent" aria-hidden> *</span>
                </label>
                <div className="relative">
                <select
                  id="state"
                  name="state"
                  autoComplete="address-level1"
                  value={form.state}
                  onChange={set("state")}
                  aria-invalid={errors.state ? true : undefined}
                  className="field-input"
                >
                  <option value="">Select state</option>
                  {INDIAN_STATES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
                </div>
                {errors.state && <p className="field-error">{errors.state}</p>}
              </div>
              <Field
                label="PIN code"
                name="pincode"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                value={form.pincode}
                onChange={set("pincode")}
                error={errors.pincode}
              />
              <Field
                label="Country"
                name="country"
                autoComplete="country-name"
                value={STORE_COUNTRY}
                readOnly
                aria-readonly
                hint="We currently deliver within India only"
                className="sm:col-span-2"
              />
            </div>
            {user && (
              <label className="mt-4 flex items-center gap-2.5 text-sm">
                <input type="checkbox" checked={saveAddress} onChange={(e) => setSaveAddress(e.target.checked)} className="h-[18px] w-[18px] accent-accent" />
                Save this address to my account
              </label>
            )}
          </Step>

          <Step n={3} title="Payment method">
            <div role="radiogroup" aria-label="Payment method" className="space-y-3">
              {PAYMENT_OPTIONS.map((opt) => {
                const active = payment === opt.id;
                return (
                  <div key={opt.id} className={cn("rounded-2xl border transition-colors", active ? "border-ink bg-canvas" : "border-line")}>
                    <label className="flex cursor-pointer items-center gap-4 px-4 py-4">
                      <input
                        type="radio"
                        name="payment"
                        value={opt.id}
                        checked={active}
                        onChange={() => setPayment(opt.id)}
                        className="h-[18px] w-[18px] accent-accent"
                      />
                      <opt.icon size={22} className={active ? "text-accent" : "text-muted"} />
                      <span className="flex-1">
                        <span className="block text-[15px] font-semibold">{opt.label}</span>
                        <span className="text-[13px] text-muted">{opt.desc}</span>
                      </span>
                    </label>
                    <AnimatePresence initial={false}>
                      {active && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="px-4 pb-4">
                            <p className="flex gap-2 rounded-xl bg-white px-3 py-2.5 text-[13px] text-muted">
                              <Info size={15} className="mt-0.5 shrink-0 text-accent" />
                              {opt.id === "upi"
                                ? "You'll approve the payment in your UPI app through Razorpay's secure checkout."
                                : opt.id === "card"
                                  ? "Card details are entered on Razorpay's secure, PCI-DSS compliant checkout — we never see or store them. Only cards issued in India are accepted."
                                  : "You'll log in to your bank securely through Razorpay to approve the payment."}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </Step>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-2xl border border-line p-5">
            <h2 className="text-lg font-semibold">
              Items <span className="font-normal text-muted">({totals.itemCount})</span>
            </h2>
            <ul className="mt-4 max-h-72 space-y-4 overflow-y-auto pr-1">
              {lines.map((l) => (
                <li key={l.key} className="flex gap-3">
                  <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-sand">
                    <ProductImage src={l.image} alt={l.name} fill sizes="64px" />
                    <span className="absolute top-1 right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-ink px-1 text-[11px] font-bold text-white">
                      {l.quantity}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="line-clamp-2 font-medium">{l.name}</p>
                    <p className="mt-0.5 text-[13px] text-muted">
                      {[l.size && `Size ${l.size}`, l.color, `Qty ${l.quantity}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <p className="text-sm font-semibold">{formatPrice(l.price * l.quantity)}</p>
                </li>
              ))}
            </ul>
            <div className="mt-5 border-t border-line pt-5">
              <CouponForm subtotal={totals.subtotal} />
            </div>
          </div>
          <OrderSummary totals={totals} couponCode={couponCode} title="Price details">
            <button type="submit" disabled={placing} className="btn-accent mt-5 hidden min-h-13 w-full text-[15px] lg:flex">
              {placing ? <Loader2 size={18} className="animate-spin" /> : <Lock size={16} />}
              {placing ? "Processing payment…" : `Place Order · ${formatPrice(totals.total)}`}
            </button>
            <p className="mt-3 hidden text-center text-xs text-muted lg:block">
              By placing your order you agree to our{" "}
              <Link href="/terms" className="underline">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/return-policy" className="underline">
                Return Policy
              </Link>
              .
            </p>
          </OrderSummary>
        </aside>

        {/* Mobile sticky place order */}
        <div className="fixed inset-x-0 bottom-0 z-30 flex items-center gap-4 border-t border-line bg-white/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
          <div>
            <p className="text-xs text-muted">Total · Shipping charges applicable</p>
            <p className="text-lg font-semibold">{formatPrice(totals.total)}</p>
          </div>
          <button type="submit" disabled={placing} className="btn-accent min-h-12 flex-1">
            {placing ? <Loader2 size={18} className="animate-spin" /> : <Lock size={15} />}
            {placing ? "Processing…" : "Place Order"}
          </button>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="container-page pt-6 lg:pt-8">
      <Breadcrumbs items={[{ label: "Bag", href: "/cart" }, { label: "Checkout" }]} />
      <h1 className="mt-4 font-display text-4xl font-semibold sm:text-5xl">Checkout</h1>
      {children}
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`step-${n}`} className="rounded-2xl border border-line p-5 sm:p-6">
      <h2 id={`step-${n}`} className="mb-5 flex items-center gap-3 text-lg font-semibold">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-sm text-white">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}
