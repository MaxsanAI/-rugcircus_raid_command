import {telegramUserFromRequest,telegramUserFromBody} from "../_telegram.js";

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS reward_task_claims (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,telegram_id TEXT NOT NULL,task TEXT NOT NULL,points INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(member_id,task))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_reward_task_claims_tg ON reward_task_claims(telegram_id,task)").run().catch(()=>{});
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
}
const TASKS={x_follow:{points:2,oneTime:true},telegram_group:{points:2,oneTime:true},bot_group:{points:3,oneTime:true}};
async function tgCall(method,token,body={}){
  if(!token)return null;
  try{const r=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});return await r.json().catch(()=>null)}catch{return null}
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const token=String(body.memberToken||"").trim(),task=String(body.task||"").trim();
  if(!token||!TASKS[task])return json({ok:false,error:"Invalid reward task"},400);
  const tg=await telegramUserFromRequest(request,env)||await telegramUserFromBody(body,env);
  if(!tg)return json({ok:false,error:"Telegram session could not be verified. Open Rewards inside Telegram."},401);
  try{
    await ensureSchema(env.DB);
    const member=await env.DB.prepare("SELECT id,telegram_id,points FROM leaderboard_members WHERE member_token=?").bind(token).first();
    if(!member)return json({ok:false,error:"Join the Reward Wall first."},401);
    if(member.telegram_id&&String(member.telegram_id)!==String(tg.id))return json({ok:false,error:"Telegram account does not match this Reward Wall membership."},403);
    if(task==="telegram_group"){
      const check=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:"@rugcxx",user_id:Number(tg.id)});
      const status=check?.result?.status;
      if(!check?.ok||["left","kicked"].includes(String(status)))return json({ok:false,error:"Join @rugcxx first, then press VERIFY +2."},403);
    }
    if(task==="bot_group"){
      const found=await env.DB.prepare("SELECT id FROM reward_task_claims WHERE member_id=? AND task='bot_group' LIMIT 1").bind(member.id).first();
      if(!found)return json({ok:false,error:"Add @RugcircusRaidBot to a Telegram group first. The bot must receive the group update before this task can be verified."},403);
    }
    const existing=await env.DB.prepare("SELECT id FROM reward_task_claims WHERE member_id=? AND task=? LIMIT 1").bind(member.id,task).first();
    if(existing)return json({ok:true,awarded:false,points:TASKS[task].points,message:"Task already completed."});
    const points=TASKS[task].points;
    await env.DB.prepare("INSERT INTO reward_task_claims (member_id,telegram_id,task,points) VALUES (?,?,?,?)").bind(member.id,String(tg.id),task,points).run();
    await env.DB.prepare("UPDATE leaderboard_members SET points=points+? WHERE id=?").bind(points,member.id).run();
    return json({ok:true,awarded:true,points});
  }catch(error){console.error("REWARD TASK ERROR",error);return json({ok:false,error:"Could not verify reward task"},500)}
}
