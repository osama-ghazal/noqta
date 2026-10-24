import 'dotenv/config'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express, { type NextFunction, type Request, type Response } from 'express'
import { NoqtaApiError, requireAppProxy, requireSession, type NoqtaRequest } from './noqta.js'
import { applyJob, getJob, previewFile, retryItem, startJob, type Mode } from './jobs.js'
import { isHexColor, type RegenerateOptions } from './regenerate.js'

const PORT = Number(process.env.PORT || 3000)
const isDev = process.env.NODE_ENV !== 'production'
const MAX_PRODUCTS = 100

const app = express()
app.use(express.json({ limit: '1mb' }))

// Only the Noqta admin may frame your app (keeps other sites — and store pages, which live on
// <store>.noqta.ps — from embedding it). In dev a local admin (http://localhost:…) may frame it too.
const ADMIN_ORIGINS =
  process.env.NOQTA_ADMIN_ORIGINS ||
  ['https://admin.noqta.ps', ...(isDev ? ['http://localhost:*', 'http://127.0.0.1:*'] : [])].join(' ')
app.use((_req, res, next) => {
  res.setHeader('Content-Security-Policy', `frame-ancestors ${ADMIN_ORIGINS}`)
  next()
})

const ids = (value: unknown): number[] =>
  String(value || '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0)
    .slice(0, MAX_PRODUCTS)

// ── your API: every route checks the session token first ──────────────────

app.get('/api/products', requireSession, async (req, res, next) => {
  try {
    const { api } = (req as NoqtaRequest).noqta!
    res.json({ products: await api.products(ids(req.query.ids)) })
  } catch (err) {
    next(err)
  }
})

app.post('/api/jobs', requireSession, (req, res) => {
  const { storeId } = (req as NoqtaRequest).noqta!
  const body = req.body || {}
  const productIds = ids((body.product_ids || []).join(','))
  const mode: Mode = body.mode === 'all' ? 'all' : 'main'
  const options: RegenerateOptions = {
    style: body.style === 'realistic' ? 'realistic' : 'clean',
    background: isHexColor(body.background) ? body.background.toLowerCase() : '#ffffff',
    quality: body.quality === 'high' ? 'high' : 'medium',
    note: typeof body.note === 'string' ? body.note.trim().slice(0, 500) || undefined : undefined
  }
  if (!productIds.length) {
    res.status(400).json({ error: 'product_ids is required' })
    return
  }
  res.status(201).json({ job: startJob(storeId, productIds, mode, options) })
})

// Keep some of the generated images: replace the originals, or add them to the products.
app.post('/api/jobs/:id/apply', requireSession, (req, res) => {
  const job = getJob(req.params.id, (req as NoqtaRequest).noqta!.storeId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  const keys = Array.isArray(req.body?.keys) ? req.body.keys.map(String) : []
  if (!applyJob(job, keys, req.body?.replace !== false)) {
    res.status(409).json({ error: 'Nothing to apply' })
    return
  }
  res.json({ job })
})

// Generate one image of the job again.
app.post('/api/jobs/:id/retry', requireSession, (req, res) => {
  const job = getJob(req.params.id, (req as NoqtaRequest).noqta!.storeId)
  const item = job && retryItem(job, String(req.body?.key || ''))
  if (!job || !item) {
    res.status(409).json({ error: 'Cannot retry this image' })
    return
  }
  res.json({ job })
})

// The previews: <img> tags can't send the session token, so the unguessable job id is the key.
app.get('/previews/:job/:file', (req, res) => {
  const file = previewFile(req.params.job, req.params.file)
  if (!file) {
    res.status(404).end()
    return
  }
  res.setHeader('Cache-Control', 'private, max-age=86400')
  res.sendFile(file)
})

// The app's home page: the last regenerations (metaobjects of type "regeneration").
app.get('/api/history', requireSession, async (req, res, next) => {
  try {
    const { api } = (req as NoqtaRequest).noqta!
    res.json({ history: await api.metaobjects('regeneration', 20) })
  } catch (err) {
    next(err)
  }
})

// App proxy ([app_proxy] in noqta.app.toml, url = "https://<your app>/proxy"): a block calls
// fetch('{{ app.proxy_url }}/status') on the store, the store forwards it here, signed.
// Answer JSON, plain text or images (the store refuses HTML).
app.get('/proxy/status', requireAppProxy, (req, res) => {
  res.json({ ok: true, store: (req as NoqtaRequest).noqta!.storeId })
})

app.get('/api/jobs/:id', requireSession, (req, res) => {
  const job = getJob(req.params.id, (req as NoqtaRequest).noqta!.storeId)
  if (!job) {
    res.status(404).json({ error: 'Job not found' })
    return
  }
  res.json({ job })
})

app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  if (err instanceof NoqtaApiError) {
    res.status(err.status >= 500 ? 502 : err.status).json({ error: err.message })
    return
  }
  res.status(500).json({ error: 'Something went wrong' })
})

// ── the frontend (Vite in dev, the built files in production) ──────────────

async function start() {
  const server = http.createServer(app)
  if (isDev) {
    const { createServer } = await import('vite')
    // `nqs app dev` serves this app through a tunnel (like Shopify CLI): let Vite answer on the
    // tunnel's host, and run hot reload on this same server so it works through the tunnel too.
    const tunnel = process.env.NOQTA_TUNNEL_URL ? new URL(process.env.NOQTA_TUNNEL_URL).hostname : null
    // The tunnel is public: Vite may only serve the frontend (web/) and its packages — never
    // .env, store tokens (data/) or your server code through /@fs/….
    const root = fileURLToPath(new URL('..', import.meta.url))
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
  } else {
    const dist = path.resolve('dist/web')
    app.use(express.static(dist))
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')))
  }
  server.listen(PORT, () =>
    console.log(`App running on http://localhost:${PORT}${process.env.NOQTA_TUNNEL_URL ? ` and ${process.env.NOQTA_TUNNEL_URL}` : ''}`)
  )
}

void start()
