function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const PLATFORMS={x:"x_url",tiktok:"tiktok_url",telegram:"telegram_url",callout:"pump_callout_url",pump:"pump_url",movers:null,dexscreener:null,birdeye:null,jupiter:null,raydium:null};
const FIXED_TARGETS={movers:"https://pump.fun/explore",dexscreener:"https://dexscreener.com/solana",birdeye:"https://birdeye.so/",jupiter:"https://jup.ag/",raydium:"https://raydium.io/"};
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  const url=new URL(request.url);
  const campaignId=Number(url.searchParams.get("campaign"));
  const platform=String(url.searchParams.get("platform")||"").toLowerCase();
  const column=PLATFORMS[platform];
  const fixedTarget=FIXED_TARGETS[platform]||"";
  const wallet=String(url.searchParams.get("wallet")||"").trim();
  if(!Number.isInteger(campaignId)||campaignId<1||(!column&&!fixedTarget))return json({ok:false,error:"Invalid campaign or platform"},400);
  try{
    await env.DB.prepare("ALTER TABLE campaigns ADD COLUMN pump_callout_url TEXT").run().catch(()=>{});
    const row=await env.DB.prepare("SELECT t.mint_address"+(column?", c."+column+" AS target":"")+" FROM campaigns c JOIN tokens t ON t.id=c.token_id WHERE c.id=? AND c.status='active' AND (c.ends_at IS NULL OR datetime(c.ends_at)>datetime('now'))").bind(campaignId).first();
    const target=fixedTarget||(platform==="pump"&&row?.mint_address?"https://pump.fun/coin/"+row.mint_address:row?.target);
    if(!target)return json({ok:false,error:"Campaign link is not active"},404);
    let userId=null;
    if(WALLET_RE.test(wallet)){
      await env.DB.prepare("INSERT INTO users (wallet_address) VALUES (?) ON CONFLICT(wallet_address) DO NOTHING").bind(wallet).run().catch(()=>{});
      const user=await env.DB.prepare("SELECT id FROM users WHERE wallet_address=?").bind(wallet).first().catch(()=>null);
      userId=user?.id||null;
    }
    // Analytics must never block the actual raid link. Older D1 databases may
    // have a legacy raid_actions schema, so create/migrate it before recording.
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS raid_actions (id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id INTEGER NOT NULL,user_id INTEGER,platform TEXT NOT NULL,action_type TEXT NOT NULL,external_url TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run().catch(()=>{});
    const info=await env.DB.prepare("PRAGMA table_info(raid_actions)").all().catch(()=>({results:[]}));
    const columns=new Set((info.results||[]).map(row=>String(row.name)));
    const required=[
      ["campaign_id","INTEGER"],
      ["user_id","INTEGER"],
      ["platform","TEXT"],
      ["action_type","TEXT"],
      ["external_url","TEXT"],
      ["created_at","TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"]
    ];
    for(const [name,type] of required){
      if(!columns.has(name))await env.DB.prepare("ALTER TABLE raid_actions ADD COLUMN "+name+" "+type).run().catch(()=>{});
    }
    // Never turn a valid X/Telegram/TikTok/Pump link into a JSON error just
    // because analytics logging failed.
    await env.DB.prepare("INSERT INTO raid_actions (campaign_id,user_id,platform,action_type,external_url) VALUES (?,?,?,?,?)")
       .bind(campaignId,userId,platform,"click",target).run().catch(error=>console.error("RAID ACTION LOG ERROR",error));
    return Response.redirect(target,302);
  }catch(error){
    console.error("RAID CLICK ERROR",error);
    // The destination is still the important part: redirect even if D1
    // analytics has a temporary/schema problem.
    try{
      const fallback=fixedTarget?{target:fixedTarget}:await env.DB.prepare("SELECT "+column+" AS target FROM campaigns WHERE id=?").bind(campaignId).first();
      if(fallback?.target)return Response.redirect(fallback.target,302);
    }catch{}
    return json({ok:false,error:"Campaign link is unavailable"},502);
  }
}
