import {prepareTelegramImage} from "./raid/image.js";
import {prepareBotReward} from "./adsgram/reward.js";
const API="https://api.telegram.org/bot";
const APP_URL="https://raidrugcircus.pulserapp.com";

async function tgCall(method,token,body={}){
  try{
    const response=await fetch(API+token+"/"+method,{
      method:"POST",
      headers:{"content-type":"application/json"},
      body:JSON.stringify(body)
    });
    const data=await response.json().catch(()=>null);
    return {ok:response.ok&&data?.ok===true,data};
  }catch(error){
    console.error("TELEGRAM API REQUEST ERROR",method,error);
    return {ok:false,data:null,error};
  }
}

function commandOf(text){
  const first=(text||"").trim().split(/\s+/)[0]||"";
  return first.split("@")[0].toLowerCase();
}

function commandArgs(text){
  return (text||"").trim().replace(/^\/\S+\s*/,"").trim();
}

function isAdmin(member){
  return member?.status==="creator"||member?.status==="administrator";
}

async function requireAdmin(chatId,userId,token){
  if(!userId) return false;
  const result=await tgCall("getChatMember",token,{chat_id:chatId,user_id:userId});
  return result.ok&&isAdmin(result.data?.result);
}

async function sendPanel(chatId,token,appUrl){
  const openButton={text:"🚀 Open App",web_app:{url:APP_URL+"/"}};
  return tgCall("sendMessage",token,{
    chat_id:chatId,
    text:"🎪 RUGCIRCUS COMMAND\n\nChoose an action:",
    reply_markup:{
      inline_keyboard:[
        [{text:"⚔️ Active Raid",callback_data:"raid"},{text:"🪙 $RUGCX",callback_data:"token"}],
        [{text:"📣 Announce",callback_data:"announce_help"},{text:"🧹 Moderation",callback_data:"clean_help"}],
        [{text:"📌 Pin / Unpin",callback_data:"pin_help"}],
        [{text:"📊 Group Status",callback_data:"group"}],
        [openButton]
      ]
    }
  });
}

async function activeRaid(env,chatId,chatUsername){
  if(!env.DB) return null;
  try{
    const groupId=String(chatId||"");
    const username=chatUsername?"@"+String(chatUsername).replace(/^@/,""):"";
    const configured=String(env.TELEGRAM_RAID_CHAT_ID||"@rugcxx").trim();
    return await env.DB.prepare(
      "SELECT c.id,c.package,c.duration_hours,c.x_url,c.tiktok_url,c.telegram_url,c.raid_copy,c.pump_callout_url,c.telegram_group,t.ticker,t.name,t.mint_address,t.pump_url,t.logo_url FROM campaigns c JOIN tokens t ON t.id=c.token_id WHERE c.status='active' AND (c.ends_at IS NULL OR datetime(c.ends_at)>datetime('now')) AND (c.telegram_group=? OR c.telegram_group=? OR c.telegram_group=?) ORDER BY c.starts_at DESC,c.id DESC LIMIT 1"
    ).bind(groupId,username,configured).first();
  }catch{return null}
}

