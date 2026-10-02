const API="https://api.telegram.org/bot";

async function tgCall(method,token,body={}){
  const response=await fetch(API+token+"/"+method,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(body)
  });
  const data=await response.json().catch(()=>null);
  return {ok:response.ok&&data?.ok===true,data};
}

function replyText(chatId,text,extra={}){
  return tgCall("sendMessage",extra.token,{chat_id:chatId,text,...extra.options});
}

function commandOf(text){
  const first=(text||"").trim().split(/\s+/)[0]||"";
  return first.split("@")[0].toLowerCase();
}

function commandArgs(text){
  const value=(text||"").trim();
  return value.replace(/^\/\S+\s*/,"").trim();
}

function isAdmin(member){
  return member?.status==="creator"||member?.status==="administrator";
}

async function requireAdmin(chatId,userId,token){
  const result=await tgCall("getChatMember",token,{chat_id:chatId,user_id:userId});
  return result.ok&&isAdmin(result.data?.result);
}

async function sendPanel(chatId,token){
  return tgCall("sendMessage",token,{
    chat_id:chatId,
    text:"🎪 RUGCIRCUS COMMAND\n\nChoose an action:",
    reply_markup:{
      inline_keyboard:[
        [{text:"⚔️ Active Raid",callback_data:"raid"},{text:"🪙 $RUGCX",callback_data:"token"}],
        [{text:"📣 Announce",callback_data:"announce_help"},{text:"🧹 Moderation",callback_data:"clean_help"}],
        [{text:"📌 Pin / Unpin",callback_data:"pin_help"}],
        [{text:"📊 Group Status",callback_data:"group"}],
        [{text:"🚀 Open Command Center",web_app:{url:__APP_URL__}}]
      ]
    }
  });
}

async function activeRaid(env){
  if(!env.DB) return null;
  try{
    return await env.DB.prepare(
      "SELECT c.id,c.package,c.duration_hours,c.x_url,c.tiktok_url,c.telegram_url,t.ticker,t.name FROM campaigns c JOIN tokens t ON t.id=c.token_id WHERE c.status='active' AND (c.ends_at IS NULL OR c.ends_at > CURRENT_TIMESTAMP) ORDER BY c.starts_at DESC,c.id DESC LIMIT 1"
    ).first();
  }catch{return null}
}

async function sendRaid(chatId,env){
  const raid=await activeRaid(env);
  const lines=[
    "⚔️ RUGCIRCUS LIVE RAID",
    "",
    raid?.ticker ? "🪙 $"+raid.ticker+(raid.name?" · "+raid.name:"") : "🪙 $RUGCX · RUGCIRCUS",
    raid?.package ? "📦 "+raid.package : "📦 Community Raid",
    "",
    "🔥 Join the raid and open the Command Center."
  ];
  const buttons=[
    [{text:"🚀 Open Command Center",web_app:{url:env.PUBLIC_APP_URL||"https://rugcircus-raid-command.pages.dev"}}],
    [{text:"🪙 $RUGCX on Pump.fun",url:"https://pump.fun/coin/3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump"}]
  ];
  if(raid?.x_url) buttons.splice(1,0,[{text:"🐦 Join X Raid",url:raid.x_url}]);
  if(raid?.tiktok_url) buttons.splice(2,0,[{text:"🎵 Join TikTok Raid",url:raid.tiktok_url}]);
  if(raid?.telegram_url) buttons.splice(3,0,[{text:"💬 Telegram",url:raid.telegram_url}]);
  return tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:lines.join("\n"),reply_markup:{inline_keyboard:buttons}});
}

