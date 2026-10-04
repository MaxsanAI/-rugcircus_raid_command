export async function resolveRaidImage(imageUrl,xUrl,tiktokUrl){
  const direct=String(imageUrl||"").trim();
  if(/^https?:\/\//i.test(direct))return direct.slice(0,2000);

  const x=String(xUrl||"").trim();
  if(/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\//i.test(x)){
    try{
      const r=await fetch(x,{headers:{"user-agent":"Mozilla/5.0 RUGCIRCUS Raid Preview"}});
      const html=await r.text();
      const match=html.match(/<meta[^>]+(?:property|name)=["'](?:og:image|twitter:image)["'][^>]+content=["']([^"']+)["']/i)||html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image|twitter:image)["']/i);
      if(match?.[1])return match[1].replace(/&amp;/g,"&").slice(0,2000);
    }catch{}
  }

  const tiktok=String(tiktokUrl||"").trim();
  if(/^https?:\/\/(?:www\.)?tiktok\.com\//i.test(tiktok)){
    try{
      const r=await fetch("https://www.tiktok.com/oembed?url="+encodeURIComponent(tiktok),{
        headers:{"user-agent":"Mozilla/5.0 RUGCIRCUS Telegram Preview","accept":"application/json"}
      });
      const data=await r.json().catch(()=>null);
      const thumbnail=String(data?.thumbnail_url||"").trim();
      if(/^https?:\/\//i.test(thumbnail))return thumbnail.slice(0,2000);
    }catch{}
  }

  return null;
}

export async function prepareTelegramImage(imageUrl){
  const url=String(imageUrl||"").trim();
  if(!/^https?:\/\//i.test(url))return null;
  try{
    const response=await fetch(url,{
      cf:{image:{width:800,height:450,fit:"cover",format:"jpeg",quality:82}},
      headers:{"user-agent":"Mozilla/5.0 RUGCIRCUS Telegram Preview"}
    });
    if(!response.ok)return null;
    const blob=await response.blob();
    if(!blob.type||!blob.type.startsWith("image/"))return null;
    return blob;
  }catch(error){
    console.error("TELEGRAM IMAGE RESIZE ERROR",error);
    return null;
  }
}
