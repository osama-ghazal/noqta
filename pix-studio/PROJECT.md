# This app

Notes about this particular app for you, your team and your AI assistant. `nqs` never changes
this file (AGENTS.md and docs/ are managed by `nqs` and replaced on update).

- What the app does: **Pix Studio** regenerates product photos with AI, ported from the Pix
  project (`C:\Users\semog\Pix-new\lib\social`). Two styles:
  - **clean** (خلفية نظيفة): Gemini cuts the product out on chroma green, `keyOut` turns the green
    into alpha, then the product is centred on a square canvas of the merchant's colour (white by
    default, any hex).
  - **realistic** (صورة واقعية): Claude studies the photo (what is it, how is it used), Claude
    writes a scene brief, Gemini edits the photo into that scene. No people in the picture.
- Flow: settings → **previews** (nothing on the store changes) → the merchant keeps some and
  either replaces the originals (same position) or adds them as new images. Single images can
  be re-generated before saving.
- Where it is hosted (application_url): not yet — dev only through `nqs app dev`.
- Your backend / AI service: `server/ai/` (gemini.ts, anthropic.ts, prompt.ts, scene.ts, trim.ts),
  `server/regenerate.ts` is the entry point. Keys: `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` in `.env`.
- Decisions and conventions:
  - Previews live in `data/previews/<job id>/` and are served at `/previews/…` without a session
    token (`<img>` can't send one); the unguessable job id is the key. Deleted after a day.
  - Jobs are in memory (3 AI calls in parallel per job): a server restart loses unfinished runs.
    Use a real queue and object storage before going to production.
  - Prompts stay in English (the image model follows English best); everything shown to
    merchants is Arabic.
