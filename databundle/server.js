require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
  PAYSTACK_SECRET_KEY, DATAPLUG_API_KEY, ADMIN_PASSWORD,
  PORT = 3000, MARKUP_PERCENT = '0', AUTO_REFUND = 'false',
} = process.env;
for (const k of ['PAYSTACK_SECRET_KEY', 'DATAPLUG_API_KEY', 'ADMIN_PASSWORD']) {
  if (!process.env[k]) { console.error(`Missing env var: ${k}`); process.exit(1); }
}

const DP = 'https://api.dataplug.store/functions/v1';
const PS = 'https://api.paystack.co';
const NETWORKS = ['mtn', 'mtn_express', 'telecel', 'airteltigo'];

// ---------- tiny JSON "database" (swap for Postgres/Supabase at scale) ----------
const DB = path.join(process.env.DATA_DIR || __dirname, 'orders.json'); // point DATA_DIR at a persistent disk if you have one
let orders = {};
try { orders = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { /* first run */ }
const save = () => fs.writeFileSync(DB, JSON.stringify(orders, null, 2));

// ---------- API helpers ----------
async function call(base, token, p, opts = {}) {
  const r = await fetch(base + p, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });
  const body = await r.json().catch(() => ({}));
  return { status: r.status, body };
}
const dp = (p, o) => call(DP, DATAPLUG_API_KEY, p, o);
const ps = (p, o) => call(PS, PAYSTACK_SECRET_KEY, p, o);

const asList = (b) => (Array.isArray(b) ? b : b.packages || b.data || []);
// Adjust here if DataPlug's field names differ from these guesses.
const normalize = (p, network) => {
  const base = Number(p.price ?? p.amount ?? p.cost);
  const price = Math.round(base * (1 + Number(MARKUP_PERCENT) / 100) * 100) / 100;
  return { network: p.network || network, size_gb: Number(p.size_gb ?? p.size), price };
};
async function getPackages(network) {
  const r = await dp(`/get-packages?network=${encodeURIComponent(network)}`);
  if (r.status !== 200) throw new Error('Could not load packages');
  return asList(r.body).map((p) => normalize(p, network)).filter((p) => p.size_gb && p.price > 0);
}

const cleanPhone = (v) => {
  let p = String(v || '').replace(/[\s-]/g, '');
  if (p.startsWith('+233')) p = '0' + p.slice(4);
  else if (p.startsWith('233')) p = '0' + p.slice(3);
  return /^0[235]\d{8}$/.test(p) ? p : null;
};

// ---------- fulfillment (idempotent: safe to call from webhook AND verify) ----------
const locks = new Set();
async function fulfill(ref) {
  const o = orders[ref];
  if (!o) return null;
  if (o.status !== 'awaiting_payment' || locks.has(ref)) return o;
  locks.add(ref);
  try {
    const v = await ps(`/transaction/verify/${encodeURIComponent(ref)}`);
    const d = v.body.data;
    if (!d || d.status !== 'success') return o; // not paid (yet)

    if (d.currency !== 'GHS' || d.amount !== Math.round(o.price * 100)) {
      o.status = 'failed'; o.error = 'Paid amount does not match order'; save();
      return o;
    }
    o.status = 'processing'; o.paidAt = new Date().toISOString(); save();

    const r = await dp('/purchase', {
      method: 'POST',
      body: JSON.stringify({ network: o.network, size_gb: o.size_gb, phone: o.phone }),
    });

    if (r.status === 200) {
      o.status = 'completed';
      o.order_id = r.body.order_id;
      o.provider_reference = r.body.provider_reference;
      o.dataplug_status = r.body.status;
    } else {
      o.status = 'paid_unfulfilled';
      o.error = r.status === 402 ? `DataPlug wallet low: ${JSON.stringify(r.body)}`
        : r.status === 404 ? 'Package not found on DataPlug'
        : `DataPlug error ${r.status}: ${JSON.stringify(r.body)}`;
      if (AUTO_REFUND === 'true') {
        const rf = await ps('/refund', { method: 'POST', body: JSON.stringify({ transaction: ref }) });
        if (rf.status === 200 && rf.body.status) o.status = 'refunded';
      }
    }
    save();
    return o;
  } catch (e) {
    console.error('fulfill error', ref, e);
    if (o.status === 'processing') { o.status = 'paid_unfulfilled'; o.error = String(e); save(); }
    return o;
  } finally {
    locks.delete(ref);
  }
}

