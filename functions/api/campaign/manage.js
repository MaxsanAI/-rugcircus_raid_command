import {Address} from "@ton/core";
import {resolveRaidImage} from "../raid/image.js";
import {publishRaidCard} from "../raid/publish.js";
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const WALLET_RE=/^[A-Za-z0-9_-]{48}$/;
const FREE_RE=/^[A-Za-z0-9_-]{8,128}$/;
const clean=(v,max=2000)=>String(v??"").trim().slice(0,max);
const nullable=(v,max=2000)=>{const s=clean(v,max);return s||null};

async function ensureSchema(db){
  await db.prepare("ALTER TABLE campaigns ADD COLUMN creator_wallet TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN amount_sol REAL").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN amount_lamports INTEGER").run().catch(()=>{});
  await db.prepare("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id INTEGER NOT NULL,signature TEXT UNIQUE NOT NULL,wallet_address TEXT,lamports INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',verified_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN free_user_id TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN pump_callout_url TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN telegram_group TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN raid_copy TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN status TEXT DEFAULT 'active'").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN telegram_message_id INTEGER").run().catch(()=>{});
  await db.prepare("ALTER TABLE tokens ADD COLUMN logo_url TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE tokens ADD COLUMN x_url TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE tokens ADD COLUMN tiktok_url TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE tokens ADD COLUMN telegram_url TEXT").run().catch(()=>{});
}

function ownerFromRequest(request){
  const walletRaw=clean(request.headers.get("x-ton-wallet-address"),100);let wallet="";try{wallet=Address.parse(walletRaw).toRawString()}catch{}
  const freeUserId=clean(request.headers.get("x-free-user-id"),128);
  return {
    wallet:WALLET_RE.test(walletRaw)||wallet?wallet:"",
    freeUserId:FREE_RE.test(freeUserId)?freeUserId:""
  };
}

async function getOwnedCampaign(db,id,owner){
  const row=await db.prepare(
    "SELECT c.id,c.token_id,c.package,c.amount_sol,c.duration_hours,c.status,c.starts_at,c.ends_at,c.x_url,c.tiktok_url,c.telegram_url,c.raid_copy,c.pump_callout_url,c.telegram_group,c.payment_signature,COALESCE(c.creator_wallet,p.wallet_address) AS creator_wallet,c.free_user_id,t.mint_address,t.ticker,t.name,t.logo_url,t.pump_url,t.dex_url FROM campaigns c JOIN tokens t ON t.id=c.token_id LEFT JOIN payments p ON p.campaign_id=c.id WHERE c.id=? AND ((COALESCE(c.creator_wallet,p.wallet_address) IS NOT NULL AND COALESCE(c.creator_wallet,p.wallet_address)=?) OR (c.free_user_id IS NOT NULL AND c.free_user_id=?))"
  ).bind(id,owner.wallet||"__none__",owner.freeUserId||"__none__").first();
  return row||null;
}

