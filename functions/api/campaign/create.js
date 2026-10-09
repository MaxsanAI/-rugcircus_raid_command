import {Address} from "@ton/core";
import {telegramUserFromRequest} from "../_telegram.js";
import {resolveRaidImage} from "../raid/image.js";
import {publishRaidCard} from "../raid/publish.js";

const PACKAGES={
  FEATURED:{nano:750000000,hours:24},
  "MEGA RAID":{nano:2000000000,hours:48},
  "FRONT ROW":{nano:4000000000,hours:168}
};

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
function normalizeTon(value){try{return Address.parse(String(value||"").trim()).toRawString()}catch{return ""}}
function apiHeaders(env){return env.TONCENTER_API_KEY?{"accept":"application/json","content-type":"application/json","X-API-Key":env.TONCENTER_API_KEY}:{"accept":"application/json","content-type":"application/json"}}

async function verifyTonPayment({boc,recipient,payer,nano,env}){
  if(!boc||!recipient||!payer)return {ok:false,error:"TON payment data is incomplete"};
  const recipientRaw=normalizeTon(recipient),payerRaw=normalizeTon(payer);
  if(!recipientRaw||!payerRaw)return {ok:false,error:"Invalid TON wallet address"};
  try{
    const messageResponse=await fetch("https://toncenter.com/api/v3/message",{method:"POST",headers:apiHeaders(env),body:JSON.stringify({boc})});
    const messageData=await messageResponse.json().catch(()=>null);
    const messageHash=messageData?.message_hash_norm||messageData?.message_hash;
    if(!messageResponse.ok||!messageHash)return {ok:false,error:"TON payment could not be decoded"};
    const url="https://toncenter.com/api/v3/transactionsByMessage?direction=in&limit=20&msg_hash="+encodeURIComponent(messageHash);
    const txResponse=await fetch(url,{headers:apiHeaders(env)});
    const txData=await txResponse.json().catch(()=>null);
    if(!txResponse.ok)return {ok:false,error:"TON transaction lookup failed"};
    const txs=Array.isArray(txData?.transactions)?txData.transactions:[];
    const required=BigInt(String(nano));
    for(const tx of txs){
      if(normalizeTon(tx.account)!==payerRaw)continue;
      if(tx.description?.aborted===true||tx.description?.action?.success===false)continue;
      const out=Array.isArray(tx.out_msgs)?tx.out_msgs.find(m=>normalizeTon(m.destination)===recipientRaw&&BigInt(String(m.value||0))>=required):null;
      if(out){
        return {ok:true,messageHash,txHash:String(tx.hash||""),receivedNano:String(out.value||0),payer:payerRaw,recipient:recipientRaw};
      }
    }
    return {ok:false,error:"The verified TON transaction does not contain the required payment"};
  }catch(error){
    console.error("TON PAYMENT VERIFY ERROR",error);
    return {ok:false,error:"TON payment verification failed"};
  }
}

async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT,mint_address TEXT UNIQUE NOT NULL,ticker TEXT,name TEXT,logo_url TEXT,x_url TEXT,tiktok_url TEXT,telegram_url TEXT,pump_url TEXT,dex_url TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT,token_id INTEGER NOT NULL,package TEXT NOT NULL,amount_lamports INTEGER NOT NULL,duration_hours INTEGER NOT NULL,x_url TEXT,tiktok_url TEXT,telegram_url TEXT,raid_copy TEXT,status TEXT NOT NULL DEFAULT 'pending',payment_signature TEXT,payout_wallet TEXT,creator_wallet TEXT,free_user_id TEXT,pump_callout_url TEXT,telegram_group TEXT,starts_at TEXT,ends_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const tokenColumns=await db.prepare("PRAGMA table_info(tokens)").all();const existingTokens=new Set((tokenColumns.results||[]).map(row=>String(row.name)));
  for(const [name,type] of [["address","TEXT"],["mint_address","TEXT"],["ticker","TEXT"],["name","TEXT"],["logo_url","TEXT"],["x_url","TEXT"],["tiktok_url","TEXT"],["telegram_url","TEXT"],["pump_url","TEXT"],["dex_url","TEXT"],["created_at","TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"]])if(!existingTokens.has(name))await db.prepare("ALTER TABLE tokens ADD COLUMN "+name+" "+type).run();
  for(const [name,type] of [["amount_lamports","INTEGER"],["amount_sol","REAL"],["amount_gram","REAL"],["duration_hours","INTEGER"],["payout_wallet","TEXT"],["creator_wallet","TEXT"],["free_user_id","TEXT"],["pump_callout_url","TEXT"],["telegram_group","TEXT"],["telegram_id","TEXT"]])await db.prepare("ALTER TABLE campaigns ADD COLUMN "+name+" "+type).run().catch(()=>{});
  await db.prepare("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id INTEGER NOT NULL,signature TEXT UNIQUE NOT NULL,wallet_address TEXT,lamports INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',verified_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS premium_operators (id INTEGER PRIMARY KEY AUTOINCREMENT,wallet_address TEXT UNIQUE NOT NULL,telegram_id TEXT,x_handle TEXT,status TEXT NOT NULL DEFAULT 'active',paid_signature TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
}

