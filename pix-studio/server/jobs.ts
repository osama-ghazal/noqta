import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { NoqtaApi, storeToken, type Product } from './noqta.js'
import { regenerateImage, type RegenerateOptions } from './regenerate.js'

/**
 * A run happens in two steps, both as background jobs on this server with the store's offline
 * access token (they keep going if the merchant closes the dialog; the frontend just polls):
 *
 *   1. generate  every selected image is regenerated into a preview file (data/previews/<job>/),
 *                nothing on the store changes yet → status "review".
 *   2. apply     the images the merchant kept go on their products, replacing the original
 *                (same position) or added after the product's images → status "done".
 *
 * Kept in memory for the starter; use a queue (BullMQ, a jobs table…) in production.
 */

export type Mode = 'main' | 'all'

export interface JobItem {
  key: string // `${productId}-${imageId}`
  productId: number
  imageId: number
  position: number
  alt: string | null
  title: string
  original: string
  status: 'pending' | 'generating' | 'ready' | 'failed' | 'applied'
  /** The preview's URL path, when ready (unguessable: it carries the job id). */
  preview?: string
  error?: string
}

export interface Job {
  id: string
  storeId: string
  productIds: number[]
  mode: Mode
  options: RegenerateOptions
  status: 'generating' | 'review' | 'applying' | 'done' | 'failed'
  items: JobItem[]
  errors: { productId: number; message: string }[]
  /** Products whose images changed (for noqta.products.changed). */
  changed: number[]
  createdAt: number
}

/** AI calls in flight per job: fast enough for a selection, gentle on the AI providers' limits. */
const CONCURRENCY = 3
const PREVIEWS = path.resolve(process.env.PREVIEWS_DIR || 'data/previews')

const jobs = new Map<string, Job>()

export function getJob(id: string, storeId: string): Job | undefined {
  const job = jobs.get(id)
  return job && job.storeId === storeId ? job : undefined
}

export function previewFile(jobId: string, file: string): string | undefined {
  if (!jobs.has(jobId) || !/^\d+-\d+\.jpg$/.test(file)) return undefined
  const full = path.join(PREVIEWS, jobId, file)
  return fs.existsSync(full) ? full : undefined
}

export function startJob(storeId: string, productIds: number[], mode: Mode, options: RegenerateOptions): Job {
  const job: Job = {
    id: crypto.randomUUID(),
    storeId,
    productIds,
    mode,
    options,
    status: 'generating',
    items: [],
    errors: [],
    changed: [],
    createdAt: Date.now()
  }
  jobs.set(job.id, job)
  void generate(job)
  return job
}

function api(job: Job) {
  const token = storeToken(job.storeId)
  if (!token) throw new Error('No access token for this store')
  return new NoqtaApi(token, job.storeId)
}

async function generate(job: Job) {
  try {
    const client = api(job)
    for (const productId of job.productIds) {
      try {
        const product = await client.product(productId)
        const images = job.mode === 'main' ? product.images.slice(0, 1) : product.images
        for (const image of images) {
          job.items.push({
            key: `${product.id}-${image.id}`,
            productId: product.id,
            imageId: image.id,
            position: image.position,
            alt: image.alt,
            title: product.title,
            original: image.src,
            status: 'pending'
          })
        }
      } catch (err) {
        job.errors.push({ productId, message: (err as Error).message })
      }
    }
    fs.mkdirSync(path.join(PREVIEWS, job.id), { recursive: true })
    const queue = [...job.items]
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        for (let item = queue.shift(); item; item = queue.shift()) await generateItem(job, item)
      })
    )
    job.status = job.items.some((i) => i.status === 'ready') ? 'review' : 'failed'
  } catch (err) {
    job.errors.push({ productId: 0, message: (err as Error).message })
    job.status = 'failed'
  }
}

