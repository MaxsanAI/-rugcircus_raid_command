async function tgCall(method,token,body={}){
  const response=await fetch("https://api.telegram.org/bot"+token+"/"+method,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>null);
  return {ok:response.ok&&data?.ok===true,data};
}

function normalizeGroup(value){
  const raw=String(value||"").trim();
  if(!raw)return "@rugcxx";
  if(/^-100\d+$/.test(raw)||/^-\d+$/.test(raw))return raw;
  const match=raw.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})/i);
  if(match)return "@"+match[1];
  return raw.startsWith("@")?raw:"@"+raw;
}

export async function onRequestGet({request,env}) {
  if(!env.TELEGRAM_BOT_TOKEN)return new Response("Telegram bot token is not configured",{status:503});

  const appUrl="https://raidrugcircus.pulserapp.com";
  const webhookUrl=appUrl+"/api/telegram";
  const body={
    url:webhookUrl,
    allowed_updates:["message","callback_query","channel_post","edited_channel_post"],
    drop_pending_updates:false
  };
  if(env.TELEGRAM_WEBHOOK_SECRET)body.secret_token=env.TELEGRAM_WEBHOOK_SECRET;

  const webhookResponse=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/setWebhook",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  const webhookData=await webhookResponse.json().catch(()=>null);

  if(!webhookResponse.ok||!webhookData?.ok){
    return new Response(JSON.stringify({ok:false,error:webhookData?.description||"Telegram webhook setup failed"}),{
      status:502,
      headers:{"content-type":"application/json"}
    });
  }

  const commands=[
    {command:"start",description:"Open RUGCIRCUS COMMAND"},
    {command:"help",description:"Show available commands"},
    {command:"panel",description:"Open admin panel"},
    {command:"raid",description:"Show active raid"},
    {command:"announce",description:"Send admin announcement"},
    {command:"pin",description:"Pin a message"},
    {command:"unpin",description:"Unpin a message"},
    {command:"clean",description:"Delete a replied message"},
    {command:"ban",description:"Ban a replied member"},
    {command:"unban",description:"Unban by user ID"},
    {command:"mute",description:"Mute a replied member"},
    {command:"unmute",description:"Unmute a replied member"},
    {command:"token",description:"Show $RUGCX token"},
    {command:"group",description:"Show group status"},
    {command:"id",description:"Show chat and user IDs"},
    {command:"status",description:"Check bot webhook status"}
  ];

  const commandResponse=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/setMyCommands",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({commands})
  });
  const commandData=await commandResponse.json().catch(()=>null);

  const group=normalizeGroup(env.TELEGRAM_RAID_CHAT_ID||"@rugcxx");
  const me=await tgCall("getMe",env.TELEGRAM_BOT_TOKEN,{});
  let groupCheck={ok:false,chatId:group,status:"unknown",error:"Could not verify group bot status"};
  if(me.ok&&me.data?.result?.id){
    const member=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:group,user_id:me.data.result.id});
    if(member.ok){
      const status=member.data?.result?.status||"unknown";
      groupCheck={ok:status==="administrator"||status==="creator",chatId:group,status};
      if(!groupCheck.ok)groupCheck.error="Bot must be an administrator in the raid group";
    }else{
      groupCheck={ok:false,chatId:group,status:"not_member",error:member.data?.description||"Bot is not a member of the raid group"};
    }
  }else{
    groupCheck={ok:false,chatId:group,status:"unknown",error:me.data?.description||"Could not identify Telegram bot"};
  }

  return new Response(JSON.stringify({
    ok:true,
    webhookUrl,
    webhookSecretConfigured:Boolean(env.TELEGRAM_WEBHOOK_SECRET),
    commandsConfigured:Boolean(commandResponse.ok&&commandData?.ok),
    raidGroup:groupCheck,
    message:groupCheck.ok
      ?"RUGCIRCUS Telegram bot connected and is administrator in the raid group"
      :"RUGCIRCUS Telegram webhook connected, but the bot still needs administrator access in the raid group"
  }),{
    headers:{"content-type":"application/json"}
  });
}
