const crypto=require('crypto');
const DB=require('./_db');
const PAYSTACK_SECRET_KEY=process.env.PAYSTACK_SECRET_KEY, DATAPLUG_API_KEY=process.env.DATAPLUG_API_KEY;
const DP='https://api.dataplug.store/functions/v1', PS='https://api.paystack.co';
const NETWORKS=['mtn','mtn_express','telecel','airteltigo'];
const call=async(base,key,path,opts={})=>{const r=await fetch(base+path,{...opts,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'}});return{status:r.status,body:await r.json().catch(()=>({}))};};
const ps=(p,o)=>call(PS,PAYSTACK_SECRET_KEY,p,o), dp=(p,o)=>call(DP,DATAPLUG_API_KEY,p,o);
const list=b=>Array.isArray(b)?b:b.packages||b.data||[];
const phone=v=>{let p=String(v||'').replace(/[\s-]/g,'');if(p.startsWith('+233'))p='0'+p.slice(4);else if(p.startsWith('233'))p='0'+p.slice(3);return /^0[235]\d{8}$/.test(p)?p:null;};
async function packages(net){const r=await dp(`/get-packages?network=${encodeURIComponent(net)}`);if(r.status!==200)throw Error('Could not load packages');return list(r.body).map(p=>{const base=Number(p.price??p.amount??p.cost);return{network:p.network||net,size_gb:Number(p.size_gb??p.size),price:Math.round(base*(1+Number(process.env.MARKUP_PERCENT||0)/100)*100)/100};}).filter(p=>p.size_gb&&p.price>0);}
async function fulfill(ref){const old=await DB.get(ref);if(!old||old.status!=='awaiting_payment')return old;const verify=await ps(`/transaction/verify/${encodeURIComponent(ref)}`),d=verify.body.data;if(!d||d.status!=='success')return old;
 if(d.currency!=='GHS'||d.amount!==Math.round(old.price*100))return DB.update(ref,'failed',{error:'Paid amount does not match order'});
 const o=await DB.claim(ref);if(!o)return DB.get(ref);
 try{const r=await dp('/purchase',{method:'POST',body:JSON.stringify({network:o.network,size_gb:o.size_gb,phone:o.phone})});if(r.status===200)return DB.update(ref,'completed',{order_id:r.body.order_id,provider_reference:r.body.provider_reference,dataplug_status:r.body.status});
 const error=r.status===402?`DataPlug wallet low: ${JSON.stringify(r.body)}`:r.status===404?'Package not found on DataPlug':`DataPlug error ${r.status}: ${JSON.stringify(r.body)}`;
 if(process.env.AUTO_REFUND==='true'){const rf=await ps('/refund',{method:'POST',body:JSON.stringify({transaction:ref})});if(rf.status===200&&rf.body.status)return DB.update(ref,'refunded',{error});}return DB.update(ref,'paid_unfulfilled',{error});
 }catch(e){return DB.update(ref,'paid_unfulfilled',{error:String(e)});}}
module.exports={DB,crypto,NETWORKS,packages,phone,ps,dp,fulfill};