async function generateItem(job: Job, item: JobItem) {
  item.status = 'generating'
  try {
    const jpeg = await regenerateImage(item.original, item.title, job.options)
    fs.writeFileSync(path.join(PREVIEWS, job.id, `${item.key}.jpg`), jpeg)
    // ?v: a retry writes the same file name, so the browser must not reuse the old one.
    item.preview = `/previews/${job.id}/${item.key}.jpg?v=${Date.now()}`
    item.status = 'ready'
  } catch (err) {
    console.error(`regenerate ${item.key}:`, err)
    item.error = (err as Error).message
    item.status = 'failed'
  }
}

/** Generate one image again (the merchant didn't like it), while the job waits for review. */
export function retryItem(job: Job, key: string): JobItem | undefined {
  const item = job.items.find((i) => i.key === key)
  if (!item || job.status !== 'review' || item.status === 'generating' || item.status === 'applied') return undefined
  item.preview = undefined
  item.error = undefined
  void generateItem(job, item)
  return item
}

export function applyJob(job: Job, keys: string[], replace: boolean): boolean {
  if (job.status !== 'review') return false
  const picked = job.items.filter((i) => keys.includes(i.key) && i.status === 'ready')
  if (!picked.length) return false
  job.status = 'applying'
  void apply(job, picked, replace)
  return true
}

/** Replace each image the way a Shopify app does: add the new one at its position, remove the old one. */
async function apply(job: Job, items: JobItem[], replace: boolean) {
  const client = api(job)
  const titles = new Map<number, string>()
  for (const item of items) {
    try {
      const jpeg = fs.readFileSync(path.join(PREVIEWS, job.id, `${item.key}.jpg`))
      // Idempotency keys make a retried request safe: the image is added only once.
      await client.addImage(
        item.productId,
        {
          attachment: jpeg.toString('base64'),
          filename: `pix-${item.imageId}.jpg`,
          alt: item.alt,
          ...(replace ? { position: item.position } : {})
        },
        `${job.id}:${item.imageId}:add`
      )
      if (replace) await client.removeImage(item.productId, item.imageId, `${job.id}:${item.imageId}:remove`)
      item.status = 'applied'
      titles.set(item.productId, item.title)
    } catch (err) {
      job.errors.push({ productId: item.productId, message: (err as Error).message })
    }
  }
  job.changed = [...titles.keys()]
  for (const productId of job.changed) await markProduct(client, productId).catch((e) => console.error('metafield not saved:', e.message))
  if (job.changed.length) await saveRun(client, job, items.filter((i) => i.status === 'applied').length, [...titles.values()])
  job.status = 'done'
}

/**
 * App data, stored at Noqta (declared in noqta.app.toml):
 * - what belongs to ONE product goes on the product, as a metafield (here: the date it was last
 *   regenerated). One value per product, replaced on the next run — never a growing list.
 * - the history is ONE `regeneration` metaobject per run (not per product), shown on the app's
 *   home page and to the merchant under the app's data.
 */
async function markProduct(api: NoqtaApi, productId: Product['id']) {
  const today = new Date().toISOString().slice(0, 10)
  await api.setMetafield(productId, { namespace: 'ai_images', key: 'regenerated_at', type: 'date', value: today })
}

async function saveRun(api: NoqtaApi, job: Job, images: number, titles: string[]) {
  try {
    await api.createMetaobject('regeneration', {
      products: String(job.changed.length),
      images: String(images),
      // Saved as the merchant reads it (App data shows values as they are).
      mode: job.options.style === 'realistic' ? 'صورة واقعية' : `خلفية ${job.options.background.toUpperCase()}`,
      product_titles: titles.join('\n').slice(0, 2000)
    })
  } catch (err) {
    // The images are already updated; a missing history line isn't worth failing the run.
    console.error('history not saved:', (err as Error).message)
  }
}

// Forget finished jobs (and their previews) after a day.
setInterval(() => {
  for (const [id, job] of jobs) {
    if (Date.now() - job.createdAt > 86_400_000 && job.status !== 'generating' && job.status !== 'applying') {
      jobs.delete(id)
      fs.rmSync(path.join(PREVIEWS, id), { recursive: true, force: true })
    }
  }
}, 600_000).unref()
