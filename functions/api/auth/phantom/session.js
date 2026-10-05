import {cookieValue,ensureAuthSchema,sha256Hex,SESSION_COOKIE} from "./_shared.js";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store",...headers}})}
export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:true,authenticated:false});
  await ensureAuthSchema(env.DB);
  const raw=cookieValue(request,SESSION_COOKIE);
  if(!raw)return json({ok:true,authenticated:false});
  const id=await sha256Hex(raw);
  const row=await env.DB.prepare("SELECT wallet_address,expires_at FROM phantom_auth_sessions WHERE id=?").bind(id).first();
  if(!row||new Date(String(row.expires_at)).getTime()<Date.now()){
    if(row)await env.DB.prepare("DELETE FROM phantom_auth_sessions WHERE id=?").bind(id).run().catch(()=>{});
    return json({ok:true,authenticated:false});
  }
  await env.DB.prepare("UPDATE phantom_auth_sessions SET last_seen_at=CURRENT_TIMESTAMP WHERE id=?").bind(id).run().catch(()=>{});
  return json({ok:true,authenticated:true,walletAddress:String(row.wallet_address),expiresAt:String(row.expires_at)});
}
