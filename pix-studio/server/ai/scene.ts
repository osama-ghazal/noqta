import sharp from 'sharp'
import { claudeJson, imageBlock, studyModel, briefModel } from './anthropic.js'

/**
 * The realistic style's text steps, ported from Pix (lib/social/scene.js):
 *
 *   studyProduct  "what is this and how is it used?" — the photograph and the name, nothing else.
 *   briefScene    "now brief a photograph of that" — one paragraph that becomes SCENE: … in the
 *                 image prompt.
 *
 * Two separate calls on purpose: asked for the use and the scene in one answer, the model
 * drifts towards whatever is photogenic rather than what the product does.
 */

const SHOP = 'an online store'

const STUDY_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: { use: { type: 'string', description: 'What the product is and how it is used, 40 to 80 words of English.' } },
  required: ['use']
}

const STUDY = `You are shown a photograph of a single product and the name it is sold under by ${SHOP}. Nothing else is known about it.

Work out what this product is and how it is actually used, and answer in 40 to 80 words of English.

Read the photograph closely and let it lead: the shape, the material and finish, the proportions and real size, compartments, holes, slots, handles, hinges, clamps, blades, feet, a lid, a crank, a gauge. The name is a hint, often abbreviated, ambiguous or in Arabic; where the name and the photograph disagree, the photograph is right.

Say:
- what the product is, in plain words
- what job it does, and at which step
- where it is used
- what goes into it or onto it, and what comes out

Be concrete and specific to THIS object, not to the general category. If you cannot tell what it does, say so plainly and describe the most plausible use — do not invent an elaborate or unusual one to fill the gap.

Do not describe the photograph's lighting, background or styling. Do not mention brands, prices or text. This is not a photo brief; it is an explanation of the product.`

const BRIEF_SCHEMA = {
  type: 'object' as const,
  additionalProperties: false,
  properties: { scene: { type: 'string', description: 'The photo brief: one English paragraph of 80 to 130 words.' } },
  required: ['scene']
}

const BRIEF = `You are the creative director and the photographer for ${SHOP}. You have already been told what the product is and how it is used, and you are shown its photograph.

Write ONE English paragraph of 80 to 130 words briefing a photograph of THIS product performing exactly that use. The explanation of the use is authoritative: never photograph the product doing something else.

It must read like a real photograph taken on location by a professional photographer — not an AI render, not a catalogue or stock photo. Real places are a little imperfect and lived-in; say what makes this one real.

NOBODY IS IN THE PHOTOGRAPH. The product is caught mid-use but completely unattended — the work is evidently happening and no one is there. Never write a person, a hand, an arm or any other body part into the brief, not even in the background and not even out of focus.

The brief says, concretely and specifically:
- the exact setting: the room and the surface it stands on, taken from the use you were given — a particular place, not a generic one.
- how the product appears: where it sits, and the use visibly under way — shown through the product and its surroundings (what is in it, on it, coming out of it), never through a person.
- a few small authentic details that make the place feel real and used: two or three close, plausible props of that setting, and the traces of work.
- the light and the mood: where the light comes from, its quality and the time of day.
- the camera: the angle the product reads best from (eye level, three-quarter, overhead), the distance, and a natural depth of field.
The shop sells to an Arabic-speaking market: where the setting shows a home, kitchen, shop or workplace, it should look like one there — its fittings, tiles, utensils and food — without clichés or anything ceremonial.

Rules:
- The product must be the hero: the largest, sharpest and best-lit thing in the frame, unobstructed, entirely in frame.
- Describe only the photograph. Never mention the brand, the business, prices, text, signage or the product's name.
- Do not describe or change the product's own shape, parts, colour or markings — another instruction handles that.`

/** The merchant's own direction for the scene, applied on top of the brief rules. */
const DIRECTION = 'The store owner asked for this about the photograph. Follow it as long as it keeps to the rules above:'

/** The photo, small: 512px is enough to identify and art-direct from, and keeps a long run cheap. */
const thumbnail = (bytes: Buffer) =>
  sharp(bytes).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()

export async function studyAndBrief(photo: Buffer, name: string, direction?: string): Promise<{ use: string; brief: string }> {
  const thumb = imageBlock(await thumbnail(photo))

  const studied = await claudeJson({
    system: STUDY,
    content: [thumb, { type: 'text', text: `Name on the store: ${name}` }],
    schema: STUDY_SCHEMA,
    name: 'product_use',
    model: studyModel()
  })
  const use = String(studied.use || '').trim()
  if (!use) throw new Error('The model returned no explanation of the product.')

  const text = [`What this product is and how it is used:\n${use}`, direction ? `${DIRECTION} ${direction}` : '']
    .filter(Boolean)
    .join('\n\n')
  const briefed = await claudeJson({
    system: BRIEF,
    content: [thumb, { type: 'text', text }],
    schema: BRIEF_SCHEMA,
    name: 'scene_brief',
    model: briefModel()
  })
  const brief = String(briefed.scene || '').trim()
  if (!brief) throw new Error('The model returned no scene brief.')
  return { use, brief }
}
