const SESSION_COOKIE="rugcircus_phantom_session";
const SESSION_TTL=60*60*24*30;
const CHALLENGE_TTL=10*60;
const WALLET_RE=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function b64url(bytes){
  let s="";
  for(const b of bytes)s+=String.fromCharCode(b);
  return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
}
function fromB64url(value){
  const s=String(value||"").replace(/-/g,"+").replace(/_/g,"/");
  const padded=s+"=".repeat((4-s.length%4)%4);
  const raw=atob(padded);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
async function sha256Hex(value){
  const data=typeof value==="string"?new TextEncoder().encode(value):value;
  const digest=await crypto.subtle.digest("SHA-256",data);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("");
}
function randomToken(){
  const bytes=new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return b64url(bytes);
}
function base58Decode(value){
  const alphabet="123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes=[0];
  for(const char of String(value||"")){
    const digit=alphabet.indexOf(char);
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
  for(const char of String(value||"")){if(char==="1")zeros++;else break}
  const out=new Uint8Array(zeros+bytes.length-(bytes.length&&bytes[bytes.length-1]===0?1:0));
  for(let i=0;i<bytes.length;i++)out[out.length-1-i]=bytes[i];
  return out;
}
async function verifyEd25519(wallet,message,signature){
  const publicBytes=base58Decode(wallet);
  const signatureBytes=base58Decode(signature);
  if(publicBytes.length!==32||signatureBytes.length!==64)return false;
  const key=await crypto.subtle.importKey("raw",publicBytes,{name:"Ed25519"},false,["verify"]);
  return crypto.subtle.verify("Ed25519",key,signatureBytes,new TextEncoder().encode(message));
}
function cookieValue(request,name){
  const header=request.headers.get("cookie")||"";
  const part=header.split(";").map(x=>x.trim()).find(x=>x.startsWith(name+"="));
  return part?decodeURIComponent(part.slice(name.length+1)):"";
}
function sessionCookie(token,maxAge=SESSION_TTL){
  return SESSION_COOKIE+"="+encodeURIComponent(token)+"; Path=/; Max-Age="+maxAge+"; HttpOnly; Secure; SameSite=Lax";
}
async function ensureAuthSchema(db){
  await db.prepare("CREATE TABLE IF NOT EXISTS phantom_auth_challenges (id TEXT PRIMARY KEY,wallet_address TEXT NOT NULL,message TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_phantom_auth_challenges_expires ON phantom_auth_challenges(expires_at)").run().catch(()=>{});
  await db.prepare("CREATE TABLE IF NOT EXISTS phantom_auth_sessions (id TEXT PRIMARY KEY,wallet_address TEXT NOT NULL,expires_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_phantom_auth_sessions_wallet ON phantom_auth_sessions(wallet_address)").run().catch(()=>{});
}
export {SESSION_COOKIE,SESSION_TTL,CHALLENGE_TTL,WALLET_RE,b64url,fromB64url,sha256Hex,randomToken,verifyEd25519,cookieValue,sessionCookie,ensureAuthSchema};