async function upsertToken(db,{mint,ticker,name,xUrl,tiktokUrl,telegramUrl,logoUrl}){
  const info=await db.prepare("PRAGMA table_info(tokens)").all();const columns=new Set((info.results||[]).map(row=>String(row.name)));
  const fields={address:mint,mint_address:mint,ticker:ticker||null,name:name||null,x_url:xUrl||null,tiktok_url:tiktokUrl||null,telegram_url:telegramUrl||null,logo_url:logoUrl||null,pump_url:"https://pump.fun/coin/"+mint,dex_url:"https://dexscreener.com/solana/"+mint};
  const writable=Object.keys(fields).filter(key=>columns.has(key));if(!writable.includes("mint_address")&&!writable.includes("address"))throw new Error("tokens table has no token address column");
  const setFields=writable.filter(key=>key!=="id"),setSql=setFields.map(key=>key+"=?").join(","),setValues=setFields.map(key=>fields[key]),lookupColumn=columns.has("mint_address")?"mint_address":"address";
  const updated=await db.prepare("UPDATE tokens SET "+setSql+" WHERE "+lookupColumn+"=?").bind(...setValues,mint).run();
  if(Number(updated.meta?.changes||0)===0){const placeholders=writable.map(()=>"?").join(",");await db.prepare("INSERT INTO tokens ("+writable.join(",")+") VALUES ("+placeholders+")").bind(...writable.map(key=>fields[key])).run()}
  const alternate=lookupColumn==="mint_address"&&columns.has("address")?"address":"mint_address";
  const token=columns.has(alternate)?await db.prepare("SELECT id FROM tokens WHERE "+lookupColumn+"=? OR "+alternate+"=? LIMIT 1").bind(mint,mint).first():await db.prepare("SELECT id FROM tokens WHERE "+lookupColumn+"=? LIMIT 1").bind(mint).first();
  if(!token?.id)throw new Error("Token record could not be created");return token;
}

function normalizeTelegramGroup(value){const raw=String(value||"").trim();if(!raw)return "";if(/^-100\d+$/.test(raw)||/^-\d+$/.test(raw))return raw;const match=raw.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})/i);if(match)return "@"+match[1];return raw.startsWith("@")?raw:"@"+raw;}
async function tgCall(method,token,body){const response=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const data=await response.json().catch(()=>null);return {ok:response.ok&&data?.ok===true,data};}
async function verifyBotAdmin(env,targetGroup){if(!env.TELEGRAM_BOT_TOKEN)return {ok:false,error:"TELEGRAM_BOT_TOKEN is not configured"};const chatId=normalizeTelegramGroup(targetGroup)||"@rugcxx";const me=await tgCall("getMe",env.TELEGRAM_BOT_TOKEN,{});if(!me.ok||!me.data?.result?.id)return {ok:false,error:"Telegram bot identity could not be verified"};const member=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:me.data.result.id});if(!member.ok)return {ok:false,error:member.data?.description||"Telegram bot is not a member of the raid group",chatId};const status=member.data?.result?.status;if(status!=="administrator"&&status!=="creator")return {ok:false,error:"RUGCIRCUS bot must be an administrator in the raid group before launching a raid",chatId,status:status||"unknown"};return {ok:true,chatId,status};}

