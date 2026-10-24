# Coming from Shopify

> Managed by `nqs`. Read this before relying on what you (or your AI assistant) know from Shopify.

## The same

- Embedded app in an iframe in the admin; the app is hosted by you.
- `noqta.app.toml` ≈ `shopify.app.toml` (`client_id`, `name`, `handle`, `application_url`,
  `embedded`, `[access_scopes] scopes`, `[build] dev_store_url`).
- `nqs app init / dev / deploy / info` ≈ `shopify app init / dev / deploy / info`.
- App Bridge global (`noqta` ≈ `shopify`), `idToken()`, `toast.show()`, `loading()`, automatic
  session token on same-origin `fetch`.
- Session token claims, token exchange parameters, offline access tokens.
- REST shapes: `{ product }`, `{ products }`, `title`, `src`, `position`, `alt`, `product_id`;
  `limit` + `page_info` paging with the `Link` header; `.json` suffix accepted.
- Admin action target names: `admin.product-details.action.render`,
  `admin.product-index.selection-action.render`, with `data.selected`.

## Different

| Shopify | Noqta |
|---|---|
| GraphQL Admin API (+ legacy REST) | **REST only** (v1) |
| Dated API versions (`2025-01`) | **`v1`**, additive changes only |
| `X-Shopify-Access-Token` | **`X-Noqta-Access-Token`** |
| `write_products`: the whole product | **`write_products`: description, short description, SEO and images only** (no price, stock, variants, categories, status) |
| Orders, customers, inventory APIs | **Not available** yet |
| Metaobjects via GraphQL, `fields` as a list | **REST**, `fields` as an object `{ key: value }` |
| Metafields on many resources, any namespace | **Products only**, the app's own namespaces only |
| Image upload by `src` URL or `attachment` | **`attachment` only** |
| Deleting an image deletes it | **Removing only detaches it**; the file stays in the media library |
| Admin actions are extensions rendered with Shopify UI components | Admin actions are **pages of your app** (`path` in `[[admin.actions]]`) opened in a dialog |
| Merchants install from the App Store (OAuth) | **Noqta installs** apps on stores for now; no OAuth screens |
| Webhooks | **Not yet** |
| App home page (embedded) | **Same idea**: Apps → your app, `admin.app.home` |
| — | `noqta.confirm()` (admin-drawn confirm) and `noqta.products.changed()` |
| — | The admin is **RTL**, locales `ar` / `he` |
| — | The iframe is **credentialless**: no persistent cookies or storage |
| Theme app extensions: app blocks in any template + app embeds | **App blocks** with `"target"`: `section` (builder pages), `product` (every product page, fixed spot), `body` (app embed, every page). No asset files |
| Theme app extension changes deploy freely | Adding/changing **product blocks or embeds waits for approval** (page blocks don't) |
| App proxy (`[app_proxy]`: url, subpath, prefix) | **Same** (`/apps/<subpath>` only), signed the same way, but the key is per store: `HMAC-SHA256(client_secret, "proxy:" + store_id)`. Responses: JSON, plain text or images — **no HTML/Liquid pages**. No `logged_in_customer_id`. Bodies: JSON or form-urlencoded (no multipart) |
| — | Simple storefront forms don't need your server: **forms save metaobjects** at Noqta (`access.storefront_form`) |
| `shopify.resourcePicker` | `noqta.resourcePicker({ type: 'product' })` (products only) |
| `shopify.saveBar`, `modal`, `ui-nav-menu` | **Not available** (yet) |
