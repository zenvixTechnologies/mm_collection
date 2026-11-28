# M&M Collections: project audit

Date: 28 November 2026. Branch `mm-01`, including the uncommitted shipment tracking work.

> This file lists unfixed security and payment weaknesses. Don't commit it to a public repository.

**Scope.** Audit only: no code, schema, environment, package or data changes. All runs used throwaway in-memory databases, with external payment, email and image services disabled or blocked. Your Atlas database was not contacted. The one outside lookup was `npm audit`, which sends dependency names and versions to the npm registry.

**Evidence labels.**
- **[Reproduced]**: observed by running the code.
- **[Code]**: confirmed by reading or searching the code, not by running that scenario.

**Depth.** The server services for auth, payments, refunds, checkout, stock, coupons, cart and wishlist, catalogue admin, settings and media were read closely. UI files were mostly traced by search and targeted reading, not line by line. This is not a penetration test.

---

## Verdict

**Not ready for a production launch.** The core backend is solid for the normal flows, and all automated checks pass. However:

1. Two reproduced payment-handling bugs can corrupt stock or an order's payment status.
2. Several storefront and admin features only look as if they work.
3. The storefront shows generated reviews labelled "Verified buyer".
4. Email, the Razorpay webhook and the scheduled jobs are not configured in the local environment.

Passing tests did not catch these bugs, because no test covers those scenarios.

---

## A. Overall project status

"Complete" means the code is connected end to end and passes the isolated tests. It does not mean it was verified against live services.

| Module | Status | Notes |
|---|---|---|
| Backend foundation (env, DB, errors, validation, health) | Complete | |
| Catalogue models, APIs, variants, paise pricing, indexes | Complete | Scaling concern: P-01 |
| Admin auth, sessions, token rotation, permission checks | Complete, with a security gap | S-01 |
| Admin user and role management | **Not implemented** | B-12 |
| Product, category, inventory, upload, audit-log writing | Complete | Cloudinary not tested live. No audit-log viewer |
| Customer auth, profile, addresses, sessions | Complete in code | No email can be sent with the local settings (F) |
| Cart and wishlist | Complete | |
| Checkout, coupons, order creation, reservation, guest access | Complete | Expiry is not scheduled: B-05 |
| Razorpay create, verify, retry, webhook | Partial, **bugs** | B-01, B-03 |
| Refunds and refund webhooks | Partial, **bugs** | B-02, B-04 |
| Admin customers, orders, payments, coupons | Complete apart from payment bugs | B-06, B-07 |
| Hero and promo banners | Complete | |
| Featured products, section visibility, offers | **Disconnected** | B-10 |
| Store, SEO and shipping settings | **Disconnected** (courier list works) | B-10 |
| Manual shipment tracking | Partial, **one bug** | B-08 |
| Dashboard statistics, charts, recent orders | **Sample data** | B-11 |
| Activity feed and admin notifications | **Sample data** | B-11 |
| Contact form, newsletter, review submission | **Not implemented** (UI only) | B-13 |
| Product reviews and testimonials | **Generated or hardcoded** | B-14 |
| Order confirmation, shipping and admin alert emails | **Not implemented** | B-15 |

---

## B. Pending development tasks, in priority order

1. Fix stock handling and refund handling (B-01, B-02).
2. Add a per-IP limit to admin login and revisit lockout (S-01).
3. Remove or replace generated reviews, ratings and marketing figures (B-14).
4. Make the contact form and newsletter real, or remove them (B-13).
5. Schedule order expiry and configure the cron secret (B-05).
6. Configure email sender, webhook secret, Upstash and production URL (F).
7. Fix the remaining payment edge cases (B-03, B-04, B-06, B-07).
8. Fix the tracking form (B-08).
9. Connect store settings, offers, featured products and section visibility, or hide the controls (B-10).
10. Replace dashboard, notification and activity sample data, and remove the "Demo mode" label (B-11).
11. Build staff account management (B-12).
12. Add order emails (B-15).
13. Add security headers, escape structured data, fix share images (S-03, S-04, B-09).
14. Add missing tests and CI (G).

