function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_ad_rewards (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,telegram_id TEXT NOT NULL,points INTEGER NOT NULL DEFAULT 3,status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,rewarded_at TEXT)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_leaderboard_ad_rewards_member ON leaderboard_ad_rewards(member_id,rewarded_at)").run().catch(()=>{});
}
async function prepare(db,token,telegramId){
  const member=await db.prepare("SELECT id,telegram_id FROM leaderboard_members WHERE member_token=?").bind(token).first();
  if(!member)return {error:"Leaderboard membership not found",status:401};
  if(!member.telegram_id||String(member.telegram_id)!==String(telegramId))return {error:"Telegram account does not match this membership",status:403};
  const last=await db.prepare("SELECT rewarded_at FROM leaderboard_ad_rewards WHERE member_id=? AND status='rewarded' ORDER BY rewarded_at DESC LIMIT 1").bind(member.id).first();
  if(last?.rewarded_at){
    const elapsed=(Date.now()-Date.parse(String(last.rewarded_at).replace(" ","T")+"Z"))/1000;
    if(elapsed<180)return {error:"Reward cooldown active",status:429,remainingSeconds:Math.ceil(180-elapsed)};
  }
  const pending=await db.prepare("SELECT id FROM leaderboard_ad_rewards WHERE member_id=? AND status='pending' AND created_at>=datetime('now','-10 minutes') LIMIT 1").bind(member.id).first();
  if(!pending)await db.prepare("INSERT INTO leaderboard_ad_rewards (member_id,telegram_id,points,status) VALUES (?,?,3,'pending')").bind(member.id,String(telegramId)).run();
  return {ok:true};
}
async function prepareBotReward(db,telegramId,telegramUsername=""){
  const id=String(telegramId||"").trim();
  if(!/^\d{1,20}$/.test(id))return {error:"Invalid Telegram user id",status:400};
  await ensureSchema(db);
  let member=await db.prepare("SELECT id,telegram_id FROM leaderboard_members WHERE telegram_id=?").bind(id).first();
  if(!member&&telegramUsername){
    const username=String(telegramUsername).trim().replace(/^@/,"");
    if(username){
      const candidate=await db.prepare("SELECT id,telegram_id FROM leaderboard_members WHERE lower(username)=lower(?)").bind(username).first();
      if(candidate&&(!candidate.telegram_id||String(candidate.telegram_id)===id)){
        await db.prepare("UPDATE leaderboard_members SET telegram_id=?,telegram_username=? WHERE id=?").bind(id,username,candidate.id).run();
        member={id:candidate.id,telegram_id:id};
      }
    }
  }
  if(!member)return {error:"Join the Reward Wall first in the Command Center.",status:403};
  const last=await db.prepare("SELECT rewarded_at FROM leaderboard_ad_rewards WHERE member_id=? AND status='rewarded' ORDER BY rewarded_at DESC LIMIT 1").bind(member.id).first();
  if(last?.rewarded_at){
    const elapsed=(Date.now()-Date.parse(String(last.rewarded_at).replace(" ","T")+"Z"))/1000;
    if(elapsed<180)return {error:"Reward cooldown active",status:429,remainingSeconds:Math.ceil(180-elapsed)};
  }
  const pending=await db.prepare("SELECT id FROM leaderboard_ad_rewards WHERE member_id=? AND status='pending' AND created_at>=datetime('now','-10 minutes') LIMIT 1").bind(member.id).first();
  if(!pending)await db.prepare("INSERT INTO leaderboard_ad_rewards (member_id,telegram_id,points,status) VALUES (?,?,3,'pending')").bind(member.id,id).run();
  return {ok:true};
}
export { prepareBotReward };

async function claim(db,telegramId){
  const pending=await db.prepare("SELECT id,member_id FROM leaderboard_ad_rewards WHERE telegram_id=? AND status='pending' AND created_at>=datetime('now','-10 minutes') ORDER BY id DESC LIMIT 1").bind(String(telegramId)).first();
  if(!pending)return {awarded:false};
  const last=await db.prepare("SELECT rewarded_at FROM leaderboard_ad_rewards WHERE member_id=? AND status='rewarded' ORDER BY rewarded_at DESC LIMIT 1").bind(pending.member_id).first();
  if(last?.rewarded_at){
    const elapsed=(Date.now()-Date.parse(String(last.rewarded_at).replace(" ","T")+"Z"))/1000;
    if(elapsed<180)return {awarded:false,cooldown:Math.ceil(180-elapsed)};
  }
  const done=await db.prepare("UPDATE leaderboard_ad_rewards SET status='rewarded',rewarded_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'").bind(pending.id).run();
  if(Number(done?.meta?.changes||0)!==1)return {awarded:false};
  await db.prepare("UPDATE leaderboard_members SET points=points+3 WHERE id=?").bind(pending.member_id).run();
  return {awarded:true};
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let b;try{b=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const token=String(b.memberToken||"").trim(),telegramId=String(b.telegramId||"").trim();
  if(!token||!/^\d{1,20}$/.test(telegramId))return json({ok:false,error:"Telegram identity is required"},400);
  try{await ensureSchema(env.DB);const r=await prepare(env.DB,token,telegramId);return json(r,r.status||200)}catch(e){console.error("ADSGRAM PREPARE",e);return json({ok:false,error:"Could not prepare reward"},500)}
}
export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  const telegramId=String(new URL(request.url).searchParams.get("userid")||"").trim();
  if(!/^\d{1,20}$/.test(telegramId))return json({ok:false,error:"Invalid Telegram user id"},400);
  try{await ensureSchema(env.DB);const r=await claim(env.DB,telegramId);return json({ok:true,...r})}catch(e){console.error("ADSGRAM CLAIM",e);return json({ok:false,error:"Could not claim reward"},500)}
}