export async function onRequestGet({env}) {
  return new Response(JSON.stringify({
    ok:true,
    treasury:env.PUBLIC_TREASURY_WALLET||null,
    monetagSmartLink:env.MONETAG_SMARTLINK||null,
    social:{x:Boolean(env.X_BEARER_TOKEN),tiktok:Boolean(env.TIKTOK_ACCESS_TOKEN),telegram:Boolean(env.TELEGRAM_BOT_TOKEN)}
  }),{headers:{"content-type":"application/json","cache-control":"no-store"}});
}