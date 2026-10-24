# Noqta app — guide for developers and AI assistants

> This file is managed by `nqs` and replaced when nqs is updated. Put notes about this
> particular app in **PROJECT.md** (read it too).

You are building a **Noqta app**: a web app that runs on the developer's own servers and opens
inside the Noqta store admin (Arabic-first, RTL e-commerce platform). **It works like a Shopify
embedded app.** If you know Shopify apps, App Bridge, session tokens and the REST Admin API, you
already know most of this — read `docs/shopify-differences.md` before relying on Shopify knowledge.

## 1. How it fits together

```
Store admin (Noqta)                Your app (this project)              Noqta public API
───────────────────                ───────────────────────              ────────────────
dialog with your iframe ── bridge ─► web/  (Vue + App Bridge)
  • session token (60 s)                 │ fetch('/api/…')  + session token (automatic)
  • selected products                    ▼
  • toast / confirm / close         server/ (Node + Express) ──────────► https://apps-api.noqta.ps/v1
                                      verifies the token,                X-Noqta-Access-Token
                                      exchanges it for a store token,
                                      does the work
```

- The app **never gets a store password or admin token**. It gets a short **session token** from
  the admin and exchanges it (server side) for a **store access token** limited to the scopes in
  `noqta.app.toml`.
- Data goes through the **public API** only. The bridge (`window.noqta`) is for UI and identity.
- The store owner can uninstall the app or Noqta can disable it at any time: every token stops
  working immediately. Handle `401`/`403` from the API gracefully.

## 2. Workflow

```bash
nqs app login                      # once per machine: your browser opens, confirm
nqs app init my-app                # registers the app, creates this project, writes .env
cd my-app && npm install
nqs app dev                        # runs your local app on your dev store (no deploy, no review)
nqs app deploy                     # ready for real stores: a version Noqta reviews
nqs app info                       # your dev stores, versions, approval state, installs
nqs app secret                     # leaked .env? rotate the client secret
nqs app update                     # after updating nqs: refresh the docs + check your code (docs/upgrading.md)
```

