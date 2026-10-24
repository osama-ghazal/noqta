import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import jwt from 'jsonwebtoken'

/**
 * Everything your server needs to talk to Noqta (see docs/api.md):
 * 1. verify the session token the admin gives your frontend (noqta.idToken()),
 * 2. exchange it once per store for an offline store access token,
 * 3. call the public API with that token.
 */

export const config = {
  clientId: required('NOQTA_CLIENT_ID'),
  clientSecret: required('NOQTA_CLIENT_SECRET'),
  apiUrl: (process.env.NOQTA_API_URL || 'https://apps-api.noqta.ps/v1').replace(/\/+$/, '')
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is missing: copy .env.example to .env and fill it in`)
  return value
}

// ── session tokens ─────────────────────────────────────────────────────────

export interface SessionClaims {
  iss: string
  dest: string // the store's URL
  aud: string // your client_id
  sub: string // the Noqta account using the admin (opaque)
  store_id: string // sto_…
  exp: number
  jti: string
}

export function verifySessionToken(token: string): SessionClaims {
  return jwt.verify(token, config.clientSecret, {
    algorithms: ['HS256'],
    audience: config.clientId,
    clockTolerance: 10
  }) as SessionClaims
}

// ── store access tokens (one per store, no time limit) ─────────────────────
// Kept in a JSON file so the starter has no database. Use a real database in production,
// and treat these tokens like passwords.

const TOKENS_FILE = path.resolve(process.env.NOQTA_TOKENS_FILE || 'data/store-tokens.json')

function readTokens(): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'))
  } catch {
    return {}
  }
}

function saveToken(storeId: string, token: string) {
  const tokens = readTokens()
  tokens[storeId] = token
  fs.mkdirSync(path.dirname(TOKENS_FILE), { recursive: true })
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 })
}

export function storeToken(storeId: string): string | undefined {
  return readTokens()[storeId]
}

/** A revoked token (the app was reinstalled…): drop it; the next admin visit exchanges a new one. */
export function forgetToken(storeId: string) {
  const tokens = readTokens()
  if (!(storeId in tokens)) return
  delete tokens[storeId]
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2), { mode: 0o600 })
}

/** Token exchange — same parameters as Shopify's. Returns the same token on every call. */
export async function exchangeToken(sessionToken: string): Promise<{ accessToken: string; storeId: string }> {
  const res = await fetch(`${config.apiUrl}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      subject_token: sessionToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
      requested_token_type: 'urn:noqta:params:oauth:token-type:offline-access-token'
    })
  })
  const body = await res.json()
  if (!res.ok) throw new NoqtaApiError(res.status, body)
  saveToken(body.store_id, body.access_token)
  return { accessToken: body.access_token, storeId: body.store_id }
}

// ── Express middleware for your API routes ─────────────────────────────────

export interface NoqtaRequest extends Request {
  noqta?: { storeId: string; storeUrl: string; api: NoqtaApi }
}

/**
 * Protects your routes: requires a valid session token (App Bridge adds it to fetch()
 * automatically) and gives the route an API client for that store.
 */
export async function requireSession(req: Request, res: Response, next: NextFunction) {
  const auth = req.header('Authorization') || ''
  const sessionToken = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  let claims: SessionClaims
  try {
    claims = verifySessionToken(sessionToken)
  } catch (err) {
    if (process.env.NODE_ENV !== 'production') {
      const claims = jwt.decode(sessionToken, { complete: true })
      console.warn('session token rejected:', (err as Error).message, sessionToken ? { header: claims?.header, payload: claims?.payload } : '(none sent)')
    }
    res.status(401).json({ error: 'Invalid or missing session token' })
    return
  }
  try {
    const token = storeToken(claims.store_id) || (await exchangeToken(sessionToken)).accessToken
    ;(req as NoqtaRequest).noqta = { storeId: claims.store_id, storeUrl: claims.dest, api: new NoqtaApi(token, claims.store_id) }
    next()
  } catch (err) {
    next(err)
  }
}

// ── app proxy: storefront → the store's /apps/<subpath>/… → your server ───────
// Same as Shopify's app proxy. The store adds shop, store_id, path_prefix, timestamp and a
// signature to the query; the signing key is per store: HMAC-SHA256(client_secret, "proxy:" + store_id).

const PROXY_MAX_AGE = 300 // seconds

