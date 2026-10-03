const API="https://api.mainnet-beta.solana.com";
const PACKAGES={
  FEATURED:{lamports:20000000,hours:24},
  "MEGA RAID":{lamports:50000000,hours:48},
  "FRONT ROW":{lamports:100000000,hours:168}
};
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function rpc(method,params){
  const r=await fetch(API,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
  const d=await r.json().catch(()=>null);
  return d?.result||null;
}
async function verifyPayment(signature,recipient,lamports){
  const tx=await rpc("getTransaction",[signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]);
  if(!tx||tx.meta?.err) return {ok:false,error:"Transaction not found or failed"};
  const keys=tx.transaction?.message?.accountKeys||[];
  const index=keys.findIndex(k=>(k.pubkey||k)===recipient);
  if(index<0) return {ok:false,error:"Payment recipient was not in transaction"};
  const before=Number(tx.meta?.preBalances?.[index]??-1);
  const after=Number(tx.meta?.postBalances?.[index]??-1);
  const received=after-before;
  if(received<lamports) return {ok:false,error:"Required payment amount was not received",receivedLamports:received};
  return {ok:true,receivedLamports:received};
}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT,mint_address TEXT UNIQUE NOT NULL,ticker TEXT,name TEXT,logo_url TEXT,x_url TEXT,tiktok_url TEXT,telegram_url TEXT,pump_url TEXT,dex_url TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT,token_id INTEGER NOT NULL,package TEXT NOT NULL,amount_lamports INTEGER NOT NULL,duration_hours INTEGER NOT NULL,x_url TEXT,tiktok_url TEXT,telegram_url TEXT,raid_copy TEXT,status TEXT NOT NULL DEFAULT 'pending',payment_signature TEXT,payout_wallet TEXT,creator_wallet TEXT,free_user_id TEXT,pump_callout_url TEXT,telegram_group TEXT,starts_at TEXT,ends_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  const tokenColumns=await db.prepare("PRAGMA table_info(tokens)").all();
  const existingTokens=new Set((tokenColumns.results||[]).map(row=>String(row.name)));
  for(const [name,type] of [["address","TEXT"],["mint_address","TEXT"],["ticker","TEXT"],["name","TEXT"],["logo_url","TEXT"],["x_url","TEXT"],["tiktok_url","TEXT"],["telegram_url","TEXT"],["pump_url","TEXT"],["dex_url","TEXT"],["created_at","TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"]]){
    if(!existingTokens.has(name))await db.prepare("ALTER TABLE tokens ADD COLUMN "+name+" "+type).run();
  }
  await db.prepare("ALTER TABLE campaigns ADD COLUMN amount_lamports INTEGER").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN amount_sol REAL").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN duration_hours INTEGER").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN payout_wallet TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN creator_wallet TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN free_user_id TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN pump_callout_url TEXT").run().catch(()=>{});
  await db.prepare("ALTER TABLE campaigns ADD COLUMN telegram_group TEXT").run().catch(()=>{});
}

async function resolveRaidImage(imageUrl,xUrl){
  const direct=String(imageUrl||"").trim();
  if(/^https?:\/\//i.test(direct))return direct.slice(0,2000);
  const x=String(xUrl||"").trim();
  if(!/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(x))return null;
  try{
    const r=await fetch(x,{headers:{"user-agent":"Mozilla/5.0 RUGCIRCUS Raid Preview"}});
    const html=await r.text();
    const match=html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)||html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
    return match?.[1]?match[1].replace(/&amp;/g,"&").slice(0,2000):null;
  }catch{return null}
}

