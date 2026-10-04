import {prepareTelegramImage} from "./image.js";

function normalizeTelegramGroup(value){
  const raw=String(value||"").trim();
  if(!raw)return "";
  if(/^-100\d+$/.test(raw)||/^-\d+$/.test(raw))return raw;
  const match=raw.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{5,})/i);
  if(match)return "@"+match[1];
  return raw.startsWith("@")?raw:"@"+raw;
}

export async function publishRaidCard(env,campaignId,targetGroup,ticker,name,packageName,endsAt,xUrl,tiktokUrl,telegramUrl,pumpCalloutUrl,raidCopy,imageUrl,mintAddress){
  if(!env.TELEGRAM_BOT_TOKEN)return {ok:false,error:"TELEGRAM_BOT_TOKEN is not configured"};
  const chatId=normalizeTelegramGroup(targetGroup)||env.TELEGRAM_RAID_CHAT_ID||"@rugcxx";
  const pumpUrl=mintAddress?"https://pump.fun/coin/"+mintAddress:"https://pump.fun/coin/3wLrSM5gkSSSQGoivnnN32Xh6ffjDwFeJFMqnNnSpump";
  const lines=["🎪 RUGCIRCUS RAID IS LIVE","","🪙 $"+(ticker||"RUGCX")+(name?" · "+name:""),"📦 "+packageName,"⏳ Ends: "+endsAt];
  if(raidCopy)lines.push("","📣 "+raidCopy);
  lines.push("","⚔️ Join the raid and hit the links below.");
  const buttons=[];
  if(xUrl)buttons.push([{text:"𝕏 X RAID",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=x"}]);
  if(tiktokUrl)buttons.push([{text:"🎵 TIKTOK RAID",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=tiktok"}]);
  if(telegramUrl)buttons.push([{text:"✈️ TELEGRAM RAID",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=telegram"}]);
  if(pumpCalloutUrl)buttons.push([{text:"🎯 PUMP CALLOUT",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=callout"}]);
  buttons.push([
    {text:"🪙 OPEN PUMP.FUN",url:pumpUrl},
    {text:"🟢 PUMP.FUN MOVERS",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=movers"}
  ]);
  buttons.push([
    {text:"📈 DEXSCREENER",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=dexscreener"},
    {text:"🦅 BIRDEYE",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=birdeye"}
  ]);
  buttons.push([
    {text:"🪐 JUPITER",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=jupiter"},
    {text:"⚡ RAYDIUM",url:"https://raidrugcircus.pulserapp.com/api/raid/click?campaign="+campaignId+"&platform=raydium"}
  ]);
  buttons.push([
    {text:"🤖 AI HUB PRO NEWS",url:"https://t.me/Aihubpronewsbot"},
    {text:"🚀 OPEN COMMAND CENTER",url:"https://raidrugcircus.pulserapp.com/"}
  ]);
  const caption=lines.join("\n");
  let response;
  if(imageUrl){
    const image=await prepareTelegramImage(imageUrl);
    if(image){
      const form=new FormData();
      form.set("chat_id",chatId);
      form.set("photo",image,"raid-preview.jpg");
      form.set("caption",caption);
      form.set("reply_markup",JSON.stringify({inline_keyboard:buttons}));
      response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendPhoto",{method:"POST",body:form});
    }else{
      response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendPhoto",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,photo:imageUrl,caption,reply_markup:{inline_keyboard:buttons}})});
    }
  }else{
    response=await fetch("https://api.telegram.org/bot"+env.TELEGRAM_BOT_TOKEN+"/sendMessage",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({chat_id:chatId,text:caption,reply_markup:{inline_keyboard:buttons},disable_web_page_preview:true})});
  }
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data?.ok)return {ok:false,error:data?.description||"Telegram could not publish the raid card",chatId};
  return {ok:true,chatId,messageId:data.result?.message_id||null};
}
