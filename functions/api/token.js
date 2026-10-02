function json(data, status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"public, max-age=30"}})}
export async function onRequestGet({request}) {
  const url=new URL(request.url);
  const address=url.searchParams.get("address")?.trim();
  if(!address) return json({ok:false,error:"Missing address"},400);
  try{
    const r=await fetch("https://api.dexscreener.com/latest/dex/tokens/"+encodeURIComponent(address),{headers:{accept:"application/json"}});
    if(!r.ok) return json({ok:false,error:"Market provider returned "+r.status},502);
    const data=await r.json();
    const pairs=Array.isArray(data.pairs)?data.pairs:[];
    return json({ok:true,address,pairs:pairs.slice(0,20).map(p=>({
      chainId:p.chainId,dexId:p.dexId,pairAddress:p.pairAddress,
      baseToken:p.baseToken,quoteToken:p.quoteToken,
      priceUsd:p.priceUsd,priceNative:p.priceNative,
      liquidity:p.liquidity,fdv:p.fdv,marketCap:p.marketCap,
      volume24h:p.volume?.h24||0,priceChange24h:p.priceChange?.h24||0,
      url:p.url
    }))});
  }catch(error){return json({ok:false,error:"Market lookup failed"},500)}
}