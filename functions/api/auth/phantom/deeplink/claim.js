import {ensureAuthSchema} from "../_shared.js";

export async function onRequestPost({request,env}){
  if(!env.DB)return Response.json({ok:false,error:"Database unavailable"},{status:503});
  await ensureAuthSchema(env.DB);
  let body;try{body=await request.json()}catch{return Response.json({ok:false,error:"Invalid JSON"},{status:400})}
  const id=String(body?.id||"").trim();
  if(!id)return Response.json({ok:false,error:"Missing callback id"},{status:400});
  const row=await env.DB.prepare("SELECT payload,expires_at FROM phantom_deeplink_callbacks WHERE id=?").bind(id).first();
  if(!row)return Response.json({ok:false,error:"Phantom callback expired or already used"},{status:404});
  if(new Date(row.expires_at).getTime()<Date.now()){
    await env.DB.prepare("DELETE FROM phantom_deeplink_callbacks WHERE id=?").bind(id).run().catch(()=>{});
    return Response.json({ok:false,error:"Phantom callback expired"},{status:410});
  }
  await env.DB.prepare("DELETE FROM phantom_deeplink_callbacks WHERE id=?").bind(id).run();
  let payload;try{payload=JSON.parse(row.payload)}catch{return Response.json({ok:false,error:"Invalid callback data"},{status:500})}
  return Response.json({ok:true,payload});
}