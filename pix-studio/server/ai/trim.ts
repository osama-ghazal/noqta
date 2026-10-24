import sharp from 'sharp'

/**
 * Crop a transparent PNG to its opaque content, plus a small margin (ported from Pix,
 * lib/social/trim.js). sharp's built-in trim keys on the corner colour, which is unreliable for
 * alpha, so the bounding box is read from the alpha channel.
 *
 * pad = margin as a fraction of the longer side; alpha = pixels at or below this count as empty.
 */
export async function trimTransparent(png: Buffer, { pad = 0.02, alpha = 8 } = {}): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height, channels } = info
  let top = height,
    left = width,
    bottom = -1,
    right = -1
  for (let y = 0; y < height; y++) {
    const row = y * width * channels
    for (let x = 0; x < width; x++) {
      if (data[row + x * channels + 3] > alpha) {
        if (y < top) top = y
        if (y > bottom) bottom = y
        if (x < left) left = x
        if (x > right) right = x
      }
    }
  }
  if (bottom < 0) return png // fully transparent: leave it
  const margin = Math.round(Math.max(width, height) * pad)
  const x0 = Math.max(0, left - margin)
  const y0 = Math.max(0, top - margin)
  const x1 = Math.min(width, right + 1 + margin)
  const y1 = Math.min(height, bottom + 1 + margin)
  if (x0 === 0 && y0 === 0 && x1 === width && y1 === height) return png
  return sharp(png).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).png().toBuffer()
}
