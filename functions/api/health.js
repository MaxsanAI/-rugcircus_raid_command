export async function onRequestGet({ env }) {
  return new Response(JSON.stringify({
    ok: true,
    service: "rugcircus-command",
    d1: Boolean(env.DB),
    treasuryConfigured: Boolean(env.PUBLIC_TREASURY_WALLET),
    monetagConfigured: Boolean(env.MONETAG_SMARTLINK),
    rpcConfigured: Boolean(env.SOLANA_RPC_URL)
  }), { headers: { "content-type": "application/json" } });
}