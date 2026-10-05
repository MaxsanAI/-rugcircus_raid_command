export async function onRequestGet({request,env}) {
  const userId = new URL(request.url).searchParams.get("userid");
  if (!env.DB || !userId) return new Response(JSON.stringify({ok:false}), {status:400, headers:{"content-type":"application/json"}});
  return new Response(JSON.stringify({ok:true,awarded:false,reason:"pending"}), {headers:{"content-type":"application/json"}});
}
