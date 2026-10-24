/**
 * Claude for the realistic style's text steps: studying a product and writing its photo brief
 * (scene.ts). Ported from Pix (lib/social/anthropic.js). Plain fetch, no SDK.
 *
 *   ANTHROPIC_API_KEY
 *   SCENE_STUDY_MODEL   default claude-opus-5-5   — identifying the product is the step worth the best model
 *   SCENE_BRIEF_MODEL   default claude-sonnet-5-5 — writing the brief from that
 */

const URL_MESSAGES = 'https://api.anthropic.com/v1/messages'
const apiKey = () => process.env.ANTHROPIC_API_KEY || process.env.anthropic_api_key || ''

export const hasAnthropicKey = () => Boolean(apiKey())
export const studyModel = () => process.env.SCENE_STUDY_MODEL || 'claude-opus-5-5'
export const briefModel = () => process.env.SCENE_BRIEF_MODEL || 'claude-sonnet-5-5'

export class AnthropicError extends Error {}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** A JPEG/PNG buffer as a Claude image block. */
export const imageBlock = (bytes: Buffer, type = 'image/jpeg') => ({
  type: 'image',
  source: { type: 'base64', media_type: type, data: bytes.toString('base64') }
})

type Block = ReturnType<typeof imageBlock> | { type: 'text'; text: string }
interface Schema {
  type: 'object'
  properties: Record<string, unknown>
  [k: string]: unknown
}

/** One structured answer, through a tool call: returns the tool arguments. */
export async function claudeJson({
  system,
  content,
  schema,
  name,
  model,
  maxTokens = 1500
}: {
  system: string
  content: Block[]
  schema: Schema
  name: string
  model: string
  maxTokens?: number
}): Promise<Record<string, unknown>> {
  if (!hasAnthropicKey()) throw new AnthropicError('Anthropic is not configured on this server (ANTHROPIC_API_KEY).')
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    // Not every model takes a forced tool_choice, so the system prompt asks for the call.
    system: `${system}\n\nGive your answer only by calling the \`${name}\` tool.`,
    messages: [{ role: 'user', content }],
    tools: [{ name, description: 'Return the answer.', input_schema: schema }],
    tool_choice: { type: 'auto' }
  })
  // Overloaded or rate-limited: a couple of patient retries before giving up.
  for (let attempt = 0; ; attempt++) {
    let r: Response
    try {
      r = await fetch(URL_MESSAGES, {
        method: 'POST',
        headers: { 'x-api-key': apiKey(), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(120_000)
      })
    } catch (e) {
      if (attempt < 2) {
        await sleep(1500 * (attempt + 1))
        continue
      }
      throw new AnthropicError(`Claude request failed: ${(e as Error)?.message || e}`)
    }
    const j = await r.json().catch(() => ({}))
    if ((r.status === 429 || r.status === 529 || r.status >= 500) && attempt < 2) {
      await sleep(Number(r.headers.get('retry-after')) * 1000 || 2000 * (attempt + 1))
      continue
    }
    if (!r.ok) throw new AnthropicError(j.error?.message || `Claude returned HTTP ${r.status}.`)
    const blocks: { type: string; name?: string; input?: Record<string, unknown>; text?: string }[] = j.content || []
    const call = blocks.find((c) => c.type === 'tool_use' && c.name === name)
    if (call) return call.input || {}
    // Answered in prose instead: take a JSON object from it, or — for a one-field schema — the text itself.
    const text = blocks
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('\n')
      .trim()
    const m = /\{[\s\S]*\}/.exec(text)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* not JSON */
      }
    }
    const fields = Object.keys(schema.properties || {})
    if (text && fields.length === 1) return { [fields[0]]: text }
    throw new AnthropicError('Claude returned no answer.')
  }
}
