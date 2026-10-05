import {Address} from "@ton/core";
import {telegramUserFromRequest} from "../_telegram.js";

const PREMIUM_NANO=6000000000;
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function rawAddress(value){try{return Address.parse(String(value||"").trim()).toRawString()}catch{return ""}}
function apiHeaders(env){return env.TONCENTER_API_KEY?{"accept":"application/json","content-type":"application/json","X-API-Key":env.TONCENTER_API_KEY}:{"accept":"application/json","content-type":"application/json"}}

async function verifyTonPayment(boc,recipient,payer,env){
  const recipientRaw=rawAddress(recipient),payerRaw=rawAddress(payer);if(!boc||!recipientRaw||!payerRaw)return {ok:false,error:"Invalid TON payment data"};
  try{
    const m=await fetch("https://toncenter.com/api/v3/message",{method:"POST",headers:apiHeaders(env),body:JSON.stringify({boc})}),md=await m.json().catch(()=>null),hash=md?.message_hash_norm||md?.message_hash;
    if(!m.ok||!hash)return {ok:false,error:"TON payment could not be decoded"};
    const r=await fetch("https://toncenter.com/api/v3/transactionsByMessage?direction=in&limit=20&msg_hash="+encodeURIComponent(hash),{headers:apiHeaders(env)}),d=await r.json().catch(()=>null);if(!r.ok)return {ok:false,error:"TON transaction lookup failed"};
    for(const tx of Array.isArray(d?.transactions)?d.transactions:[]){
      if(rawAddress(tx.account)!==payerRaw||tx.description?.aborted===true||tx.description?.action?.success===false)continue;
      const out=Array.isArray(tx.out_msgs)?tx.out_msgs.find(x=>rawAddress(x.destination)===recipientRaw&&BigInt(String(x.value||0))>=BigInt(PREMIUM_NANO)):null;
      if(out)return {ok:true,messageHash:hash,txHash:String(tx.hash||"")};
    }
    return {ok:false,error:"Premium payment was not found on TON"};
  }catch(e){console.error("PREMIUM TON VERIFY ERROR",e);return {ok:false,error:"TON payment verification failed"}}
}

async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS premium_operators (id INTEGER PRIMARY KEY AUTOINCREMENT,wallet_address TEXT UNIQUE NOT NULL,telegram_id TEXT,x_handle TEXT,status TEXT NOT NULL DEFAULT 'active',paid_signature TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const info=await db.prepare("PRAGMA table_info(premium_operators)").all().catch(()=>({results:[]})),cols=new Set((info.results||[]).map(x=>String(x.name)));
  for(const [n,t] of [["telegram_id","TEXT"],["x_handle","TEXT"],["status","TEXT DEFAULT 'active'"],["paid_signature","TEXT"],["expires_at","TEXT"]])if(!cols.has(n))await db.prepare("ALTER TABLE premium_operators ADD COLUMN "+n+" "+t).run().catch(()=>{});
}

export async function onRequestPost({request,env}){
  const treasury=String(env.TON_TREASURY_ADDRESS||env.PUBLIC_TON_TREASURY_ADDRESS||"").trim();if(!env.DB||!treasury)return json({ok:false,error:"Premium payments are not configured"},503);
  const tg=await telegramUserFromRequest(request,env);if(!tg)return json({ok:false,error:"Open the Command Center from Telegram before activating Premium."},401);
  let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const wallet=String(b.walletAddress||"").trim(),boc=String(b.boc||"").trim();if(!rawAddress(wallet)||!boc)return json({ok:false,error:"TON wallet and payment are required"},400);
  await ensureSchema(env.DB);
  const payment=await verifyTonPayment(boc,treasury,wallet,env);if(!payment.ok)return json(payment,400);
  const used=await env.DB.prepare("SELECT id FROM premium_operators WHERE paid_signature=?").bind(payment.messageHash).first().catch(()=>null);if(used)return json({ok:false,error:"This Premium payment was already used"},409);
  const expires=new Date(Date.now()+30*86400000).toISOString();
  await env.DB.prepare("INSERT INTO premium_operators (wallet_address,telegram_id,x_handle,status,paid_signature,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(wallet_address) DO UPDATE SET telegram_id=excluded.telegram_id,x_handle=excluded.x_handle,status='active',paid_signature=excluded.paid_signature,expires_at=excluded.expires_at").bind(wallet,String(tg.id),String(b.xHandle||"").trim()||null,"active",payment.messageHash,expires).run();
  return json({ok:true,walletAddress:wallet,expiresAt:expires});
}
