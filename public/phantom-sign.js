export async function phantomSignMessage(provider,message){
  const bytes=new TextEncoder().encode(message);
  return provider.signMessage(bytes,"utf8");
}
