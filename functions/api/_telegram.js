const textEncoder=new TextEncoder();

async function hmac(key,data){
  const k=await crypto.subtle.importKey("raw",key,{name:"HMAC",hash:"SHA-256"},false,["sign"]);
  return crypto.subtle.sign("HMAC",k,data);
}

function hex(bytes){
  return [...new Uint8Array(bytes)].map(x=>x.toString(16).padStart(2,"0")).join("");
}

export async function verifyTelegramInitData(initData,botToken){
  if(!initData||!botToken)return null;
  try{
    const p=new URLSearchParams(String(initData));
    const hash=p.get("hash");
    const auth=Number(p.get("auth_date")||0);
    if(!hash||!auth||Math.abs(Date.now()/1000-auth)>86400)return null;
    const data=[...p.entries()].filter(([k])=>k!=="hash"&&k!=="signature").sort((a,b)=>a[0].localeCompare(b[0])).map(([k,v])=>k+"="+v).join("\n");
    const secret=await hmac(textEncoder.encode("WebAppData"),textEncoder.encode(botToken));
    const calculated=hex(await hmac(new Uint8Array(secret),textEncoder.encode(data)));
    if(calculated.length!==hash.length)return null;
    let diff=0;
    for(let i=0;i<calculated.length;i++)diff|=calculated.charCodeAt(i)^hash.charCodeAt(i);
    if(diff!==0)return null;
    const user=JSON.parse(p.get("user")||"null");
    return user?.id?user:null;
  }catch{return null}
}

export async function telegramUserFromRequest(request,env){
  return verifyTelegramInitData(request.headers.get("x-telegram-init-data")||"",env.TELEGRAM_BOT_TOKEN);
}

export async function telegramUserFromBody(body,env){
  return verifyTelegramInitData(String(body?.telegramInitData||"").trim(),env.TELEGRAM_BOT_TOKEN);
}