async function upsertToken(db,{mint,ticker,name,xUrl,tiktokUrl,telegramUrl,logoUrl}){
  const info=await db.prepare("PRAGMA table_info(tokens)").all();
  const columns=new Set((info.results||[]).map(row=>String(row.name)));
  const fields={
    address:mint,
    mint_address:mint,
    ticker:ticker||null,
    name:name||null,
    x_url:xUrl||null,
    tiktok_url:tiktokUrl||null,
    telegram_url:telegramUrl||null,
    logo_url:logoUrl||null,
    pump_url:"https://pump.fun/coin/"+mint,
    dex_url:"https://dexscreener.com/solana/"+mint
  };
  const writable=Object.keys(fields).filter(key=>columns.has(key));
  if(!writable.includes("mint_address")&&!writable.includes("address"))throw new Error("tokens table has no token address column");
  const setFields=writable.filter(key=>key!=="id");
  const setSql=setFields.map(key=>key+"=?").join(",");
  const setValues=setFields.map(key=>fields[key]);
  const lookupColumn=columns.has("mint_address")?"mint_address":"address";
  const updated=await db.prepare("UPDATE tokens SET "+setSql+" WHERE "+lookupColumn+"=?").bind(...setValues,mint).run();
  if(Number(updated.meta?.changes||0)===0){
    const placeholders=writable.map(()=>"?").join(",");
    await db.prepare("INSERT INTO tokens ("+writable.join(",")+") VALUES ("+placeholders+")").bind(...writable.map(key=>fields[key])).run();
  }
  const alternate=lookupColumn==="mint_address"&&columns.has("address")?"address":"mint_address";
  const token=columns.has(alternate)
    ? await db.prepare("SELECT id FROM tokens WHERE "+lookupColumn+"=? OR "+alternate+"=? LIMIT 1").bind(mint,mint).first()
    : await db.prepare("SELECT id FROM tokens WHERE "+lookupColumn+"=? LIMIT 1").bind(mint).first();
  if(!token?.id)throw new Error("Token record could not be created");
  return token;
}

