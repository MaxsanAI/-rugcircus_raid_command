export async function onRequestGet({request,env}) {
  if(!env.TELEGRAM_BOT_TOKEN) return new Response("Telegram bot token is not configured",{status:503});

  const webhookUrl=(env.PUBLIC_APP_URL||new URL(request.url).origin)+"/api/telegram";
  const response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/setWebhook",{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({
      url:webhookUrl,
      allowed_updates:["message","callback_query"],
      drop_pending_updates:false
    })
  });

  const data=await response.json().catch(()=>null);
  if(!response.ok || !data?.ok){
    return new Response(JSON.stringify({ok:false,error:data?.description||"Telegram webhook setup failed"}),{
      status:502,
      headers:{"content-type":"application/json"}
    });
  }

  return new Response(JSON.stringify({
    ok:true,
    webhookUrl,
    message:"Telegram webhook connected"
  }),{
    headers:{"content-type":"application/json"}
  });
}
