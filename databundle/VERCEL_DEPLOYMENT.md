# BundleBay deployment guide (Vercel + Paystack)

## Before deploying

1. Revoke and replace the Paystack live secret key and DataPlug API key that were accidentally committed in `PASSWORD.env`. Change the admin password too. Removing the file from the current checkout does not erase the Git history; keep the replacement secrets out of Git.
2. Create a Vercel project with **Root Directory** set to `databundle`.
3. Create a Vercel Postgres compatible database and connect it to this Vercel project. The app needs the `POSTGRES_URL` environment variable (the Vercel Postgres integration normally supplies it). Database schema is created automatically on first API request.
4. Add these Environment Variables in Vercel for **Production**, **Preview**, and **Development** as needed:
   - `PAYSTACK_SECRET_KEY`: rotated Paystack secret key (`sk_test_...` for testing; `sk_live_...` only for production)
   - `DATAPLUG_API_KEY`: rotated DataPlug API key
   - `ADMIN_PASSWORD`: a unique random string of at least 32 characters
   - `MARKUP_PERCENT`: e.g. `5`
   - `AUTO_REFUND`: `false` initially; enable only after you validate Paystack refund behavior
   - `POSTGRES_URL`: supplied by the connected database integration
5. Redeploy after changing environment variables.

## Paystack setup and test

1. Start with Paystack test credentials and a DataPlug test/sandbox account if available. Confirm the DataPlug package endpoint returns the expected package sizes and prices.
2. In Paystack Dashboard, configure the webhook URL to `https://YOUR-VERCEL-DOMAIN/api/paystack/webhook`. Use the matching environment (test/live) key.
3. Visit `https://YOUR-VERCEL-DOMAIN/api/health`; `ok` means database connectivity works.
4. Load the storefront. Confirm packages load. Complete a test payment and confirm the order reaches `completed` (or the expected failure/refund status) and the correct Ghana number receives the bundle.
5. Check `https://YOUR-VERCEL-DOMAIN/#admin`, enter the `ADMIN_PASSWORD`, and confirm the order appears.
6. Only after successful test-mode checkout and fulfillment should you add the rotated live Paystack key and switch the webhook to the live endpoint/configuration. Run a small real transaction to confirm live settlement and delivery.

## Important behavior and limitations

- Vercel serves `public/index.html` as static content; API requests run as serverless functions under `api/`.
- Orders are persisted in PostgreSQL. Do not deploy without `POSTGRES_URL`.
- Fulfillment is claimed atomically in PostgreSQL so webhook and status polling cannot both start a purchase for the same order.
- The webhook verifies the Paystack HMAC signature and awaits processing before responding. If fulfillment fails after the claim, the order is marked `paid_unfulfilled`; it needs operator review. It is not automatically retried because the DataPlug purchase may have succeeded despite a network timeout.
- `api/` handlers are designed for Vercel Node functions. Local `npm start` still runs the old Express/JSON implementation; use Vercel CLI (`vercel dev`) for local integration testing, or retire `server.js` once migration is fully validated.
- Use the Vercel Postgres integration's currently supported connection variable. If your database provider supplies a different variable name, set `POSTGRES_URL` to its compatible pooled connection string.

## Security notes

- The old credential file was removed from the current working tree. Rotate the leaked keys and password; consider removing the file from Git history before sharing the repository further.
- Admin password is no longer cached in browser storage.
- Configure HTTPS only (Vercel provides it) and never expose the Paystack secret or DataPlug key in frontend code.
