import sharp from 'sharp'

/**
 * Image edits on Gemini (gemini-3.1-flash-image, "Nano Banana 2"), ported from Pix
 * (lib/social/gemini.js). Plain fetch against generateContent.
 *
 * Gemini has no transparent output: asked for one, it paints a checkerboard into an opaque
 * JPEG. So a cut-out is drawn on flat chroma green and the green is keyed out here (keyOut)
 * into a real alpha PNG.
 */

const ENDPOINT = (model: string) => `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`

const apiKey = () => process.env.GEMINI_API_KEY || process.env.gemini_api_key || ''
export const hasImageKey = () => Boolean(apiKey())
export const imageModel = () => process.env.GEMINI_IMAGE_MODEL || 'gemini-3.1-flash-image'

export class ImageError extends Error {}

export type Quality = 'medium' | 'high'
export interface ImageRef {
  bytes: Buffer
  type: string
}

const RETRY_DELAYS_MS = [8_000, 20_000, 40_000]
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** '1024x1536' → '2:3' — Gemini takes an aspect ratio, not pixels. */
function aspectOf(size: string) {
  const [w, h] = size.split('x').map(Number)
  const g = (a: number, b: number): number => (b ? g(b, a % b) : a)
  const d = g(w, h) || 1
  return `${w / d}:${h / d}`
}

/** Appended to transparent requests: the background is removed after generation, so it must be keyable. */
const CHROMA =
  'BACKGROUND OVERRIDE — this replaces every instruction above about the background: this image cannot hold transparency, so place the product on a perfectly flat, uniform, pure chroma-key green background (#00FF00) filling the whole frame, edge to edge. No gradient, no texture, no vignette, no checkerboard pattern, no floor, no cast shadow and no green reflections or green tint on the product. The green is removed automatically afterwards, so keep a clean, sharp edge between the product and the green.'

async function generate({ prompt, refs, size, quality }: { prompt: string; refs: ImageRef[]; size: string; quality: Quality }) {
  const key = apiKey()
  if (!key) throw new ImageError('AI image generation is not configured on this server (GEMINI_API_KEY).')
  const body = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }, ...refs.map((r) => ({ inlineData: { mimeType: r.type, data: r.bytes.toString('base64') } }))]
      }
    ],
    generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspectOf(size), imageSize: quality === 'high' ? '2K' : '1K' } }
  })
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(ENDPOINT(imageModel()), {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body
    })
    if (res.ok) {
      const json = await res.json()
      const cand = json.candidates?.[0]
      const part = cand?.content?.parts?.find((p: { inlineData?: { data?: string } }) => p.inlineData?.data)
      if (part) return Buffer.from(part.inlineData.data, 'base64')
      const said = cand?.content?.parts
        ?.map((p: { text?: string }) => p.text)
        .filter(Boolean)
        .join(' ')
      throw new ImageError(
        `Gemini returned no image (${cand?.finishReason || json.promptFeedback?.blockReason || 'no candidate'})${said ? `: ${said.slice(0, 200)}` : '.'}`
      )
    }
    const retryable = res.status === 429 || res.status >= 500
    if (retryable && attempt < RETRY_DELAYS_MS.length) {
      await sleep(RETRY_DELAYS_MS[attempt])
      continue
    }
    let message = `Gemini request failed (${res.status}).`
    try {
      message = (await res.json()).error?.message || message
    } catch {
      /* keep status line */
    }
    throw new ImageError(message)
  }
}

/**
 * Edit reference photos into a new image: a PNG with real transparency for background
 * 'transparent', else a JPEG.
 */
export async function editImage({
  prompt,
  images,
  size,
  quality = 'medium',
  background = 'transparent'
}: {
  prompt: string
  images: ImageRef[]
  size: string
  quality?: Quality
  background?: 'transparent' | 'opaque'
}): Promise<Buffer> {
  const transparent = background === 'transparent'
  const out = await generate({ prompt: transparent ? `${prompt}\n\n${CHROMA}` : prompt, refs: images, size, quality })
  if (transparent) return keyOut(out)
  return sharp(out).jpeg({ quality: 92 }).toBuffer()
}

/**
 * The green background out, as alpha. The key colour is read from the frame's border (the
 * model's "#00FF00" is never exact). Background = pixels close to it that touch the border
 * (flood fill), plus near-exact matches anywhere, which empties enclosed gaps such as the
 * inside of a handle. One pixel of soft edge, and green spill pulled off the product's rim.
 */
export async function keyOut(bytes: Buffer, { near = 70, exact = 40, soft = 130 } = {}): Promise<Buffer> {
  const { data, info } = await sharp(bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  const n = w * h
  const px = (i: number) => [data[i * 3], data[i * 3 + 1], data[i * 3 + 2]]

  // The key: the median border colour.
  const border: number[] = []
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
  for (let y = 1; y < h - 1; y++) border.push(y * w, y * w + w - 1)
  const med = (c: number) => border.map((i) => data[i * 3 + c]).sort((a, b) => a - b)[border.length >> 1]
  const key = [med(0), med(1), med(2)]
  const dist = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const [r, g, b] = px(i)
    dist[i] = Math.hypot(r - key[0], g - key[1], b - key[2])
  }

  const bg = new Uint8Array(n)
  const stack = border.filter((i) => dist[i] < near)
  for (const i of stack) bg[i] = 1
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
      if (j >= 0 && j < n && !bg[j] && dist[j] < near) {
        bg[j] = 1
        stack.push(j)
      }
    }
  }
  for (let i = 0; i < n; i++) if (dist[i] < exact) bg[i] = 1
  // Pockets the flood cannot reach (between a diffuser's reeds, inside a handle) keep the model's
  // bright chroma green: any strongly saturated, bright green pixel goes too. A dark green
  // product (green glass, a forest label) is nowhere near this bright, so it is left alone.
  const greenKey = key[1] > key[0] + 40 && key[1] > key[2] + 40
  if (greenKey) {
    for (let i = 0; i < n; i++) {
      const [r, g, b] = px(i)
      if (!bg[i] && g > 150 && g > r + 70 && g > b + 70) bg[i] = 1
    }
  }

  // How far each product pixel is from the background, up to RIM px: the rim is where green spills.
  const RIM = 4
  const ring = new Uint8Array(n)
  let front: number[] = []
  for (let i = 0; i < n; i++) if (bg[i]) front.push(i)
  for (let d = 1; d <= RIM && front.length; d++) {
    const next: number[] = []
    for (const i of front) {
      const x = i % w
      for (const j of [i - w, i + w, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1]) {
        if (j >= 0 && j < n && !bg[j] && !ring[j]) {
          ring[j] = d
          next.push(j)
        }
      }
    }
    front = next
  }

  const out = Buffer.alloc(n * 4)
  for (let i = 0; i < n; i++) {
    let [r, g, b] = px(i)
    let a = 255
    if (bg[i]) a = 0
    else if (ring[i]) {
      if (ring[i] === 1 && dist[i] < soft) a = Math.round((255 * (dist[i] - near)) / (soft - near))
      if (greenKey) g = Math.min(g, Math.max(r, b)) // spill: the rim takes on the background's green
    }
    out[i * 4] = r
    out[i * 4 + 1] = g
    out[i * 4 + 2] = b
    out[i * 4 + 3] = Math.max(0, Math.min(255, a))
  }
  return sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer()
}
