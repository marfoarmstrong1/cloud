# Go live in 10 minutes (Render + GitHub, works from a phone)

1. github.com: sign up, tap New repository (name it e.g. bundlebay), then "uploading an existing file".
   Upload every file from this folder EXCEPT `.env` (it is not in this zip). Keep the `public` folder structure
   (`public/index.html`). Commit.
2. render.com: sign up with GitHub, tap New > Blueprint, choose your repository. Render reads `render.yaml`.
3. When asked, paste the three secrets from your separate `.env` file:
   PAYSTACK_SECRET_KEY, DATAPLUG_API_KEY, ADMIN_PASSWORD. Tap Apply.
4. After the deploy finishes you get a link like https://bundlebay.onrender.com. Open it: bundles should load.
5. Paystack dashboard > Settings > API Keys & Webhooks: set the Live webhook URL to
   https://YOUR-RENDER-LINK/api/paystack/webhook
6. Buy a small bundle for your own number. Check it in https://YOUR-RENDER-LINK/#admin

Notes
- Free Render sleeps after inactivity (first visit takes ~30s) and loses `orders.json` on redeploy.
  For a real shop use a paid instance with a disk and set DATA_DIR to the disk path (e.g. /data).
- Keep your DataPlug wallet funded.
- Never upload `.env` to GitHub.
