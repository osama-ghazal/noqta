# Noqta public API v1

> Managed by `nqs`. Base URL: `https://apps-api.noqta.ps/v1`

Shapes follow the **Shopify REST Admin API**: one resource is wrapped (`{ "product": {…} }`), lists
are plural (`{ "products": [ … ] }`), and field names match Shopify's (`title`, `src`,
`product_id`, `position`, `alt`). Every route also accepts Shopify's `.json` suffix.

## Authentication

### Session token → store access token (token exchange)

Your frontend gets a session token with `await noqta.idToken()` (App Bridge also adds it to your
own `fetch` calls). Your server verifies it and, once per store, exchanges it:

```http
POST /v1/oauth/access_token
Content-Type: application/json

{
  "client_id": "app_…",
  "client_secret": "nqsec_…",
  "grant_type": "urn:ietf:params:oauth:grant-type:token-exchange",
  "subject_token": "<session token>",
  "subject_token_type": "urn:ietf:params:oauth:token-type:id_token",
  "requested_token_type": "urn:noqta:params:oauth:token-type:offline-access-token"
}
```

```json
{ "access_token": "nqa_…", "scope": "read_products,write_product_images", "store_id": "sto_…" }
```

- The store access token has **no time limit**. A repeated exchange returns the **same** token.
- It stops working when the app is uninstalled from that store, disabled, or its secret rotated.
- Send it as `X-Noqta-Access-Token: nqa_…` (`Authorization: Bearer nqa_…` works too).

### Session token claims (HS256, signed with your client secret, 60 s)

| Claim | |
|---|---|
| `iss` | `https://apps-api.noqta.ps/stores/<store_id>` |
| `dest` | the store's URL |
| `aud` | your `client_id` — **check it** |
| `sub` | opaque id of the person using the admin (`acc_…`, stable per app) |
| `exp`, `nbf`, `iat`, `jti`, `sid` | as in Shopify |
| `store_id` | `sto_…` |

Verify with HS256 only, `aud` = your client_id, and `exp`/`nbf` (allow ~10 s clock skew).

## Conventions

- **Errors** — `errors` holds the message (or field → messages), plus a stable `code`:
  `{ "errors": "Product not found", "code": "not_found" }`

| HTTP | `code` |
|---|---|
| 400 | `validation_failed` |
| 401 | `invalid_token`, `token_revoked` |
| 403 | `missing_scope`, `app_disabled`, `install_inactive`, `forbidden` |
| 404 | `not_found` |
| 409 | `conflict` |
| 413 | `too_large` |
| 415 | `unsupported_image` |
| 429 | `rate_limited` (see `Retry-After`) |
| 502 / 504 | `store_unreachable`, `store_timeout` |

- **Rate limit**: 120 requests/min per store. Headers `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-RateLimit-Reset`.
- **Paging**: `?limit=50` (max 250) and cursors like Shopify: the next/previous pages are in the
  `Link` header (`<…?limit=50&page_info=…>; rel="next"`). With `page_info`, only `limit` may be sent.
- **Idempotency**: write routes accept `Idempotency-Key` (kept 24 h); a retry returns the first
  answer with `Idempotent-Replayed: true`.
