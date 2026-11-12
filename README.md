# M&M COLLECTIONS — storefront

Women's fashion e-commerce frontend built with Next.js 15 (App Router), React 19, TypeScript,
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

## What is simulated

This is a frontend demo. There is no backend:

- Cart, wishlist, orders, accounts and recently-viewed items live in the browser's `localStorage`.
- Authentication is mock-only. Passwords are stored in plain text locally; do not reuse real ones.
- UPI and card payments are simulated: no card details are collected and no money is taken. Cash on Delivery is disabled.
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
