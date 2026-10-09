function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL DEFAULT '',member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const info=await db.prepare("PRAGMA table_info(leaderboard_members)").all().catch(()=>({results:[]}));
  const cols=new Set((info.results||[]).map(x=>String(x.name)));
  for(const [name,type] of [["telegram_id","TEXT"],["telegram_username","TEXT"],["telegram_first_name","TEXT"],["telegram_last_name","TEXT"],["display_name","TEXT"]]){
    if(!cols.has(name))await db.prepare("ALTER TABLE leaderboard_members ADD COLUMN "+name+" "+type).run().catch(()=>{});
  }
}
export async function onRequestGet({env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  try{
    await ensureSchema(env.DB);
    const total=await env.DB.prepare("SELECT COUNT(*) AS n FROM leaderboard_members").first();
    const rows=await env.DB.prepare("SELECT username,wallet_address,points FROM leaderboard_members ORDER BY points DESC,created_at ASC LIMIT 50").all();
    const leaderboard=(rows.results||[]).map(x=>({username:String(x.username||"Anonymous"),wallet:String(x.wallet_address||""),points:Number(x.points||0)}));
    return json({ok:true,rewardPoolGram:0.030,basePoolGram:0.030,revenueContributionGram:0,leaderboardMembers:Number(total?.n||0),leaderboard});
  }catch(error){console.error("REWARDS LEADERBOARD ERROR",error);return json({ok:false,error:"Could not load the Reward Wall leaderboard"},500)}
}
