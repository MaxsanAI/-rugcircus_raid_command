export async function onRequestGet({request,env}) {
  let premiumOperator=false;
  const wallet=String(request.headers.get("x-wallet-address")||"").trim();
  if(env.DB&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)){
    premiumOperator=Boolean(await env.DB.prepare("SELECT id FROM premium_operators WHERE wallet_address=? AND status='active' AND expires_at>CURRENT_TIMESTAMP LIMIT 1").bind(wallet).first().catch(()=>null));
  }
  return new Response(JSON.stringify({
    ok:true,
    treasury:env.PUBLIC_TREASURY_WALLET||null,
    premiumOperator,
    monetagSmartLink:env.MONETAG_SMARTLINK||null,
    social:{x:Boolean(env.X_BEARER_TOKEN),tiktok:Boolean(env.TIKTOK_ACCESS_TOKEN),telegram:Boolean(env.TELEGRAM_BOT_TOKEN)}
  }),{headers:{"content-type":"application/json","cache-control":"no-store"}});
}
