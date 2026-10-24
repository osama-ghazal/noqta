# Upgrading an existing app

`nqs app update` refreshes this file and the other docs, then **checks your code** against the
current starter and lists what's out of date. Your code is never changed for you — apply the
items below (or ask your AI assistant: *"apply docs/upgrading.md to this project"*). Each item
says why it matters.

## bridge — App Bridge 0.2.0 or later

**Why (security):** 0.2.0 only talks to the Noqta admin; older versions answer any page that
frames your app.

```bash
npm install @noqtaps/app-bridge@^0.2.0
```

## frame-ancestors — only the admin may frame your app

**Why (security):** every store lives on `*.noqta.ps`, so allowing `*.noqta.ps` lets any store's
page frame your app and pose as the admin.

```ts
// server/index.ts
const ADMIN_ORIGINS =
  process.env.NOQTA_ADMIN_ORIGINS ||
  ['https://admin.noqta.ps', ...(isDev ? ['http://localhost:*', 'http://127.0.0.1:*'] : [])].join(' ')
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', `frame-ancestors ${ADMIN_ORIGINS}`)
  next()
})
```

## vite-fs — the dev server serves your frontend only

**Why (security):** `nqs app dev` exposes your dev server through a public tunnel; without this,
anyone with the tunnel URL can download `data/store-tokens.json`, `.env` or your server code.
Also lets the tunnel's host through and runs hot reload on the same server (`allowedHosts`, `hmr`).

```ts
// server/index.ts — in start(), development branch
import http from 'node:http'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const server = http.createServer(app)
const tunnel = process.env.NOQTA_TUNNEL_URL ? new URL(process.env.NOQTA_TUNNEL_URL).hostname : null
const vite = await createServer({
  server: {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: ['.trycloudflare.com', ...(tunnel ? [tunnel] : [])],
    fs: {
      strict: true,
      allow: [path.join(root, 'web'), path.join(root, 'node_modules')],
      deny: ['.env', '.env.*', '*.{crt,pem,key}', '**/.git/**', '**/data/**', '**/server/**']
    }
  },
  appType: 'spa'
})
app.use(vite.middlewares)
// …and listen with server.listen(PORT) instead of app.listen(PORT)
```

## token-renew — forget a revoked store token

**Why (it stops working otherwise):** a store's access token is revoked when the app is
reinstalled or its secret rotated. Drop it on a `401` so the next admin visit exchanges a new one.

```ts
// server/noqta.ts
export function forgetToken(storeId: string) {
  const tokens = readTokens()
  if (!(storeId in tokens)) return
  delete tokens[storeId]
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 })
}
// in your API client, after each call:
if (res.status === 401 && this.storeId) forgetToken(this.storeId)
```

## proxy-timestamp — refuse app proxy calls without a valid timestamp

**Why (security):** a missing `timestamp` must not pass the 5-minute freshness check.

```ts
const ts = Number(params.timestamp)
if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > PROXY_MAX_AGE) return null
```

## block-url — call your server through the app proxy, never directly

**Why:** a block that calls `http://localhost:…` or your own domain only works on your machine,
needs CORS, and can't prove which store is calling. Declare `[app_proxy]` and call
`{{ app.proxy_url }}/…` (see docs/storefront.md → app proxy).

## escape — escape every value you print in Liquid

**Why (security):** Liquid doesn't escape for you; a setting or entry containing `"` or `<` can
break out of an attribute.

```liquid
<input placeholder="{{ section.settings.placeholder | escape }}">
<h3>{{ section.settings.title | escape }}</h3>
```