---

## C. Bugs and fixes

### B-01 · High · Cancelling a late-paid order never returns its stock [Reproduced]
- **What happens:** a payment arrives after the hold expired and the items are still available (`late_paid`). Stock is sold. When staff cancel the order, stock stays at 8 instead of returning to 10, and no `return` ledger row is written.
- **Files:** `server/services/payment.service.ts` (`completePayment`), `server/services/admin-order.service.ts` (`updateOrderStatus`).
- **Root cause:** expiry sets `stockReleased: true`. The late sale never resets it, and cancellation restocks only when it is false.
- **Impact:** stock and sold counts drift permanently, with no warning.
- **Fix:** set `stockReleased: false` only for `late_paid`, in the same transaction. Don't change it for `late_unfulfillable`, where nothing was sold. Add a test.

### B-02 · High · Refunding a duplicate payment marks the whole order refunded [Reproduced]
- **What happens:** an order is paid, then a second payment is captured on another attempt. The system flags it "Refund it". After that second payment is refunded, the order shows `refunded` while the original payment is still `captured`. The only status move offered is **Cancel**.
- **File:** `server/services/refund.service.ts` (`recordRefund`).
- **Root cause:** any payment's refund totals overwrite the order's totals. It never checks that this is the payment that paid the order.
- **Impact:** a paid order can't be fulfilled, revenue is understated, and staff may cancel it by mistake.
- **Fix:** update the order only when the payment's Razorpay ID equals `order.razorpayPaymentId`.

### B-03 · Medium · A second capture on the same Razorpay order isn't recorded [Reproduced]
- **What happens:** the order is flagged, but no record holds the second payment ID. Its refund webhook returns `unknown_payment`, so it can't be refunded or tracked from Admin.
- **Files:** `payment.service.ts` (duplicate branch), `payment.model.ts`.
- **Root cause:** the update only matches an attempt that has no payment ID yet.
- **Impact:** extra money can only be traced in the flag text and Razorpay. I didn't check how often Razorpay allows this.
- **Fix:** store extra captures (a small schema addition) and allow refunding them.

### B-04 · Medium · A late webhook can move a processed refund back to pending [Reproduced]
- **File:** `refund.service.ts` (`recordRefund`).
- **Root cause:** the incoming status always overwrites the stored one.
- **Impact:** wrong refund status until someone syncs it.
- **Fix:** don't allow `processed` or `failed` to return to `pending`.

### B-05 · High · Expired orders aren't released on a schedule [Code]
- **Files:** `vercel.json`, `app/api/v1/cron/expire-orders/route.ts`, `checkout.service.ts`.
- **Root cause:** only `cleanup-media` is scheduled. `CRON_SECRET` is also empty locally, so both cron routes return 503 [Reproduced with it unset].
- **Impact:** expired holds are released only when someone requests a checkout quote or places an order (5 at a time). Stock can show as sold out so nobody reaches checkout. That sweep may also call Razorpay inside a shopper's request.
- **Fix:** set the secret and schedule the route every few minutes. Check your Vercel plan's cron limits, or use an external scheduler.

### B-06 · Medium · Payment warnings can never be cleared [Code]
- **Files:** `order.model.ts`, admin order service and UI.
- **Root cause:** `exception.resolvedAt` is read, but nothing writes it.
- **Fix:** add an audited "Mark resolved" action.

### B-07 · Medium · Paid orders with no stock have no fulfilment path [Code]
- **What happens:** after `late_unfulfillable`, the order stays Expired or Cancelled with captured payment. The message says "refund or arrange stock", but only a refund is possible.
- **Files:** `payment.service.ts`, `admin-sales.shared.ts`.
- **Fix:** add a controlled "fulfil after restock" action, or change the message to refund only.