// ---------- app ----------
const app = express();
app.set('trust proxy', 1);

// Simple per-IP rate limit (30 requests/minute) for checkout and order polling.
const hits = new Map();
setInterval(() => hits.clear(), 60_000).unref();
const limit = (req, res, next) => {
  const n = (hits.get(req.ip) || 0) + 1;
  hits.set(req.ip, n);
  return n > 30 ? res.status(429).json({ error: 'Too many requests. Wait a minute and try again.' }) : next();
};
app.get('/health', (_req, res) => res.send('ok'));

// Webhook needs the RAW body to verify the signature, so it comes before express.json().
app.post('/api/paystack/webhook', express.raw({ type: '*/*' }), (req, res) => {
  const sig = crypto.createHmac('sha512', PAYSTACK_SECRET_KEY).update(req.body).digest('hex');
  if (sig !== req.headers['x-paystack-signature']) return res.sendStatus(401);
  res.sendStatus(200); // acknowledge fast, work after
  try {
    const ev = JSON.parse(req.body.toString());
    if (ev.event === 'charge.success') fulfill(ev.data.reference);
  } catch (e) { console.error('webhook parse', e); }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/packages', async (req, res) => {
  const network = req.query.network;
  if (!NETWORKS.includes(network)) return res.status(400).json({ error: 'Unknown network' });
  try {
    const list = (await getPackages(network)).sort((a, b) => a.size_gb - b.size_gb);
    res.json({ packages: list });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

app.post('/api/checkout', limit, async (req, res) => {
  const { network, size_gb, email } = req.body || {};
  const phone = cleanPhone(req.body?.phone);
  if (!NETWORKS.includes(network)) return res.status(400).json({ error: 'Unknown network' });
  if (!phone) return res.status(400).json({ error: 'Enter a valid Ghana number, e.g. 0241234567' });
  try {
    // Price always comes from the server, never from the browser.
    const pkg = (await getPackages(network)).find((p) => p.size_gb === Number(size_gb));
    if (!pkg) return res.status(404).json({ error: 'That package is no longer available' });

    const reference = 'DB_' + Date.now() + '_' + crypto.randomBytes(5).toString('hex');
    const init = await ps('/transaction/initialize', {
      method: 'POST',
      body: JSON.stringify({
        email: /^\S+@\S+\.\S+$/.test(email || '') ? email : `${phone}@example.com`,
        amount: Math.round(pkg.price * 100),
        currency: 'GHS',
        reference,
        metadata: { network, size_gb: pkg.size_gb, phone },
      }),
    });
    if (!init.body.status) return res.status(502).json({ error: 'Could not start payment' });

    orders[reference] = {
      reference, network, size_gb: pkg.size_gb, phone, price: pkg.price,
      status: 'awaiting_payment', createdAt: new Date().toISOString(),
    };
    save();
    res.json({ reference, access_code: init.body.data.access_code, price: pkg.price });
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Browser polls this after the Paystack popup closes. It also verifies + fulfills,
// so delivery works even if the webhook is delayed.
app.get('/api/order/:ref', limit, async (req, res) => {
  const o = await fulfill(req.params.ref);
  if (!o) return res.status(404).json({ error: 'Order not found' });
  res.json({
    reference: o.reference, status: o.status, network: o.network, size_gb: o.size_gb,
    phone: o.phone, price: o.price, order_id: o.order_id,
  });
});

const admin = (req, res, next) => {
  const a = Buffer.from(req.get('x-admin-key') || '');
  const b = Buffer.from(ADMIN_PASSWORD);
  if (a.length === b.length && crypto.timingSafeEqual(a, b)) return next();
  res.sendStatus(401);
};
app.get('/api/admin/orders', admin, async (_req, res) => {
  const remote = await dp('/get-orders').catch(() => ({ body: {} }));
  res.json({
    local: Object.values(orders).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200),
    dataplug: asList(remote.body),
  });
});

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));
