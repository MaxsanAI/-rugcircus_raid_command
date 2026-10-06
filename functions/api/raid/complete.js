function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS raid_actions (id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id INTEGER NOT NULL,user_id INTEGER,platform TEXT NOT NULL,action_type TEXT NOT NULL,external_url TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run().catch(()=>{});
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_raid_rewards (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,campaign_id INTEGER NOT NULL,points INTEGER NOT NULL DEFAULT 3,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(member_id,campaign_id))").run();
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const token=String(body.memberToken||"").trim(),campaignId=Number(body.campaignId);
  if(!token||!Number.isInteger(campaignId)||campaignId<1)return json({ok:false,error:"Member token and campaign are required"},400);
  try{
    await ensureSchema(env.DB);
    const member=await env.DB.prepare("SELECT id,points FROM leaderboard_members WHERE member_token=?").bind(token).first();
    if(!member)return json({ok:false,error:"Join the Reward Wall first."},401);
    const campaign=await env.DB.prepare("SELECT id,x_url,status,ends_at FROM campaigns WHERE id=? AND status='active' AND (ends_at IS NULL OR datetime(ends_at)>datetime('now'))").bind(campaignId).first();
    if(!campaign)return json({ok:false,error:"This raid is no longer active."},404);
    const existing=await env.DB.prepare("SELECT id FROM leaderboard_raid_rewards WHERE member_id=? AND campaign_id=? LIMIT 1").bind(member.id,campaignId).first();
    if(existing)return json({ok:true,awarded:false,points:3,message:"You already earned the points for this raid."});
    if(!campaign.x_url)return json({ok:false,error:"This raid has no X task."},400);
    const click=await env.DB.prepare("SELECT id FROM raid_actions WHERE campaign_id=? AND user_id IS NULL AND platform='x' AND action_type='click' AND created_at>=datetime('now','-30 minutes') ORDER BY id DESC LIMIT 1").bind(campaignId).first();
    if(!click){
      return json({ok:false,error:"Open the X raid first. Like it, repost it and leave a comment, then return here and claim your +3 points."},403);
    }
    await env.DB.prepare("INSERT INTO leaderboard_raid_rewards (member_id,campaign_id,points) VALUES (?,?,3)").bind(member.id,campaignId).run();
    await env.DB.prepare("UPDATE leaderboard_members SET points=points+3 WHERE id=?").bind(member.id).run();
    const current=await env.DB.prepare("SELECT points FROM leaderboard_members WHERE id=?").bind(member.id).first();
    return json({ok:true,awarded:true,points:3,totalPoints:Number(current?.points||0)});
  }catch(error){console.error("RAID REWARD ERROR",error);return json({ok:false,error:"Could not complete raid reward"},500)}
}
