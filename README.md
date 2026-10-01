# E.C.H.O. — AI Skill Coach

**Learn a physical skill from a coach that actually watches you.** E.C.H.O. teaches you
to use chopsticks through your webcam: it tracks your hand live, measures your technique,
corrects you in plain language one step at a time, and remembers your progress between
sessions.

**Try it live: [echo-skill-coach.vercel.app](https://echo-skill-coach.vercel.app)** — no
chopsticks handy? Two pens or pencils work for practice.

> Built for the Modern Stack Hackathon with **Convex**, **OpenAI**, **Better Auth**, and
> **Resend**.

---

## What it does

1. **Watches your hand in real time.** Hand tracking runs entirely in the browser
   (MediaPipe). No video is recorded or uploaded.
2. **Measures your technique.** It turns 21 hand landmarks into real numbers, updated
   live: how far your pointer and middle fingers open and close (**pivot range**), how
   much your ring finger (which holds the bottom chopstick) moves (**anchor movement**),
   and what share of the motion comes from the right fingers (**isolation**).
3. **Teaches you step by step.** A 4-step lesson (pick up → grip → move only the top
   stick → practice) with literal, beginner-level directions. When you make a mistake,
   you get *one* correction at a time, held long enough to read and try. If the same
   mistake keeps happening, the coach explains it a different way, then gives you a drill.
4. **Confirms what it can't measure.** The hand tracker sees your hand, not the
   chopsticks. So before a grip step passes, one still frame goes to an OpenAI vision
   model that checks: are there really two chopsticks, in one hand, held correctly? It
   returns a structured verdict, and hard facts in the code gate it. The model can't wave
   you through on its own. If the finger tracker keeps flagging your ring finger, the
   coach compares an *open* and a *closed* frame to judge the real goal directly: did
   the bottom chopstick stay still while only the top one moved?
5. **Remembers you — and gives you a reason to come back.** Sign in and every session is
   saved to your account. The progress dashboard updates live while you practice, tracks
   your daily practice streak and personal bests, and finishing a session emails you a
   recap with the one thing to focus on next time.

## Why it isn't "just an LLM wrapper"

Most of E.C.H.O.'s intelligence is **measured, not generated**:

```
webcam ─▶ MediaPipe hand landmarks (in browser)
           │
           ▼
       feature engine ── smoothing (One Euro filter), glitch-frame rejection,
           │             3D finger-bend angles, grip-shape + two-hand detection
           ▼
       lesson engine ─── step gating, one correction at a time, escalating hints,
           │             progress that mistakes drain (you can't fake a pass)
           │
           ├──▶ OpenAI vision (grip checkpoints + open/closed motion check) ──
           │        structured JSON verdict, gated by code-checked facts
           │        (2 sticks, 1 hand, bottom stick still, confidence threshold)
           │
           └──▶ Convex ── sessions, steps, AI checks, corrections, metric samples
                    │     (live dashboard via reactive queries)
                    ├──▶ Better Auth ── progress follows your account across devices
                    └──▶ Resend ── recap email when you finish a session
```

The code decides whether you're doing it right, from numbers it measured. The AI handles
the one thing numbers can't: seeing the chopsticks themselves.

## How each sponsor is used

| Sponsor | What it does in E.C.H.O. | Where |
|---|---|---|
| **Convex** | The whole backend: 6-table schema (skills, sessions, step events, AI checks, corrections, metric samples) with denormalized counters; every lesson event is written as it happens, and the dashboard is made of reactive queries, so it updates live with no refresh or polling. Also hosts Better Auth (component + HTTP routes), and queues the recap email through the Resend component in the same transaction that ends a session. | `convex/` |
| **OpenAI** | Vision checks for what hand tracking can't see: chopsticks present, correct grip (not a fist, not crossed), and — comparing an open and a closed frame — whether the bottom chopstick stays still. Structured Outputs (strict JSON schema): `pass`, `issue`, `correction`, `confidence`, counts of sticks and hands, bottom/top stick motion. The verdict and the tracker's measurements at that moment are stored together. | `src/app/api/coach/check/route.ts` |
| **Better Auth** | Email + password accounts via `@convex-dev/better-auth`. Signing in claims the sessions you practiced on that device before signing in, so nothing is lost, and your history follows you to any device. Ownership is derived server-side from the auth token, never from client arguments. | `convex/auth.ts`, `src/components/AccountMenu.tsx` |
| **Resend** | Session recap email via `@convex-dev/resend` (durable, batched, exactly once): steps reached, AI checks passed, practice time, best isolation, and your most-corrected mistake with a specific drill. | `convex/recap.ts` |

## Tech

- **Next.js 16** (App Router) · **React 19** · **Tailwind CSS 4**
- **MediaPipe Tasks Vision** hand landmarker (WASM + GPU, CPU fallback), loaded on demand
- **Convex** (database, functions, components: `@convex-dev/better-auth`, `@convex-dev/resend`)
- **OpenAI** Responses API with a strict JSON schema

Key files:

| Path | What's in it |
|---|---|
| `src/lib/chopstickFeatures.ts` | Feature engine: smoothing, glitch rejection, bend angles, metrics, grip shape |
| `src/lib/chopstickCoaching.ts` | Lesson engine: steps, corrections, hint ladders, reading-time pacing, vision gate |
| `src/lib/sessionRecorder.ts` | Streams lesson events + metric samples into Convex |
| `src/components/Dashboard.tsx` | Live progress dashboard |
| `convex/schema.ts`, `convex/sessions.ts` | Data model and session functions |

## Run it locally

Requirements: Node 20+, a Convex account, an OpenAI API key. A Resend key is optional
(needed only for recap emails).

```bash
npm install

# 1. Start Convex (creates a dev deployment and writes .env.local)
npx convex dev

# 2. Better Auth settings on the Convex deployment
npx convex env set BETTER_AUTH_SECRET=$(openssl rand -base64 32)
npx convex env set SITE_URL http://localhost:3000

# 3. Optional: recap emails
npx convex env set RESEND_API_KEY=re_...

# 4. OpenAI key for the vision checkpoint — add to .env.local:
#    OPENAI_API_KEY=sk-...
#    (optional) OPENAI_MODEL=gpt-5.4-mini

# 5. In another terminal
npm run dev
```

Open http://localhost:3000, allow camera access, and pick up some chopsticks.

## Privacy

Hand tracking runs in your browser, and no video is recorded. At a grip checkpoint, a
single still frame (or, for the motion check, two) is sent to OpenAI to verify the
chopsticks. Your measurements, lesson
events, and the AI's verdicts are stored in Convex so your progress can be shown back
to you.

## Credits

Built by Jaden Coley, with help from [Claude Code](https://claude.com/claude-code) as a
coding assistant.
