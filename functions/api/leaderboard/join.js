import {Address} from "@ton/core";
import {telegramUserFromRequest,telegramUserFromBody} from "../_telegram.js";

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}})}
const USERNAME_RE=/^[A-Za-z0-9_]{3,32}$/;

function tonAddress(value){
  try{return Address.parse(String(value||"").trim()).toString({urlSafe:true,bounceable:true,testOnly:false})}
  catch{return ""}
}

async function ensureSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS leaderboard_members (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL UNIQUE,wallet_address TEXT NOT NULL,member_token TEXT NOT NULL UNIQUE,points INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_username_lower ON leaderboard_members(lower(username))").run();
  const info=await db.prepare("PRAGMA table_info(leaderboard_members)").all().catch(()=>({results:[]})),cols=new Set((info.results||[]).map(x=>String(x.name)));
  for(const [n,t] of [["telegram_id","TEXT"],["telegram_username","TEXT"],["telegram_first_name","TEXT"],["telegram_last_name","TEXT"],["display_name","TEXT"]]){
    if(!cols.has(n))await db.prepare("ALTER TABLE leaderboard_members ADD COLUMN "+n+" "+t).run().catch(()=>{});
  }
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_leaderboard_telegram_id ON leaderboard_members(telegram_id) WHERE telegram_id IS NOT NULL").run().catch(()=>{});
}

export async function onRequestPost({request,env}){
  if(!env.DB)return json({ok:false,error:"Database is not configured"},503);
  let body;try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}

  const tg=await telegramUserFromRequest(request,env)||await telegramUserFromBody(body,env);
  if(!tg)return json({ok:false,error:"Telegram session could not be verified. Open Rewards from the Telegram Mini App."},401);

  const supplied=String(body.username||"").trim().replace(/^@/,"");
  const tgUsername=String(tg.username||"").trim().replace(/^@/,"");
  const username=tgUsername||supplied||("tg_"+String(tg.id));
  const wallet=tonAddress(body.wallet);

  if(!USERNAME_RE.test(username))return json({ok:false,error:"Your Telegram username is not valid for the Reward Wall."},400);

  try{
    await ensureSchema(env.DB);
    const tgId=String(tg.id);

    let m=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points,telegram_id FROM leaderboard_members WHERE telegram_id=?").bind(tgId).first();
    if(m){
      if(wallet){
        await env.DB.prepare("UPDATE leaderboard_members SET username=?,wallet_address=?,telegram_username=?,telegram_first_name=?,telegram_last_name=?,display_name=? WHERE id=?")
          .bind(username,wallet,tgUsername||null,tg.first_name||null,tg.last_name||null,username,m.id).run();
      }else{
        await env.DB.prepare("UPDATE leaderboard_members SET username=?,telegram_username=?,telegram_first_name=?,telegram_last_name=?,display_name=? WHERE id=?")
          .bind(username,tgUsername||null,tg.first_name||null,tg.last_name||null,username,m.id).run();
      }
      return json({ok:true,member:{username,wallet:wallet||String(m.wallet_address||""),points:Number(m.points||0),telegramId:tgId},memberToken:m.member_token,updated:true});
    }

    m=await env.DB.prepare("SELECT id,username,wallet_address,member_token,points,telegram_id FROM leaderboard_members WHERE lower(username)=lower(?)").bind(username).first();
    if(m){
      if(m.telegram_id&&String(m.telegram_id)!==tgId)return json({ok:false,error:"That leaderboard username is already linked to another Telegram account."},409);
      await env.DB.prepare("UPDATE leaderboard_members SET wallet_address=?,telegram_id=?,telegram_username=?,telegram_first_name=?,telegram_last_name=?,display_name=? WHERE id=?")
        .bind(wallet||String(m.wallet_address||""),tgId,tgUsername||null,tg.first_name||null,tg.last_name||null,username,m.id).run();
      return json({ok:true,member:{username,wallet:wallet||String(m.wallet_address||""),points:Number(m.points||0),telegramId:tgId},memberToken:m.member_token,updated:true});
    }

    const mt=crypto.randomUUID()+"-"+crypto.randomUUID();
    const ins=await env.DB.prepare("INSERT INTO leaderboard_members (username,wallet_address,member_token,telegram_id,telegram_username,telegram_first_name,telegram_last_name,display_name) VALUES (?,?,?,?,?,?,?,?)")
      .bind(username,wallet,mt,tgId,tgUsername||null,tg.first_name||null,tg.last_name||null,username).run();

    return json({ok:true,member:{username,wallet,points:0,telegramId:tgId},memberToken:mt,id:ins.meta?.last_row_id});
  }catch(error){
    console.error("LEADERBOARD JOIN ERROR",error);
    return json({ok:false,error:"Could not join the Reward Wall"},500);
  }
}