### B-08 · Medium · Tracking can't be corrected right after marking Shipped [Reproduced, including in the browser]
- **This bug is in the tracking work delivered in the previous task.** My earlier tests and report missed it.
- **What happens:** after marking an order Shipped without having typed a shipment date, changing the AWB fails with "A shipped order needs its shipment date." The old AWB stays stored. Reloading the page works around it.
- **Files:** `components/admin/sales/OrderDetailView.tsx` (form key), `ShipmentForm.tsx`.
- **Root cause:** the form resets only when `tracking.updatedAt` changes. Marking Shipped sets `shippedAt` without changing it, so the form sends a blank date.
- **Fix:** include `shippedAt` in the form key, and add a regression test.

### B-09 · Medium · Share image and structured-data image URLs can be invalid [Code]
- **File:** `app/(store)/product/[slug]/page.tsx`.
- **Root cause:** `&w=1200` is appended to every URL. A Cloudinary URL has no `?`, and a product with no image gives `undefined&w=1200`.
- **Fix:** build the URL according to its host, and omit it when there is no image.

### B-10 · High · Many admin settings have no effect on the storefront [Code]
- **Saved but never read by the storefront:** store name, contact details, address, hours and logo; social links; SEO title and description; return-policy settings; delivery estimate and dispatch time; featured products; homepage section visibility; announcement offers.
- **Files:** `lib/utils.ts` (`SITE`), `Footer.tsx`, `app/layout.tsx`, `app/(store)/page.tsx`, `AnnouncementBar.tsx` (uses `data/offers.ts`), policy and contact pages.
- **Also:** Instagram, Facebook and YouTube links go to those sites' home pages. Stored `checkout.reservationMinutes` defaults to 15, while checkout always uses 30.
- **Impact:** Admin says changes appear to shoppers, but they don't.
- **Fix:** add a cached public settings reader and use it, with the current values as fallback. Hide any control you won't connect.

### B-11 · High · Dashboard shows sample data, and Admin is labelled "Demo mode" [Code, label also seen in the browser]
- **Sample:** revenue, order and customer figures, charts, pipeline, sales by category, top products, recent orders, activity feed, header notifications. The dashboard is dated 14 November 2026.
- **Real:** catalogue counts, stock alerts, sidebar badges, header search.
- **Files:** `store/admin-store.ts`, `data/admin/*`, `DashboardView.tsx`, `AdminHeader.tsx`, `AdminSidebar.tsx`, `SettingsView.tsx` ("Reset demo data").
- **Impact:** owners can act on invented figures. The sidebar says "changes stay in this browser tab", although product, order and refund actions are real.
- **Fix:** remove the label first. Then add dashboard APIs that respect permissions, or hide the sample panels.

### B-12 · High · Manager and Staff accounts can't be created [Code]
- **Evidence:** there is no admin-user or role API or screen. `admin:create-owner` creates only Owners. The only code creating other roles is the smoke-test script.
- **Impact:** the team can't use limited roles without editing the database.
- **Fix:** build Owner-only account management (create, disable, reset, assign role).

### B-13 · High · Forms report success but send nothing [Code]
- **Contact form** (`ContactForm.tsx`): a timer fakes sending. A small note says it isn't sent.
- **Newsletter** (`Newsletter.tsx`): says "You're on the list!" and discards the email, with no note.
- **Review form** (`ProductReviews.tsx`): toast says "submitted for moderation", but nothing is submitted.
- **Impact:** customer messages are lost.
- **Fix:** implement them, or remove them. WhatsApp, phone and email links can replace the contact form.

### B-14 · High · Generated reviews and unsupported claims [Code; badge and rating markup also seen in built pages]
- `getProductReviews()` gives **every product** four reviews from a fixed pool, marked **"Verified buyer"**. This includes newly added products.
- The star breakdown is calculated from an average. Seeded ratings, review counts and sold counts come from sample data.
- Homepage testimonials are hardcoded under "Real reviews". "12,000+ happy customers", "4.7" and "40+" are hardcoded.
- Product pages publish `aggregateRating` structured data from these numbers.
- **Files:** `data/reviews.ts`, `ProductReviews.tsx`, `Testimonials.tsx`, `Hero.tsx`, product page, `legacy-import.ts`.
- **Impact:** this can mislead shoppers, may breach consumer-protection rules, and can breach Google's structured-data rules.
- **Fix:** remove everything you can't substantiate before launch. Check the values stored in production. Add real reviews later (a `Review` model exists but is unused).

