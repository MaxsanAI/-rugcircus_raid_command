# RUGCIRCUS COMMAND

Astro MVP for the RUGCIRCUS / $RUGCX social-token command center.

## Included
- Dark/neon command dashboard
- Token directory and campaign UI
- X posts/replies/quotes wall
- TikTok video/photo wall
- Raid controls and leaderboard
- Pump.fun / DexScreener entry points
- SOL promotion packages
- Monetag sponsor placement hook
- D1 schema for users, tokens, campaigns, raids and payments

## Build
pnpm install
pnpm build

Deploy the generated dist/ folder with Cloudflare Pages.

## Production configuration
- PUBLIC_TREASURY_WALLET
- MONETAG_SMARTLINK
- SOLANA_RPC_URL
- X_BEARER_TOKEN
- TIKTOK_ACCESS_TOKEN
- TELEGRAM_BOT_TOKEN

Never put private keys or secret API tokens in browser code. The current payment UI is a safe front-end shell; server-side Solana transaction verification must be connected before accepting real campaign payments.