- **Versioning**: `/v1` only gets additive changes (new fields, routes, optional params, **new enum
  values** — accept values you don't know). Breaking changes would be `/v2`.

## Resources

```ts
Product = {
  id: number
  title: string
  handle: string
  status: 'active' | 'draft' | 'archived'          // may grow
  product_type: 'simple' | 'variable' | 'other'    // may grow
  sku: string | null
  body_html: string                                // description (store's main language)
  short_description: string
  metafields_global_title_tag: string | null       // SEO title
  metafields_global_description_tag: string | null // SEO description
  online_store_url: string
  image: ProductImage | null                       // the main image (= images[0])
  images: ProductImage[]
  created_at: string                               // ISO 8601, UTC
  updated_at: string
}

ProductImage = {
  id: number
  product_id: number
  position: number            // 1 = main image
  src: string
  alt: string | null
  width: number | null
  height: number | null
  created_at: string
  updated_at: string
  created_by_app: string | null   // client_id of the app that added it
}

Shop = { id: string, name: string, domain: string, currency: string,
         primary_locale: 'ar' | 'en', timezone: string }
```

Variation images are not available in v1.

## Routes

| Route | Scope |
|---|---|
| `GET /shop` | any |
| `GET /products?ids=1,2,3` (up to 250) | `read_products` |
| `GET /products?limit=&title=&status=` · `?limit=&page_info=` | `read_products` |
| `GET /products/{id}` | `read_products` |
| `GET /products/{id}/images` | `read_products` |
| `POST /products/{id}/images` | `write_product_images` |
| `PUT /products/{id}/images/{image_id}` | `write_product_images` |
| `DELETE /products/{id}/images/{image_id}` | `write_product_images` |
| `PUT /products/{id}` | `write_products` |
| `GET /products/{id}/metafields` | `read_products` |
| `POST /products/{id}/metafields` | `write_products` |
| `PUT` / `DELETE /products/{id}/metafields/{metafield_id}` | `write_products` |
| `GET /metaobjects?type=…` · `GET /metaobjects/{id}` | `read_metaobjects` |
| `POST /metaobjects` · `PUT` / `DELETE /metaobjects/{id}` | `write_metaobjects` |

`write_products` also covers the image routes (like Shopify). Orders, customers and inventory
are not available.

### Add an image

```http
POST /v1/products/42/images
X-Noqta-Access-Token: nqa_…
Idempotency-Key: job-123:img-991:add

{ "image": { "attachment": "<base64>", "filename": "shoe.png", "alt": "Red shoe", "position": 1 } }
```

→ `{ "image": ProductImage }`

- JPEG, PNG or WebP, max 15 MB before base64. Anything else is `415 unsupported_image`.
- Noqta processes it like an image uploaded in the admin: longest side ≤ 2048 px, WebP, metadata
  removed. `width`/`height` in the answer are the processed size.
- `position` is optional (default: last). `src` (download from a URL) is **not** accepted.

### Move an image or change its alt text

```http
PUT /v1/products/42/images/991
{ "image": { "position": 2, "alt": "Side view" } }
```

### Remove an image

```http
DELETE /v1/products/42/images/991
```

→ `{}` — the image is taken off the product; the file stays in the media library (the merchant
can undo). Apps can never delete media.

### Edit product content (`write_products`)

```http
PUT /v1/products/42
{ "product": { "body_html": "<p>…</p>", "short_description": "…",
               "metafields_global_title_tag": "SEO title", "metafields_global_description_tag": "…" } }
```

→ `{ "product": Product }`. Only these four fields can change (the store's main language); anything
else is `400`. HTML is sanitized like a post (no scripts).

## App data

Your app can keep small data **at Noqta** instead of (or next to) your own database — it's there
for the merchant, for your app page, and (later) for your storefront blocks.

### Metafields — values on products

Shopify REST shape: `{ id, namespace, key, type, value, owner_id, owner_resource, created_at, updated_at }`.
Each app only sees its own metafields.

```http
POST /v1/products/42/metafields
{ "metafield": { "namespace": "ai_images", "key": "regenerated_at", "type": "date", "value": "2026-10-16" } }
```

Creates or replaces (same namespace + key). `PUT /products/42/metafields/{id}` `{ "metafield": { "value": "…" } }`
changes the value (same type). `DELETE` removes it.

Types (values are always strings): `single_line_text_field`, `multi_line_text_field`, `number_integer`,
`number_decimal`, `boolean` (`"true"`/`"false"`), `json`, `url`, `date` (`YYYY-MM-DD`). Limits:
namespace/key `[a-z0-9_]{2,30}`, value ≤ 16 KB, 50 per product.

### Metaobjects — your own records

Declare types in `noqta.app.toml` (deployed with `nqs app deploy`; a new type is part of the version):

```toml
[metaobjects.app.subscriber]
name = "المشتركون"
access.admin = "merchant_read"        # merchant_read | merchant_read_write
access.storefront = "none"            # none | public_read (your storefront blocks can show them)
access.storefront_form = false        # true: your blocks' forms can add entries (docs/storefront.md)

[metaobjects.app.subscriber.fields.email]
name = "البريد الإلكتروني"
type = "single_line_text_field"
required = true
```

Entries — one row each (`{ id, type, handle, fields, created_at, updated_at }`):

```http
POST /v1/metaobjects
{ "metaobject": { "type": "subscriber", "handle": "optional-unique-handle", "fields": { "email": "a@b.com" } } }

GET  /v1/metaobjects?type=subscriber&limit=50        # paged with page_info / Link, like products
PUT  /v1/metaobjects/{id}  { "metaobject": { "fields": { "email": "new@b.com", "note": null } } }   # merge; null removes
DELETE /v1/metaobjects/{id}
```

Fields are checked against your definition (types as metafields; required fields; unknown fields
refused). Limits: 10 types per app, 20 fields per type, 50,000 entries per type per store.

The merchant sees your entries in the admin (your app → **App data**); with
`access.admin = "merchant_read_write"` they can also edit and delete them. Uninstalling keeps the
data (reinstalling brings it back).