async function handleCommand(message,env){
  const chatId=message.chat.id;
  const userId=message.from?.id;
  const text=message.text||"";
  const cmd=commandOf(text);
  const args=commandArgs(text);
  const appUrl=env.PUBLIC_APP_URL||"https://rugcircus-raid-command.pages.dev";
  const group=message.chat.type==="group"||message.chat.type==="supergroup";
  const adminCommands=new Set(["/panel","/announce","/pin","/unpin","/clean"]);

  if(adminCommands.has(cmd)&&group){
    if(!userId||!(await requireAdmin(chatId,userId,env.TELEGRAM_BOT_TOKEN))){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🛡️ Admins only."});
      return;
    }
  }

  if(cmd==="/start"){
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🎪 RUGCIRCUS COMMAND\n\n⚔️ RAID • 🪙 $RUGCX • 📣 CAMPAIGNS • 🛡️ COMMUNITY CONTROL\n\nUse /panel for admin tools or /raid for the active raid.",
      reply_markup:{inline_keyboard:[
        [{text:"🎪 Open Command",web_app:{url:appUrl}}],
        [{text:"⚔️ Live Raid",callback_data:"raid"},{text:"🪙 $RUGCX",callback_data:"token"}]
      ]}
    });
    return;
  }

  if(cmd==="/help"){
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🎪 RUGCIRCUS COMMAND\n\n/start — Open Command Center\n/help — Show commands\n/raid — Active raid\n/token — $RUGCX\n/status — Bot status\n/group — Group status\n\n🛡️ Admins:\n/panel — Admin panel\n/announce <text> — Announcement\n/pin — Pin replied message\n/unpin — Remove pin\n/clean — Delete replied message"
    });
    return;
  }

  if(cmd==="/panel"){
    await sendPanel(chatId,env.TELEGRAM_BOT_TOKEN);
    return;
  }

  if(cmd==="/raid"){
    await sendRaid(chatId,env);
    return;
  }

  if(cmd==="/token"){
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🎪 $RUGCX · RUGCIRCUS\n\n🪙 Official Pump.fun token page:",
      reply_markup:{inline_keyboard:[
        [{text:"🔥 Open $RUGCX on Pump.fun",url:"https://pump.fun/coin/3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump"}],
        [{text:"🚀 Open Command Center",web_app:{url:appUrl}}]
      ]}
    });
    return;
  }

  if(cmd==="/announce"){
    if(!group){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📣 Use /announce inside a Telegram group."});
      return;
    }
    if(!args){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📣 Usage: /announce Your announcement text"});
      return;
    }
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📣 RUGCIRCUS ANNOUNCEMENT\n\n"+args});
    return;
  }

  if(cmd==="/pin"){
    if(!group){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📌 Use /pin in a group by replying to the message you want to pin."});
      return;
    }
    const target=message.reply_to_message?.message_id;
    if(!target){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📌 Reply to a message with /pin."});
      return;
    }
    const result=await tgCall("pinChatMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,message_id:target,disable_notification:false});
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:result.ok?"📌 Message pinned.":"❌ Could not pin that message. Check the bot's Pin Messages permission."});
    return;
  }

  if(cmd==="/unpin"){
    if(!group){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📌 Use /unpin inside a group."});
      return;
    }
    const result=await tgCall("unpinChatMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId});
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:result.ok?"📌 Pinned message removed.":"❌ Could not remove the pin."});
    return;
  }

  if(cmd==="/clean"){
    if(!group){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🧹 Use /clean in a group by replying to the message you want to delete."});
      return;
    }
    const target=message.reply_to_message?.message_id;
    if(!target){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🧹 Reply to a message with /clean to delete it."});
      return;
    }
    const result=await tgCall("deleteMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,message_id:target});
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:result.ok?"🧹 Message deleted.":"❌ Could not delete that message. Check Delete Messages permission."});
    return;
  }

  if(cmd==="/group"){
    if(!group){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"💬 This command is for a Telegram group."});
      return;
    }
    const [chatResult,countResult]=await Promise.all([
      tgCall("getChat",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId}),
      tgCall("getChatMemberCount",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId})
    ]);
    const chat=chatResult.data?.result;
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"💬 GROUP STATUS\n\n🎪 "+(chat?.title||"RUGCIRCUS Community")+"\n👥 Members: "+(countResult.data?.result??"—")+"\n🛡️ Bot: Administrator\n\nUse /panel for admin tools."
    });
    return;
  }

  if(cmd==="/status"){
    const result=await tgCall("getWebhookInfo",env.TELEGRAM_BOT_TOKEN,{});
    const info=result.data?.result;
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🟢 RUGCIRCUS STATUS\n\n🤖 Bot: Online\n🔗 Webhook: "+(info?.url?"Connected":"Not connected")+"\n📥 Pending updates: "+(info?.pending_update_count??0)+(info?.last_error_message?"\n⚠️ Last error: "+info.last_error_message:"")
    });
    return;
  }
}

export async function onRequestPost({request,env}){
  if(!env.TELEGRAM_BOT_TOKEN) return new Response("Telegram not configured",{status:503});

  if(env.TELEGRAM_WEBHOOK_SECRET){
    const supplied=request.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if(supplied!==env.TELEGRAM_WEBHOOK_SECRET) return new Response("Unauthorized",{status:401});
  }

  let update;
  try{update=await request.json()}catch{return new Response("Bad request",{status:400})}

  if(update.callback_query){
    const q=update.callback_query;
    const chatId=q.message?.chat?.id;
    if(chatId){
      await tgCall("answerCallbackQuery",env.TELEGRAM_BOT_TOKEN,{callback_query_id:q.id});
      const action=q.data;
      if(action==="raid") await sendRaid(chatId,env);
      else if(action==="token") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🪙 $RUGCX",reply_markup:{inline_keyboard:[[{text:"🔥 Pump.fun",url:"https://pump.fun/coin/3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump"}]]}});
      else if(action==="group"){
        const count=await tgCall("getChatMemberCount",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId});
        await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"💬 Group members: "+(count.data?.result??"—")});
      } else if(action==="announce_help") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📣 Admin usage: /announce Your announcement text"});
      else if(action==="clean_help") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🧹 Reply to a message with /clean to delete it."});
      else if(action==="pin_help") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📌 Reply to a message with /pin to pin it, or use /unpin to remove the current pin."});
    }
    return new Response("ok");
  }

  const message=update.message;
  if(message?.text) await handleCommand(message,env);
  return new Response("ok");
}
