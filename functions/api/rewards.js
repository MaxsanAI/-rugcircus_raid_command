function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const BASE_POOL_NANO=30000000;
const REWARD_BPS=1000;
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_views (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,campaign_id INTEGER NOT NULL,viewed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_leaderboard_views_member ON leaderboard_views(member_id,viewed_at)").run().catch(()=>{});
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_sponsor_opens (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
}
export async function onRequestGet({env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  try{
    await ensureSchema(env.DB);
    const [row,leaders,countRow]=await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(amount_lamports),0) AS nano FROM campaigns WHERE package!='FREE RAID' AND amount_lamports>0 AND created_at>=datetime('now','-7 days')").first(),
      env.DB.prepare("SELECT m.username,m.wallet_address AS wallet,m.points AS points FROM leaderboard_members m ORDER BY points DESC,m.created_at ASC LIMIT 20").all(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM leaderboard_members").first()
    ]);
    const paidRevenueNano=Number(row?.nano||0),revenueContributionNano=Math.floor(paidRevenueNano*REWARD_BPS/10000),rewardPoolNano=BASE_POOL_NANO+revenueContributionNano;
    return json({ok:true,basePoolGram:BASE_POOL_NANO/1e9,paidRevenueGram:paidRevenueNano/1e9,revenueContributionGram:revenueContributionNano/1e9,rewardPoolGram:rewardPoolNano/1e9,rewardRatePercent:10,windowDays:7,leaderboardMembers:Number(countRow?.count||0),leaderboard:(leaders?.results||[]).map(x=>({username:String(x.username||"Anonymous"),wallet:String(x.wallet||"").slice(0,4)+"…"+String(x.wallet||"").slice(-4),points:Number(x.points||0)}))});
  }catch(error){console.error("REWARD LEADERBOARD ERROR",error);return json({ok:false,error:"Reward pool query failed"},500)}
}
