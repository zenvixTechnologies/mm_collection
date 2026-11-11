"use client";

import Link from "next/link";
import { ChevronRight, Heart, MapPin, Package, Pencil, Plus, Trash2, UserRound } from "lucide-react";
import { useState } from "react";
import type { Address } from "@/types";
import { useHydrated } from "@/hooks/use-hydrated";
import { useMyOrders } from "@/hooks/use-my-orders";
import { formatDate, formatPrice } from "@/lib/utils";
import { EMAIL_RE, INDIAN_STATES, PIN_RE, isValidMobile, normalizeMobile } from "@/lib/validation";
import { useAuthStore, useCurrentUser } from "@/store/auth-store";
import { toast } from "@/store/ui-store";
import { useWishlistStore } from "@/store/wishlist-store";
import { Field } from "@/components/ui/Field";
import { AccountShell } from "./AccountNav";
import { StatusBadge } from "./OrderParts";

export function AccountView() {
  const hydrated = useHydrated();
  const user = useCurrentUser();

  if (!hydrated) {
    return (
      <AccountShell title="My Account">
        <div className="skeleton h-72 rounded-2xl" />
      </AccountShell>
    );
  }

  if (!user) {
    return (
      <AccountShell title="My Account">
        <div className="rounded-2xl bg-canvas p-8 text-center sm:p-12">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-accent">
            <UserRound size={28} />
          </span>
          <h2 className="mt-5 font-display text-3xl font-semibold">Log in to your account</h2>
          <p className="mx-auto mt-2 max-w-sm text-muted">
            See your profile, saved addresses and full order history. You can still track orders and check out as a guest.
          </p>
          <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href="/login?next=/account" className="btn-primary px-8">
              Log in
            </Link>
            <Link href="/register?next=/account" className="btn-outline px-8">
              Create account
            </Link>
          </div>
        </div>
      </AccountShell>
    );
  }

  return (
    <AccountShell title="My Account">
      <p className="-mt-2 mb-6 text-muted">
        Hello, <strong className="text-ink">{user.fullName.split(" ")[0]}</strong> 👋
      </p>
      <div className="space-y-6">
        <Profile />
        <RecentOrders />
        <Addresses />
        <WishlistCard />
      </div>
    </AccountShell>
  );
}

