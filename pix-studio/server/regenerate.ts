import sharp from 'sharp'
import { editImage, ImageError, type Quality } from './ai/gemini.js'
import { PACKSHOT_SIZE, packshotPrompt, SCENE_SIZE, scenePrompt, withNote } from './ai/prompt.js'
import { studyAndBrief } from './ai/scene.js'
import { trimTransparent } from './ai/trim.js'

/**
 * The app's AI (ported from Pix): one product photo in, one new product photo out.
 *
 *   clean      the product cut out (Gemini on chroma green, keyed out), then centred on a
 *              square canvas of the merchant's colour — white by default.
 *   realistic  Claude studies the product and briefs a scene, Gemini edits the photo into it.
 */

export type Style = 'clean' | 'realistic'

export interface RegenerateOptions {
  style: Style
  /** Clean style: the canvas colour, #rrggbb. */
  background: string
  quality: Quality
  /** Details the model tends to get wrong (clean), or the scene the merchant wants (realistic). */
  note?: string
}

export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)

async function download(src: string) {
  const res = await fetch(src)
  if (!res.ok) throw new Error(`Could not download ${src} (${res.status})`)
  const bytes = Buffer.from(await res.arrayBuffer())
  // Gemini takes JPEG/PNG/WebP; store images are WebP, re-encode anything odd (and apply EXIF rotation).
  return { bytes: await sharp(bytes).rotate().png().toBuffer(), type: 'image/png' }
}

/** Returns a JPEG. */
export async function regenerateImage(src: string, name: string, options: RegenerateOptions): Promise<Buffer> {
  const photo = await download(src)
  try {
    return options.style === 'realistic' ? await realistic(photo, name, options) : await clean(photo, name, options)
  } catch (err) {
    if (err instanceof ImageError) throw new Error(`Image generation failed: ${err.message}`)
    throw err
  }
}

/** Margin around the product on the canvas, as a fraction of the canvas side. */
const MARGIN = 0.08

async function clean(photo: { bytes: Buffer; type: string }, name: string, options: RegenerateOptions) {
  const cutout = await editImage({
    prompt: withNote(packshotPrompt({ name }), options.note),
    images: [photo],
    size: PACKSHOT_SIZE,
    quality: options.quality,
    background: 'transparent'
  })
  // Crop to the product, then place it centred on the merchant's colour.
  const product = await trimTransparent(cutout, { pad: 0 }).catch(() => cutout)
  const { width = 1024, height = 1024 } = await sharp(product).metadata()
  const side = Math.round(Math.max(width, height) / (1 - 2 * MARGIN))
  return sharp({ create: { width: side, height: side, channels: 3, background: options.background } })
    .composite([{ input: product, gravity: 'centre' }])
    .jpeg({ quality: 92 })
    .toBuffer()
}

async function realistic(photo: { bytes: Buffer; type: string }, name: string, options: RegenerateOptions) {
  const { brief } = await studyAndBrief(photo.bytes, name, options.note)
  return editImage({
    prompt: scenePrompt({ brief, name }),
    images: [photo],
    size: SCENE_SIZE,
    quality: options.quality,
    background: 'opaque'
  })
}
