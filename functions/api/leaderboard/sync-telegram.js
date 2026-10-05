function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
async function hmac(key,data){const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);return crypto.subtle.sign("HMAC",k,data)}
function hex(b){return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,"0")).join("")}
async function telegramUser(initData,token){
  if(!initData||!token)return null;
  try{
    const p=new URLSearchParams(initData),hash=p.get("hash"),auth=Number(p.get("auth_date")||0);
    if(!hash||!auth||Math.abs(Date.now()/1000-auth)>86400)return null;
    const a=[...p.entries()].filter(([k])=>k!=="hash"&&k!=="signature").sort((x,y)=>x[0].localeCompare(y[0]));
    const check=a.map(([k,v])=>k+"="+v).join("\n");
    const secret=await hmac(new TextEncoder().encode("WebAppData"),new TextEncoder().encode(token));
    const calc=hex(await hmac(new Uint8Array(secret),new TextEncoder().encode(check)));
    if(calc.length!==hash.length)return null;
    let diff=0;for(let i=0;i<calc.length;i++)diff|=calc.charCodeAt(i)^hash.charCodeAt(i);if(diff!==0)return null;
    const user=JSON.parse(p.get("user")||"null");
    return user?.id?user:null;
  }catch{return null}
}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  for(const [n,t] of [["telegram_id","TEXT"],["telegram_username","TEXT"],["telegram_first_name","TEXT"],["telegram_last_name","TEXT"],["display_name","TEXT"]]){
    const info=await db.prepare("PRAGMA table_info(leaderboard_members)").all().catch(()=>({results:[]}));
    const cols=new Set((info.results||[]).map(x=>String(x.name)));
    if(!cols.has(n))await db.prepare("ALTER TABLE leaderboard_members ADD COLUMN "+n+" "+t).run().catch(()=>{});
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_telegram_id ON leaderboard_members(telegram_id) WHERE telegram_id IS NOT NULL").run().catch(()=>{});
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:"Telegram authentication is not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const initData=String(body.telegramInitData||"").trim();
  const memberToken=String(body.memberToken||"").trim();
  const suppliedUsername=String(body.username||"").trim().replace(/^@/,"");
  const tg=await telegramUser(initData,env.TELEGRAM_BOT_TOKEN);
  if(!tg)return json({ok:false,error:"Telegram session could not be verified"},401);
  const tgId=String(tg.id),tgUsername=String(tg.username||"").trim().replace(/^@/,"");
  const username=tgUsername||suppliedUsername||("tg_"+tgId);
  try{
    await ensureSchema(env.DB);
    let member=null;
    if(memberToken){
      member=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points,telegram_id FROM leaderboard_members WHERE member_token=?").bind(memberToken).first();
      if(member&&member.telegram_id&&String(member.telegram_id)!==tgId)return json({ok:false,error:"This leaderboard membership is linked to another Telegram account."},409);
    }
    if(!member&&username){
      member=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points,telegram_id FROM leaderboard_members WHERE lower(username)=lower(?)").bind(username).first();
      if(member&&member.telegram_id&&String(member.telegram_id)!==tgId)return json({ok:false,error:"That leaderboard username is linked to another Telegram account."},409);
    }
    if(!member){
      return json({ok:true,linked:false,telegram:{id:tgId,username:tgUsername||null,firstName:tg.first_name||null,lastName:tg.last_name||null}});
    }
    await env.DB.prepare("UPDATE leaderboard_members SET telegram_id=?,telegram_username=?,telegram_first_name=?,telegram_last_name=?,display_name=? WHERE id=?").bind(tgId,tgUsername||null,tg.first_name||null,tg.last_name||null,member.username,member.id).run();
    return json({ok:true,linked:true,memberToken:member.member_token,member:{username:member.username,wallet:member.wallet_address,points:Number(member.points||0),telegramId:tgId}});
  }catch(e){
    console.error("TELEGRAM LEADERBOARD SYNC",e);
    return json({ok:false,error:"Could not sync Telegram account"},500);
  }
}