function Card({ title, icon, action, children, id }: { title: string; icon: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border border-line p-5 sm:p-6" aria-labelledby={id ? `${id}-title` : undefined}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <h2 id={id ? `${id}-title` : undefined} className="flex items-center gap-2.5 text-lg font-semibold">
          <span className="text-accent">{icon}</span> {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Profile() {
  const user = useCurrentUser()!;
  const update = useAuthStore((s) => s.updateProfile);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ fullName: user.fullName, email: user.email, mobile: user.mobile });
  const [errors, setErrors] = useState<Partial<Record<keyof typeof f, string>>>({});

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (f.fullName.trim().length < 3) errs.fullName = "Please enter your full name.";
    if (!EMAIL_RE.test(f.email.trim())) errs.email = "Enter a valid email.";
    if (!isValidMobile(f.mobile)) errs.mobile = "Enter a valid 10-digit mobile.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    update({ fullName: f.fullName.trim(), email: f.email.trim(), mobile: normalizeMobile(f.mobile) });
    setEditing(false);
    toast.success("Profile updated");
  };

  return (
    <Card
      title="Profile information"
      icon={<UserRound size={19} />}
      action={
        !editing && (
          <button type="button" onClick={() => setEditing(true)} className="flex items-center gap-1.5 text-sm font-medium hover:text-accent">
            <Pencil size={14} /> Edit
          </button>
        )
      }
    >
      {editing ? (
        <form onSubmit={save} noValidate className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" name="p-name" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} error={errors.fullName} className="sm:col-span-2" />
          <Field label="Email" name="p-email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} error={errors.email} />
          <Field label="Mobile" name="p-mobile" type="tel" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} error={errors.mobile} />
          <div className="flex gap-3 sm:col-span-2">
            <button type="submit" className="btn-primary">
              Save changes
            </button>
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted">Full name</dt>
            <dd className="mt-0.5 font-medium">{user.fullName}</dd>
          </div>
          <div>
            <dt className="text-muted">Email</dt>
            <dd className="mt-0.5 font-medium break-all">{user.email}</dd>
          </div>
          <div>
            <dt className="text-muted">Mobile</dt>
            <dd className="mt-0.5 font-medium">+91 {user.mobile}</dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

function RecentOrders() {
  const orders = useMyOrders();
  return (
    <Card
      title="My Orders"
      icon={<Package size={19} />}
      action={
        orders.length > 0 && (
          <Link href="/account/orders" className="text-sm font-medium hover:text-accent">
            View all
          </Link>
        )
      }
    >
      {orders.length === 0 ? (
        <p className="text-sm text-muted">
          No orders yet.{" "}
          <Link href="/shop" className="font-medium text-ink underline">
            Start shopping
          </Link>
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {orders.slice(0, 3).map((o) => (
            <li key={o.id}>
              <Link href={`/account/orders/${o.id}`} className="flex items-center gap-4 py-3 hover:bg-canvas sm:rounded-lg sm:px-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">#{o.id}</p>
                  <p className="text-xs text-muted">
                    {formatDate(o.createdAt)} · {o.items.reduce((n, i) => n + i.quantity, 0)} items · {formatPrice(o.total)}
                  </p>
                </div>
                <StatusBadge status={o.status} />
                <ChevronRight size={16} className="text-subtle" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const EMPTY_ADDRESS: Address = { house: "", street: "", city: "", district: "", state: "Kerala", pincode: "" };

function Addresses() {
  const user = useCurrentUser()!;
  const addAddress = useAuthStore((s) => s.addAddress);
  const removeAddress = useAuthStore((s) => s.removeAddress);
  const [adding, setAdding] = useState(false);
  const [a, setA] = useState<Address>(EMPTY_ADDRESS);
  const [errors, setErrors] = useState<Partial<Record<keyof Address, string>>>({});

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    (["house", "street", "city", "district", "state"] as const).forEach((k) => {
      if (!a[k].trim()) errs[k] = "Required";
    });
    if (!PIN_RE.test(a.pincode)) errs.pincode = "Enter a valid 6-digit PIN code.";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    addAddress(a);
    setA(EMPTY_ADDRESS);
    setAdding(false);
    toast.success("Address saved");
  };

  const f = (k: keyof Address) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setA({ ...a, [k]: k === "pincode" ? e.target.value.replace(/\D/g, "").slice(0, 6) : e.target.value });
  };

  return (
    <Card
      id="addresses"
      title="Saved Addresses"
      icon={<MapPin size={19} />}
      action={
        !adding && (
          <button type="button" onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-sm font-medium hover:text-accent">
            <Plus size={15} /> Add new
          </button>
        )
      }
    >
      {user.addresses.length === 0 && !adding && <p className="text-sm text-muted">No saved addresses yet. Addresses you use at checkout can be saved here.</p>}
      <ul className="grid gap-3 sm:grid-cols-2">
        {user.addresses.map((ad, i) => (
          <li key={`${ad.house}-${ad.pincode}-${i}`} className="relative rounded-xl bg-canvas p-4 text-sm leading-6">
            {i === 0 && <span className="mb-1 inline-block rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold">Default</span>}
            <p className="font-medium">{ad.house}</p>
            <p className="text-muted">
              {ad.street}, {ad.city}, {ad.district}
              <br />
              {ad.state} – {ad.pincode}
            </p>
            <button
              type="button"
              onClick={() => {
                removeAddress(i);
                toast.info("Address removed");
              }}
              className="absolute top-3 right-3 rounded-full p-2 text-muted hover:bg-danger-soft hover:text-danger"
              aria-label={`Remove address ${ad.house}`}
            >
              <Trash2 size={15} />
            </button>
          </li>
        ))}
      </ul>
      {adding && (
        <form onSubmit={save} noValidate className="mt-4 grid gap-4 rounded-xl border border-line p-4 sm:grid-cols-2">
          <Field label="House / Building" name="a-house" value={a.house} onChange={f("house")} error={errors.house} className="sm:col-span-2" />
          <Field label="Street / Area" name="a-street" value={a.street} onChange={f("street")} error={errors.street} className="sm:col-span-2" />
          <Field label="City" name="a-city" value={a.city} onChange={f("city")} error={errors.city} />
          <Field label="District" name="a-district" value={a.district} onChange={f("district")} error={errors.district} />
          <div>
            <label htmlFor="a-state" className="field-label">
              State
            </label>
            <select id="a-state" value={a.state} onChange={f("state")} className="field-input">
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <Field label="PIN code" name="a-pin" inputMode="numeric" value={a.pincode} onChange={f("pincode")} error={errors.pincode} />
          <div className="flex gap-3 sm:col-span-2">
            <button type="submit" className="btn-primary">
              Save address
            </button>
            <button type="button" onClick={() => setAdding(false)} className="btn-ghost">
              Cancel
            </button>
          </div>
        </form>
      )}
    </Card>
  );
}

function WishlistCard() {
  const count = useWishlistStore((s) => s.ids.length);
  return (
    <Link href="/wishlist" className="flex items-center gap-4 rounded-2xl border border-line p-5 transition-colors hover:border-ink sm:p-6">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
        <Heart size={20} />
      </span>
      <div className="flex-1">
        <p className="font-semibold">Wishlist</p>
        <p className="text-sm text-muted">
          {count} saved item{count === 1 ? "" : "s"}
        </p>
      </div>
      <ChevronRight size={18} className="text-subtle" />
    </Link>
  );
}
