import {telegramUserFromRequest} from "./_telegram.js";

export async function onRequestGet({request,env}) {
  let premiumOperator=false;
  const telegramUser=await telegramUserFromRequest(request,env);
  if(env.DB&&telegramUser?.id){
    premiumOperator=Boolean(await env.DB.prepare("SELECT id FROM premium_operators WHERE telegram_id=? AND status='active' AND expires_at>CURRENT_TIMESTAMP LIMIT 1").bind(String(telegramUser.id)).first().catch(()=>null));
  }
  return new Response(JSON.stringify({
    ok:true,
    tonTreasury:env.TON_TREASURY_ADDRESS||env.PUBLIC_TON_TREASURY_ADDRESS||null,
    premiumOperator,
    monetagSmartLink:env.MONETAG_SMARTLINK||null,
    adsgramBlockId:env.PUBLIC_ADSGRAM_BLOCK_ID||"52186",
    social:{x:Boolean(env.X_BEARER_TOKEN),tiktok:Boolean(env.TIKTOK_ACCESS_TOKEN),telegram:Boolean(env.TELEGRAM_BOT_TOKEN)}
  }),{headers:{"content-type":"application/json","cache-control":"no-store"}});
}