function normalizeTelegramGroup(value){const raw=String(value||"").trim();if(!raw)return "";if(/^-100\d+$/.test(raw)||/^-\d+$/.test(raw))return raw;const match=raw.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})/i);if(match)return "@"+match[1];return raw.startsWith("@")?raw:"@"+raw;}
async function tgCall(method,token,body){const response=await fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});const data=await response.json().catch(()=>null);return {ok:response.ok&&data?.ok===true,data};}
async function verifyBotAdmin(env,targetGroup){
  if(!env.TELEGRAM_BOT_TOKEN)return {ok:false,error:"TELEGRAM_BOT_TOKEN is not configured"};
  const chatId=normalizeTelegramGroup(targetGroup)||"@rugcxx";
  const me=await tgCall("getMe",env.TELEGRAM_BOT_TOKEN,{});
  if(!me.ok||!me.data?.result?.id)return {ok:false,error:"Telegram bot identity could not be verified"};
  const member=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:me.data.result.id});
  if(!member.ok)return {ok:false,error:member.data?.description||"Telegram bot is not a member of the raid group",chatId};
  const status=member.data?.result?.status;
  if(status!=="administrator"&&status!=="creator")return {ok:false,error:"RUGCIRCUS bot must be an administrator in the raid group before launching a raid",chatId,status:status||"unknown"};
  return {ok:true,chatId,status};
}
async function publishRaidCard(env, campaignId, targetGroup, mintAddress, ticker, name, packageName, endsAt, xUrl, tiktokUrl, telegramUrl, pumpCalloutUrl, raidCopy){
  if(!env.TELEGRAM_BOT_TOKEN) return {ok:false,error:"TELEGRAM_BOT_TOKEN is not configured"};
  const chatId=normalizeTelegramGroup(targetGroup)||env.TELEGRAM_RAID_CHAT_ID||"@rugcxx";
  const lines=["🎪 RUGCIRCUS RAID IS LIVE","", "🪙 $"+(ticker||"RUGCX")+(name?" · "+name:""), "📦 "+packageName, "⏳ Ends: "+endsAt];
  if(raidCopy) lines.push("", "📣 "+raidCopy);
  lines.push("", "⚔️ Join the raid and hit the links below.");
  const buttons=[];
  const row=[];
  if(xUrl) row.push({text:"🐦 X RAID",url:xUrl});
  if(tiktokUrl) row.push({text:"🎵 TIKTOK",url:tiktokUrl});
  if(row.length) buttons.push(row);
  const row2=[];
  if(telegramUrl) row2.push({text:"💬 TELEGRAM",url:telegramUrl});
  row2.push({text:"🪙 PUMP.FUN",url:"https://pump.fun/coin/"+(mintAddress||env.RUGCX_MINT||"3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump")});
  buttons.push(row2);
  if(pumpCalloutUrl) buttons.push([{text:"📣 PUMP CALL OUT",url:pumpCalloutUrl}]);
  buttons.push([{text:"🎪 OPEN RUGCIRCUS COMMAND",web_app:{url:env.PUBLIC_APP_URL||"https://raidrugcircus.pulserapp.com"}}]);
  const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,text:lines.join("\n"),reply_markup:{inline_keyboard:buttons},disable_web_page_preview:true})});
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok) return {ok:false,error:data?.description||"Telegram could not publish the raid card",chatId};
  return {ok:true,chatId,messageId:data.result?.message_id||null};
}
export async function onRequestPost({request,env}){
  if(!env.DB||!env.PUBLIC_TREASURY_WALLET) return json({ok:false,error:"Campaign payments are not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const pack=PACKAGES[String(body.package||"").toUpperCase()];
  const signature=String(body.signature||"").trim();
  const mint=String(body.mintAddress||"").trim();
  const ticker=String(body.ticker||"").trim().replace(/[^A-Za-z0-9_]/g,"").slice(0,15);
  const name=String(body.name||ticker||"Token").trim().slice(0,80);
  const payoutWallet=String(body.payoutWallet||env.PUBLIC_TREASURY_WALLET).trim();
  const telegramGroup=normalizeTelegramGroup(body.telegramGroup)||normalizeTelegramGroup(env.TELEGRAM_RAID_CHAT_ID)||"@rugcxx";
  if(!pack||!signature||!mint||!payoutWallet||!telegramGroup) return json({ok:false,error:"package, signature, mintAddress, payoutWallet and Telegram group are required"},400);
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(payoutWallet)) return json({ok:false,error:"Invalid Solana address"},400);
  const botCheck=await verifyBotAdmin(env,telegramGroup);
  if(!botCheck.ok)return json({ok:false,error:botCheck.error,telegram:botCheck},403);
  await ensureSchema(env.DB);
  const premium=await env.DB.prepare("SELECT wallet_address,expires_at FROM premium_operators WHERE wallet_address=? AND status='active' AND expires_at>CURRENT_TIMESTAMP").bind(payoutWallet).first().catch(()=>null);
  if(payoutWallet!==env.PUBLIC_TREASURY_WALLET&&!premium) return json({ok:false,error:"This payout wallet requires an active Premium Operator plan"},403);
  const payment=await verifyPayment(signature,payoutWallet,pack.lamports);
  if(!payment.ok) return json(payment,400);
  const existing=await env.DB.prepare("SELECT id FROM payments WHERE signature=?").bind(signature).first();
  if(existing) return json({ok:false,error:"This transaction has already been used"},409);
  const logoUrl=await resolveRaidImage(body.imageUrl,body.xUrl);
  const token=await upsertToken(env.DB,{mint,ticker,name,xUrl:String(body.xUrl||"").trim(),tiktokUrl:String(body.tiktokUrl||"").trim(),telegramUrl:String(body.telegramUrl||"").trim(),logoUrl});
  const now=new Date();
  const ends=new Date(now.getTime()+pack.hours*3600000);
  const campaign=await env.DB.prepare("INSERT INTO campaigns (token_id,package,amount_lamports,amount_sol,duration_hours,x_url,tiktok_url,telegram_url,raid_copy,pump_callout_url,status,payment_signature,payout_wallet,telegram_group,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(token.id,String(body.package).toUpperCase(),pack.lamports,pack.lamports/1000000000,pack.hours,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,String(body.raidCopy||"").trim()||null,String(body.pumpCalloutUrl||"").trim()||null,"active",signature,payoutWallet,telegramGroup,now.toISOString(),ends.toISOString()).run();
  await env.DB.prepare("INSERT INTO payments (campaign_id,signature,wallet_address,lamports,status,verified_at) VALUES (?,?,?,?,?,?)").bind(campaign.meta.last_row_id,signature,String(body.payerWallet||"").trim()||null,pack.lamports,"verified",now.toISOString()).run();
  const telegram=await publishRaidCard(env,campaign.meta.last_row_id,telegramGroup,mint,ticker,name,String(body.package).toUpperCase(),ends.toISOString(),String(body.xUrl||"").trim(),String(body.tiktokUrl||"").trim(),String(body.telegramUrl||"").trim(),String(body.pumpCalloutUrl||"").trim(),String(body.raidCopy||"").trim());
  if(!telegram.ok){
    await env.DB.prepare("UPDATE campaigns SET status='failed' WHERE id=?").bind(campaign.meta.last_row_id).run().catch(()=>{});
    return json({ok:false,error:telegram.error||"Telegram could not publish the raid card",campaignId:campaign.meta.last_row_id,receivedLamports:payment.receivedLamports,telegram},502);
  }
  return json({ok:true,campaignId:campaign.meta.last_row_id,endsAt:ends.toISOString(),receivedLamports:payment.receivedLamports,telegram});
}