### B-15 · Medium · No order or alert emails [Code]
- Only welcome, password-reset and password-changed emails exist.
- Admin says new orders trigger "an email and a bell notification", and offers low-stock, failed-payment and daily-summary alerts. None of these is sent.
- **Fix:** add order confirmation and shipped emails after the transaction commits. Remove alert toggles until they work.

### B-16 · Medium · "First order" coupons may be reusable [Code]
- `WELCOME10` and `FIRSTORDER` are seeded without a per-customer limit. There is no first-order rule, although the newsletter and announcement present `WELCOME10` as a new-customer offer.
- **Fix:** check the live coupon settings in Admin and set the limits you intend. A real first-order rule needs new code. Guest limits are per email, so a different email gets around them.

### B-17 · Low · Other fixed storefront content [Code]
- The announcement bar and fallback promo advertise fixed coupons, even if Admin disables them.
- The PIN checker uses prefix rules, not courier data.
- "Load more" in the shop has an artificial delay.
- `lib/pricing.ts` still contains an old hardcoded coupon list. Checkout doesn't use it: coupon checks are on the server.

---

## D. Security findings

**Critical:** none found in the application code reviewed. The "critical" npm advisories are in development tools (S-05).

### High
**S-01 · Admin login has no per-IP limit, and anyone can lock an admin out [Reproduced]**
- 30 attempts from one IP against different names produced no 429.
- After 5 wrong passwords, the **correct** password was refused for the locked account.
- Someone who knows the owner's email can repeat this every 15 minutes. The 423 response also reveals that the account exists.
- **Files:** `app/api/v1/admin/auth/login/route.ts`, `admin-auth.service.ts`.
- **Fix:** limit by IP and by IP plus identifier, backed by Upstash. Make lockout harder to abuse and its response less revealing. Customer login has IP limits but also returns 423 [Code].

### Medium
| ID | Finding | Fix |
|---|---|---|
| S-02 | Rate limits are held in each server instance's memory because Upstash isn't configured. They also fall back to memory if Upstash fails. On serverless this is weak [Code] | Configure Upstash and monitor failures |
| S-03 | The app sets no CSP, frame protection, `nosniff`, referrer or permissions policy, and sends `x-powered-by`. HSTS wasn't set locally; check the deployed host [Reproduced] | Add headers in `next.config.ts`. Introduce CSP in report-only mode first, allowing Razorpay, Cloudinary, Unsplash and Maps |
| S-04 | Product text goes into a JSON-LD `<script>` with `JSON.stringify`, which doesn't escape `</script>`. Someone with `products:write` could inject script into a product page. The escaping behaviour was confirmed; a full exploit was not run [Code] | Escape `<` as `<` |
| S-05 | `npm audit`: 11 advisories (2 critical, 1 high, 8 moderate). With development packages excluded: 2, being `postcss` (high, through Next) and `next` (moderate). The critical ones are Vitest tooling. I didn't assess exploitability | Update test tooling. Review the Next advisory path; npm proposes a major upgrade, so don't force it. Don't expose the Vitest UI |

### Low
- **Password-reset timing:** existing accounts wait for the email request, so response time may reveal them [Code].
- **Reset-link address:** it falls back to the request's origin if `NEXT_PUBLIC_APP_URL` is unset. Always set it in production [Code].
- **Validation before sign-in:** bulk product requests are validated before authentication [Code].
- **Permission level:** refund sync changes records but needs only `payments:read` [Code].
- **Missing limits:** admin password change, address APIs and public catalogue APIs have no explicit rate limit [Code].
- **Guest tokens:** they don't expire. They depend on `JWT_ACCESS_SECRET`, so rotating it ends guest order access [Code].
- **Client IP:** limits trust forwarded-IP headers, which is only safe behind a proxy that overwrites them [Code].
- **Upload size:** it is checked at confirmation, not by the upload signature. Cleanup of unconfirmed files needs the disabled cron [Code].

