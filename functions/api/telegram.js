function tg(method,token,body){return fetch("https://api.telegram.org/bot"+token+"/"+method,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)})}
export async function onRequestPost({request,env}) {
  if(!env.TELEGRAM_BOT_TOKEN) return new Response("Telegram not configured",{status:503});
  let update; try{update=await request.json()}catch{return new Response("bad request",{status:400})}
  const chatId=update.message?.chat?.id;
  if(!chatId) return new Response("ok");
  const text=update.message?.text||"";
  const appUrl=env.PUBLIC_APP_URL||"https://rugcircus-command.pages.dev";
  const message=text.startsWith("/start")
    ?"🎪 RUGCIRCUS COMMAND\\n\\n$RUGCX • RAID • TRADE • PROMOTE\\n\\nOpen the command center to explore tokens, join campaigns and create a raid."
    :"🎪 Use the RUGCIRCUS COMMAND dashboard for live campaigns, social feeds and token tools.";
  await tg("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:message,reply_markup:{inline_keyboard:[[{text:"🎪 Open Command",web_app:{url:appUrl}}],[{text:"🔥 Live Campaigns",url:appUrl+"#explore"}]]}});
  return new Response("ok");
}