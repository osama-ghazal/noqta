// Calls to this app's own server. No token handling here: App Bridge adds the session token
// to every same-origin fetch(), and the server checks it (server/noqta.ts requireSession).

export interface ProductImage {
  id: number
  position: number
  src: string
  alt: string | null
}

export interface Product {
  id: number
  title: string
  images: ProductImage[]
}

export type Style = 'clean' | 'realistic'
export type Mode = 'main' | 'all'

export interface JobOptions {
  style: Style
  background: string
  quality: 'medium' | 'high'
  note?: string
}

export interface JobItem {
  key: string
  productId: number
  imageId: number
  title: string
  original: string
  status: 'pending' | 'generating' | 'ready' | 'failed' | 'applied'
  preview?: string
  error?: string
}

export interface Job {
  id: string
  status: 'generating' | 'review' | 'applying' | 'done' | 'failed'
  options: JobOptions
  items: JobItem[]
  changed: number[]
  errors: { productId: number; message: string }[]
}

async function json<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`)
  return body as T
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function getProducts(ids: number[]): Promise<Product[]> {
  return (await json<{ products: Product[] }>(await fetch(`/api/products?ids=${ids.join(',')}`))).products
}

export async function startJob(productIds: number[], mode: Mode, options: JobOptions): Promise<Job> {
  return (await json<{ job: Job }>(await post('/api/jobs', { product_ids: productIds, mode, ...options }))).job
}

export async function getJob(id: string): Promise<Job> {
  return (await json<{ job: Job }>(await fetch(`/api/jobs/${id}`))).job
}

export async function retryImage(jobId: string, key: string): Promise<Job> {
  return (await json<{ job: Job }>(await post(`/api/jobs/${jobId}/retry`, { key }))).job
}

export async function applyJob(jobId: string, keys: string[], replace: boolean): Promise<Job> {
  return (await json<{ job: Job }>(await post(`/api/jobs/${jobId}/apply`, { keys, replace }))).job
}

export interface HistoryEntry {
  id: number
  fields: { products: string; images?: string; mode?: string; product_titles?: string }
  created_at: string
}

export async function getHistory(): Promise<HistoryEntry[]> {
  const { history } = await json<{ history: HistoryEntry[] }>(await fetch('/api/history'))
  return history.sort((a, b) => b.created_at.localeCompare(a.created_at)) // newest first
}