### Controls found to be in place
These come from code review, and many also have tests.
- **Payments:** the webhook signature is checked on the raw body. Checkout signatures are verified and the payment is re-read from Razorpay. Amounts come from the database. Webhook events are de-duplicated, and Live keys need an explicit flag.
- **Sessions:** cookies are HttpOnly (the non-secret signed-in hint excepted), with token rotation, reuse detection and revocation. Admin and customer tokens are separate.
- **Access:** admin permissions are re-read from the database on each request, state changes check origin, and order access needs ownership or a guest token.
- **Data:** passwords use bcrypt, admin search input is regex-escaped, and the customer order view is an allow-list.
- **Secrets:** no `.env`, `.env.local` or `.env.production` appears in git history. The credential-pattern search of tracked files matched only test fixtures; history wasn't exhaustively secret-scanned.

---

## E. Integration status

| Page or area | Data source |
|---|---|
| Product, category, shop, search, new arrivals, best sellers, sitemap | **Database** (cached). Ratings and sold counts may be seeded sample values |
| Product reviews | **Generated** |
| Home | Products and banners: **database**. Testimonials, figures, section layout, featured collections: **hardcoded** |
| Announcement bar, footer, contact details, SEO defaults, policies | **Hardcoded** |
| Cart, wishlist, coupons, checkout, payment | **Real APIs** |
| Login, register, password reset, account, addresses | **Real APIs** |
| My Orders, order details, order success, track order | **Real APIs** |
| Contact form, newsletter, review form | **No backend** |
| PIN delivery checker | **Local rules** |
| Admin products, categories, inventory | **Real APIs** |
| Admin orders, customers, payments, coupons | **Real APIs** |
| Admin homepage, settings, shipping | **Real APIs**, but much is not used by the storefront |
| Admin dashboard | **Mostly sample data** |
| Admin notifications and activity | **Sample data** |

For connected flows, the existing tests and smoke run found no mismatch between API responses and the UI. Not every button and error state was exercised in a browser.

---

## F. External service status

This reflects **local `.env.local` only**. No values are shown. Vercel settings and live connections were not checked.

| Service | Status | Detail |
|---|---|---|
| MongoDB Atlas | Configured, untested | Atlas-style address and database name set |
| JWT secrets | Configured | Both at least 32 characters, and different |
| Razorpay Test Mode | **Partial** | Test keys set; **webhook secret missing**, so the webhook can't work |
| Razorpay Live safeguard | Active | Live keys are not in use and the allow flag is absent |
| `CRON_SECRET` | **Not configured** | Empty |
| Cloudinary | Configured, untested | All three values set |
| Resend | **Partial** | API key set; **`EMAIL_FROM` empty**, so nothing is sent, including password resets |
| Upstash Redis | **Not configured** | Both values empty |
| App URL | Local only | Points to localhost; production needs its real address |
| Site address in code | Fixed | Canonicals and sitemap always use `https://mmcollections.in`; confirm that is your domain |
| Vercel | **Partial / unknown** | Only media cleanup is scheduled. No Node version pinned in `package.json`. Dashboard, domain, Atlas network access and webhook registration not checked |

---

## Performance, SEO and UI findings

| ID | Severity | Finding | Fix |
|---|---|---|---|
| P-01 | Medium | The store layout sends the whole catalogue to the browser on every storefront page. Measured HTML at seed size: home 735 KB, shop 545 KB, product 447 KB, privacy policy 341 KB [Reproduced; cause from code]. It will grow with the catalogue, and large cached entries can exceed Next's cache limit (not observed) | Send a slim summary; load details and search from APIs |
| P-02 | Low now | Admin loads all products; inventory isn't paginated; payment and customer lists join records before pagination [Code] | Paginate, and join only the page where filters allow. Measure with realistic volumes |
| P-03 | Low | Home has no canonical tag [Reproduced]. Sitemap sets every `lastModified` to generation time [Code] | Add the canonical; use real update times |

