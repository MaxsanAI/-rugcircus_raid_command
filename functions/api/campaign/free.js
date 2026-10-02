export async function onRequestPost({request,env}){
  if(!env.DB) return new Response(JSON.stringify({ok:false,error:"Database is not configured"}),{status:503,headers:{"content-type":"application/json"}});
  let body;try{body=await request.json()}catch{return new Response(JSON.stringify({ok:false,error:"Invalid JSON"}),{status:400,headers:{"content-type":"application/json"}})}
  const wallet=String(body.payerWallet||"").trim();
  const mint=String(body.mintAddress||"").trim();
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return new Response(JSON.stringify({ok:false,error:"Valid Solana wallet and mint are required"}),{status:400,headers:{"content-type":"application/json"}});
  await env.DB.prepare("ALTER TABLE campaigns ADD COLUMN creator_wallet TEXT").run().catch(()=>{});
  const used=await env.DB.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE creator_wallet=? AND package='FREE RAID' AND created_at>=datetime('now','-24 hours')").bind(wallet).first();
  if(Number(used?.count||0)>=2) return new Response(JSON.stringify({ok:false,error:"You have used both free raids for the last 24 hours"}),{status:429,headers:{"content-type":"application/json"}});
  const ticker=String(body.ticker||"").trim().replace(/[^A-Za-z0-9_]/g,"").slice(0,15);
  const name=String(body.name||ticker||"Token").trim().slice(0,80);
  await env.DB.prepare("INSERT INTO tokens (mint_address,ticker,name,x_url,tiktok_url,telegram_url,pump_url,dex_url) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(mint_address) DO UPDATE SET ticker=excluded.ticker,name=excluded.name,x_url=excluded.x_url,tiktok_url=excluded.tiktok_url,telegram_url=excluded.telegram_url,pump_url=excluded.pump_url,dex_url=excluded.dex_url").bind(mint,ticker,name,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,"https://pump.fun/coin/"+mint,"https://dexscreener.com/solana/"+mint).run();
  const token=await env.DB.prepare("SELECT id FROM tokens WHERE mint_address=?").bind(mint).first();
  const now=new Date();const ends=new Date(now.getTime()+24*3600000);
  const row=await env.DB.prepare("INSERT INTO campaigns (token_id,package,amount_lamports,duration_hours,x_url,tiktok_url,telegram_url,raid_copy,status,payout_wallet,creator_wallet,starts_at,ends_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(token.id,"FREE RAID",0,24,String(body.xUrl||"").trim()||null,String(body.tiktokUrl||"").trim()||null,String(body.telegramUrl||"").trim()||null,String(body.raidCopy||"").trim()||null,"active",env.PUBLIC_TREASURY_WALLET, wallet,now.toISOString(),ends.toISOString()).run();
  const remaining=Math.max(0,1-Number((await env.DB.prepare("SELECT COUNT(*) AS count FROM campaigns WHERE creator_wallet=? AND package='FREE RAID' AND created_at>=datetime('now','-24 hours')").bind(wallet).first())?.count||0));
  return new Response(JSON.stringify({ok:true,campaignId:row.meta.last_row_id,endsAt:ends.toISOString(),remainingFreeRaids:remaining}),{headers:{"content-type":"application/json"}});
}