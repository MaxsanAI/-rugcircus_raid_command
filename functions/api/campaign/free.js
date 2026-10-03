function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}

function normalizeTelegramGroup(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  if(/^-100\d+$/.test(raw)||/^-\d+$/.test(raw))return raw;
  const match=raw.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})/i);
  if(match)return "@"+match[1];
  return raw.startsWith("@")?raw:"@"+raw;
}

async function tgCall(method,token,body){
  const response=await fetch("https://api.telegram.org/bot"+token+"/"+method,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>null);
  return {ok:response.ok&&data?.ok===true,data};
}

async function verifyBotAdmin(env,targetGroup){
  if(!env.TELEGRAM_BOT_TOKEN)return {ok:false,error:"TELEGRAM_BOT_TOKEN is not configured"};
  const chatId=normalizeTelegramGroup(targetGroup)||"@rugcxx";
  const me=await tgCall("getMe",env.TELEGRAM_BOT_TOKEN,{});
  if(!me.ok||!me.data?.result?.id)return {ok:false,error:"Telegram bot identity could not be verified"};
  const member=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:me.data.result.id});
  if(!member.ok)return {ok:false,error:member.data?.description||"Telegram bot is not a member of the raid group",chatId};
  const status=member.data?.result?.status;
  if(status!=="administrator"&&status!=="creator"){
    return {ok:false,error:"RUGCIRCUS bot must be an administrator in the raid group before launching a raid",chatId,status:status||"unknown"};
  }
  return {ok:true,chatId,status};
}

async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,wallet_address TEXT UNIQUE,telegram_id TEXT UNIQUE,x_handle TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT,mint_address TEXT UNIQUE NOT NULL,ticker TEXT,name TEXT,logo_url TEXT,x_url TEXT,tiktok_url TEXT,telegram_url TEXT,pump_url TEXT,dex_url TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT,token_id INTEGER NOT NULL,package TEXT NOT NULL,amount_lamports INTEGER NOT NULL,duration_hours INTEGER NOT NULL,x_url TEXT,tiktok_url TEXT,telegram_url TEXT,raid_copy TEXT,status TEXT NOT NULL DEFAULT 'pending',payment_signature TEXT,starts_at TEXT,ends_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(token_id) REFERENCES tokens(id))").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS raid_actions (id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id INTEGER NOT NULL,user_id INTEGER,platform TEXT NOT NULL,action_type TEXT NOT NULL,external_url TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS payments (id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id INTEGER NOT NULL,signature TEXT UNIQUE NOT NULL,wallet_address TEXT,lamports INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',verified_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS featured_tokens (token_id INTEGER PRIMARY KEY,priority INTEGER NOT NULL DEFAULT 0,starts_at TEXT,ends_at TEXT)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS premium_operators (id INTEGER PRIMARY KEY AUTOINCREMENT,wallet_address TEXT UNIQUE NOT NULL,telegram_id TEXT,x_handle TEXT,status TEXT NOT NULL DEFAULT 'active',paid_signature TEXT UNIQUE NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();

  for(const column of [
    ["creator_wallet","TEXT"],
    ["free_user_id","TEXT"],
    ["payout_wallet","TEXT"],
    ["pump_callout_url","TEXT"],
    ["telegram_group","TEXT"]
  ]){
    await db.prepare("ALTER TABLE campaigns ADD COLUMN "+column[0]+" "+column[1]).run().catch(()=>{});
  }
}

async function publishRaidCard(env,campaignId,targetGroup,mintAddress,ticker,name,packageName,endsAt,xUrl,tiktokUrl,telegramUrl,pumpCalloutUrl,raidCopy){
  if(!env.TELEGRAM_BOT_TOKEN)return {ok:false,error:"TELEGRAM_BOT_TOKEN is not configured"};
  const chatId=normalizeTelegramGroup(targetGroup)||env.TELEGRAM_RAID_CHAT_ID||"@rugcxx";
  const lines=["🎪 RUGCIRCUS RAID IS LIVE","","🪙 $"+(ticker||"RUGCX")+(name?" · "+name:""),"📦 "+packageName,"⏳ Ends: "+endsAt];
  if(raidCopy)lines.push("","📣 "+raidCopy);
  lines.push("","⚔️ Join the raid and hit the links below.");
  const buttons=[];
  const row=[];
  if(xUrl)row.push({text:"🐦 X RAID",url:xUrl});
  if(tiktokUrl)row.push({text:"🎵 TIKTOK",url:tiktokUrl});
  if(row.length)buttons.push(row);
  const row2=[];
  if(telegramUrl)row2.push({text:"💬 TELEGRAM",url:telegramUrl});
  row2.push({text:"🪙 PUMP.FUN",url:"https://pump.fun/coin/"+(mintAddress||env.RUGCX_MINT||"3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump")});
  buttons.push(row2);
  if(pumpCalloutUrl)buttons.push([{text:"📣 PUMP CALL OUT",url:pumpCalloutUrl}]);
  buttons.push([{text:"🎪 OPEN RUGCIRCUS COMMAND",web_app:{url:env.PUBLIC_APP_URL||"https://rugcircus-raid-command.pages.dev"}}]);
  const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text:lines.join("\n"),reply_markup:{inline_keyboard:buttons},disable_web_page_preview:true})
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok)return {ok:false,error:data?.description||"Telegram could not publish the raid card",chatId};
  return {ok:true,chatId,messageId:data.result?.message_id||null};
}

