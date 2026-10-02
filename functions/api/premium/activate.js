const RPC="https://api.mainnet-beta.solana.com";
const PREMIUM_LAMPORTS=150000000;
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function verify(signature,recipient){
  const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getTransaction",params:[signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]})});
  const d=await r.json().catch(()=>null);const tx=d?.result;
  if(!tx||tx.meta?.err)return {ok:false,error:"Transaction not found or failed"};
  const keys=tx.transaction?.message?.accountKeys||[];const i=keys.findIndex(k=>(k.pubkey||k)===recipient);
  if(i<0)return {ok:false,error:"Premium payment recipient was not found"};
  const received=Number(tx.meta?.postBalances?.[i]??0)-Number(tx.meta?.preBalances?.[i]??0);
  return received>=PREMIUM_LAMPORTS?{ok:true}:{ok:false,error:"Premium payment amount was not received",receivedLamports:received};
}
export async function onRequestPost({request,env}){
  if(!env.DB||!env.PUBLIC_TREASURY_WALLET)return json({ok:false,error:"Premium payments are not configured"},503);
  let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const wallet=String(b.walletAddress||"").trim(),signature=String(b.signature||"").trim(),telegramId=String(b.telegramId||"").trim()||null;
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)||!signature)return json({ok:false,error:"walletAddress and signature are required"},400);
  const used=await env.DB.prepare("SELECT id FROM premium_operators WHERE paid_signature=?").bind(signature).first().catch(()=>null);
  if(used)return json({ok:false,error:"This premium payment was already used"},409);
  const payment=await verify(signature,env.PUBLIC_TREASURY_WALLET);if(!payment.ok)return json(payment,400);
  const expires=new Date(Date.now()+30*86400000).toISOString();
  await env.DB.prepare("INSERT INTO premium_operators (wallet_address,telegram_id,x_handle,status,paid_signature,expires_at) VALUES (?,?,?,?,?,?) ON CONFLICT(wallet_address) DO UPDATE SET telegram_id=excluded.telegram_id,x_handle=excluded.x_handle,status='active',paid_signature=excluded.paid_signature,expires_at=excluded.expires_at").bind(wallet,telegramId,String(b.xHandle||"").trim()||null,"active",signature,expires).run();
  return json({ok:true,walletAddress:wallet,expiresAt:expires});
}
