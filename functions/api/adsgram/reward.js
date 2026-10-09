import {telegramUserFromRequest} from "../_telegram.js";
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS free_raid_credits (telegram_id TEXT PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 0, last_ad_at TEXT)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS free_raid_ad_claims (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, claimed_at TEXT)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_free_raid_ad_claims_pending ON free_raid_ad_claims(telegram_id,status,created_at)").run().catch(()=>{});
}
async function cooldown(db,telegramId){
  const row=await db.prepare("SELECT last_ad_at FROM free_raid_credits WHERE telegram_id=?").bind(telegramId).first();
  if(!row?.last_ad_at)return 0;
  const stamp=String(row.last_ad_at).includes("T")?String(row.last_ad_at):String(row.last_ad_at).replace(" ","T")+"Z";
  const elapsed=(Date.now()-Date.parse(stamp))/1000;
  return Number.isFinite(elapsed)&&elapsed<180?Math.ceil(180-elapsed):0;
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:"Telegram bot is not configured"},503);
  const user=await telegramUserFromRequest(request,env);
  if(!user?.id)return json({ok:false,error:"Open Reward Wall inside Telegram to verify your account"},401);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const action=String(body.action||"");
  const telegramId=String(user.id);
  try{
    await ensureSchema(env.DB);
    if(action==="prepare"){
      const remaining=await cooldown(env.DB,telegramId);
      if(remaining>0)return json({ok:false,error:"Please wait "+remaining+" seconds before watching another rewarded ad.",remainingSeconds:remaining},429);
      const pending=await env.DB.prepare("SELECT id FROM free_raid_ad_claims WHERE telegram_id=? AND status='pending' AND created_at>=datetime('now','-10 minutes') ORDER BY id DESC LIMIT 1").bind(telegramId).first();
      if(!pending)await env.DB.prepare("INSERT INTO free_raid_ad_claims (telegram_id,status) VALUES (?,'pending')").bind(telegramId).run();
      return json({ok:true,ready:true,cooldownSeconds:0});
    }
    if(action==="claim"){
      const pending=await env.DB.prepare("SELECT id FROM free_raid_ad_claims WHERE telegram_id=? AND status='pending' AND created_at>=datetime('now','-10 minutes') ORDER BY id DESC LIMIT 1").bind(telegramId).first();
      if(!pending)return json({ok:false,awarded:false,error:"No active ad session was found. Tap WATCH ADS and complete the ad again."},409);
      const remaining=await cooldown(env.DB,telegramId);
      if(remaining>0)return json({ok:false,awarded:false,error:"Please wait "+remaining+" seconds before claiming another raid credit.",remainingSeconds:remaining},429);
      const claimed=await env.DB.prepare("UPDATE free_raid_ad_claims SET status='claimed',claimed_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(pending.id).run();
      if(Number(claimed?.meta?.changes||0)!==1)return json({ok:false,awarded:false,error:"This ad reward has already been claimed."},409);
      await env.DB.prepare("INSERT INTO free_raid_credits (telegram_id,credits,last_ad_at) VALUES (?,1,CURRENT_TIMESTAMP) ON CONFLICT(telegram_id) DO UPDATE SET credits=free_raid_credits.credits+1,last_ad_at=CURRENT_TIMESTAMP").bind(telegramId).run();
      const row=await env.DB.prepare("SELECT credits FROM free_raid_credits WHERE telegram_id=?").bind(telegramId).first();
      return json({ok:true,awarded:true,credits:Number(row?.credits||0),message:"One free-raid credit added."});
    }
    return json({ok:false,error:"Unknown reward action"},400);
  }catch(error){console.error("FREE RAID REWARD ERROR",error);return json({ok:false,error:"Could not process the free-raid reward"},500)}
}