async function sendRaid(chatId,env,chatUsername){
  const raid=await activeRaid(env,chatId,chatUsername);
  const lines=[
    "⚔️ RUGCIRCUS LIVE RAID",
    "",
    raid?.ticker ? "🪙 $"+raid.ticker+(raid.name?" · "+raid.name:"") : "🪙 Community Raid",
    raid?.package ? "📦 "+raid.package : "📦 Community Raid",
    raid?.raid_copy ? "\n📣 "+raid.raid_copy : "",
    "",
    "⚡ COMPLETE THE ACTIONS TO EARN YOUR POINTS",
    "❤️ LIKE • 💬 COMMENT • 🔁 REPOST",
    "",
    "🔥 Join the raid and open the Command Center."
  ];
  const appUrl=APP_URL;
  const buttons=[];
  if(raid?.x_url) buttons.push([{text:"𝕏 X RAID",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=x"}]);
  if(raid?.tiktok_url) buttons.push([{text:"🎵 TIKTOK RAID",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=tiktok"}]);
  if(raid?.telegram_url) buttons.push([{text:"✈️ TELEGRAM RAID",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=telegram"}]);
  if(raid?.pump_callout_url) buttons.push([{text:"🎯 PUMP CALLOUT",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=callout"}]);
  if(raid?.mint_address) buttons.push([{text:"🪙 OPEN PUMP.FUN",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=pump"}]);
  buttons.push([{text:"🟢 PUMP.FUN MOVERS",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=movers"}]);
  buttons.push([{text:"📈 DEXSCREENER",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=dexscreener"}]);
  buttons.push([{text:"🦅 BIRDEYE",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=birdeye"}]);
  buttons.push([{text:"🪐 JUPITER",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=jupiter"}]);
  buttons.push([{text:"⚡ RAYDIUM",url:appUrl+"/api/raid/click?campaign="+raid.id+"&platform=raydium"}]);
  buttons.push([{text:"🤖 AI HUB PRO NEWS",url:"https://t.me/Aihubpronewsbot"}]);
  buttons.push([{text:"🚀 OPEN COMMAND CENTER",web_app:{url:appUrl+"/"}}]);
  const caption=lines.join("\n");
  if(raid?.logo_url){
    const image=await prepareTelegramImage(raid.logo_url);
    if(image){
      const form=new FormData();
      form.set("chat_id",chatId);
      form.set("photo",image,"raid-preview.jpg");
      form.set("caption",caption);
      form.set("reply_markup",JSON.stringify({inline_keyboard:buttons}));
      const response=await fetch(API+env.TELEGRAM_BOT_TOKEN+"/sendPhoto",{method:"POST",body:form});
      const data=await response.json().catch(()=>null);
      return {ok:response.ok&&data?.ok===true,data};
    }
  }
  return tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:caption,reply_markup:{inline_keyboard:buttons}});
}

function parseDuration(value){
  const match=String(value||"").trim().match(/^(\d{1,4})(m|h|d)?$/i);
  if(!match) return null;
  const amount=Number(match[1]);
  const unit=(match[2]||"m").toLowerCase();
  const minutes=unit==="d"?amount*1440:unit==="h"?amount*60:amount;
  if(!Number.isInteger(minutes)||minutes<1||minutes>40320) return null;
  return minutes*60;
}

async function memberTarget(message,env){
  if(message.reply_to_message?.from?.id) return message.reply_to_message.from;
  const raw=commandArgs(message.text||"");
  const first=raw.split(/\s+/)[0]||"";
  if(/^\d+$/.test(first)){
    const result=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:message.chat.id,user_id:first});
    if(result.ok) return result.data.result.user;
  }
  return null;
}

async function sendAdminError(chatId,env,text){
  await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text});
}

async function sendAdsgramAd(chatId,telegramId,env,messageFromUsername=""){
  if(!env.ADSGRAM_TOKEN||!env.PUBLIC_ADSGRAM_BLOCK_ID){
    await sendAdminError(chatId,env,"🎬 Ads are not configured yet.");
    return;
  }
  if(!env.DB){
    await sendAdminError(chatId,env,"🎬 Reward Wall is temporarily unavailable.");
    return;
  }

  const prepared=await prepareBotReward(env.DB,telegramId,String(messageFromUsername||""));
  if(!prepared.ok){
    if(prepared.status===429){
      const minutes=Math.max(1,Math.ceil(Number(prepared.remainingSeconds||1800)/60));
      await sendAdminError(chatId,env,"⏳ Your next ad reward is available in about "+minutes+" minute"+(minutes===1?"":"s")+"." );
    }else{
      await sendAdminError(chatId,env,"🎬 "+(prepared.error||"Join the Reward Wall first in the Command Center."));
    }
    return;
  }

  const blockId=String(env.PUBLIC_ADSGRAM_BLOCK_ID).replace(/^bot-/i,"").trim();
  const url="https://api.adsgram.ai/advbot?tgid="+encodeURIComponent(String(telegramId))+"&blockid="+encodeURIComponent(blockId)+"&language=en&token="+encodeURIComponent(String(env.ADSGRAM_TOKEN));
  let response;
  try{
    response=await fetch(url,{method:"GET",headers:{accept:"application/json"}});
  }catch(e){
    console.error("ADSGRAM REQUEST",e);
    await sendAdminError(chatId,env,"🎬 Could not load an ad right now. Please try again later.");
    return;
  }
  const ad=await response.json().catch(()=>null);
  if(!response.ok||!ad?.click_url||!ad?.reward_url){
    console.error("ADSGRAM RESPONSE",response.status,ad);
    await sendAdminError(chatId,env,"🎬 No ad is available right now. Please try again later.");
    return;
  }

  const keyboard={inline_keyboard:[
    [{text:String(ad.button_name||"OPEN AD"),url:ad.click_url}],
    [{text:String(ad.button_reward_name||("🎁 CLAIM +"+Number(prepared.points||3)+" POINTS")),url:ad.reward_url}]
  ]};
  const caption=String(ad.text_html||"🎬 Sponsored ad\n\nOpen the ad, complete the visit, then return here and claim your +"+Number(prepared.points||3)+" points.");

  if(ad.image_url){
    const result=await tgCall("sendPhoto",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      photo:ad.image_url,
      caption:caption.slice(0,1024),
      parse_mode:"HTML",
      reply_markup:keyboard,
      protect_content:true
    });
    if(!result.ok)console.error("ADSGRAM SEND PHOTO",result.data);
    return;
  }

  const result=await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
    chat_id:chatId,
    text:caption.slice(0,4096),
    parse_mode:"HTML",
    reply_markup:keyboard,
    protect_content:true
  });
  if(!result.ok)console.error("ADSGRAM SEND MESSAGE",result.data);
}

async function handleCommand(message,env){
  const chatId=message.chat.id;
  const userId=message.from?.id;
  const text=message.text||"";
  const cmd=commandOf(text);
  const args=commandArgs(text);
  const appUrl=APP_URL;
  const group=message.chat.type==="group"||message.chat.type==="supergroup";
  const adminCommands=new Set(["/panel","/announce","/pin","/unpin","/clean","/ban","/unban","/mute","/unmute"]);

  if(adminCommands.has(cmd)&&group){
    if(!(await requireAdmin(chatId,userId,env.TELEGRAM_BOT_TOKEN))){
      await sendAdminError(chatId,env,"🛡️ Admins only.");
      return;
    }
  }

  if(cmd==="/start"){
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🎪 RUGCIRCUS COMMAND\n\n⚔️ RAID • 🪙 $RUGCX • 📣 CAMPAIGNS • 🛡️ COMMUNITY CONTROL\n\nUse /panel for admin tools or /raid for the active raid.",
      reply_markup:{inline_keyboard:[
        [{text:"🚀 Open App",web_app:{url:appUrl+"/"}}],
        [{text:"⚔️ Live Raid",callback_data:"raid"},{text:"🪙 $RUGCX",callback_data:"token"}]
      ]}
    });
    return;
  }

  if(cmd==="/help"){
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🎪 RUGCIRCUS COMMAND\n\n/start — Open Command Center\n/help — Show commands\n/raid — Active raid\n/ad — Watch a sponsored ad\n/token — $RUGCX\n/status — Bot status\n/group — Group status\n/id — Show chat/user IDs\n\n🛡️ Admins:\n/panel — Admin panel\n/announce <text> — Announcement\n/pin — Pin replied message\n/unpin — Remove pin\n/clean — Delete replied message\n/ban — Ban replied user\n/unban <user id> — Unban user\n/mute [10m|1h] — Mute replied user\n/unmute — Unmute replied user"
    });
    return;
  }

  if(cmd==="/panel"){await sendPanel(chatId,env.TELEGRAM_BOT_TOKEN,appUrl);return;}
  if(cmd==="/raid"){await sendRaid(chatId,env,message.chat?.username);return;}
  if(cmd==="/ad"){await sendAdsgramAd(chatId,userId,env,message.from?.username||"");return;}

  if(cmd==="/token"){
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🎪 $RUGCX · RUGCIRCUS\n\n🪙 Official Pump.fun token page:",
      reply_markup:{inline_keyboard:[
        [{text:"🔥 Open $RUGCX on Pump.fun",url:"https://pump.fun/coin/3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump"}],
        [{text:"🚀 Open App",web_app:{url:appUrl+"/"}}]
      ]}
    });
    return;
  }

  if(cmd==="/announce"){
    if(!group){await sendAdminError(chatId,env,"📣 Use /announce inside a Telegram group.");return;}
    if(!args){await sendAdminError(chatId,env,"📣 Usage: /announce Your announcement text");return;}
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"📣 RUGCIRCUS ANNOUNCEMENT\n\n🎪 "+args+"\n\n━━━━━━━━━━━━━━━━━━\n🔥 Stay active. Stay loud. Stay RUGCIRCUS.\n━━━━━━━━━━━━━━━━━━",
      reply_markup:{inline_keyboard:[
        [{text:"🚀 OPEN COMMAND CENTER",web_app:{url:APP_URL+"/"}}],
        [{text:"🪙 $RUGCX",url:"https://pump.fun/coin/3wLrSM5gkSSSQGoivnnnN32Xh6ffjDwFeJFMqnNnSpump"}]
      ]}
    });
    return;
  }

  if(cmd==="/pin"){
    if(!group){await sendAdminError(chatId,env,"📌 Use /pin in a group by replying to the message you want to pin.");return;}
    const target=message.reply_to_message?.message_id;
    if(!target){await sendAdminError(chatId,env,"📌 Reply to a message with /pin.");return;}
    const result=await tgCall("pinChatMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,message_id:target,disable_notification:false});
    await sendAdminError(chatId,env,result.ok?"📌 Message pinned.":"❌ Could not pin that message. Check Pin Messages permission.");
    return;
  }

  if(cmd==="/unpin"){
    if(!group){await sendAdminError(chatId,env,"📌 Use /unpin inside a group.");return;}
    const result=await tgCall("unpinChatMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId});
    await sendAdminError(chatId,env,result.ok?"📌 Pinned message removed.":"❌ Could not remove the pin.");
    return;
  }

  if(cmd==="/clean"){
    if(!group){await sendAdminError(chatId,env,"🧹 Use /clean in a group by replying to the message you want to delete.");return;}
    const target=message.reply_to_message?.message_id;
    if(!target){await sendAdminError(chatId,env,"🧹 Reply to a message with /clean to delete it.");return;}
    const result=await tgCall("deleteMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,message_id:target});
    await sendAdminError(chatId,env,result.ok?"🧹 Message deleted.":"❌ Could not delete that message. Check Delete Messages permission.");
    return;
  }

  if(cmd==="/ban"){
    if(!group){await sendAdminError(chatId,env,"🔨 Use /ban in a group by replying to the member's message.");return;}
    const target=await memberTarget(message,env);
    if(!target){await sendAdminError(chatId,env,"🔨 Reply to the member's message with /ban.");return;}
    if(target.id===userId){await sendAdminError(chatId,env,"🛡️ You cannot ban yourself.");return;}
    const targetMember=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:target.id});
    if(targetMember.ok&&isAdmin(targetMember.data?.result)){await sendAdminError(chatId,env,"🛡️ I won't ban another administrator.");return;}
    const result=await tgCall("banChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:target.id,revoke_messages:true});
    await sendAdminError(chatId,env,result.ok?"🔨 Member banned.":"❌ Could not ban that member. Check Ban Users permission.");
    return;
  }

  if(cmd==="/unban"){
    if(!group){await sendAdminError(chatId,env,"🔓 Use /unban in a group.");return;}
    const raw=args.split(/\s+/)[0]||"";
    if(!/^\d+$/.test(raw)){await sendAdminError(chatId,env,"🔓 Usage: /unban <numeric user id>");return;}
    const result=await tgCall("unbanChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:Number(raw),only_if_banned:true});
    await sendAdminError(chatId,env,result.ok?"🔓 User unbanned.":"❌ Could not unban that user.");
    return;
  }

  if(cmd==="/mute"){
    if(!group){await sendAdminError(chatId,env,"🔇 Use /mute in a group by replying to the member's message.");return;}
    const target=await memberTarget(message,env);
    if(!target){await sendAdminError(chatId,env,"🔇 Reply to the member's message with /mute [10m|1h|1d].");return;}
    if(target.id===userId){await sendAdminError(chatId,env,"🛡️ You cannot mute yourself.");return;}
    const targetMember=await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:target.id});
    if(targetMember.ok&&isAdmin(targetMember.data?.result)){await sendAdminError(chatId,env,"🛡️ I won't mute another administrator.");return;}
    const seconds=parseDuration(args)||3600;
    const until=Math.floor(Date.now()/1000)+seconds;
    const result=await tgCall("restrictChatMember",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,user_id:target.id,until_date:until,
      use_independent_chat_permissions:true,
      permissions:{can_send_messages:false,can_send_audios:false,can_send_documents:false,can_send_photos:false,can_send_videos:false,can_send_video_notes:false,can_send_voice_notes:false,can_send_polls:false,can_send_other_messages:false,can_add_web_page_previews:false}
    });
    await sendAdminError(chatId,env,result.ok?"🔇 Member muted for "+Math.round(seconds/60)+" minutes.":"❌ Could not mute that member. Check Restrict Members permission.");
    return;
  }

  if(cmd==="/unmute"){
    if(!group){await sendAdminError(chatId,env,"🔊 Use /unmute in a group by replying to the member's message.");return;}
    const target=await memberTarget(message,env);
    if(!target){await sendAdminError(chatId,env,"🔊 Reply to the member's message with /unmute.");return;}
    const result=await tgCall("restrictChatMember",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,user_id:target.id,
      permissions:{can_send_messages:true,can_send_audios:true,can_send_documents:true,can_send_photos:true,can_send_videos:true,can_send_video_notes:true,can_send_voice_notes:true,can_send_polls:true,can_send_other_messages:true,can_add_web_page_previews:true}
    });
    await sendAdminError(chatId,env,result.ok?"🔊 Member unmuted.":"❌ Could not unmute that member.");
    return;
  }

  if(cmd==="/group"){
    if(!group){await sendAdminError(chatId,env,"💬 This command is for a Telegram group.");return;}
    const [chatResult,countResult,meResult]=await Promise.all([
      tgCall("getChat",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId}),
      tgCall("getChatMemberCount",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId}),
      tgCall("getMe",env.TELEGRAM_BOT_TOKEN,{})
    ]);
    const chat=chatResult.data?.result;
    const botId=meResult.data?.result?.id;
    const botMember=botId?await tgCall("getChatMember",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,user_id:botId}):null;
    const botStatus=botMember?.ok?botMember.data?.result?.status:"unknown";
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"💬 GROUP STATUS\n\n🎪 "+(chat?.title||"RUGCIRCUS Community")+"\n👥 Members: "+(countResult.data?.result??"—")+"\n🛡️ Bot status: "+botStatus+"\n\nUse /panel for admin tools."
    });
    return;
  }

  if(cmd==="/id"){
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{
      chat_id:chatId,
      text:"🆔 IDs\n\nChat ID: "+chatId+"\nYour User ID: "+(userId??"—")+(message.reply_to_message?.from?.id?"\nReplied User ID: "+message.reply_to_message.from.id:"")
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
  }
}

async function handleCallback(query,env){
  const chatId=query.message?.chat?.id;
  if(!chatId) return;
  await tgCall("answerCallbackQuery",env.TELEGRAM_BOT_TOKEN,{callback_query_id:query.id});
  const action=query.data;
  const group=query.message.chat.type==="group"||query.message.chat.type==="supergroup";
  if(["announce_help","clean_help","pin_help","group"].includes(action)&&group){
    const allowed=await requireAdmin(chatId,query.from?.id,env.TELEGRAM_BOT_TOKEN);
    if(!allowed){
      await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🛡️ Admins only."});
      return;
    }
  }
  if(action==="raid") await sendRaid(chatId,env,query.message?.chat?.username);
  else if(action==="token") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🪙 $RUGCX",reply_markup:{inline_keyboard:[[{text:"🔥 Pump.fun",url:"https://pump.fun/coin/3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump"}]]}});
  else if(action==="group"){
    const count=await tgCall("getChatMemberCount",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId});
    await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"💬 Group members: "+(count.data?.result??"—")});
  } else if(action==="announce_help") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📣 Admin usage: /announce Your announcement text"});
  else if(action==="clean_help") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"🧹 Reply to a message with /clean to delete it.\n\nModeration: /ban, /unban, /mute, /unmute"});
  else if(action==="pin_help") await tgCall("sendMessage",env.TELEGRAM_BOT_TOKEN,{chat_id:chatId,text:"📌 Reply to a message with /pin to pin it, or use /unpin to remove the current pin."});
}

