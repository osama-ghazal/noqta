/**
 * Prompts for the image model (gemini.ts), ported from Pix (lib/social/prompt.js) and adapted
 * from social posts to store product pages. Priority order: product accuracy first, then the
 * subject, then composition, then style and the "do not" list. English, because the model
 * follows English most reliably.
 */

const ACCURACY = [
  'PRODUCT ACCURACY - THIS IS THE TOP PRIORITY AND OVERRIDES EVERY OTHER INSTRUCTION.',
  'A reference photo of the real product is attached. The product in the output must be the SAME physical object, reproduced exactly:',
  '- Same shape, proportions, dimensions and construction. Never redesign, simplify, stretch or "improve" the product.',
  '- Same number of parts, compartments, holes, handles, wheels, blades, pieces in a set. Never add, remove, duplicate or merge parts.',
  '- Same materials, colours and finishes: stainless steel stays stainless, matte stays matte, plastic stays plastic. Do not recolour.',
  '- Same printed text, logos, engravings and labels, in the same places. Never invent, rewrite, translate or remove text on the product.',
  '- Same camera angle and orientation as the reference, unless the reference is badly angled - then use the nearest clean three-quarter or front view that still shows the same features.',
  'You may change ONLY the photography: background, lighting, sharpness, exposure, white balance, noise, framing and margins.',
  'If any instruction below would require changing the product, keep the product accurate and ignore that instruction.'
].join('\n')

const STYLE = [
  'STYLE: clean professional e-commerce product photography. The product is fully isolated on a TRANSPARENT background: no backdrop, no floor, no surface, no shadow cast onto a surface (a soft shadow that stays within the footprint of the product is fine). Soft, even studio lighting. Crisp focus, true-to-life colour, enhanced clarity compared with the reference (remove noise, fix exposure and colour cast, sharpen details).',
  'DO NOT include: any text, captions, watermarks, logos other than those printed on the product itself, price tags, badges, arrows, hands, people, food, props, other products, decorative objects, reflections of a room, coloured, white or textured backgrounds, borders or frames.'
].join('\n')

const productLine = (name: string) => `Product: "${name}".`

/** The clean style: a cut-out of the product, placed on the merchant's colour afterwards (clean.ts). */
export function packshotPrompt({ name }: { name: string }) {
  return [
    ACCURACY,
    productLine(name),
    'IMAGE: reproduce the product presentation of the reference photo as a packshot. If the reference shows several product objects (a set, a pair), show EXACTLY that many, in the same arrangement. Centred, filling the frame as fully as possible, the whole product inside the frame - nothing cropped.',
    'The image will be placed on a plain background on an online store product page, so the product must be cleanly cut out with clean edges.',
    STYLE
  ].join('\n\n')
}

/**
 * Per-product additions, right after the accuracy block so they keep its priority: a note from
 * the merchant about details the model tends to get wrong.
 */
const SEP = '\n\n'

export function withNote(prompt: string, note?: string) {
  if (!note) return prompt
  const i = prompt.indexOf(SEP)
  const extra = `PRODUCT-SPECIFIC DETAILS (part of product accuracy - top priority): ${note}`
  return i < 0 ? prompt + SEP + extra : prompt.slice(0, i) + SEP + extra + prompt.slice(i)
}

export const PACKSHOT_SIZE = '1024x1024'

/* ------------------------------------------------------------------ scenes */

/**
 * The realistic style: the product photographed in use, on an opaque background. The inverse
 * of STYLE above — props are the point here — but ACCURACY is reused untouched, because a scene
 * that flatters a product the store does not sell is worse than no scene at all.
 */
const SCENE_STYLE = [
  'REALISM: this must look like a real photograph taken on location by a professional photographer — not an AI render, not a 3D visualisation, not a stock or catalogue photo. Real materials, real wear, natural imperfections and small authentic details that make the place feel used.',
  'STYLE: photorealistic editorial photography of the product in real use. A real environment with real surfaces, natural depth of field, believable directional light and true-to-life colour. Food, ingredients, utensils and the props of its station are welcome where they show what the product is for, but they stay secondary: they must never hide, overlap, crowd or obscure the product.',
  'NOBODY IS IN THE PICTURE. The product is shown mid-use but completely unattended: the work is evidently happening, and no one is there. Show the use through the product and its surroundings — food in it or on it, steam, a lit burner, a prepared station, ingredients set out — never through a person handling it.',
  'DO NOT include: people of any kind, or any part of a person — no hands, fingers, arms, shoulders, torsos, legs, faces, silhouettes, out-of-focus people in the background, people reflected in a surface, and no mannequins, dolls or statues. Also do not include: any text, captions, lettering, signage, menus, watermarks, price tags, badges, arrows, logos other than those printed on the product itself, other products of the same kind competing for attention, a collage, a split screen, a border or a frame.'
].join('\n')

export function scenePrompt({ brief, name }: { brief: string; name: string }) {
  return [
    ACCURACY,
    productLine(name),
    `SCENE: ${brief}`,
    'FRAME: a square 1:1 photograph filling the entire canvas edge to edge — no borders, letterboxing or padding.\nCOMPOSITION: a square picture for an online store product page. The product is the unmistakable hero of the frame — the largest, sharpest and best-lit thing in it. Centre it with comfortable room on every side, entirely inside the frame, nothing cropped.',
    SCENE_STYLE
  ].join('\n\n')
}

export const SCENE_SIZE = '1024x1024'
