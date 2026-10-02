const API="https://api.mainnet-beta.solana.com";
const PACKAGES={
  FEATURED:{lamports:20000000,hours:24},
  "MEGA RAID":{lamports:50000000,hours:48},
  "FRONT ROW":{lamports:100000000,hours:168}
};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function rpc(method,params){
  const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  const d=await r.json().catch(()=>null);
  return d?.result||null;
}
async function verifyPayment(signature,recipient,lamports){
  const tx=await rpc("getTransaction",[signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]);
  if(!tx||tx.meta?.err) return {ok:false,error:"Transaction not found or failed"};
  const keys=tx.transaction?.message?.accountKeys||[];
  const index=keys.findIndex(k=>(k.pubkey||k)===recipient);
  if(index<0) return {ok:false,error:"Payment recipient was not in transaction"};
  const before=Number(tx.meta?.preBalances?.[index]??-1);
  const after=Number(tx.meta?.postBalances?.[index]??-1);
  const received=after-before;
  if(received<lamports) return {ok:false,error:"Required payment amount was not received",receivedLamports:received};
  return {ok:true,receivedLamports:received};
}
async function ensureSchema(db){
  await db.prepare("ALTER TABLE campaigns ADD COLUMN payout_wallet TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN pump_callout_url TEXT").run().catch(()=>{});
}
export async function onRequestPost({request,env}){
  if(!env.DB||!env.PUBLIC_TREASURY_WALLET) return json({ok:false,error:"Campaign payments are not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const pack=PACKAGES[String(body.package||"").toUpperCase()];
  const signature=String(body.signature||"").trim();
  const mint=String(body.mintAddress||"").trim();
  const ticker=String(body.ticker||"").trim().replace(/[^A-Za-z0-9_]/g,"").slice(0,15);
  const name=String(body.name||ticker||"Token").trim().slice(0,80);
  const payoutWallet=String(body.payoutWallet||env.PUBLIC_TREASURY_WALLET).trim();
  if(!pack||!signature||!mint||!payoutWallet) return json({ok:false,error:"package, signature, mintAddress and payoutWallet are required"},400);
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payoutWallet)) return json({ok:false,error:"Invalid Solana address"},400);
  await ensureSchema(env.DB);
  const premium=await env.DB.prepare("SELECT wallet_address,expires_at FROM premium_operators WHERE wallet_address=? AND status='active' AND expires_at>CURRENT_TIMESTAMP").bind(payoutWallet).first().catch(()=>null);
  if(payoutWallet!==env.PUBLIC_TREASURY_WALLET&&!premium) return json({ok:false,error:"This payout wallet requires an active Premium Operator plan"},403);
  const payment=await verifyPayment(signature,payoutWallet,pack.lamports);
  if(!payment.ok) return json(payment,400);
  const existing=await env.DB.prepare("SELECT id FROM payments WHERE signature=?").bind(signature).first();
  if(existing) return json({ok:false,error:"This transaction has already been used"},409);
  const tokenInsert=await env.DB.prepare("INSERT INTO tokens (mint_address,ticker,name,x_url,tiktok_url,telegram_url,pump_url,dex_url) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(mint_address) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,x_url=excluded.x_url,tiktok_url=excluded.tiktok_url,telegram_url=excluded.telegram_url,pump_url=excluded.pump_url,dex_url=excluded.dex_url").bind(mint,ticker,name,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,"https://pump.fun/coin/"+mint,"https://dexscreener.com/solana/"+mint).run();
  const token=await env.DB.prepare("SELECT id FROM tokens WHERE mint_address=?").bind(mint).first();
  const now=new Date();
  const ends=new Date(now.getTime()+pack.hours*3600000);
  const campaign=await env.DB.prepare("INSERT INTO campaigns (token_id,package,amount_lamports,duration_hours,x_url,tiktok_url,telegram_url,raid_copy,pump_callout_url,status,payment_signature,payout_wallet,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(token.id,String(body.package).toUpperCase(),pack.lamports,pack.hours,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,String(body.raidCopy||"").trim()||null,String(body.pumpCalloutUrl||"").trim()||null,"active",signature,payoutWallet,now.toISOString(),ends.toISOString()).run();
  await env.DB.prepare("INSERT INTO payments (campaign_id,signature,wallet_address,lamports,status,verified_at) VALUES (?,?,?,?,?,?)").bind(campaign.meta.last_row_id,signature,String(body.payerWallet||"").trim()||null,pack.lamports,"verified",now.toISOString()).run();
  return json({ok:true,campaignId:campaign.meta.last_row_id,endsAt:ends.toISOString(),receivedLamports:payment.receivedLamports});
}
