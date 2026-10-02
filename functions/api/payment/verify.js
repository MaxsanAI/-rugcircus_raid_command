function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json"}})}
export async function onRequestPost({request,env}) {
  if(!env.SOLANA_RPC_URL||!env.PUBLIC_TREASURY_WALLET) return json({ok:false,error:"Payment verification is not configured"},503);
  let body;
  try{body=await request.json()}catch{return json({ok:false,error:"Invalid JSON"},400)}
  const signature=String(body.signature||"").trim();
  const expectedLamports=Number(body.expectedLamports);
  if(!signature||!Number.isSafeInteger(expectedLamports)||expectedLamports<=0) return json({ok:false,error:"signature and expectedLamports are required"},400);
  try{
    const rpc=await fetch(env.SOLANA_RPC_URL,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"getTransaction",params:[signature,{encoding:"jsonParsed",commitment:"confirmed",maxSupportedTransactionVersion:0}]})});
    const data=await rpc.json();
    const tx=data.result;
    if(!tx) return json({ok:false,error:"Transaction not found or not confirmed"},400);
    if(tx.meta?.err) return json({ok:false,error:"Transaction failed on Solana"},400);
    const keys=tx.transaction?.message?.accountKeys||[];
    const index=keys.findIndex(k=>(k.pubkey||k)===env.PUBLIC_TREASURY_WALLET);
    if(index<0) return json({ok:false,error:"Treasury wallet was not part of transaction"},400);
    const before=Number(tx.meta?.preBalances?.[index]??-1);
    const after=Number(tx.meta?.postBalances?.[index]??-1);
    const received=after-before;
    if(received<expectedLamports) return json({ok:false,error:"Treasury received less than required amount",receivedLamports:received},400);
    return json({ok:true,signature,receivedLamports:received,verifiedAt:new Date().toISOString()});
  }catch(error){return json({ok:false,error:"RPC verification failed"},502)}
}