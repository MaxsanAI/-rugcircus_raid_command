export async function onRequestGet({request,env}) {
  if(!env.TELEGRAM_BOT_TOKEN) return new Response("Telegram bot token is not configured",{status:503});

  const appUrl=env.PUBLIC_APP_URL||new URL(request.url).origin;
  const webhookUrl=appUrl+"/api/telegram";
  const body={
    url:webhookUrl,
    allowed_updates:["message","callback_query","channel_post","edited_channel_post"],
    drop_pending_updates:false
  };
  if(env.TELEGRAM_WEBHOOK_SECRET) body.secret_token=env.TELEGRAM_WEBHOOK_SECRET;

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

  return new Response(JSON.stringify({
    ok:true,
    webhookUrl,
    webhookSecretConfigured:Boolean(env.TELEGRAM_WEBHOOK_SECRET),
    commandsConfigured:Boolean(commandResponse.ok&&commandData?.ok),
    message:"RUGCIRCUS Telegram bot connected"
  }),{
    headers:{"content-type":"application/json"}
  });
}
