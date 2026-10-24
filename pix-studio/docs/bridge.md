# App Bridge (`window.noqta`)

> Managed by `nqs`. Package: `@noqtaps/app-bridge`.

Like Shopify App Bridge: import it first (or add the script), and use the global `noqta`.

```ts
import '@noqtaps/app-bridge' // web/src/main.ts — creates window.noqta
```

```html
<meta name="noqta-client-id" content="app_…" />  <!-- required, before the bridge -->
```

| Noqta | Shopify App Bridge | Does |
|---|---|---|
| `await noqta.ready` | — | the admin answered; rejects with `NotEmbeddedError` outside the admin |
| `await noqta.idToken()` | `shopify.idToken()` | session token (60 s), reused until shortly before expiry |
| `fetch('/api/…')` | same | same-origin requests get `Authorization: Bearer <session token>` automatically |
| `noqta.config` | `shopify.config` | `{ clientId, storeId, storeUrl, locale: 'ar' \| 'he', dir: 'rtl' }` |
| `noqta.data.selected` | `data.selected` (admin actions) | `[{ id }]` — the products the action was opened for |
| `noqta.data.target` | — | which admin action opened the app |
| `noqta.toast.show(msg, { isError, duration })` | `shopify.toast.show()` | duration 1000–15000 ms |
| `noqta.loading(true \| false)` | `shopify.loading()` | the admin's loading bar |
| `await noqta.confirm({ title, message, confirmLabel, danger })` | — | confirm dialog drawn by the admin → `true`/`false` |
| `noqta.resize('small' \| 'base' \| 'large' \| 'max')` | modal `variant` | dialog size (phones are always full screen) |
| `noqta.products.changed([42])` | — | the admin reloads those products (only ids in `selected`) |
| `await noqta.resourcePicker({ type: 'product', multiple })` | `shopify.resourcePicker()` | the admin's product picker → `[{ id, title, image }]`, `[]` if cancelled |
| `noqta.navigate({ to: 'product', id })` / `({ to: 'products' })` | `open('shopify://admin/…')` | open a page of the admin |
| `noqta.close()` | `close()` | close the dialog |
| `noqta.onContextChange(fn)` | — | the selection changed while the app is open |

## Your app's home page

Every app has its own page under **Apps** in the admin's side menu (like a Shopify app's main page).
It opens `application_url` (path `/`) full size, with `noqta.data.target === 'admin.app.home'` and no
selected products — use `resourcePicker()` to let the merchant choose. See `web/src/App.vue`.

Notes:

- Payloads are copied to plain data, so passing Vue/React state is fine.
- Opened outside the admin (e.g. `http://localhost:3000` in a tab), `noqta.ready` and every call
  reject with `NotEmbeddedError` — show a hint like the starter does.
- The bridge only talks to the Noqta admin (`https://admin.noqta.ps`, or a local admin on
  `http://localhost:<port>`): framed by any other page, it's the same `NotEmbeddedError` and no
  session token leaves your page. A staging admin: `<meta name="noqta-admin-origins" content="https://…">`.
- The admin waits 10 s for your app to connect; after that it shows "This app isn't responding".
