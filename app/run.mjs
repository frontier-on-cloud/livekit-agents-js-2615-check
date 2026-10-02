// One live Gemini session through agents-js AgentSession, no LiveKit room, no human.
// Input: a recorded 16 kHz mono WAV pushed in real time through a custom AudioInput.
// Output: a simulated real-time AudioOutput (playout timed from the pushed duration).
// Usage: node --env-file=.env run.mjs <label>   (stdout = JSON log lines, one per event)
import { initializeLogger, llm, stream, voice } from '@livekit/agents';
import * as google from '@livekit/agents-plugin-google';
import { AudioFrame } from '@livekit/rtc-node';
import { Live, Session } from '@google/genai';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const LABEL = process.argv[2] ?? 'run';
const MODEL = process.env.MODEL ?? 'gemini-3.8-live';
const WAV =
  process.env.WAV ??
  new URL('./assets/book.wav', import.meta.url).pathname;
const TOOL_MS = 3000; // tool execute() duration
const LEAD_SILENCE_MS = 1000; // silence before the clip
const AFTER_TOOL_MS = 12000; // keep the session open this long after execute() resolves
const HARD_TIMEOUT_MS = 40000; // whole run cap
const FRAME_MS = 20;

// Same instruction and tool as the raw google-genai measurements.
const INSTRUCTIONS_CALL_FIRST =
  'You are a scheduling assistant. When the user asks to book a slot, call ' +
  'book_slot immediately, then tell the user you are booking it. Keep replies ' +
  'to one or two short sentences. If the user tells you to stop or cancel, ' +
  'tell them plainly whether the booking was already made or not.';
// Variant: ask the model to speak before the call, so the speech that owns the call is
// still playing out when the trailing generationComplete arrives (the reporter's case).
const INSTRUCTIONS_SPEAK_FIRST =
  'You are a scheduling assistant. When the user asks to book a slot, first say one ' +
  'short sentence telling the user you are booking it, then call book_slot in the same ' +
  'turn. Keep replies to one or two short sentences.';
const VARIANT = process.env.VARIANT ?? 'call_first';
const INSTRUCTIONS = VARIANT === 'speak_first' ? INSTRUCTIONS_SPEAK_FIRST : INSTRUCTIONS_CALL_FIRST;

function mark(event, extra = {}) {
  process.stdout.write(JSON.stringify({ harness: true, time: Date.now(), event, ...extra }) + '\n');
}

// ---- count live sessions and see every function response at the SDK boundary ----
// The plugin opens a first websocket when AgentActivity creates the RealtimeSession, then
// closes it and reconnects as soon as the agent's tools are applied (updateTools ->
// markRestartNeeded), before any audio is sent. So a normal run has exactly 2 connects,
// the second within a few hundred ms. Anything else aborts the run (budget guard).
const RUN_T0 = Date.now();
let connects = 0;
const origConnect = Live.prototype.connect;
Live.prototype.connect = async function (params) {
  connects += 1;
  const fns = (params?.config?.tools ?? []).flatMap((t) => t.functionDeclarations ?? []);
  mark('genai_live_connect', {
    n: connects,
    model: params?.model,
    functionDeclarations: fns.map((f) => ({ name: f.name, behavior: f.behavior ?? 'unset' })),
  });
  if (connects > 2 || (connects === 2 && Date.now() - RUN_T0 > 3000)) {
    mark('abort_extra_connect', { n: connects });
    process.exit(3);
  }
  return origConnect.call(this, params);
};
const origSendToolResponse = Session.prototype.sendToolResponse;
Session.prototype.sendToolResponse = function (params) {
  const frs = params?.functionResponses ?? [];
  mark('genai_send_tool_response', {
    responses: frs.map((f) => ({ id: f.id, name: f.name, willContinue: f.willContinue })),
  });
  return origSendToolResponse.call(this, params);
};

