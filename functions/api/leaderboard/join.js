function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const USERNAME_RE=/^[A-Za-z0-9_]{3,32}$/;

async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_username_lower ON leaderboard_members(lower(username))").run();
}

export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body;
  try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const username=String(body.username||"").trim().replace(/^@/,"");
  const wallet=String(body.wallet||"").trim();
  const existingToken=String(body.memberToken||"").trim();
  if(!USERNAME_RE.test(username))return json({ok:false,error:"Enter a valid Telegram-style username (3-32 letters, numbers or underscore)."},400);
  if(!WALLET_RE.test(wallet))return json({ok:false,error:"Enter a valid Solana wallet address."},400);
  try{
    await ensureSchema(env.DB);
    if(existingToken){
      const member=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points FROM leaderboard_members WHERE member_token=?").bind(existingToken).first();
      if(member){
        if(String(member.username).toLowerCase()!==username.toLowerCase())return json({ok:false,error:"That leaderboard token belongs to another username."},409);
        await env.DB.prepare("UPDATE leaderboard_members SET wallet_address=? WHERE id=?").bind(wallet,member.id).run();
        return json({ok:true,member:{username:member.username,wallet:wallet,points:Number(member.points||0)},memberToken:member.member_token,updated:true});
      }
    }
    const existing=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points FROM leaderboard_members WHERE lower(username)=lower(?)").bind(username).first();
    if(existing){
      if(String(existing.wallet_address)===wallet)return json({ok:true,member:{username:existing.username,wallet:wallet,points:Number(existing.points||0)},memberToken:existing.member_token,existing:true});
      return json({ok:false,error:"That username is already registered on the leaderboard. Use the same wallet you registered with."},409);
    }
    const memberToken=crypto.randomUUID()+"-"+crypto.randomUUID();
    const result=await env.DB.prepare("INSERT INTO leaderboard_members (username,wallet_address,member_token) VALUES (?,?,?)").bind(username,wallet,memberToken).run();
    const id=result.meta?.last_row_id;
    return json({ok:true,member:{username,wallet,points:0},memberToken,id});
  }catch(error){
    console.error("LEADERBOARD JOIN ERROR",error);
    return json({ok:false,error:"Could not join the leaderboard"},500);
  }
}