- **Build:** passed, and a search of its log found no warnings. Shared first-load JavaScript is 103 KB.
- **Runtime:** no hydration or console errors on the pages the browser test visited. Failed network requests were excluded from that check. It didn't visit every page.
- **SEO:** admin is `noindex`; `robots.txt` and the sitemap work; the other sampled content pages have canonicals.
- **Mobile:** only the customer order page was checked at 390 px. A full responsive and accessibility audit was **not done**.
- **Error and loading states:** present in the main data views that were reviewed. Route-level loading exists only for Shop.
- **Not measured:** Core Web Vitals, load, query timings. No N+1 problem stood out in the main order lists, but this wasn't profiled.

---

## G. Testing report

The audit changed no code, so these results are both the baseline and the final state.

| Check | Result |
|---|---|
| Vitest (unit and integration together) | **329 passed, 0 failed**, 21 files |
| TypeScript | **Pass** |
| ESLint | **Pass** |
| Production build (isolated database) | **Pass** |
| API, page and headless Edge smoke checks | **95 passed, 0 failed** |
| Audit reproductions | 6 tests confirming B-01, B-02, B-03, B-04, S-01 and B-08. They **pass because they assert the faulty behaviour** |

The smoke script and reproductions are temporary and are not in the repository. Smoke "paid" orders were set directly in the throwaway database. The build rewrote `next-env.d.ts`, which was restored.

**Not run:** live Atlas, Razorpay, Cloudinary, Resend, Upstash or Vercel; real payments or refunds; other browsers; load, accessibility or penetration tests; coverage percentage (no coverage tool is installed).

**Coverage gaps**
- Late payment followed by cancellation; refunding a duplicate payment; refund webhooks out of order.
- No component, hook or store tests. This is where B-08 slipped through.
- No automated end-to-end suite and no CI configuration in the repository.
- Route handlers not imported by any test: public products, product detail, categories, category detail, health, media-cleanup cron, admin sessions (two routes), API catch-all and the retired payment verify route. Some underlying services are tested.

---

## H. Production readiness: blockers

**Code**
- [ ] B-01 and B-02 fixed with tests
- [ ] S-01 fixed
- [ ] B-14: unsupported reviews, ratings and figures removed
- [ ] B-13: fake forms implemented or removed
- [ ] B-10 and B-11: misleading settings, sample dashboard and "Demo mode" fixed or hidden
- [ ] B-12 built, if anyone besides Owners will use Admin
- [ ] B-08 fixed before releasing tracking

**Configuration**
- [ ] Production variables set in Vercel, including the real `NEXT_PUBLIC_APP_URL`
- [ ] `EMAIL_FROM` on a verified domain; test a password reset
- [ ] Webhook created with its secret; verify delivery in Test Mode
- [ ] `CRON_SECRET` set and expiry scheduled (B-05)
- [ ] Upstash configured
- [ ] Atlas network access, least-privilege user and backups checked

**Data and release**
- [ ] Run `db:setup` for production indexes (automatic indexing is off). It also **drops indexes not in the schemas**, so review and back up first
- [ ] Don't run `db:seed` on production without review: it can import sample ratings, sold counts, coupons, banners and offers
- [ ] Full Test Mode rehearsal: pay, fail and retry, webhook, expiry, refund, ship
- [ ] Live Mode only afterwards, with its own keys, webhook secret and allow flag

**Existing data check (not run).** If real or shared data has taken payments, check it read-only for:
- orders with a "Paid after the reservation expired" sale, later cancelled, with no matching `return` movement (B-01). Check physical stock before correcting anything.
- orders flagged `DUPLICATE_PAYMENT` with a refunded status (B-02). Compare with Razorpay.

