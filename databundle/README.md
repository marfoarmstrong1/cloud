# BundleBay – automated data bundle shop

Customer picks network + bundle + phone, pays with Paystack, and the server delivers the data through DataPlug.

## Setup
1. Install Node 18+ and run `npm install`.
2. `cp .env.example .env` and fill in:
   - `PAYSTACK_SECRET_KEY` – your `sk_live_...` key
   - `DATAPLUG_API_KEY` – your DataPlug key
   - `ADMIN_PASSWORD` – protects the orders page
   - `MARKUP_PERCENT` – your margin over DataPlug prices
3. `npm start`, then open http://localhost:3000
4. Test first with `sk_test_...` before going live.

The Paystack public key (`pk_live_...`) is not needed: the server creates the transaction and the browser opens it with an access code.

## Paystack webhook (recommended)
Dashboard > Settings > API Keys & Webhooks > Webhook URL:
`https://YOUR-DOMAIN/api/paystack/webhook`
The webhook delivers bundles even if the customer closes the tab. The site also verifies on its own after payment, and both paths are idempotent, so a customer is never charged-and-delivered twice.

## How it works
1. `GET /api/packages` loads live DataPlug prices (plus your markup).
2. `POST /api/checkout` re-prices the bundle on the server and initializes Paystack in GHS. The browser can't change the price.
3. After payment, `/api/order/:ref` and the webhook both call `fulfill()`: verify with Paystack, check amount and currency, then `POST /purchase` to DataPlug.
4. Statuses: `awaiting_payment`, `processing`, `completed`, `paid_unfulfilled` (paid but DataPlug failed, e.g. 402 low wallet or 404), `refunded`, `failed`.
5. Orders page: open `/#admin`. It shows your orders and DataPlug's `GET /get-orders`.

## Things to check
- DataPlug's response field names are assumed (`size_gb`, `price`). If they differ, edit `normalize()` in `server.js`.
- Keep your DataPlug wallet funded. Watch for `paid_unfulfilled` in the admin view, or set `AUTO_REFUND=true`.
- Orders are stored in `orders.json`. That's fine for a single server; on serverless or multi-instance hosting, use a real database (e.g. Supabase) instead.
- Tailwind is loaded from its CDN for simplicity. For heavy traffic, build it with the Tailwind CLI.
- Deploy behind HTTPS (Render, Railway, a VPS with Nginx). Consider adding `express-rate-limit` on `/api/checkout`.
