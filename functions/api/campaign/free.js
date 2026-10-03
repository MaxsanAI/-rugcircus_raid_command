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

  const tableColumns=async(table)=>{
    const result=await db.prepare("PRAGMA table_info("+table+")").all();
    return new Set((result.results||[]).map(row=>String(row.name)));
  };

  const ensureColumns=async(table,columns)=>{
    const existing=await tableColumns(table);
    for(const [name,type] of columns){
      if(!existing.has(name)){
        await db.prepare("ALTER TABLE "+table+" ADD COLUMN "+name+" "+type).run();
      }
    }
  };

  await ensureColumns("tokens",[
    ["address","TEXT"],
    ["mint_address","TEXT"],
    ["ticker","TEXT"],
    ["name","TEXT"],
    ["logo_url","TEXT"],
    ["x_url","TEXT"],
    ["tiktok_url","TEXT"],
    ["telegram_url","TEXT"],
    ["pump_url","TEXT"],
    ["dex_url","TEXT"],
    ["created_at","TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"]
  ]);

  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_tokens_mint_address_unique ON tokens(mint_address) WHERE mint_address IS NOT NULL").run().catch(()=>{});

  await ensureColumns("campaigns",[
    ["token_id","INTEGER"],
    ["package","TEXT"],
    ["amount_lamports","INTEGER"],
    ["amount_sol","REAL"],
    ["duration_hours","INTEGER"],
    ["x_url","TEXT"],
    ["tiktok_url","TEXT"],
    ["telegram_url","TEXT"],
    ["raid_copy","TEXT"],
    ["status","TEXT DEFAULT 'pending'"],
    ["payment_signature","TEXT"],
    ["payout_wallet","TEXT"],
    ["creator_wallet","TEXT"],
    ["free_user_id","TEXT"],
    ["pump_callout_url","TEXT"],
    ["telegram_group","TEXT"],
    ["starts_at","TEXT"],
    ["ends_at","TEXT"],
    ["created_at","TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP"]
  ]);
}


async function upsertToken(db,{mint,ticker,name,xUrl,tiktokUrl,telegramUrl}){
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
  const token=await db.prepare("SELECT id FROM tokens WHERE "+lookupColumn+"=? OR "+(lookupColumn==="mint_address"&&columns.has("address")?"address":"mint_address")+"=? LIMIT 1").bind(mint,mint).first();
  if(!token?.id)throw new Error("Token record could not be created");
  return token;
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
  buttons.push([{text:"🎪 OPEN RUGCIRCUS COMMAND",url:env.PUBLIC_APP_URL||"https://rugcircus-raid-command.pages.dev"}]);
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
    if(Number(used?.count||0)>=3){
      return json({ok:false,error:"You have used all 3 free raids for the last 24 hours",remainingFreeRaids:0},429);
    }

    const ticker=String(body.ticker||"").trim().replace(/[^A-Za-z0-9_]/g,"").slice(0,15);
    const name=String(body.name||ticker||"Token").trim().slice(0,80);

    const token=await upsertToken(env.DB,{mint,ticker,name,xUrl:String(body.xUrl||"").trim(),tiktokUrl:String(body.tiktokUrl||"").trim(),telegramUrl:String(body.telegramUrl||"").trim()});

    const now=new Date();
    const ends=new Date(now.getTime()+24*3600000);
    const row=await env.DB.prepare("INSERT INTO campaigns (token_id,package,amount_lamports,amount_sol,duration_hours,x_url,tiktok_url,telegram_url,raid_copy,pump_callout_url,status,payout_wallet,creator_wallet,free_user_id,telegram_group,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(token.id,"FREE RAID",0,0,24,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,String(body.raidCopy||"").trim()||null,String(body.pumpCalloutUrl||"").trim()||null,"active",env.PUBLIC_TREASURY_WALLET||null,null,clientId,telegramGroup,now.toISOString(),ends.toISOString()).run();

    const campaignId=row.meta?.last_row_id;
    if(!campaignId)return json({ok:false,error:"Campaign was not created"},500);

    const telegram=await publishRaidCard(env,campaignId,telegramGroup,mint,ticker,name,"FREE RAID",ends.toISOString(),String(body.xUrl||"").trim(),String(body.tiktokUrl||"").trim(),String(body.telegramUrl||"").trim(),String(body.pumpCalloutUrl||"").trim(),String(body.raidCopy||"").trim());

    if(!telegram.ok){
      await env.DB.prepare("UPDATE campaigns SET status='failed' WHERE id=?").bind(campaignId).run().catch(()=>{});
      return json({ok:false,error:telegram.error||"Telegram could not publish the raid card",campaignId,telegram},502);
    }

    const remainingFreeRaids=Math.max(0,3-Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE free_user_id=? AND package='FREE RAID' AND created_at>=datetime('now','-24 hours')").bind(clientId).first())?.count||0));
    return json({ok:true,campaignId,endsAt:ends.toISOString(),remainingFreeRaids,telegram});
  }catch(error){
    console.error("FREE RAID ERROR",error);
    return json({ok:false,error:String(error?.message||error||"Unknown server error")},500);
  }
}
