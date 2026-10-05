import {ensureAuthSchema,randomToken} from "../_shared.js";

const API="https://api.telegram.org/bot";

async function getBotUsername(token){
  const r=await fetch(API+token+"/getMe");
  const d=await r.json();
  if(!d?.ok||!d.result?.username)throw new Error("Telegram bot username is unavailable");
  return String(d.result.username);
}

export async function onRequestGet({request,env}){
  if(!env.DB||!env.TELEGRAM_BOT_TOKEN)return Response.redirect("https://raidrugcircus.pulserapp.com/?phantom_error=telegram_not_configured",302);
  await ensureAuthSchema(env.DB);
  const url=new URL(request.url);
  const payload={
    phantom_encryption_public_key:url.searchParams.get("phantom_encryption_public_key")||"",
    nonce:url.searchParams.get("nonce")||"",
    data:url.searchParams.get("data")||"",
    errorCode:url.searchParams.get("errorCode")||"",
    errorMessage:url.searchParams.get("errorMessage")||""
  };
  if((payload.data&&!payload.nonce)||(!payload.data&&payload.errorCode)){}
  else if(!payload.data&&!payload.errorCode)return new Response("Invalid Phantom callback",{status:400});
  const id=randomToken().replace(/[^A-Za-z0-9_-]/g,"").slice(0,40);
  const expires=new Date(Date.now()+5*60*1000).toISOString();
  await env.DB.prepare("INSERT INTO phantom_deeplink_callbacks (id,payload,expires_at) VALUES (?,?,?)").bind(id,JSON.stringify(payload),expires).run();
  const username=await getBotUsername(env.TELEGRAM_BOT_TOKEN);
  const start="phantom_"+id;
  return Response.redirect("https://t.me/"+encodeURIComponent(username)+"?startapp="+encodeURIComponent(start),302);
}