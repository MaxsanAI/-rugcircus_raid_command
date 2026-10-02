function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const PLATFORMS={x:"x_url",tiktok:"tiktok_url",telegram:"telegram_url",callout:"pump_callout_url"};
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  const url=new URL(request.url);
  const campaignId=Number(url.searchParams.get("campaign"));
  const platform=String(url.searchParams.get("platform")||"").toLowerCase();
  const column=PLATFORMS[platform];
  const wallet=String(url.searchParams.get("wallet")||"").trim();
  if(!Number.isInteger(campaignId)||campaignId<1||!column)return json({ok:false,error:"Invalid campaign or platform"},400);
  try{
    await env.DB.prepare("ALTER TABLE campaigns ADD COLUMN pump_callout_url TEXT").run().catch(()=>{});
    const row=await env.DB.prepare("SELECT "+column+" AS target FROM campaigns WHERE id=? AND status='active' AND (ends_at IS NULL OR ends_at>CURRENT_TIMESTAMP)").bind(campaignId).first();
    if(!row?.target)return json({ok:false,error:"Campaign link is not active"},404);
    let userId=null;
    if(WALLET_RE.test(wallet)){
      await env.DB.prepare("INSERT INTO users (wallet_address) VALUES (?) ON CONFLICT(wallet_address) DO NOTHING").bind(wallet).run().catch(()=>{});
      const user=await env.DB.prepare("SELECT id FROM users WHERE wallet_address=?").bind(wallet).first().catch(()=>null);
      userId=user?.id||null;
    }
    await env.DB.prepare("INSERT INTO raid_actions (campaign_id,user_id,platform,action_type,external_url) VALUES (?,?,?,?,?)").bind(campaignId,userId,platform,"click",row.target).run();
    return Response.redirect(row.target,302);
  }catch(error){
    return json({ok:false,error:"Could not record raid action"},500);
  }
}
