import {ensureAuthSchema,randomToken,sha256Hex,WALLET_RE} from "./_shared.js";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store",...headers}})}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body={};try{body=await request.json()}catch{}
  const wallet=String(body.wallet||"").trim();
  if(wallet&&!WALLET_RE.test(wallet))return json({ok:false,error:"Invalid Solana wallet address"},400);
  await ensureAuthSchema(env.DB);
  const challenge=randomToken();
  const message=[
    "RUGCIRCUS COMMAND — Phantom Sign-In",
    "",
    "Sign this message to securely connect your wallet.",
    "This does not authorize a payment or transaction.",
    "",
    "Wallet: "+(wallet||"pending"),
    "Challenge: "+challenge,
    "Issued At: "+new Date().toISOString(),
    "Domain: "+new URL(request.url).host
  ].join("\n");
  const id=randomToken();
  const expires=new Date(Date.now()+10*60*1000).toISOString();
  await env.DB.prepare("INSERT INTO phantom_auth_challenges (id,wallet_address,message,expires_at) VALUES (?,?,?,?)").bind(id,wallet||"pending",message,expires).run();
  return json({ok:true,challengeId:id,message,expiresAt:expires});
}