---

## I. Recommended roadmap

| Group | Items |
|---|---|
| **Must fix immediately** | B-01, B-02, S-01, B-08. Remove the "Demo mode" label. Don't take Live payments yet |
| **Must complete before launch** | B-05, B-13, B-14, B-10, B-11, F configuration and S-02, S-04, B-12 (if staff need access), B-03, B-04, B-06, B-07, B-16, B-15 order confirmation, H data and rehearsal |
| **Recommended improvements** | S-03, S-05, Low security items, B-09, B-17, P-01, P-02, P-03, tests and CI, mobile and accessibility audit |
| **Optional later** | Real review system, alert and summary emails, audit-log viewer, courier integration, shipping rates, GST invoices, customer data export and deletion (check legal needs first) |

---

## J. Implementation plan

Paths are under `src/` unless shown. Do each batch separately, with approval and a full test run.

| Batch | Items | Likely files | Tests to add | Schema change |
|---|---|---|---|---|
| 1. Payment integrity | B-01, B-02, B-04 | `server/services/payment.service.ts`, `refund.service.ts`, `admin-order.service.ts` | The three scenarios, replay and concurrency | None expected |
| 2. Login hardening | S-01 | admin and customer login routes and auth services, `server/security/rate-limit.ts` | IP limit, lockout abuse | None expected |
| 3. Tracking fix | B-08 | `components/admin/sales/OrderDetailView.tsx`, `ShipmentForm.tsx` | Edit immediately after Shipped | None |
| 4. Trust and honesty | B-13, B-14, "Demo mode" | `data/reviews.ts`, `components/products/ProductReviews.tsx`, `components/home/{Hero,Testimonials,Newsletter}.tsx`, `components/layout/ContactForm.tsx`, product page, `AdminSidebar.tsx`, `server/catalog/legacy-import.ts` | Structured data and rendered pages | None to remove; stored values need an approved data update |
| 5. Operations | B-05, F, S-02 | `vercel.json`, `README.md`, environment settings | Cron authorisation and expiry | None |
| 6. Payment follow-ups | B-03, B-06, B-07 | payment and order models, services, `admin-sales.shared.ts`, admin order and payment UI | Extra capture, resolve, restock-and-fulfil | Additive |
| 7. Settings connection | B-10, B-17 | new public settings reader; `Footer.tsx`, `AnnouncementBar.tsx`, `app/layout.tsx`, home, contact and policy pages, `lib/utils.ts`, `checkout.service.ts` | Settings changes reach the storefront | None expected |
| 8. Dashboard | B-11 | new dashboard service and API; `DashboardView.tsx`, `AdminHeader.tsx`, `store/admin-store.ts`, `data/admin/*` | Figures and permissions | Only if notifications are stored |
| 9. Staff accounts | B-12 | new admin-user service, APIs and screen; `admin-nav.ts` | Owner-only access, session revocation, last-Owner protection | None expected |
| 10. Email and coupons | B-15, B-16 | email templates, payment and order services, `SettingsView.tsx`, coupon service and data | No duplicate emails; email failure never blocks payment | Possibly additive |
| 11. Web security and SEO | S-03, S-04, B-09, P-03 | `next.config.ts`, product page, home page, `app/sitemap.ts` | Headers, escaping, image URLs, Razorpay under CSP | None; keep URLs |
| 12. Performance, quality | P-01, P-02, S-05, gaps | `StoreChrome.tsx`, `CatalogProvider.tsx` and its users, admin list services, package files, new CI file | Catalogue regression, end-to-end | Possibly indexes |

**Decisions needed from you**
1. Which of the forms, reviews and settings should be built now, and which hidden?
2. Will Managers or Staff use Admin at launch?
3. Should `WELCOME10` and `FIRSTORDER` be limited to once per customer, or to true first orders?
4. When stock runs out after a late payment, refund only, or allow fulfilment after restocking?
