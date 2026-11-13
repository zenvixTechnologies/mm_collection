# M&M COLLECTIONS — storefront

India-only family fashion e-commerce site (women, men and kids) built with Next.js 15 (App Router), React 19, TypeScript,
Tailwind CSS 4, Zustand, Framer Motion and Lucide icons.

## Run

```bash
npm install
npm run dev        # http://localhost:3000
npm run build && npm run start
npm run lint
npm run typecheck
npm test           # unit tests (Vitest)
```

> The npm scripts call `node node_modules/...` directly because the folder name contains `&`,
> which breaks npm's `.bin` shims on Windows.
>
> Tailwind is pinned to 4.1.18: newer 4.x releases need Node ≥ 22.12 (`require(esm)`).

## Demo details

- **Demo login:** `demo@mmcollections.in` / `demo1234` (includes sample order history)
- **Coupons:** `WELCOME10`, `FIRSTORDER` (min ₹799), `SAVE15` (min ₹1,999), `FESTIVE20` (min ₹2,999)
- **Sample order IDs for tracking:** `MM24A7K1`, `MM24A3F9`, `MM24931C`

## India-only store & Razorpay payments

M&M COLLECTIONS serves customers in India only: prices are in INR (₹), delivery addresses must be
Indian (Indian state + valid 6-digit PIN, country fixed to India), and payments are domestic only.

Payments use **Razorpay Standard Checkout** with UPI, Indian debit/credit cards and net banking
(wallets, EMI and pay-later are hidden; international cards and non-INR payments are rejected).

1. Copy `.env.example` to `.env.local` and add your Razorpay **Test Mode** keys (`rzp_test_…`).
2. For **Live Mode** after account approval, replace them with `rzp_live_…` keys — no code change.
   Keep international payments disabled in the Razorpay dashboard.

Flow:

- `POST /api/payments/razorpay/order` validates the address, re-prices the bag from the catalogue
  (`src/lib/order-quote.ts`, prices from the browser are ignored) and creates an INR Razorpay order.
- `POST /api/payments/razorpay/verify` checks the HMAC signature, fetches the order and payment from
  Razorpay, rejects international / non-INR / unsupported-method / wrong-amount payments, captures
  if needed and returns the confirmed amount.

## What is simulated

There is no database yet:

- Cart, wishlist, orders, accounts and recently-viewed items live in the browser's `localStorage`
  (paid orders are recorded there after server verification — add a database and a Razorpay
  webhook before going live so paid orders are stored server-side).
- Authentication is mock-only. Passwords are stored in plain text locally; do not reuse real ones.
- Cash on Delivery is disabled.
- Shipping shows "Shipping Charges Applicable" only: no shipping amount is calculated or added to totals yet.
- PIN code delivery estimates, order tracking statuses, the newsletter and contact forms use dummy logic.

## Structure

```
src/
  app/          routes (home, shop, categories, product, search, cart, checkout, order-success,
                wishlist, login, register, account, account/orders, track-order, policies, about, contact)
  components/   layout, home, products, cart, checkout, account, ui
  data/         products (44), categories (12), reviews, orders, coupons, offers, images
  store/        cart, wishlist, auth, orders, checkout (buy now), ui/toasts/recently-viewed
  hooks/ lib/ types/
```

Product photos come from Unsplash's CDN via a custom `next/image` loader (`src/lib/image-loader.ts`),
with a local fallback image if a photo fails to load.
