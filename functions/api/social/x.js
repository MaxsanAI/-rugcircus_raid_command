function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"public,max-age=30"}})}
export async function onRequestGet({request,env}){
  if(!env.X_BEARER_TOKEN)return json({ok:true,configured:false,posts:[],message:"X API is not configured"});
  const q=new URL(request.url).searchParams.get("q")||"$RUGCX OR RUGCIRCUS";
  const url="https://api.x.com/2/tweets/search/recent?query="+encodeURIComponent(q+" -is:retweet")+"&max_results=10&tweet.fields=created_at,public_metrics,author_id&expansions=author_id&user.fields=username,name,profile_image_url";
  const r=await fetch(url,{headers:{Authorization:"Bearer "+env.X_BEARER_TOKEN}});
  const d=await r.json().catch(()=>null);
  if(!r.ok)return json({ok:false,error:d?.detail||d?.title||"X API request failed"},502);
  const users=Object.fromEntries((d.includes?.users||[]).map(u=>[u.id,u]));
  return json({ok:true,configured:true,posts:(d.data||[]).map(p=>({id:p.id,text:p.text,createdAt:p.created_at,author:users[p.author_id]?.username||"unknown",name:users[p.author_id]?.name||"",avatar:users[p.author_id]?.profile_image_url||"",metrics:p.public_metrics||{},url:"https://x.com/i/web/status/"+p.id}))});
}