// ---- WAV reader (PCM16 mono) ----
function readWavPcm16(path) {
  const buf = readFileSync(path);
  let off = 12;
  let fmt;
  while (off < buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') {
      fmt = {
        channels: buf.readUInt16LE(off + 10),
        sampleRate: buf.readUInt32LE(off + 12),
        bits: buf.readUInt16LE(off + 22),
      };
    } else if (id === 'data') {
      const data = buf.subarray(off + 8, off + 8 + size);
      const pcm = new Int16Array(data.length / 2);
      for (let i = 0; i < pcm.length; i++) pcm[i] = data.readInt16LE(i * 2);
      return { ...fmt, pcm };
    }
    off += 8 + size + (size % 2);
  }
  throw new Error('no data chunk');
}

// ---- recorded-audio input ----
class FileAudioInput extends voice.AudioInput {
  constructor(pcm, sampleRate) {
    super();
    this.pcm = pcm;
    this.sampleRate = sampleRate;
    this.channel = stream.createStreamChannel();
    this.multiStream.addInputStream(this.channel.stream());
    this.stopped = false;
  }
  start() {
    const spf = (this.sampleRate * FRAME_MS) / 1000;
    const leadFrames = LEAD_SILENCE_MS / FRAME_MS;
    const speechFrames = Math.ceil(this.pcm.length / spf);
    const t0 = Date.now();
    let i = 0;
    const tick = async () => {
      if (this.stopped) return;
      const data = new Int16Array(spf);
      const s = i - leadFrames;
      if (s >= 0 && s < speechFrames) {
        data.set(this.pcm.subarray(s * spf, Math.min((s + 1) * spf, this.pcm.length)));
        if (s === 0) mark('user_clip_started');
        if (s === speechFrames - 1) mark('user_clip_ended');
      }
      await this.channel.write(new AudioFrame(data, this.sampleRate, 1, spf));
      i += 1;
      const next = t0 + i * FRAME_MS; // drift-corrected real-time pacing
      setTimeout(tick, Math.max(0, next - Date.now()));
    };
    tick();
  }
  async close() {
    this.stopped = true;
    await this.channel.close().catch(() => {});
    await super.close();
  }
}

// ---- simulated real-time playout ----
class SimAudioOutput extends voice.AudioOutput {
  constructor() {
    super(24000, undefined, { pause: false });
    this.pushedMs = 0;
    this.startedAt = 0;
    this.timer = null;
    this.flushed = false;
  }
  async captureFrame(frame) {
    await super.captureFrame(frame);
    if (this.pushedMs === 0) {
      this.startedAt = Date.now();
      this.onPlaybackStarted(this.startedAt);
      mark('playout_started');
    }
    this.pushedMs += (frame.samplesPerChannel / frame.sampleRate) * 1000;
  }
  flush() {
    super.flush();
    if (this.pushedMs === 0 || this.flushed) return;
    this.flushed = true;
    const remaining = Math.max(0, this.startedAt + this.pushedMs - Date.now());
    this.timer = setTimeout(() => this.finish(false), remaining);
  }
  clearBuffer() {
    if (this.pushedMs === 0) return;
    if (this.timer) clearTimeout(this.timer);
    if (!this.flushed) super.flush();
    this.finish(true);
  }
  finish(interrupted) {
    const played = interrupted
      ? Math.min(Date.now() - this.startedAt, this.pushedMs)
      : this.pushedMs;
    mark('playout_finished', {
      interrupted,
      playedMs: Math.round(played),
      pushedMs: Math.round(this.pushedMs),
    });
    this.pushedMs = 0;
    this.timer = null;
    this.flushed = false;
    this.onPlaybackFinished({ playbackPosition: played / 1000, interrupted });
  }
}

