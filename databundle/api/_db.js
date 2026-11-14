const { sql } = require('@vercel/postgres');
let setup;
async function init() {
  if (!setup) setup = sql`CREATE TABLE IF NOT EXISTS orders (
    reference TEXT PRIMARY KEY, network TEXT NOT NULL, size_gb NUMERIC NOT NULL,
    phone TEXT NOT NULL, price NUMERIC NOT NULL, status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), paid_at TIMESTAMPTZ,
    order_id TEXT, provider_reference TEXT, dataplug_status TEXT, error TEXT
  )`;
  await setup;
}
const map = r => r && ({reference:r.reference,network:r.network,size_gb:Number(r.size_gb),phone:r.phone,price:Number(r.price),status:r.status,createdAt:new Date(r.created_at).toISOString(),paidAt:r.paid_at&&new Date(r.paid_at).toISOString(),order_id:r.order_id,provider_reference:r.provider_reference,dataplug_status:r.dataplug_status,error:r.error});
async function create(o) { await init(); const r=await sql`INSERT INTO orders(reference,network,size_gb,phone,price,status) VALUES(${o.reference},${o.network},${o.size_gb},${o.phone},${o.price},'awaiting_payment') RETURNING *`; return map(r.rows[0]); }
async function get(ref) { await init(); const r=await sql`SELECT * FROM orders WHERE reference=${ref}`; return map(r.rows[0]); }
async function claim(ref) { await init(); const r=await sql`UPDATE orders SET status='processing',paid_at=NOW() WHERE reference=${ref} AND status='awaiting_payment' RETURNING *`; return map(r.rows[0]); }
async function update(ref,status,extra={}) { await init(); await sql`UPDATE orders SET status=${status},order_id=${extra.order_id||null},provider_reference=${extra.provider_reference||null},dataplug_status=${extra.dataplug_status||null},error=${extra.error||null} WHERE reference=${ref}`; return get(ref); }
async function list() { await init(); const r=await sql`SELECT * FROM orders ORDER BY created_at DESC LIMIT 200`; return r.rows.map(map); }
module.exports={create,get,claim,update,list};
