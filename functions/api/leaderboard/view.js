function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}

async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_views (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,campaign_id INTEGER NOT NULL,viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(member_id,campaign_id))").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_leaderboard_views_member ON leaderboard_views(member_id,viewed_at)").run();
}

export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body;
  try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const token=String(body.memberToken||"").trim();
  const campaignId=Number(body.campaignId);
  if(!token||!Number.isInteger(campaignId)||campaignId<1)return json({ok:false,error:"Member token and campaign are required"},400);
  try{
    await ensureSchema(env.DB);
    const member=await env.DB.prepare("SELECT id,username,points FROM leaderboard_members WHERE member_token=?").bind(token).first();
    if(!member)return json({ok:false,error:"Leaderboard membership not found"},401);
    const campaign=await env.DB.prepare("SELECT id FROM campaigns WHERE id=? AND status='active' AND (ends_at IS NULL OR datetime(ends_at)>datetime('now'))").bind(campaignId).first();
    if(!campaign)return json({ok:false,error:"Campaign is no longer active"},404);
    const recent=await env.DB.prepare("SELECT id FROM leaderboard_views WHERE member_id=? AND campaign_id=? AND viewed_at>=datetime('now','-24 hours') LIMIT 1").bind(member.id,campaignId).first();
    if(recent)return json({ok:true,awarded:false,points:Number(member.points||0)});
    await env.DB.prepare("INSERT OR IGNORE INTO leaderboard_views (member_id,campaign_id) VALUES (?,?)").bind(member.id,campaignId).run();
    const inserted=await env.DB.prepare("SELECT changes() AS changes").first();
    if(Number(inserted?.changes||0)>0){
      await env.DB.prepare("UPDATE leaderboard_members SET points=points+1 WHERE id=?").bind(member.id).run();
    }
    const updated=await env.DB.prepare("SELECT points FROM leaderboard_members WHERE id=?").bind(member.id).first();
    return json({ok:true,awarded:Number(inserted?.changes||0)>0,points:Number(updated?.points||0)});
  }catch(error){
    console.error("LEADERBOARD VIEW ERROR",error);
    return json({ok:false,error:"Could not record raid view"},500);
  }
}