async function recordBotGroupReward(update,env){
  if(!env.DB||!update?.my_chat_member)return;
  const change=update.my_chat_member;
  const chat=change.chat;
  const actor=change.from;
  const next=change.new_chat_member;
  const group=chat?.type==="group"||chat?.type==="supergroup";
  if(!group||!actor?.id||!next)return;
  const status=String(next.status||"");
  if(!["member","administrator"].includes(status))return;
  try{
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS reward_task_claims (id INTEGER PRIMARY KEY AUTOINCREMENT,member_id INTEGER NOT NULL,telegram_id TEXT NOT NULL,task TEXT NOT NULL,points INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(member_id,task))").run();
    const member=await env.DB.prepare("SELECT id FROM leaderboard_members WHERE telegram_id=?").bind(String(actor.id)).first();
    if(!member)return;
    const existing=await env.DB.prepare("SELECT id FROM reward_task_claims WHERE member_id=? AND task='bot_group' LIMIT 1").bind(member.id).first();
    if(existing)return;
    await env.DB.prepare("INSERT INTO reward_task_claims (member_id,telegram_id,task,points) VALUES (?,?,?,3)").bind(member.id,String(actor.id),"bot_group").run();
    await env.DB.prepare("UPDATE leaderboard_members SET points=points+3 WHERE id=?").bind(member.id).run();
  }catch(error){console.error("BOT GROUP REWARD ERROR",error)}
}

export async function onRequestPost({request,env}){
  try{
    if(!env.TELEGRAM_BOT_TOKEN){
      console.error("TELEGRAM WEBHOOK ERROR: TELEGRAM_BOT_TOKEN is missing");
      return new Response("Telegram not configured",{status:503});
    }

    if(env.TELEGRAM_WEBHOOK_SECRET){
      const supplied=request.headers.get("X-Telegram-Bot-Api-Secret-Token");
      if(supplied!==env.TELEGRAM_WEBHOOK_SECRET) return new Response("Unauthorized",{status:401});
    }

    let update;
    try{
      update=await request.json();
    }catch{
      return new Response("Bad request",{status:400});
    }

    if(update.callback_query) await handleCallback(update.callback_query,env);
    else if(update.my_chat_member) await recordBotGroupReward(update,env);
    else if(update.message?.text) await handleCommand(update.message,env);

    return new Response("ok");
  }catch(error){
    console.error("TELEGRAM WEBHOOK ERROR",error);
    return new Response("ok");
  }
}