export async function onRequestPost({request,env}){
  try{
    if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
    if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:"Telegram bot is not configured"},503);

    let body;
    try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}

    const clientId=String(body.clientId||"").trim();
    const mint=String(body.mintAddress||"").trim();
    const telegramGroup=normalizeTelegramGroup(env.TELEGRAM_RAID_CHAT_ID||"@rugcxx")||"@rugcxx";

    if(!/^[A-Za-z0-9_-]{16,128}$/.test(clientId)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)){
      return json({ok:false,error:"Valid free-user ID and mint are required"},400);
    }

    await ensureSchema(env.DB);

    const botCheck=await verifyBotAdmin(env,telegramGroup);
    if(!botCheck.ok)return json({ok:false,error:botCheck.error,telegram:botCheck},403);

    const used=await env.DB.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE free_user_id=? AND package='FREE RAID' AND created_at>=datetime('now','-24 hours')").bind(clientId).first();
    if(Number(used?.count||0)>=2)return json({ok:false,error:"You have used both free raids for the last 24 hours"},429);

    const ticker=String(body.ticker||"").trim().replace(/[^A-Za-z0-9_]/g,"").slice(0,15);
    const name=String(body.name||ticker||"Token").trim().slice(0,80);

    await env.DB.prepare("INSERT INTO tokens (mint_address,ticker,name,x_url,tiktok_url,telegram_url,pump_url,dex_url) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(mint_address) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,x_url=excluded.x_url,tiktok_url=excluded.tiktok_url,telegram_url=excluded.telegram_url,pump_url=excluded.pump_url,dex_url=excluded.dex_url")
      .bind(mint,ticker,name,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,"https://pump.fun/coin/"+mint,"https://dexscreener.com/solana/"+mint).run();

    const token=await env.DB.prepare("SELECT id FROM tokens WHERE mint_address=?").bind(mint).first();
    if(!token?.id)return json({ok:false,error:"Token record could not be created"},500);

    const now=new Date();
    const ends=new Date(now.getTime()+24*3600000);
    const row=await env.DB.prepare("INSERT INTO campaigns (token_id,package,amount_lamports,duration_hours,x_url,tiktok_url,telegram_url,raid_copy,pump_callout_url,status,payout_wallet,creator_wallet,free_user_id,telegram_group,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(token.id,"FREE RAID",0,24,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,String(body.raidCopy||"").trim()||null,String(body.pumpCalloutUrl||"").trim()||null,"active",env.PUBLIC_TREASURY_WALLET||null,null,clientId,telegramGroup,now.toISOString(),ends.toISOString()).run();

    const campaignId=row.meta?.last_row_id;
    if(!campaignId)return json({ok:false,error:"Campaign was not created"},500);

    const telegram=await publishRaidCard(env,campaignId,telegramGroup,mint,ticker,name,"FREE RAID",ends.toISOString(),String(body.xUrl||"").trim(),String(body.tiktokUrl||"").trim(),String(body.telegramUrl||"").trim(),String(body.pumpCalloutUrl||"").trim(),String(body.raidCopy||"").trim());

    if(!telegram.ok){
      await env.DB.prepare("UPDATE campaigns SET status='failed' WHERE id=?").bind(campaignId).run().catch(()=>{});
      return json({ok:false,error:telegram.error||"Telegram could not publish the raid card",campaignId,telegram},502);
    }

    const remaining=Math.max(0,2-Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE free_user_id=? AND package='FREE RAID' AND status='active' AND created_at>=datetime('now','-24 hours')").bind(clientId).first())?.count||0));
    return json({ok:true,campaignId,endsAt:ends.toISOString(),remainingFreeRaids:remaining,telegram});
  }catch(error){
    console.error("FREE RAID ERROR",error);
    return json({ok:false,error:String(error?.message||error||"Unknown server error")},500);
  }
}