// ---- run ----
initializeLogger({ pretty: false, level: 'debug' });
const pluginDist = new URL(
  './node_modules/@livekit/agents-plugin-google/dist/realtime/realtime_api.js',
  import.meta.url,
);
mark('run_start', {
  label: LABEL,
  model: MODEL,
  variant: VARIANT,
  toolMs: TOOL_MS,
  wav: WAV,
  pluginRealtimeApiSha256: createHash('sha256').update(readFileSync(pluginDist)).digest('hex'),
});

let toolFinishedAt = null;
const bookSlot = llm.tool({
  name: 'book_slot',
  description: 'Book an appointment slot for the user. Returns a confirmation.',
  parameters: z.object({
    slot: z.string().describe("The slot to book, e.g. 'tomorrow 3pm'."),
  }),
  // Like a real side effect: ignores the abort signal and always completes.
  execute: async ({ slot }, { toolCallId, abortSignal }) => {
    mark('tool_execute_started', { slot, callId: toolCallId });
    await new Promise((r) => setTimeout(r, TOOL_MS));
    toolFinishedAt = Date.now();
    mark('tool_execute_finished', { slot, callId: toolCallId, abortSignalAborted: !!abortSignal?.aborted });
    return { status: 'booked', slot };
  },
});

const wav = readWavPcm16(WAV);
if (wav.channels !== 1 || wav.bits !== 16) throw new Error('expected 16-bit mono WAV');

const session = new voice.AgentSession({
  llm: new google.beta.realtime.RealtimeModel({
    model: MODEL,
    apiKey: process.env.GEMINI_API_KEY,
    // toolBehavior and toolResponseScheduling deliberately unset
    connOptions: { maxRetry: 0, retryIntervalMs: 2000, timeoutMs: 10000 },
  }),
});

const audioIn = new FileAudioInput(wav.pcm, wav.sampleRate);
session.input.audio = audioIn;
session.output.audio = new SimAudioOutput();

const E = voice.AgentSessionEventTypes;
session.on(E.SpeechCreated, (ev) => {
  const h = ev.speechHandle;
  mark('speech_created', { speechId: h.id, source: ev.source, userInitiated: ev.userInitiated });
  h.addDoneCallback((sh) => mark('speech_done', { speechId: sh.id, interrupted: sh.interrupted }));
});
session.on(E.FunctionToolsExecuted, (ev) => {
  mark('function_tools_executed', {
    calls: ev.functionCalls.map((c) => ({ name: c.name, callId: c.callId })),
    outputs: ev.functionCallOutputs.map((o) => ({ callId: o.callId, isError: o.isError, output: o.output })),
  });
});
session.on(E.AgentStateChanged, (ev) => mark('agent_state', { from: ev.oldState, to: ev.newState }));
session.on(E.UserStateChanged, (ev) => mark('user_state', { from: ev.oldState, to: ev.newState }));
session.on(E.ConversationItemAdded, (ev) => {
  const it = ev.item;
  mark('conversation_item_added', {
    role: it.role,
    interrupted: it.interrupted,
    text: typeof it.textContent === 'string' ? it.textContent : undefined,
  });
});
session.on(E.Error, (ev) => mark('session_error', { error: String(ev.error?.message ?? ev.error) }));
session.on(E.Close, (ev) => mark('session_close', { reason: ev.reason, error: ev.error ? String(ev.error) : undefined }));

const hard = setTimeout(async () => {
  mark('hard_timeout');
  await finish();
}, HARD_TIMEOUT_MS);

let finishing = false;
async function finish() {
  if (finishing) return;
  finishing = true;
  clearTimeout(hard);
  mark('run_end', { connects });
  await audioIn.close().catch(() => {});
  await session.close().catch(() => {});
  setTimeout(() => process.exit(0), 500);
}

await session.start({ agent: new voice.Agent({ instructions: INSTRUCTIONS, tools: [bookSlot] }) });
mark('session_started');
audioIn.start();

const poll = setInterval(() => {
  if (toolFinishedAt && Date.now() - toolFinishedAt > AFTER_TOOL_MS) {
    clearInterval(poll);
    finish();
  }
}, 200);
