import {cookieValue,ensureAuthSchema,sha256Hex,SESSION_COOKIE} from "./_shared.js";
function json(data,status=200,headers={}){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store",...headers}})}
export async function onRequestPost({request,env}){
  if(env.DB){
    await ensureAuthSchema(env.DB);
    const raw=cookieValue(request,SESSION_COOKIE);
    if(raw)await env.DB.prepare("DELETE FROM phantom_auth_sessions WHERE id=?").bind(await sha256Hex(raw)).run().catch(()=>{});
  }
  return json({ok:true},{headers:{"set-cookie":SESSION_COOKIE+"=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax"}});
}
