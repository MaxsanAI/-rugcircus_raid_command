import {ensureAuthSchema,randomToken,sha256Hex,verifyEd25519,WALLET_RE,sessionCookie,SESSION_TTL} from "./_shared.js";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store",...headers}})}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const wallet=String(body.wallet||"").trim(),challengeId=String(body.challengeId||"").trim(),signature=String(body.signature||"").trim();
  if(!WALLET_RE.test(wallet)||!challengeId||!signature)return json({ok:false,error:"Wallet, challenge and signature are required"},400);
  await ensureAuthSchema(env.DB);
  const challenge=await env.DB.prepare("SELECT id,wallet_address,message,expires_at,used_at FROM phantom_auth_challenges WHERE id=?").bind(challengeId).first();
  if(!challenge||challenge.used_at)return json({ok:false,error:"Sign-in challenge is invalid or already used"},401);
  if(new Date(String(challenge.expires_at)).getTime()<Date.now())return json({ok:false,error:"Sign-in challenge expired. Please try again."},401);
  if(challenge.wallet_address!=="pending"&&challenge.wallet_address!==wallet)return json({ok:false,error:"Wallet does not match the sign-in challenge"},401);
  let valid=false;
  try{valid=await verifyEd25519(wallet,String(challenge.message),signature)}catch(error){console.error("PHANTOM SIGNATURE VERIFY ERROR",error)}
  if(!valid)return json({ok:false,error:"Phantom signature could not be verified"},401);
  await env.DB.prepare("UPDATE phantom_auth_challenges SET used_at=CURRENT_TIMESTAMP WHERE id=?").bind(challengeId).run();
  const session=randomToken();
  const expires=new Date(Date.now()+SESSION_TTL*1000).toISOString();
  await env.DB.prepare("INSERT INTO phantom_auth_sessions (id,wallet_address,expires_at) VALUES (?,?,?)").bind(await sha256Hex(session),wallet,expires).run();
  return json({ok:true,walletAddress:wallet,expiresAt:expires},{headers:{"set-cookie":sessionCookie(session)}});
}
