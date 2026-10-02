# livekit/agents-js#2615 on the base model: reproduction and patch check

A check of [livekit/agents-js#2615](https://github.com/livekit/agents-js/issues/2615) on
`gemini-3.8-live` (base model), run on 2026-10-02 with agents-js and the Google plugin 1.9.1,
`toolBehavior` unset, and the patch to `isNewGeneration()` proposed in the issue.
Discussion: [r/FrontierOnGCP](https://www.reddit.com/r/FrontierOnGCP/). License: MIT.

## Result

On the base model, agents-js 1.9.1 opens a phantom agent-initiated generation 2 to 7 ms after
every `toolCall` (5 of 5 unpatched runs). The trigger is the content-free `generationComplete`
that follows the call. The phantom's `input_speech_started` interrupts the speech that owns the
call. Whether the tool result is then lost depends on where that speech is:

- **The model calls the tool before saying anything (3 runs).** The owning speech has already
  finished its generation tasks and is waiting on the tool. It is marked interrupted, but the
  code after the tool runs does not check that flag again, so `FunctionToolsExecuted` is emitted
  and the function response is sent: delivered 3 of 3.
- **The model speaks first, then calls (2 runs, the issue's case).** The owning speech is still
  playing out, so it takes the interrupted branch. The spoken line is cut after 0.4 to 0.6 s,
  `execute()` still completes 3 s later, `FunctionToolsExecuted` is never emitted, no function
  response is sent, and the model stays silent until the session closes 12 s later: delivered
  0 of 2.

With the patch: no phantom generation and no `input_speech_started` after the call (0 of 5),
the result is delivered 5 of 5, the line spoken before the call plays in full, and the model
speaks the post-tool confirmation.

| Prompt | Plugin | Runs | Phantom generation after `toolCall` | Owning speech interrupted | `FunctionToolsExecuted` | Function response sent | Line spoken before the call |
|---|---|---|---|---|---|---|---|
| call first | 1.9.1 | 3 | 3/3, +3 to +4 ms | 3/3 (not aborted) | 3/3 | 3/3 | none |
| call first | patched | 3 | 0/3 | 0/3 | 3/3 | 3/3 | none |
| speak first | 1.9.1 | 2 | 2/2, +2 to +7 ms | 2/2 (aborted +2, +8 ms) | 0/2 | 0/2 | cut after 442 and 643 ms |
| speak first | patched | 2 | 0/2 | 0/2 | 2/2 | 2/2 | played in full |

So on the base model the drop is a race: any audio before the call loses it.

## Why the call-first baseline survives

The result is dropped in one place in `agent_activity.ts` (`_realtimeGenerationTaskImpl`): the
`if (speechHandle.interrupted)` check right after `waitIfNotInterrupted`. With no audio before
the call, the generation tasks finish within a few ms, before the phantom's
`input_speech_started` lands; the speech then waits on the tool, and the code after
`await executeToolsTask.result` emits `FunctionToolsExecuted` without checking the flag again.
With audio before the call, the speech is still playing out, takes the interrupted branch and
returns early.

## Versions

- `@livekit/agents` 1.9.1, `@livekit/agents-plugin-google` 1.9.1, `@livekit/rtc-node` 1.1.0,
  `@google/genai` 2.27.0 (plugin dependency), `zod` 3.25.76 (exact versions in `app/package-lock.json`)
- Node v26.9.0, macOS
- Model `gemini-3.8-live`, Gemini API (AI Studio key). No LiveKit server.
- Plugin file `dist/realtime/realtime_api.js` hashes are recorded in each run's `run_start` line.

## Harness (no human, no server)

`AgentSession.start({ agent })` works with no room and no job context, using whatever is
assigned to `session.input.audio` and `session.output.audio`. `voice.testing` only takes text
input, and the `console` subcommand needs a microphone, so `app/run.mjs` uses:

- `FileAudioInput` (extends `voice.AudioInput`): 20 ms PCM16 frames paced in real time; 1 s of
  silence, then `assets/book.wav` ("Book me the 3pm slot tomorrow, please.", 16 kHz mono,
  synthetic speech, 2.69 s), then silence. Gemini's default server-side voice detection handles
  turn-taking.
- `SimAudioOutput` (extends `voice.AudioOutput`): simulated real-time playout with the same
  contract as `ParticipantAudioOutput`.
- `google.beta.realtime.RealtimeModel({ model: 'gemini-3.8-live', connOptions: { maxRetry: 0 } })`,
  `toolBehavior` and `toolResponseScheduling` unset (`maxRetry: 0` only limits reconnects).
- One tool, `book_slot(slot)`: waits 3 s, ignores the abort signal like a real side effect, and
  logs start and finish.
- Prompts: "call first" (the issue-neutral instruction used in our raw-SDK runs) and
  `VARIANT=speak_first` (say one short sentence first, then call in the same turn).
- Evidence: one JSONL per run in `app/runs/` with agents-js and plugin debug logs
  (`LK_GOOGLE_DEBUG=1`), harness marks, and a wrapper on `@google/genai`
  `Session.prototype.sendToolResponse`, so "function response sent" is checked where the SDK
  sends it. `app/analyze.py` computes the metrics relative to the `toolCall` server event.

## Reproduce

```sh
cd app
npm ci
cp ../.env.example .env            # put GEMINI_API_KEY=... in it
LK_GOOGLE_DEBUG=1 node --env-file=.env run.mjs baseline-1 > runs/baseline-1.jsonl
VARIANT=speak_first LK_GOOGLE_DEBUG=1 node --env-file=.env run.mjs baseline-speakfirst-1 > runs/baseline-speakfirst-1.jsonl
python3 ../patches/apply_dist_patch.py .      # exact-text edit of dist/realtime/realtime_api.js and .cjs
LK_GOOGLE_DEBUG=1 node --env-file=.env run.mjs patched-1 > runs/patched-1.jsonl
VARIANT=speak_first LK_GOOGLE_DEBUG=1 node --env-file=.env run.mjs patched-speakfirst-1 > runs/patched-speakfirst-1.jsonl
python3 analyze.py runs/*.jsonl
```

To go back to the published plugin, copy `patches/orig/realtime_api.js` and `.cjs` over
`node_modules/@livekit/agents-plugin-google/dist/realtime/`. The patch is `patches/dist.diff`;
the equivalent TypeScript change, matching the issue body, is `patches/src.diff`.

`patches/orig/realtime_api.js` and `.cjs` are unmodified files from `@livekit/agents-plugin-google` 1.9.1 (Apache-2.0, LiveKit), kept so the patch can be reverted; they are not covered by this repository's MIT license.

## Limits

- Small N: 3 + 3 runs (call first), 2 + 2 (speak first).
- The speak-first variant is ours; the issue's own steps do not ask the model to speak first.
- Simulated audio output, no WebRTC track.
- Not tested: `gemini-3.8-live-extended-thinking`, NON_BLOCKING and PR #2594, a fast-failing
  tool, Vertex AI.
- Each run also opens a short setup-only websocket (about 0.3 s, no audio) when the session is
  created; 21 connections in total for 11 run attempts (one stopped at startup, kept as
  `runs/aborted-0.jsonl`).
- The absolute path of the WAV in the logs was rewritten to `assets/book.wav` for publication;
  nothing else in the logs was changed.

An AI coding agent wrote this harness under direction; the setup and the claims were reviewed
before publication.
