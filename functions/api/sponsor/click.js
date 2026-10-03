function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_sponsor_opens (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,opened_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_leaderboard_sponsor_member ON leaderboard_sponsor_opens(member_id,opened_at)").run();
}
export async function onRequestGet({request,env}){
  const url=new URL(request.url);
  const token=String(url.searchParams.get("memberToken")||"").trim();
  const target=String(env.MONETAG_SMARTLINK||"https://omg10.com/4/11941511").trim();
  if(!/^https?:\\/\\//.test(target))return json({ok:false,error:"Sponsor offer is not configured"},500);
  try{
    if(env.DB&&token){
      await ensureSchema(env.DB);
      const member=await env.DB.prepare("SELECT id FROM leaderboard_members WHERE member_token=?").bind(token).first();
      if(member){
        const recent=await env.DB.prepare("SELECT id FROM leaderboard_sponsor_opens WHERE member_id=? AND opened_at>=datetime('now','-24 hours') LIMIT 1").bind(member.id).first();
        if(!recent){
          await env.DB.prepare("INSERT INTO leaderboard_sponsor_opens (member_id) VALUES (?)").bind(member.id).run();
          await env.DB.prepare("UPDATE leaderboard_members SET points=points+2 WHERE id=?").bind(member.id).run();
        }
      }
    }
  }catch(error){console.error("SPONSOR CLICK ERROR",error)}
  return Response.redirect(target,302);
}