export async function onRequestPost({request,env}){
  if(!env.DB||!(env.TON_TREASURY_ADDRESS||env.PUBLIC_TON_TREASURY_ADDRESS))return json({ok:false,error:"TON campaign payments are not configured"},503);
  const telegramUser=await telegramUserFromRequest(request,env);if(!telegramUser)return json({ok:false,error:"Open the Command Center from Telegram before launching a paid raid."},401);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const pack=PACKAGES[String(body.package||"").toUpperCase()],mint=String(body.mintAddress||"").trim(),boc=String(body.boc||"").trim(),payerWallet=String(body.payerWallet||"").trim(),telegramGroup=normalizeTelegramGroup(body.telegramGroup)||normalizeTelegramGroup(env.TELEGRAM_RAID_CHAT_ID)||"@rugcxx";
  const treasury=String(env.TON_TREASURY_ADDRESS||env.PUBLIC_TON_TREASURY_ADDRESS).trim();
  const ticker=String(body.ticker||"").trim().replace(/[^A-Za-z0-9_]/g,"").slice(0,15),name=String(body.name||ticker||"Token").trim().slice(0,80);
  if(!pack||!boc||!mint||!payerWallet||!normalizeTon(treasury))return json({ok:false,error:"package, payment, mintAddress and TON wallet are required"},400);
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint))return json({ok:false,error:"The campaign contract address must be a valid token mint address"},400);
  const botCheck=await verifyBotAdmin(env,telegramGroup);if(!botCheck.ok)return json({ok:false,error:botCheck.error,telegram:botCheck},403);
  await ensureSchema(env.DB);
  const payment=await verifyTonPayment({boc,recipient:treasury,payer:payerWallet,nano:pack.nano,env});if(!payment.ok)return json(payment,400);
  const signature=payment.messageHash;
  const existing=await env.DB.prepare("SELECT id FROM payments WHERE signature=?").bind(signature).first();if(existing)return json({ok:false,error:"This TON transaction has already been used"},409);
  const premium=await env.DB.prepare("SELECT wallet_address,expires_at FROM premium_operators WHERE telegram_id=? AND status='active' AND expires_at>CURRENT_TIMESTAMP").bind(String(telegramUser.id)).first().catch(()=>null);
  const logoUrl=await resolveRaidImage(body.imageUrl,body.xUrl,body.tiktokUrl);
  const token=await upsertToken(env.DB,{mint,ticker,name,xUrl:String(body.xUrl||"").trim(),tiktokUrl:String(body.tiktokUrl||"").trim(),telegramUrl:String(body.telegramUrl||"").trim(),logoUrl});
  const now=new Date(),ends=new Date(now.getTime()+pack.hours*3600000),payoutWallet=normalizeTon(premium?.wallet_address||treasury)||treasury;
  const campaign=await env.DB.prepare("INSERT INTO campaigns (token_id,package,amount_lamports,amount_sol,amount_gram,duration_hours,x_url,tiktok_url,telegram_url,raid_copy,pump_callout_url,status,payment_signature,payout_wallet,creator_wallet,free_user_id,telegram_group,telegram_id,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(token.id,String(body.package).toUpperCase(),pack.nano,pack.nano/1e9,pack.nano/1e9,pack.hours,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,String(body.raidCopy||"").trim()||null,String(body.pumpCalloutUrl||"").trim()||null,"active",signature,payoutWallet,payerWallet,String(body.clientId||"").trim()||null,telegramGroup,String(telegramUser.id),now.toISOString(),ends.toISOString()).run();
  await env.DB.prepare("INSERT INTO payments (campaign_id,signature,wallet_address,lamports,status,verified_at) VALUES (?,?,?,?,?,?)").bind(campaign.meta.last_row_id,signature,payerWallet,pack.nano,"verified",now.toISOString()).run();
  const telegram=await publishRaidCard(env,campaign.meta.last_row_id,telegramGroup,mint,ticker,name,String(body.package).toUpperCase(),ends.toISOString(),String(body.xUrl||"").trim(),String(body.tiktokUrl||"").trim(),String(body.telegramUrl||"").trim(),String(body.pumpCalloutUrl||"").trim(),String(body.raidCopy||"").trim(),logoUrl,mint);
  if(!telegram.ok){await env.DB.prepare("UPDATE campaigns SET status='failed' WHERE id=?").bind(campaign.meta.last_row_id).run().catch(()=>{});return json({ok:false,error:telegram.error||"Telegram could not publish the raid card",campaignId:campaign.meta.last_row_id,telegram},502)}
  return json({ok:true,campaignId:campaign.meta.last_row_id,endsAt:ends.toISOString(),receivedGram:payment.receivedNano/1e9,telegram});
}