export function verifyAppProxy(query: Record<string, unknown>): { storeId: string; shop: string } | null {
  const { signature, ...params } = query
  const storeId = params.store_id
  if (typeof signature !== 'string' || typeof storeId !== 'string' || !/^sto_[a-z0-9]+$/.test(storeId)) return null
  // A signed URL can be replayed for 5 minutes: make routes that change data idempotent (or keep
  // a cache of used signatures) so a replay does nothing new.
  const timestamp = Number(params.timestamp)
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > PROXY_MAX_AGE) return null
  const message = Object.entries(params)
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : String(v)}`)
    .sort()
    .join('')
  const key = crypto.createHmac('sha256', config.clientSecret).update(`proxy:${storeId}`).digest('hex')
  const expected = crypto.createHmac('sha256', key).update(message).digest('hex')
  const ok =
    expected.length === signature.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
  return ok ? { storeId, shop: String(params.shop || '') } : null
}

/**
 * Protects routes the storefront calls through the app proxy (`{{ app.proxy_url }}` in a block):
 * checks the store's signature and gives the route an API client for that store. The shopper is
 * anonymous here — treat input as untrusted and rate-limit expensive work (X-Forwarded-For has
 * the shopper's IP).
 */
export function requireAppProxy(req: Request, res: Response, next: NextFunction) {
  const store = verifyAppProxy(req.query as Record<string, unknown>)
  if (!store) {
    res.status(401).json({ error: 'Invalid app proxy signature' })
    return
  }
  const token = storeToken(store.storeId)
  if (!token) {
    // We get a store's token the first time the merchant opens the app in the admin.
    res.status(503).json({ error: 'Open the app once in this store\'s admin' })
    return
  }
  ;(req as NoqtaRequest).noqta = { storeId: store.storeId, storeUrl: `https://${store.shop}`, api: new NoqtaApi(token, store.storeId) }
  next()
}

// ── the public API ─────────────────────────────────────────────────────────

export class NoqtaApiError extends Error {
  constructor(
    public status: number,
    public body: { errors?: unknown; code?: string }
  ) {
    super(`Noqta API ${status}: ${body?.code || ''} ${typeof body?.errors === 'string' ? body.errors : JSON.stringify(body?.errors)}`)
  }
}

export interface ProductImage {
  id: number
  product_id: number
  position: number
  src: string
  alt: string | null
  width: number | null
  height: number | null
  created_by_app: string | null
}

export interface Product {
  id: number
  title: string
  status: 'active' | 'draft' | 'archived' | string
  image: ProductImage | null
  images: ProductImage[]
  online_store_url: string
  updated_at: string
}

export interface Metaobject {
  id: number
  type: string
  handle: string
  fields: Record<string, string>
  created_at: string
}

export class NoqtaApi {
  constructor(
    private readonly accessToken: string,
    private readonly storeId?: string
  ) {}

  private async call<T>(method: string, route: string, body?: unknown, idempotencyKey?: string): Promise<T> {
    const res = await fetch(`${config.apiUrl}${route}`, {
      method,
      headers: {
        'X-Noqta-Access-Token': this.accessToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401 && this.storeId) forgetToken(this.storeId)
    if (!res.ok) throw new NoqtaApiError(res.status, data)
    return data as T
  }

  async products(ids: number[]): Promise<Product[]> {
    if (!ids.length) return []
    const { products } = await this.call<{ products: Product[] }>('GET', `/products?ids=${ids.join(',')}`)
    return products
  }

  async product(id: number): Promise<Product> {
    return (await this.call<{ product: Product }>('GET', `/products/${id}`)).product
  }

  /** Same body as Shopify: the file in `attachment` (base64). Noqta turns it into WebP ≤ 2048 px. */
  async addImage(productId: number, image: { attachment: string; filename: string; alt?: string | null; position?: number }, idempotencyKey?: string) {
    return (await this.call<{ image: ProductImage }>('POST', `/products/${productId}/images`, { image }, idempotencyKey)).image
  }

  /** Creates or replaces the app's metafield (namespace + key) on a product. */
  async setMetafield(productId: number, metafield: { namespace: string; key: string; type: string; value: string }) {
    return (await this.call<{ metafield: { id: number } }>('POST', `/products/${productId}/metafields`, { metafield })).metafield
  }

  /** One entry of one of the app's metaobject types (declared in noqta.app.toml). */
  async createMetaobject(type: string, fields: Record<string, string>) {
    return (await this.call<{ metaobject: Metaobject }>('POST', '/metaobjects', { metaobject: { type, fields } })).metaobject
  }

  async metaobjects(type: string, limit = 50): Promise<Metaobject[]> {
    return (await this.call<{ metaobjects: Metaobject[] }>('GET', `/metaobjects?type=${type}&limit=${limit}`)).metaobjects
  }

  /** Takes the image off the product; the file stays in the store's media library. */
  async removeImage(productId: number, imageId: number, idempotencyKey?: string) {
    await this.call('DELETE', `/products/${productId}/images/${imageId}`, undefined, idempotencyKey)
  }
}
