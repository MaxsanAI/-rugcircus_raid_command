function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const BASE_POOL_LAMPORTS=30000000;
const REWARD_BPS=1000;

export async function onRequestGet({env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  try{
    const [row,leaders]=await Promise.all([
      env.DB.prepare("SELECT COALESCE(SUM(amount_lamports),0) AS lamports FROM campaigns WHERE package!='FREE RAID' AND amount_lamports>0 AND created_at>=datetime('now','-7 days')").first(),
      env.DB.prepare("SELECT u.wallet_address AS wallet, COUNT(*) AS points FROM raid_actions ra JOIN users u ON u.id=ra.user_id WHERE ra.user_id IS NOT NULL AND ra.created_at>=datetime('now','-7 days') GROUP BY u.wallet_address ORDER BY points DESC LIMIT 20").all()
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
      leaderboard:(leaders?.results||[]).map(x=>({wallet:String(x.wallet||"").slice(0,4)+"…"+String(x.wallet||"").slice(-4),points:Number(x.points||0)}))
    });
  }catch(error){
    return json({ok:false,error:"Reward pool query failed"},500);
  }
}
