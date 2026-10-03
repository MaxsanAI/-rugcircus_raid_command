function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const USERNAME_RE=/^[A-Za-z0-9_]{3,32}$/;
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
    const user=JSON.parse(p.get("user")||"null");return user?.id?user:null;
  }catch{return null}
}
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_username_lower ON leaderboard_members(lower(username))").run();
  const info=await db.prepare("PRAGMA table_info(leaderboard_members)").all().catch(()=>({results:[]}));
  const cols=new Set((info.results||[]).map(x=>String(x.name)));
  for(const [n,t] of [["telegram_id","TEXT"],["telegram_username","TEXT"],["telegram_first_name","TEXT"],["telegram_last_name","TEXT"],["display_name","TEXT"]])if(!cols.has(n))await db.prepare("ALTER TABLE leaderboard_members ADD COLUMN "+n+" "+t).run().catch(()=>{});
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_telegram_id ON leaderboard_members(telegram_id) WHERE telegram_id IS NOT NULL").run().catch(()=>{});
}
export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const wallet=String(body.wallet||"").trim(),token=String(body.memberToken||"").trim(),initData=String(body.telegramInitData||"").trim();
  if(!WALLET_RE.test(wallet))return json({ok:false,error:"Connect a valid Solana wallet before joining the leaderboard."},400);
  let tg=null;
  if(initData){if(!env.TELEGRAM_BOT_TOKEN)return json({ok:false,error:"Telegram authentication is not configured"},503);tg=await telegramUser(initData,env.TELEGRAM_BOT_TOKEN);if(!tg)return json({ok:false,error:"Telegram session could not be verified. Open the Command Center from Telegram and try again."},401)}
  const tgUsername=String(tg?.username||"").trim().replace(/^@/,""),supplied=String(body.username||"").trim().replace(/^@/,"");
  const username=tg?(tgUsername||("tg_"+String(tg.id))):supplied;
  if(!USERNAME_RE.test(username))return json({ok:false,error:"Enter a valid Telegram username or open the Command Center from Telegram."},400);
  try{
    await ensureSchema(env.DB);
    if(tg){
      const tgId=String(tg.id);
      let m=await env.DB.prepare("SELECT id,username,member_token,points FROM leaderboard_members WHERE telegram_id=?").bind(tgId).first();
      if(m){
        if(token&&token!==m.member_token)return json({ok:false,error:"This Telegram account is already linked to another leaderboard membership."},409);
        await env.DB.prepare("UPDATE leaderboard_members SET username=?,wallet_address=?,telegram_username=?,telegram_first_name=?,telegram_last_name=?,display_name=? WHERE id=?").bind(username,wallet,tgUsername||null,tg.first_name||null,tg.last_name||null,username,m.id).run();
        return json({ok:true,member:{username,wallet,points:Number(m.points||0),telegramId:tgId},memberToken:m.member_token,updated:true});
      }
      m=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points,telegram_id FROM leaderboard_members WHERE lower(username)=lower(?)").bind(username).first();
      if(m){
        if(m.telegram_id&&String(m.telegram_id)!==tgId)return json({ok:false,error:"That leaderboard username is already linked to another Telegram account."},409);
        await env.DB.prepare("UPDATE leaderboard_members SET wallet_address=?,telegram_id=?,telegram_username=?,telegram_first_name=?,telegram_last_name=?,display_name=? WHERE id=?").bind(wallet,tgId,tgUsername||null,tg.first_name||null,tg.last_name||null,username,m.id).run();
        return json({ok:true,member:{username,wallet,points:Number(m.points||0),telegramId:tgId},memberToken:m.member_token,updated:true});
      }
      const mt=crypto.randomUUID()+"-"+crypto.randomUUID();
      const ins=await env.DB.prepare("INSERT INTO leaderboard_members (username,wallet_address,member_token,telegram_id,telegram_username,telegram_first_name,telegram_last_name,display_name) VALUES (?,?,?,?,?,?,?,?)").bind(username,wallet,mt,tgId,tgUsername||null,tg.first_name||null,tg.last_name||null,username).run();
      return json({ok:true,member:{username,wallet,points:0,telegramId:tgId},memberToken:mt,id:ins.meta?.last_row_id});
    }
    if(token){
      const m=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points FROM leaderboard_members WHERE member_token=?").bind(token).first();
      if(m){if(m.username.toLowerCase()!==username.toLowerCase())return json({ok:false,error:"That leaderboard token belongs to another username."},409);await env.DB.prepare("UPDATE leaderboard_members SET wallet_address=? WHERE id=?").bind(wallet,m.id).run();return json({ok:true,member:{username:m.username,wallet,points:Number(m.points||0)},memberToken:m.member_token,updated:true})}
    }
    const m=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points FROM leaderboard_members WHERE lower(username)=lower(?)").bind(username).first();
    if(m){if(m.wallet_address===wallet)return json({ok:true,member:{username:m.username,wallet,points:Number(m.points||0)},memberToken:m.member_token,existing:true});return json({ok:false,error:"That username is already registered on the leaderboard. Use the same wallet you registered with."},409)}
    const mt=crypto.randomUUID()+"-"+crypto.randomUUID();
    const ins=await env.DB.prepare("INSERT INTO leaderboard_members (username,wallet_address,member_token) VALUES (?,?,?)").bind(username,wallet,mt).run();
    return json({ok:true,member:{username,wallet,points:0},memberToken:mt,id:ins.meta?.last_row_id});
  }catch(error){console.error("LEADERBOARD JOIN ERROR",error);return json({ok:false,error:"Could not join the leaderboard"},500)}
}
