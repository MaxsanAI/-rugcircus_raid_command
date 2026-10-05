(function(){
const key="rugcircus_wallet";
const cryptoKey="rugcircus_phantom_deeplink_keypair";
const callbackMarker="phantom_";
const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function b58Encode(value){
  const a=value instanceof Uint8Array?value:new Uint8Array(value||[]);
  const d=[0];
  for(const x of a){
    let c=x;
    for(let i=0;i<d.length;i++){
      const n=d[i]*256+c;
      d[i]=n%58;
      c=Math.floor(n/58);
    }
    while(c){d.push(c%58);c=Math.floor(c/58)}
  }
  let s="";
  for(let i=0;i<a.length&&a[i]===0;i++)s+="1";
  for(let i=d.length-1;i>=0;i--)s+=alphabet[d[i]];
  return s;
}
function b58Decode(value){
  const bytes=[0];
  for(const ch of String(value||"")){
    const digit=alphabet.indexOf(ch);
    if(digit<0)throw new Error("Invalid base58 value");
    let carry=digit;
    for(let i=0;i<bytes.length;i++){
      const n=bytes[i]*58+carry;
      bytes[i]=n&255;
      carry=n>>8;
    }
    while(carry){bytes.push(carry&255);carry>>=8}
  }
  let zeros=0;
  for(const ch of String(value||"")){if(ch==="1")zeros++;else break}
  const out=new Uint8Array(zeros+bytes.length-(bytes.length&&bytes[bytes.length-1]===0?1:0));
  for(let i=0;i<bytes.length;i++)out[out.length-1-i]=bytes[i];
  return out;
}
function provider(){return window.phantom?.solana||window.solana||null}
function tg(){return window.Telegram?.WebApp||null}
function mobile(){return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)}
function ui(s,on){
  const b=document.getElementById("walletHint");
  if(b){b.textContent=s;b.classList.toggle("authenticated",!!on)}
}
async function session(){
  try{
    const r=await fetch("/api/auth/phantom/session",{cache:"no-store",credentials:"same-origin"});
    const d=await r.json();
    if(d.authenticated&&d.walletAddress){
      localStorage.setItem(key,d.walletAddress);
      ui("PHANTOM LOGIN · "+d.walletAddress.slice(0,4)+"…"+d.walletAddress.slice(-4),true);
      return d.walletAddress;
    }
  }catch{}
  return "";
}
function saveKeypair(kp){
  localStorage.setItem(cryptoKey,JSON.stringify({
    publicKey:b58Encode(kp.publicKey),
    secretKey:Array.from(kp.secretKey)
  }));
}
function loadKeypair(){
  try{
    const x=JSON.parse(localStorage.getItem(cryptoKey)||"");
    if(!x?.publicKey||!Array.isArray(x.secretKey))return null;
    return {publicKey:b58Decode(x.publicKey),secretKey:new Uint8Array(x.secretKey)};
  }catch{return null}
}
function callbackUrl(){
  return location.origin+"/api/auth/phantom/deeplink/callback";
}
function callbackStartParam(){
  const t=tg();
  const fromTg=t?.initDataUnsafe?.start_param||"";
  if(fromTg)return String(fromTg);
  return new URL(location.href).searchParams.get("tgWebAppStartParam")||"";
}
async function claimCallback(){
  const start=callbackStartParam();
  if(!start.startsWith(callbackMarker))return null;
  const id=start.slice(callbackMarker.length);
  const r=await fetch("/api/auth/phantom/deeplink/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id}),credentials:"same-origin"});
  const d=await r.json();
  if(!r.ok||!d.ok)throw Error(d.error||"Phantom callback expired");
  return d.payload;
}
function decrypt(payload,kp,phantomPublicKey){
  const shared=nacl.box.before(phantomPublicKey,kp.secretKey);
  const plain=nacl.box.open(b58Decode(payload.data),b58Decode(payload.nonce),shared);
  if(!plain)throw Error("Could not decrypt Phantom response");
  return {data:JSON.parse(new TextDecoder().decode(plain)),shared};
}
async function beginMobileConnect(){
  if(!window.nacl){
    alert("Secure Phantom connection is still loading. Please try again.");
    return;
  }
  try{
    ui("PHANTOM · OPENING…",false);
    const kp=nacl.box.keyPair();
    saveKeypair(kp);
    const params=new URLSearchParams({
      app_url:location.origin+"/",
      dapp_encryption_public_key:b58Encode(kp.publicKey),
      redirect_link:callbackUrl(),
      cluster:"mainnet-beta"
    });
    window.location.href="https://phantom.app/ul/v1/connect?"+params.toString();
  }catch(e){
    ui("PHANTOM LOGIN",false);
    alert(e.message||"Could not open Phantom");
  }
}
async function beginMobileSign(sessionToken,message,sharedSecret){
  const nonce=nacl.randomBytes(24);
  const payload={
    message:b58Encode(new TextEncoder().encode(message)),
    session:sessionToken,
    display:"utf8"
  };
  const encrypted=nacl.box.after(new TextEncoder().encode(JSON.stringify(payload)),nonce,sharedSecret);
  const params=new URLSearchParams({
    dapp_encryption_public_key:b58Encode(loadKeypair().publicKey),
    nonce:b58Encode(nonce),
    redirect_link:callbackUrl(),
    payload:b58Encode(encrypted)
  });
  window.location.href="https://phantom.app/ul/v1/signMessage?"+params.toString();
}
async function completeMobileCallback(){
  const payload=await claimCallback();
  if(!payload)return false;
  if(payload.errorCode)throw Error(payload.errorMessage||"Phantom request was rejected");
  const kp=loadKeypair();
  if(!kp)throw Error("Phantom connection state is missing. Please reconnect.");
  const phantomPublicKey=b58Decode(payload.phantom_encryption_public_key||"");
  if(phantomPublicKey.length!==32)throw Error("Invalid Phantom encryption key");
  const decrypted=decrypt(payload,kp,phantomPublicKey);
  if(decrypted.data?.public_key&&decrypted.data?.session){
    const wallet=String(decrypted.data.public_key);
    localStorage.setItem(key,wallet);
    sessionStorage.setItem("rugcircus_phantom_session",String(decrypted.data.session));
    sessionStorage.setItem("rugcircus_phantom_public_key",wallet);
    sessionStorage.setItem("rugcircus_phantom_shared_secret",b58Encode(decrypted.shared));
    const n=await fetch("/api/auth/phantom/nonce",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet}),credentials:"same-origin"});
    const c=await n.json();
    if(!n.ok||!c.ok)throw Error(c.error||"Could not start secure wallet login");
    await beginMobileSign(String(decrypted.data.session),c.message,decrypted.shared);
    return true;
  }
  const sessionToken=sessionStorage.getItem("rugcircus_phantom_session")||"";
  const wallet=sessionStorage.getItem("rugcircus_phantom_public_key")||localStorage.getItem(key)||"";
  const shared=new Uint8Array(b58Decode(sessionStorage.getItem("rugcircus_phantom_shared_secret")||""));
  if(!sessionToken||!wallet||shared.length!==32)throw Error("Phantom session is incomplete");
  const signature=String(decrypted.data?.signature||"");
  if(!signature)throw Error("Phantom did not return a signature");
  const message=String(sessionStorage.getItem("rugcircus_phantom_login_message")||"");
  if(!message)throw Error("Login message is missing");
  const v=await fetch("/api/auth/phantom/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet,challengeId:sessionStorage.getItem("rugcircus_phantom_challenge")||"",signature}),credentials:"same-origin"});
  const d=await v.json();
  if(!v.ok||!d.ok)throw Error(d.error||"Wallet login verification failed");
  localStorage.setItem(key,wallet);
  sessionStorage.removeItem("rugcircus_phantom_login_message");
  sessionStorage.removeItem("rugcircus_phantom_challenge");
  ui("PHANTOM LOGIN · "+wallet.slice(0,4)+"…"+wallet.slice(-4),true);
  window.dispatchEvent(new CustomEvent("rugcircus:phantom-login",{detail:{wallet}}));
  return true;
}
async function loginDesktop(){
  const x=provider();
  if(!x){
    if(mobile()){await beginMobileConnect();return}
    ui("PHANTOM LOGIN",false);
    alert("Install the Phantom desktop extension to connect your wallet.");
    return;
  }
  try{
    ui("PHANTOM · CONNECTING…",false);
    const r=await x.connect();
    const w=String((r.publicKey||x.publicKey).toString());
    const n=await fetch("/api/auth/phantom/nonce",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:w}),credentials:"same-origin"});
    const c=await n.json();
    if(!n.ok||!c.ok)throw Error(c.error||"Could not start wallet login");
    const signed=await x.signMessage(new TextEncoder().encode(c.message),"utf8");
    const sig=b58Encode(signed?.signature||signed);
    const v=await fetch("/api/auth/phantom/verify",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({wallet:w,challengeId:c.challengeId,signature:sig}),credentials:"same-origin"});
    const d=await v.json();
    if(!v.ok||!d.ok)throw Error(d.error||"Wallet login failed");
    localStorage.setItem(key,w);
    ui("PHANTOM LOGIN · "+w.slice(0,4)+"…"+w.slice(-4),true);
    window.dispatchEvent(new CustomEvent("rugcircus:phantom-login",{detail:{wallet:w}}));
  }catch(e){
    ui("PHANTOM LOGIN",false);
    alert(e.message||"Phantom login failed");
  }
}
async function boot(){
  const b=document.getElementById("walletHint");
  if(b)b.addEventListener("click",async()=>{if(!(await session()))await loginDesktop()});
  try{
    if(tg()&&callbackStartParam().startsWith(callbackMarker)){
      ui("PHANTOM · CONFIRMING…",false);
      await completeMobileCallback();
    }else{
      await session();
    }
  }catch(e){
    console.error("Phantom deeplink login failed",e);
    ui("PHANTOM LOGIN",false);
    alert(e.message||"Phantom connection failed");
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",boot,{once:true});else boot();
})();