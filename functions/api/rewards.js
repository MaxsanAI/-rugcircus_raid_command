function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const BASE_POOL_LAMPORTS=30000000;
const REWARD_BPS=1000;

async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
}

export async function onRequestGet({env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  try{
    await ensureSchema(env.DB);
    const [row,leaders]=await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(amount_lamports),0) AS lamports FROM campaigns WHERE package!='FREE RAID' AND amount_lamports>0 AND created_at>=datetime('now','-7 days')").first(),
      env.DB.prepare("SELECT m.username,m.wallet_address AS wallet,COUNT(v.id) AS points FROM leaderboard_members m JOIN leaderboard_views v ON v.member_id=m.id AND v.viewed_at>=datetime('now','-7 days') GROUP BY m.id,m.username,m.wallet_address ORDER BY points DESC,m.created_at ASC LIMIT 20").all()
    ]);
    const paidRevenueLamports=Number(row?.lamports||0);
    const revenueContributionLamports=Math.floor(paidRevenueLamports*REWARD_BPS/10000);
    const rewardPoolLamports=BASE_POOL_LAMPORTS+revenueContributionLamports;
    return json({
      ok:true,
      basePoolSol:BASE_POOL_LAMPORTS/1e9,
      paidRevenueSol:paidRevenueLamports/1e9,
      revenueContributionSol:revenueContributionLamports/1e9,
      rewardPoolSol:rewardPoolLamports/1e9,
      rewardRatePercent:10,
      windowDays:7,
      leaderboard:(leaders?.results||[]).map(x=>({
        username:String(x.username||"Anonymous"),
        wallet:String(x.wallet||"").slice(0,4)+"…"+String(x.wallet||"").slice(-4),
        points:Number(x.points||0)
      }))
    });
  }catch(error){
    console.error("REWARD LEADERBOARD ERROR",error);
    return json({ok:false,error:"Reward pool query failed"},500);
  }
}
