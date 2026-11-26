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

- **Customer accounts:** real sign-up/login (MongoDB, HttpOnly cookies). Create an account at `/register`.
- **Admin:** `/mm-hub/login` — create the first owner with `npm run admin:create-owner`.
- **Coupons:** `WELCOME10`, `FIRSTORDER` (min ₹799), `SAVE15` (min ₹1,999), `FESTIVE20` (min ₹2,999)

## India-only store & Razorpay payments

M&M COLLECTIONS serves customers in India only: prices are in INR (₹), delivery addresses must be
Indian (Indian state + valid 6-digit PIN, country fixed to India), and payments are domestic only.

Payments use **Razorpay Standard Checkout** with UPI, Indian debit/credit cards and net banking
(wallets, EMI and pay-later are hidden; international cards and non-INR payments are rejected).

### Flow

1. **Place order** (`POST /api/v1/checkout/orders`) — the server prices the bag from MongoDB,
   reserves stock for 30 minutes and stores the order as *Payment Pending*.
2. **Pay** (`POST /api/v1/payments/razorpay/create`) — the server creates a Razorpay order for the
   order's **stored total** (paise, INR) and returns only the public Key ID and Razorpay order ID.
   Razorpay Checkout opens with them.
3. **Verify** (`POST /api/v1/payments/razorpay/verify`) — the checkout callback's signature is
   checked with the Key Secret, the payment is re-read from Razorpay (order, amount, currency,
   domestic method), authorized payments are captured for the stored amount, and only then is the
   order marked paid: reserved stock becomes a sale (stock ledger "sale"), the coupon use is final.
4. **Webhook** (`POST /api/v1/payments/razorpay/webhook`) — Razorpay's server-to-server events
   (`payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`) do the same, so an
   order is confirmed even if the customer closes the browser. Events are verified with the webhook
   secret over the raw body and recorded by event ID (redeliveries are ignored safely).
5. **Unpaid orders** keep their stock for 30 minutes; customers can pay again (`/payments/:id/retry`).
   `GET /api/v1/cron/expire-orders` releases expired holds — after asking Razorpay, so an order
   whose payment succeeded (or is still processing) is never released.

### Razorpay setup (Test Mode first)

1. **Test Mode keys** — Razorpay Dashboard → switch the mode toggle to **Test Mode** →
   *Account & Settings → API Keys → Generate Test Key*. Put the Key ID (`rzp_test_…`) in
   `RAZORPAY_KEY_ID` and the Key Secret in `RAZORPAY_KEY_SECRET` in `.env.local` (and in Vercel →
   Project → Settings → Environment Variables). Never paste the secret anywhere else.
2. **Webhook** — Dashboard (Test Mode) → *Account & Settings → Webhooks → Add New Webhook*:
   - URL: `https://<your-domain>/api/v1/payments/razorpay/webhook` (Razorpay can't reach
     `localhost`; use your deployed preview URL or a tunnel for local testing).
   - Secret: a long random string — put the same value in `RAZORPAY_WEBHOOK_SECRET`.
   - Active events: `payment.captured`, `payment.authorized`, `payment.failed`, `order.paid`.
3. **Payment methods** — keep international payments disabled; wallets, EMI and pay-later are
   hidden in Checkout and rejected on the server.
4. **Expiry cron** — call `GET /api/v1/cron/expire-orders` with `Authorization: Bearer $CRON_SECRET`
   every few minutes (Vercel Cron on a paid plan, or any external scheduler).
5. **Test a payment** — place an order on the storefront and pay with Razorpay's
   [test card / UPI details](https://razorpay.com/docs/payments/payments/test-card-details/) (Test
   Mode never moves real money). Check the order shows *Order Placed* and the stock moved from
   reserved to sold in the admin inventory.

### Switching to Live Mode (only after Razorpay approves the account)

1. Generate **Live** keys and create the webhook again in Live Mode (with its own secret).
2. Replace `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` with the live values
   **and** set `RAZORPAY_ALLOW_LIVE=true` — live keys are refused without it, so Live Mode can't be
   switched on by accident.
3. Make one small real payment and refund it from the dashboard before announcing the store.

## What is simulated

- Cart, wishlist, orders, accounts, coupons and payments are stored in MongoDB.
- Customer and admin authentication run on the server (bcrypt-hashed passwords, rotating HttpOnly session cookies).
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
