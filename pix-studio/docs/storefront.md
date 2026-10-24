# App blocks on the storefront

> Managed by `nqs`. Like Shopify's theme app extensions.

Put Liquid files in `storefront/blocks/` (e.g. `storefront/blocks/newsletter.liquid`). The merchant
adds them to their pages in the builder, listed as **"block name · your app"**. Noqta Studio
renders them exactly like theme sections: Liquid + `{% stylesheet %}` + `{% javascript %}` +
settings in `{% schema %}`. Your server is never called while a page renders.

```liquid
<div class="my-faq">
  {% for item in app.metaobjects.faq %}
    <details><summary>{{ item.question | escape }}</summary>{{ item.answer | escape }}</details>
  {% endfor %}
</div>
{% stylesheet %} .my-faq details { padding: 8px 0 } {% endstylesheet %}
{% schema %}
{ "name": "الأسئلة الشائعة", "category": "content", "settings": [ { "type": "text", "id": "title", "label": "العنوان" } ] }
{% endschema %}
```

## What a block can use

| | |
|---|---|
| `section.settings.*` | the settings you declare in the schema (the merchant edits them in the builder) |
| `shop`, `settings`, `request`, `collections`, `theme` | the same objects as theme sections |
| `app.metaobjects.<type>` | your entries of types with `access.storefront = "public_read"` (newest 100) |
| `app.forms.<type>` | `{ url, honeypot }` for types with `access.storefront_form = true` |
| `app.proxy_url` | `/apps/<subpath>` when you declare `[app_proxy]`: call your server from the block (below) |
| `{{ product \| app_metafield: 'ns.key' }}` | your metafield on a product (a product object or an id) |

Your other data (metaobjects without `public_read`) never reaches the storefront.

**Liquid doesn't escape for you: use `| escape` on every value you output** — settings, metafields
and metaobject fields, in text and in attributes (`{{ section.settings.title | escape }}`).

## Calling your server from a block (app proxy)

When a block needs **your code** (AI, a calculation, your database), don't call your server's URL
from the page: use the **app proxy**, exactly like Shopify's.

```toml
# noqta.app.toml
[app_proxy]
url = "https://your-app.example.com/proxy"
subpath = "try-on"        # unique across Noqta: the store answers /apps/try-on/…
prefix = "apps"
```

```liquid
<div class="my-box" data-proxy="{{ app.proxy_url | escape }}" data-product="{{ product.id }}"></div>
{% javascript %}
  // same origin as the page: no CORS, no URL of yours in the template
  const box = document.querySelector('.my-box')
  const res = await fetch(`${box.dataset.proxy}/products/${box.dataset.product}`)
{% endjavascript %}
```

The store forwards `https://<store>/apps/try-on/products/5?x=1` to
`https://your-app.example.com/proxy/products/5?x=1&shop=…&store_id=sto_…&path_prefix=/apps/try-on&timestamp=…&signature=…`.

- **Verify every request** with `requireAppProxy` (server/noqta.ts): it checks `signature` and
  gives you `req.noqta.api` for that store. The key is per store:
  `HMAC-SHA256(client_secret, "proxy:" + store_id)`; the signature is HMAC-SHA256 (hex) of the
  sorted `key=value` pairs (without `signature`), joined with nothing. Requests older than 5
  minutes are refused.
- A signed URL can be **replayed for those 5 minutes**: make routes that change data idempotent
  (or remember the signatures you've seen).
- The shopper is anonymous: no cookies or login reach you. Their IP is in `X-Forwarded-For` —
  rate-limit expensive work.
- Answer **JSON, plain text or images** (PNG/JPEG/WebP/GIF/AVIF). The store refuses anything else
  (HTML, SVG…) so nothing you return can run on the store's domain. Responses are never cached.
- Send **JSON** (files as base64) or form-urlencoded bodies — not multipart. Max 15 MB in, 10 MB
  out, 30 s, 120 requests per minute per shopper.
- While you develop, `nqs app dev` points your dev store's proxy at your machine through its
  tunnel (see AGENTS.md → Workflow).

## Forms (e.g. newsletter, contact, waitlist)

A submission becomes an entry of your metaobject type, stored at Noqta (not sent to your server):

```liquid
{% assign form = app.forms.subscriber %}
<form method="post" action="{{ form.url | escape }}">
  <input type="email" name="fields[email]" required>
  <input type="text" name="{{ form.honeypot | escape }}" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px">
  <button>Subscribe</button>
</form>
```

- Name inputs `fields[<field key>]`. Required fields and types are checked; unknown fields are ignored.
- Keep the honeypot input (hidden from people; bots fill it).
- With `fetch(..., { headers: { Accept: 'application/json' } })` you get `201 { ok: true }` or
  `{ errors, code }`. A plain form submission comes back to the page with
  `?nq_form=<type>&nq_status=ok|error`.
- 5 submissions per visitor per 10 minutes.
- Read the entries from your server: `GET /v1/metaobjects?type=subscriber`.

## Workflow and limits

- `nqs app dev` pushes `storefront/blocks` to your dev store on every save and prints Liquid errors
  with file and line. Open a builder page on the dev store and add your block.
- `nqs app deploy` sends the blocks with the version. If a block doesn't compile on a store, the
  deploy says so and that store keeps the previous blocks.
- Up to 10 blocks, 64 KB each, 256 KB in total. One file per block (no snippets, no asset files:
  use your own URLs for images).
- Page blocks (`"target": "section"`, the default) go on builder pages (homepage, landing pages).

## Product pages and the whole store

Add `"target"` to the schema:

| `target` | Where | Gets |
|---|---|---|
| `"section"` (default) | builder pages, placed by the merchant | — |
| `"product"` | **every product page**, in the product details | `product` |
| `"body"` (**app embed**) | **once on every page** (end of the body) — never cart, checkout, account | `product` on product pages |

```liquid
{% assign done = product | app_metafield: 'ai_images.regenerated_at' %}
{% if done != blank %}<p>✨ {{ section.settings.label | escape }}</p>{% endif %}
{% schema %}
{ "name": "شارة الذكاء الاصطناعي", "target": "product", "settings": [ { "type": "text", "id": "label", "label": "النص", "default": "صور محسّنة" } ] }
{% endschema %}
```

- Product blocks and embeds are **off until the merchant switches them on** (your app →
  **في المتجر** in the admin), with the settings you declare (text, textarea, number, checkbox,
  select, color, url…).
- An embed is how you make **a general dialog, popup, announcement bar or chat bubble**: render
  the markup (e.g. a `<dialog>`) and decide in `{% javascript %}` when to open it. See
  `storefront/blocks/welcome-popup.liquid`.
- **Approval**: a version that adds or changes a product block or an embed waits for Noqta's
  approval (they run on every page); `nqs app deploy` tells you why. Page blocks go live at once.
- On your dev store, `nqs app dev` pushes them too; switch them on in the admin to see them.
