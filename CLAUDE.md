# Arqen AI Studio

A local app that turns an article URL, script or notes into a finished YouTube video or Short (script, voice, B-roll, captions, thumbnails), used to run the Arqen Build channel.

## The goal
For me as a solo creator: get from idea to an upload-ready video with as little manual work as possible.

## Always
- Check for running jobs before editing `packages/*`. The worker runs on tsx watch and restarts, killing renders.
- Ask before big builds or multi-agent work. I watch my usage limit.
- Run tools via `node` directly (e.g. `node node_modules/vitest/vitest.mjs`). npm `.bin` shims are blocked on this machine.
- Commit only when I ask.

## Never
- Never commit or print `.env` or API keys.
- Never delete anything in `data/`.
- Never call paid APIs (ElevenLabs, Claude) just to test something without asking.

## Where things live
- `packages/core/src`: pipeline (steps, providers, CLI, DB, Shorts, news watcher, Telegram)
- `packages/video`: Remotion compositions for video and thumbnails
- `apps/web`: Next.js UI. `apps/worker`: job runner
- `data/`: live projects, `studio.db`, YouTube token. Read, don't touch.
- `HANDOVER.md`: current status and handover notes
- Commands: `npm run dev`, `npm test`, `npm run typecheck`

## How to talk to me
- Swedish. Short and direct.
- One line on why you made a choice, then move on.