export async function onRequestGet({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  await ensureSchema(env.DB);
  const owner=ownerFromRequest(request);
  if(!owner.wallet&&!owner.freeUserId)return json({ok:false,error:"Connect the TON Wallet used to create paid campaigns or use the same browser for free campaigns."},401);
  let rows=[];
  if(owner.wallet&&owner.freeUserId){
    const r=await env.DB.prepare(
      "SELECT c.id,c.package,c.amount_sol,c.duration_hours,c.status,c.starts_at,c.ends_at,c.x_url,c.tiktok_url,c.telegram_url,c.raid_copy,c.pump_callout_url,c.telegram_group,c.payment_signature,COALESCE(c.creator_wallet,p.wallet_address) AS creator_wallet,c.free_user_id,t.id AS token_id,t.mint_address,t.ticker,t.name,t.logo_url,t.pump_url,t.dex_url FROM campaigns c JOIN tokens t ON t.id=c.token_id LEFT JOIN payments p ON p.campaign_id=c.id WHERE COALESCE(c.creator_wallet,p.wallet_address)=? OR c.free_user_id=? ORDER BY c.created_at DESC LIMIT 100"
    ).bind(owner.wallet,owner.freeUserId).all();
    rows=r.results||[];
  }else if(owner.wallet){
    const r=await env.DB.prepare(
      "SELECT c.id,c.package,c.amount_sol,c.duration_hours,c.status,c.starts_at,c.ends_at,c.x_url,c.tiktok_url,c.telegram_url,c.raid_copy,c.pump_callout_url,c.telegram_group,c.payment_signature,COALESCE(c.creator_wallet,p.wallet_address) AS creator_wallet,c.free_user_id,t.id AS token_id,t.mint_address,t.ticker,t.name,t.logo_url,t.pump_url,t.dex_url FROM campaigns c JOIN tokens t ON t.id=c.token_id LEFT JOIN payments p ON p.campaign_id=c.id WHERE COALESCE(c.creator_wallet,p.wallet_address)=? ORDER BY c.created_at DESC LIMIT 100"
    ).bind(owner.wallet).all();
    rows=r.results||[];
  }else{
    const r=await env.DB.prepare(
      "SELECT c.id,c.package,c.amount_sol,c.duration_hours,c.status,c.starts_at,c.ends_at,c.x_url,c.tiktok_url,c.telegram_url,c.raid_copy,c.pump_callout_url,c.telegram_group,c.payment_signature,c.creator_wallet,c.free_user_id,t.id AS token_id,t.mint_address,t.ticker,t.name,t.logo_url,t.pump_url,t.dex_url FROM campaigns c JOIN tokens t ON t.id=c.token_id WHERE c.free_user_id=? ORDER BY c.created_at DESC LIMIT 100"
    ).bind(owner.freeUserId).all();
    rows=r.results||[];
  }
  return json({ok:true,campaigns:rows});
}

export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  await ensureSchema(env.DB);
  const owner=ownerFromRequest(request);
  if(!owner.wallet&&!owner.freeUserId)return json({ok:false,error:"Campaign ownership could not be verified."},401);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const id=Number(body.id);
  if(!Number.isInteger(id)||id<=0)return json({ok:false,error:"Invalid campaign id"},400);
  const current=await getOwnedCampaign(env.DB,id,owner);
  if(!current)return json({ok:false,error:"Campaign not found or you are not its owner."},404);
  if(String(current.status||"")==="deleted")return json({ok:false,error:"This campaign has already been deleted."},409);

  const action=String(body.action||"").trim().toLowerCase();
  if(action==="publishagain"){
    if(String(current.status||"")!=="active")return json({ok:false,error:"Only an active campaign can be published to Telegram."},409);
    const imageUrl=await resolveRaidImage(current.logo_url,current.x_url,current.tiktok_url);
    const telegram=await publishRaidCard(
      env,
      current.id,
      current.telegram_group,
      current.ticker,
      current.name,
      current.package,
      current.ends_at,
      current.x_url,
      current.tiktok_url,
      current.telegram_url,
      current.pump_callout_url,
      current.raid_copy,
      imageUrl,
      current.mint_address
    );
    if(!telegram.ok)return json({ok:false,error:telegram.error||"Telegram could not publish the raid card",telegram},502);
    await env.DB.prepare("ALTER TABLE campaigns ADD COLUMN telegram_message_id INTEGER").run().catch(()=>{});
    if(telegram.messageId)await env.DB.prepare("UPDATE campaigns SET telegram_message_id=? WHERE id=?").bind(telegram.messageId,current.id).run().catch(()=>{});
    return json({ok:true,publishedAgain:true,campaignId:current.id,telegram});
  }

  const ticker=clean(body.ticker,15).replace(/[^A-Za-z0-9_]/g,"");
  const name=clean(body.name,80);
  const xUrl=nullable(body.xUrl,2000);
  const tiktokUrl=nullable(body.tiktokUrl,2000);
  const telegramUrl=nullable(body.telegramUrl,2000);
  const imageUrl=nullable(body.imageUrl,2000);
  const calloutUrl=nullable(body.pumpCalloutUrl,2000);
  const raidCopy=nullable(body.raidCopy,1000);
  const status=String(body.status||current.status||"active").trim().toLowerCase();
  if(!ticker||!name)return json({ok:false,error:"Ticker and token name are required."},400);
  if(!["active","paused","ended"].includes(status))return json({ok:false,error:"Invalid campaign status."},400);

  const resolvedImage=await resolveRaidImage(imageUrl,xUrl,tiktokUrl);
  await env.DB.prepare("UPDATE tokens SET ticker=?,name=?,x_url=?,tiktok_url=?,telegram_url=?,logo_url=? WHERE id=?")
    .bind(ticker,name,xUrl,tiktokUrl,telegramUrl,resolvedImage||imageUrl,current.token_id).run();

  await env.DB.prepare("UPDATE campaigns SET x_url=?,tiktok_url=?,telegram_url=?,raid_copy=?,pump_callout_url=?,status=? WHERE id=?")
    .bind(xUrl,tiktokUrl,telegramUrl,raidCopy,calloutUrl,status,id).run();

  return json({ok:true,campaignId:id});
}

export async function onRequestDelete({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  await ensureSchema(env.DB);
  const owner=ownerFromRequest(request);
  if(!owner.wallet&&!owner.freeUserId)return json({ok:false,error:"Campaign ownership could not be verified."},401);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const id=Number(body.id);
  if(!Number.isInteger(id)||id<=0)return json({ok:false,error:"Invalid campaign id"},400);
  const current=await getOwnedCampaign(env.DB,id,owner);
  if(!current)return json({ok:false,error:"Campaign not found or you are not its owner."},404);
  await env.DB.prepare("UPDATE campaigns SET status='deleted',ends_at=COALESCE(ends_at,CURRENT_TIMESTAMP) WHERE id=?").bind(id).run();
  return json({ok:true,deleted:true,campaignId:id});
}