- **Dev stores** (like Shopify's development stores): Noqta gives you one or more test stores.
  `nqs app dev` installs your app there with your **local** `noqta.app.toml` and
  `storefront/blocks` as a draft (**dev preview**) — no deploy, no review — and updates it on every
  save. Several dev stores? `--store sto_…` (or `build.dev_store_url`). Open that store's admin →
  **Apps** → your app, or a product → **التطبيقات**.
- Like Shopify CLI, `nqs app dev` opens a **Cloudflare quick tunnel** (a public https URL to your
  localhost; install once: `brew install cloudflared`). The admin frames your app through it and
  the store's server reaches your app proxy through it. The URL changes on every run — nothing to
  configure. Own tunnel: `--tunnel-url https://…` (ngrok…); none: `--no-tunnel` (the admin still
  works on localhost; the app proxy then only works if the store runs on your machine).
- Stopping `nqs app dev` (Ctrl+C) closes the tunnel and ends the preview: the dev store goes back
  to your approved version (or the app is removed from it if none is approved yet).
- **Real stores** only run versions from `nqs app deploy`. Live at once: admin pages, actions,
  URLs, the app proxy. **Reviewed by Noqta first** (usually fast): new scopes, any new or changed
  storefront block (its code runs on the merchant's domain), and data newly shown on or collected
  from the storefront (`public_read`, `storefront_form`). Stores keep the previous version
  meanwhile. Build and test freely on your dev store — nothing there is reviewed.

## 3. Project layout

| Path | What |
|---|---|
| `noqta.app.toml` | App config (same keys as `shopify.app.toml`): name, `application_url`, scopes, admin actions |
| `web/` | Frontend (Vite + Vue 3 + TypeScript). `web/src/main.ts` imports App Bridge first |
| `server/index.ts` | Express server: your `/api/*` routes, and Vite (dev) or the built files (production) |
| `server/noqta.ts` | Session token check, token exchange, store tokens, API client — reuse it |
| `server/jobs.ts` | Background jobs (the work keeps going if the merchant closes the dialog); saves a metafield on each product and one history metaobject per run |
| `web/src/views/HomeView.vue` | The app's home page: product picker + history (metaobjects) |
| `web/src/views/ActionView.vue` | The product actions (one product, or a selection) |
| `server/stamp.ts` | The demo "AI": draws a number on the image. **Replace this with your own logic** |
| `storefront/blocks/` | App blocks for the storefront (Liquid), e.g. `newsletter.liquid` |
| `docs/` | `api.md` (public API), `bridge.md` (App Bridge), `shopify-differences.md` |

## 4. Rules (the platform enforces most of them)

1. **Verify the session token on every request** to your server (`requireSession` does it). Never
   trust ids or store ids sent by the frontend without it.
2. **Keep the client secret and store tokens on the server.** Never send them to the browser,
   never commit `.env`. Store tokens like passwords (the starter's JSON file is for development).
   A token is revoked when the app is uninstalled or reinstalled: on a `401 invalid_token`, drop
   it (the starter does) — the next time the merchant opens the app, a new one is exchanged.
3. **Work only on what you were opened for.** `noqta.data.selected` lists the products; the
   admin ignores `products.changed()` for anything else.
4. **Long work runs in background jobs** with the store token, not in the browser. Poll from the
   frontend; the merchant may close the dialog.
5. **Images go in as files**: `POST /products/{id}/images` with `attachment` (base64). Noqta
   converts them (WebP, ≤ 2048 px). Image URLs (`src`) are not accepted.
6. **Removing an image only detaches it** from the product; the file stays in the store's media
   library. To replace an image: add the new one at its position, then remove the old one.
7. **Send `Idempotency-Key`** on writes you might retry (the starter does), so a retry never adds
   the same image twice.
8. **Ask the merchant before changing data**: `await noqta.confirm({...})` (drawn by the admin).
   Report the result with `noqta.toast.show()`.
9. **Respect rate limits**: 120 requests/min per store. On `429`, wait `Retry-After` seconds.
10. **Arabic-first, RTL, mobile**: the admin is RTL (`noqta.config.dir`), the locale is `ar` or
    `he` (`noqta.config.locale`). The dialog is full screen on phones.
11. **No cookies or local storage for important state.** The app runs in a credentialless iframe:
    storage doesn't persist. Use the session token and your server.
12. Text you send through the bridge is shown as **plain text** (no HTML).
13. **Arabic for everything merchants see.** Noqta merchants are Arabic speakers: write the app
    `name`, metaobject type and field `name`s, block `name`s and setting `label`s, action titles and
    your pages in Arabic (values you save for display too, e.g. "كل الصور", not "all"). English
    only in code, ids and keys. The admin shows these texts as they are — it doesn't translate them.
14. **Look like the admin.** Your pages sit inside the Noqta admin: keep `web/src/style.css`
    (IBM Plex Sans Arabic, black-and-white, pill buttons, rounded cards) and build on its `--nq-*` variables
    instead of adding a new color scheme or UI kit. Arabic labels, RTL layout.

## 5. Where the app appears

Declared in `noqta.app.toml` under `[[admin.actions]]`, with Shopify's target names:

| `target` | Where | `noqta.data.selected` |
|---|---|---|
| `admin.product-details.action.render` | button under the product images (disabled while the product has unsaved changes) | `[{ id }]` |
| `admin.product-index.selection-action.render` | product list → select → **الحركات** (1–100 products) | `[{ id }, …]` |
| `admin.app.home` (automatic) | **Apps** in the side menu → your app's own page (`application_url`, path `/`) | `[]` — use `noqta.resourcePicker()` |

Each action opens `application_url + path` in a dialog; the admin adds `?target=…&store_id=…&locale=…`.
The dialog header (your app name, "by <developer>", close button) belongs to the admin.

## 6. Scopes

| Scope | Allows |
|---|---|
| `read_products` | read products, their images and your own product metafields |
| `write_products` | edit description, short description, SEO title/description, images, your metafields |
| `write_product_images` | images only (narrower) |
| `read_metaobjects` / `write_metaobjects` | your own records (metaobjects) |

Not available: orders, customers, inventory, prices. Ask only for what you use — a version that
adds a scope waits for Noqta's approval.

## 6b. App data (stored at Noqta)

- **Metafields** — small typed values on products, in your own namespace (e.g.
  `ai_images.regenerated_at`). Read with the product scope; write with `write_products`.
- **Metaobjects** — your own records (one row per entry), with types you declare in
  `noqta.app.toml`. The merchant sees them under your app → **App data** (read-only, or editable
  with `access.admin = "merchant_read_write"`).

**Where does my data go?** (same rules as Shopify apps)

| Data | Put it in |
|---|---|
| The result itself (a new description, SEO title, images) | the **product** (`PUT /products/{id}`, images API) |
| Something about one product (status, last run, score, a generated extra text) | a **metafield** on that product — one value, replaced next time |
| Records that stand on their own (subscribers, FAQs, form entries, one line per run) | a **metaobject** |
| History of every change, prompts, AI responses, logs, settings, anything big or private | **your own database** |

Don't create a metaobject per product (e.g. one "generated description" record per product):
that's a metafield. Metaobjects are capped (50,000 entries per type) and grow forever.
See `docs/api.md` → App data.

## 6c. Storefront blocks

`storefront/blocks/*.liquid` are **app blocks**: Liquid sections the merchant adds to their pages
in the builder, rendered by Noqta Studio (no server of yours involved). They can read your
`public_read` metaobjects (`app.metaobjects.<type>`), your product metafields
(`{{ product | app_metafield: 'ns.key' }}`) and post forms that save entries of
`storefront_form` types (`app.forms.<type>`). See `docs/storefront.md` and the example
`storefront/blocks/newsletter.liquid`.

A block's schema `"target"` decides where it goes: `"section"` (default, placed in the builder),
`"product"` (every product page, gets `product`) or `"body"` (an **app embed** on every page —
popups, dialogs, bars, chat). Product blocks and embeds are off until the merchant switches them on,
and a version that adds/changes them waits for Noqta's approval. Examples:
`storefront/blocks/ai-badge.liquid`, `storefront/blocks/welcome-popup.liquid`.

**A block that needs your server** (AI, your database…): declare `[app_proxy]` and call
`{{ app.proxy_url }}/…` from the block — the store forwards it to your server, signed
(`requireAppProxy` in server/noqta.ts). **Never put your server's URL in Liquid** and never call
it directly from the storefront (no CORS endpoints, no "which store is this" guessing). Only for
saving what shoppers type? Use a form (`app.forms.<type>`) — no server needed. See
`docs/storefront.md` → app proxy.

**Liquid doesn't escape for you: use `| escape` on every value you output** (settings,
metafields, metaobject fields — in text and in attributes), e.g. `{{ section.settings.title | escape }}`.

## 7. Going live

1. Host the app on **https** on your own domain (Noqta domains are refused).
2. Set `application_url` in `noqta.app.toml`, run `npm run build`, deploy, `nqs app deploy`.
3. Your server must send `Content-Security-Policy: frame-ancestors https://admin.noqta.ps` (the
   starter does) so only the Noqta admin can frame it — not other sites, and not store pages
   (stores live on `<store>.noqta.ps` too, so never allow `https://*.noqta.ps`).
4. If your app is down, merchants see "This app isn't responding — contact <you>". Monitor it.

## 8. References

- `docs/upgrading.md` — what changed in the starter since you created your app (`nqs app update` checks it)

- `docs/api.md` — every API route, fields, errors, paging, limits
- `docs/bridge.md` — `window.noqta` (App Bridge)
- `docs/storefront.md` — app blocks and forms
- `docs/shopify-differences.md` — what's the same as Shopify and what isn't
