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

async function sha256Bytes(value){
  return new Uint8Array(await crypto.subtle.digest("SHA-256",textEncoder.encode(value)));
}

async function verifyTelegramLoginData(loginData,botToken){
  if(!loginData||!botToken)return null;
  try{
    const data=typeof loginData==="string"?JSON.parse(loginData):loginData;
    const hash=String(data?.hash||"");
    const auth=Number(data?.auth_date||0);
    if(!hash||!auth||Math.abs(Date.now()/1000-auth)>86400||!data?.id)return null;
    const check=[...Object.entries(data)]
      .filter(([k])=>k!=="hash"&&data[k]!==undefined&&data[k]!==null&&data[k]!=="")
      .sort((a,b)=>a[0].localeCompare(b[0]))
      .map(([k,v])=>k+"="+v)
      .join("\n");
    const secret=await sha256Bytes(botToken);
    const calculated=hex(await hmac(secret,textEncoder.encode(check)));
    if(calculated.length!==hash.length)return null;
    let diff=0;
    for(let i=0;i<calculated.length;i++)diff|=calculated.charCodeAt(i)^hash.charCodeAt(i);
    if(diff!==0)return null;
    return {
      id:Number(data.id),
      first_name:data.first_name||"",
      last_name:data.last_name||"",
      username:data.username||"",
      photo_url:data.photo_url||""
    };
  }catch{return null}
}

export async function telegramUserFromRequest(request,env){
  const initUser=await verifyTelegramInitData(request.headers.get("x-telegram-init-data")||"",env.TELEGRAM_BOT_TOKEN);
  if(initUser)return initUser;
  return verifyTelegramLoginData(request.headers.get("x-telegram-login-data")||"",env.TELEGRAM_BOT_TOKEN);
}

export async function telegramUserFromBody(body,env){
  const initUser=await verifyTelegramInitData(String(body?.telegramInitData||"").trim(),env.TELEGRAM_BOT_TOKEN);
  if(initUser)return initUser;
  return verifyTelegramLoginData(body?.telegramLoginData||"",env.TELEGRAM_BOT_TOKEN);
}
