export async function prepareTelegramImage(imageUrl){
  const url=String(imageUrl||"").trim();
  if(!/^https?:\/\//i.test(url))return null;
  try{
    const response=await fetch(url,{cf:{image:{width:800,height:450,fit:"cover",format:"jpeg",quality:82}},headers:{"user-agent":"Mozilla/5.0 RUGCIRCUS Telegram Preview"}});
    if(!response.ok)return null;
    const blob=await response.blob();
    if(!blob.type||!blob.type.startsWith("image/"))return null;
    return blob;
  }catch(error){
    console.error("TELEGRAM IMAGE RESIZE ERROR",error);
    return null;
  }
}
