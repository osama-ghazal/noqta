# Noqta app

A Noqta app: it runs on your servers and opens inside the Noqta store admin, like a Shopify
embedded app. This starter is a working example — **AI product images**: it opens on a product
(or a selection of products) and replaces their images. The "AI" here just draws a number on the
image (`server/stamp.ts`); replace it with your own.

```bash
npm install
nqs app dev        # your local app on your dev store → its admin → Apps → your app
nqs app deploy     # when ready for real stores (Noqta reviews it)
```

Read **AGENTS.md** first (and give it to your AI assistant). Reference: `docs/api.md`,
`docs/bridge.md`, `docs/shopify-differences.md`.

| Command | |
|---|---|
| `npm run dev` | server + frontend on http://localhost:3000 (what `nqs app dev` runs, behind its tunnel) |
| `npm run build` | build `dist/` (frontend + server) |
| `npm start` | run the build (production) |
| `npm run typecheck` | type-check frontend and server |
