"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var realtime_api_exports = {};
__export(realtime_api_exports, {
  DEFAULT_IMAGE_ENCODE_OPTIONS: () => DEFAULT_IMAGE_ENCODE_OPTIONS,
  RealtimeModel: () => RealtimeModel,
  RealtimeSession: () => RealtimeSession,
  toClientContentParams: () => toClientContentParams
});
module.exports = __toCommonJS(realtime_api_exports);
var types = __toESM(require("@google/genai"), 1);
var import_genai = require("@google/genai");
var import_agents = require("@livekit/agents");
var import_mutex = require("@livekit/mutex");
var import_rtc_node = require("@livekit/rtc-node");
var import_tools = require("../tools.cjs");
var import_utils = require("../utils.cjs");
const INPUT_AUDIO_SAMPLE_RATE = 16e3;
const INPUT_AUDIO_CHANNELS = 1;
const OUTPUT_AUDIO_SAMPLE_RATE = 24e3;
const OUTPUT_AUDIO_CHANNELS = 1;
const LK_GOOGLE_DEBUG = Number(process.env.LK_GOOGLE_DEBUG ?? 0);
const WS_CLOSE_NORMAL = 1e3;
const KNOWN_VERTEXAI_MODELS = /* @__PURE__ */ new Set(["gemini-live-2.5-flash-native-audio"]);
const KNOWN_GEMINI_API_MODELS = /* @__PURE__ */ new Set([
  "gemini-3.8-live",
  "gemini-3.8-live-extended-thinking",
  "gemini-3.1-flash-live-preview",
  "gemini-2.5-flash-native-audio-preview-12-2025"
]);
const MODELS_WITHOUT_REPLY_PLACEHOLDER = ["3.1", "3.8"];
function needsReplyPlaceholder(model) {
  return !MODELS_WITHOUT_REPLY_PLACEHOLDER.some((tag) => model.includes(tag));
}
function toClientContentParams({
  turns,
  turnComplete
}) {
  return {
    ...turns && turns.length > 0 ? { turns } : {},
    turnComplete: turnComplete ?? true
  };
}
function validateModelAPIMatch(model, vertexai) {
  if (vertexai && KNOWN_GEMINI_API_MODELS.has(model)) {
    throw new Error(
      `Model '${model}' is a Gemini API model, but vertexai=true. Use a VertexAI model (e.g., 'gemini-live-2.5-flash-native-audio') or set vertexai=false.`
    );
  }
  if (!vertexai && KNOWN_VERTEXAI_MODELS.has(model)) {
    throw new Error(
      `Model '${model}' is a VertexAI model, but vertexai=false. Use a Gemini API model (e.g., 'gemini-2.5-flash-native-audio-preview-12-2025') or set vertexai=true.`
    );
  }
}
const DEFAULT_IMAGE_ENCODE_OPTIONS = {
  format: "JPEG",
  quality: 75,
  resizeOptions: {
    width: 1024,
    height: 1024,
    strategy: "scale_aspect_fit"
  }
};
class RealtimeModel extends import_agents.llm.RealtimeModel {
  #logger = (0, import_agents.log)();
  /** @internal */
  _options;
  get model() {
    return this._options.model;
  }
  label() {
    return "google.RealtimeModel";
  }
  constructor(options = {}) {
    var _a, _b, _c;
    const inputAudioTranscription = options.inputAudioTranscription === void 0 ? {} : options.inputAudioTranscription;
    const outputAudioTranscription = options.outputAudioTranscription === void 0 ? {} : options.outputAudioTranscription;
    let serverTurnDetection = true;
    if ((_b = (_a = options.realtimeInputConfig) == null ? void 0 : _a.automaticActivityDetection) == null ? void 0 : _b.disabled) {
      serverTurnDetection = false;
    }
    const apiKey = options.apiKey || process.env.GOOGLE_API_KEY;
    const project = options.project || process.env.GOOGLE_CLOUD_PROJECT;
    const location = options.location || process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
    const vertexai = options.vertexai ?? false;
    const defaultModel = vertexai ? "gemini-live-2.5-flash-native-audio" : "gemini-2.5-flash-native-audio-preview-12-2025";
    const model = options.model || defaultModel;
    validateModelAPIMatch(model, vertexai);
    super({
      messageTruncation: false,
      turnDetection: serverTurnDetection,
      userTranscription: inputAudioTranscription !== null,
      autoToolReplyGeneration: true,
      audioOutput: ((_c = options.modalities) == null ? void 0 : _c.includes(import_genai.Modality.AUDIO)) ?? true,
      manualFunctionCalls: false,
      midSessionChatCtxUpdate: true,
      midSessionInstructionsUpdate: true,
      midSessionToolsUpdate: false,
      perResponseToolChoice: false
    });
    this._options = {
      model,
      apiKey,
      voice: options.voice || "Puck",
      language: options.language ? (0, import_agents.normalizeLanguage)(options.language) : void 0,
      responseModalities: options.modalities || [import_genai.Modality.AUDIO],
      vertexai,
      project,
      location,
      candidateCount: options.candidateCount || 1,
      temperature: options.temperature,
      maxOutputTokens: options.maxOutputTokens,
      topP: options.topP,
      topK: options.topK,
      presencePenalty: options.presencePenalty,
      frequencyPenalty: options.frequencyPenalty,
      instructions: options.instructions,
      inputAudioTranscription: inputAudioTranscription || void 0,
      outputAudioTranscription: outputAudioTranscription || void 0,
      imageEncodeOptions: options.imageEncodeOptions || DEFAULT_IMAGE_ENCODE_OPTIONS,
      connOptions: options.connOptions || import_agents.DEFAULT_API_CONNECT_OPTIONS,
      httpOptions: options.httpOptions,
      mediaResolution: options.mediaResolution,
      enableAffectiveDialog: options.enableAffectiveDialog,
      proactivity: options.proactivity,
      realtimeInputConfig: options.realtimeInputConfig,
      contextWindowCompression: options.contextWindowCompression,
      apiVersion: options.apiVersion,
      geminiTools: options.geminiTools,
      thinkingConfig: options.thinkingConfig,
      toolBehavior: options.toolBehavior,
      toolResponseScheduling: options.toolResponseScheduling
    };
  }
  /**
   * Create a new realtime session
   */
  session() {
    return new RealtimeSession(this);
  }
  /**
   * Update model options
   */
  updateOptions(options) {
    if (options.voice !== void 0) {
      this._options.voice = options.voice;
    }
    if (options.temperature !== void 0) {
      this._options.temperature = options.temperature;
    }
    if (options.toolBehavior !== void 0) {
      this._options.toolBehavior = options.toolBehavior;
    }
    if (options.toolResponseScheduling !== void 0) {
      this._options.toolResponseScheduling = options.toolResponseScheduling;
    }
  }
  /**
   * Close the model and cleanup resources
   */
  async close() {
  }
}
class RealtimeSession extends import_agents.llm.RealtimeSession {
  _tools = import_agents.llm.ToolContext.empty();
  _chatCtx = import_agents.llm.ChatContext.empty();
  options;
  messageChannel = new import_agents.Queue();
  inputResampler;
  inputResamplerInputRate;
  instructions;
  currentGeneration;
  bstream;
  // Google-specific properties
  activeSession;
  sessionShouldClose = new import_agents.Event();
  responseCreatedFutures = {};
  pendingGenerationFut;
  sessionResumptionHandle;
  inUserActivity = false;
  sessionLock = new import_mutex.Mutex();
  numRetries = 0;
  hasReceivedAudioInput = false;
  pendingInterruptText = false;
  earlyCompletionPending = false;
  pendingToolCallIds = /* @__PURE__ */ new Set();
  toolCallStatuses = /* @__PURE__ */ new Map();
  toolResponseCallIds = /* @__PURE__ */ new WeakMap();
  generationPendingTurnComplete;
  #client;
  #task;
  #logger = (0, import_agents.log)();
  #closed = false;
  constructor(realtimeModel) {
    super(realtimeModel);
    this.options = realtimeModel._options;
    this.bstream = new import_agents.AudioByteStream(
      INPUT_AUDIO_SAMPLE_RATE,
      INPUT_AUDIO_CHANNELS,
      INPUT_AUDIO_SAMPLE_RATE / 20
    );
    const { apiKey, project, location, vertexai, enableAffectiveDialog, proactivity } = this.options;
    const apiVersion = !this.options.apiVersion && (enableAffectiveDialog || proactivity) ? "v1alpha" : this.options.apiVersion;
    const httpOptions = {
      ...this.options.httpOptions,
      apiVersion,
      timeout: this.options.connOptions.timeoutMs
    };
    const clientOptions = vertexai ? {
      vertexai: true,
      project,
      location,
      httpOptions
    } : {
      apiKey,
      httpOptions
    };
    this.#client = new import_genai.GoogleGenAI(clientOptions);
    this.#task = this.#mainTask();
  }
  async closeActiveSession() {
    const unlock = await this.sessionLock.lock();
    if (this.activeSession) {
      try {
        await this.activeSession.close();
      } catch (error) {
        this.#logger.warn({ error }, "Error closing Gemini session");
      } finally {
        this.activeSession = void 0;
      }
    }
    this.earlyCompletionPending = false;
    this.pendingInterruptText = false;
    this.pendingToolCallIds.clear();
    this.toolCallStatuses.clear();
    if (this.generationPendingTurnComplete) {
      this.markCurrentGenerationDone(false, this.generationPendingTurnComplete);
      this.generationPendingTurnComplete = void 0;
    }
    unlock();
  }
  markRestartNeeded() {
    if (!this.sessionShouldClose.isSet) {
      this.sessionShouldClose.set();
      this.messageChannel = new import_agents.Queue();
    }
  }
  isNonBlockingToolBehavior() {
    return this.options.toolBehavior === types.Behavior.NON_BLOCKING;
  }
  shouldBlockRealtimeInputForPendingTools() {
    return this.pendingToolCallIds.size > 0 && !this.isNonBlockingToolBehavior();
  }
  getToolResultsForRealtime(ctx, vertexai) {
    const toolResponses = [];
    for (const item of ctx.items) {
      if (item.type === "function_call_output") {
        const response = {
          name: item.name,
          response: { output: item.output }
        };
        if (this.options.toolResponseScheduling !== void 0) {
          response.scheduling = this.options.toolResponseScheduling;
        }
        if (!vertexai) {
          response.id = item.callId;
        }
        this.toolResponseCallIds.set(response, item.callId);
        const status = this.toolCallStatuses.get(item.callId);
        if (status == null ? void 0 : status.willContinueSent) {
          response.willContinue = false;
          status.status = "completed";
          this.toolCallStatuses.set(item.callId, status);
        }
        toolResponses.push(response);
      }
    }
    return toolResponses.length > 0 ? { functionResponses: toolResponses } : void 0;
  }
  updateOptions(options) {
    let shouldRestart = false;
    if (options.voice !== void 0 && this.options.voice !== options.voice) {
      this.options.voice = options.voice;
      shouldRestart = true;
    }
    if (options.temperature !== void 0 && this.options.temperature !== options.temperature) {
      this.options.temperature = options.temperature;
      shouldRestart = true;
    }
    if (options.toolBehavior !== void 0 && this.options.toolBehavior !== options.toolBehavior) {
      this.options.toolBehavior = options.toolBehavior;
      shouldRestart = true;
    }
    if (options.toolResponseScheduling !== void 0 && this.options.toolResponseScheduling !== options.toolResponseScheduling) {
      this.options.toolResponseScheduling = options.toolResponseScheduling;
    }
    if (options.toolChoice !== void 0) {
      this.#logger.warn("toolChoice is not supported by the Google Realtime API.");
    }
    if (shouldRestart) {
      this.markRestartNeeded();
    }
  }
  async updateInstructions(instructions) {
    if (this.options.instructions !== void 0 && this.options.instructions === instructions) {
      return;
    }
    this.options.instructions = instructions;
    const unlock = await this.sessionLock.lock();
    try {
      if (!this.activeSession) {
        this.markRestartNeeded();
        return;
      }
    } finally {
      unlock();
    }
    if (!this.realtimeModel.capabilities.midSessionInstructionsUpdate) {
      return;
    }
    this.#logger.debug("Updating instructions mid-session");
    this.sendClientEvent({
      type: "content",
      value: {
        turns: [
          {
            parts: [{ text: instructions }],
            // Both APIs error on role="system". Gemini 2.5 accepted an omitted role as the
            // system role, but 3.1 and 3.8 reject it. "model" is accepted by all three.
            role: "model"
          }
        ],
        turnComplete: false
      }
    });
  }
  async updateChatCtx(chatCtx) {
    const unlock = await this.sessionLock.lock();
    try {
      if (!this.activeSession) {
        this._chatCtx = chatCtx.copy();
        return;
      }
    } finally {
      unlock();
    }
    const diffOps = import_agents.llm.computeChatCtxDiff(this._chatCtx, chatCtx);
    if (diffOps.toRemove.length > 0) {
      this.#logger.warn("Gemini Live does not support removing messages");
    }
    const appendCtx = import_agents.llm.ChatContext.empty();
    for (const [, itemId] of diffOps.toCreate) {
      const item = chatCtx.getById(itemId);
      if (item) {
        appendCtx.items.push(item);
      }
    }
    if (appendCtx.items.length > 0) {
      const [turns] = await appendCtx.copy({
        excludeFunctionCall: true
      }).toProviderFormat("google", false);
      const toolResults = this.getToolResultsForRealtime(appendCtx, this.options.vertexai);
      if (turns.length > 0) {
        const shouldSendRealtimeText = this.pendingInterruptText;
        if (shouldSendRealtimeText) {
          for (const turn of turns) {
            if (turn.role !== "user") continue;
            const text = (turn.parts || []).map((part) => part.text).filter((value) => !!value).join("");
            if (text) {
              this.sendClientEvent({
                type: "realtime_input",
                value: { text }
              });
              this.pendingInterruptText = false;
            }
          }
        }
        if (this.realtimeModel.capabilities.midSessionChatCtxUpdate) {
          this.sendClientEvent({
            type: "content",
            value: {
              turns,
              turnComplete: false
            }
          });
        }
      }
      if (toolResults) {
        this.sendClientEvent({
          type: "tool_response",
          value: toolResults
        });
      }
    }
    this._chatCtx = chatCtx.copy();
  }
  async updateTools(tools) {
    if (this._tools.equals(tools)) {
      return;
    }
    this._tools = tools;
    this.markRestartNeeded();
  }
  get chatCtx() {
    return this._chatCtx.copy();
  }
  get tools() {
    return this._tools.copy();
  }
  get manualActivityDetection() {
    var _a, _b;
    return ((_b = (_a = this.options.realtimeInputConfig) == null ? void 0 : _a.automaticActivityDetection) == null ? void 0 : _b.disabled) ?? false;
  }
  pushAudio(frame) {
    if (this.shouldBlockRealtimeInputForPendingTools()) {
      return;
    }
    this.hasReceivedAudioInput = true;
    for (const f of this.resampleAudio(frame)) {
      for (const nf of this.bstream.write(f.data.buffer)) {
        const realtimeInput = {
          audio: {
            mimeType: "audio/pcm",
            data: Buffer.from(nf.data.buffer).toString("base64")
          }
        };
        this.sendClientEvent({
          type: "realtime_input",
          value: realtimeInput
        });
      }
    }
  }
  pushVideo(_) {
  }
  sendClientEvent(event) {
    this.messageChannel.put(event);
  }
  async generateReply(instructions, options = {}) {
    var _a, _b;
    if (!this.realtimeModel.capabilities.midSessionChatCtxUpdate) {
      this.#logger.warn(
        `generateReply is not compatible with '${this.options.model}' and will be ignored.`
      );
      throw new Error(`generateReply is not compatible with '${this.options.model}'`);
    }
    if (this.pendingGenerationFut && !this.pendingGenerationFut.done) {
      this.#logger.warn(
        "generateReply called while another generation is pending, cancelling previous."
      );
      const oldFut = this.pendingGenerationFut;
      this.pendingGenerationFut = void 0;
      oldFut.reject(new Error("Superseded by new generate_reply call"));
    }
    const fut = new import_agents.Future();
    this.pendingGenerationFut = fut;
    const onAbort = () => {
      if (this.pendingGenerationFut !== fut) {
        return;
      }
      this.pendingGenerationFut = void 0;
      void this.interrupt();
      if (!fut.done) {
        fut.reject(new Error("generateReply aborted"));
      }
    };
    if ((_a = options.signal) == null ? void 0 : _a.aborted) {
      onAbort();
      return fut.await;
    }
    (_b = options.signal) == null ? void 0 : _b.addEventListener("abort", onAbort, { once: true });
    if (this.inUserActivity) {
      this.sendClientEvent({
        type: "realtime_input",
        value: {
          activityEnd: {}
        }
      });
      this.inUserActivity = false;
    }
    const turns = [];
    if (instructions !== void 0) {
      turns.push({
        parts: [{ text: instructions }],
        role: "model"
      });
    }
    if (needsReplyPlaceholder(this.options.model)) {
      turns.push({
        parts: [{ text: "." }],
        role: "user"
      });
    }
    this.sendClientEvent({
      type: "content",
      value: {
        turns,
        turnComplete: true
      }
    });
    const timeoutHandle = setTimeout(() => {
      if (!fut.done) {
        fut.reject(new Error("generateReply timed out waiting for generation_created event."));
        if (this.pendingGenerationFut === fut) {
          this.pendingGenerationFut = void 0;
        }
      }
    }, 5e3);
    void fut.await.finally(() => {
      var _a2;
      clearTimeout(timeoutHandle);
      (_a2 = options.signal) == null ? void 0 : _a2.removeEventListener("abort", onAbort);
    }).catch(() => void 0);
    return fut.await;
  }
  startUserActivity() {
    if (!this.manualActivityDetection) {
      return;
    }
    if (this.shouldBlockRealtimeInputForPendingTools()) {
      return;
    }
    if (!this.inUserActivity) {
      this.inUserActivity = true;
      this.sendClientEvent({
        type: "realtime_input",
        value: {
          activityStart: {}
        }
      });
    }
  }
  generationHasOutput(gen) {
    return Boolean(gen.outputText) || gen._firstTokenTimestamp !== void 0;
  }
  async interrupt() {
    var _a;
    if (((_a = this.options.realtimeInputConfig) == null ? void 0 : _a.activityHandling) === import_genai.ActivityHandling.NO_INTERRUPTION) {
      if (LK_GOOGLE_DEBUG) {
        this.#logger.debug("interrupt skipped (activityHandling = NO_INTERRUPTION)");
      }
      return;
    }
    if (this.currentGeneration && !this.currentGeneration._done) {
      this.pendingInterruptText = true;
      if (this.generationHasOutput(this.currentGeneration)) {
        this.earlyCompletionPending = true;
        this.markCurrentGenerationDone();
      }
    }
    this.startUserActivity();
  }
  async truncate(_options) {
    this.#logger.warn("truncate is not supported by the Google Realtime API.");
  }
  async close() {
    var _a;
    super.close();
    this.#closed = true;
    this.sessionShouldClose.set();
    (_a = this.inputResampler) == null ? void 0 : _a.close();
    await this.closeActiveSession();
    if (this.pendingGenerationFut && !this.pendingGenerationFut.done) {
      this.pendingGenerationFut.reject(new Error("Session closed"));
    }
    for (const fut of Object.values(this.responseCreatedFutures)) {
      if (!fut.done) {
        fut.reject(new Error("Session closed before response created"));
      }
    }
    this.responseCreatedFutures = {};
    if (this.currentGeneration) {
      this.markCurrentGenerationDone();
    }
  }
  async #mainTask() {
    const maxRetries = this.options.connOptions.maxRetry;
    while (!this.#closed) {
      await this.closeActiveSession();
      this.sessionShouldClose.clear();
      const config = this.buildConnectConfig();
      try {
        this.#logger.debug("Connecting to Gemini Realtime API...");
        const sessionOpened = new import_agents.Event();
        const connected = {};
        const session = await this.#client.live.connect({
          model: this.options.model,
          callbacks: {
            onopen: () => sessionOpened.set(),
            onmessage: (message) => {
              if (connected.session) {
                this.onReceiveMessage(connected.session, message);
              }
            },
            // onerror is called for network-level errors (connection refused, DNS failure, TLS errors).
            // Application-level errors (e.g., invalid model name) come through onclose with error codes.
            onerror: (error) => {
              this.#logger.error("Gemini Live session error:", error);
              if (!this.sessionShouldClose.isSet) {
                this.markRestartNeeded();
              }
            },
            onclose: (event) => {
              if (event.code !== WS_CLOSE_NORMAL) {
                const isTruncated = event.reason && event.reason.length >= 120;
                const truncationNote = isTruncated ? " (message may be truncated - check model name and API permissions)" : "";
                const errorMsg = event.reason || `WebSocket closed with code ${event.code}`;
                this.#logger.error(`Gemini Live session error: ${errorMsg}${truncationNote}`);
                this.emitError(
                  new import_agents.APIStatusError({
                    message: `${errorMsg}${truncationNote}`,
                    options: {
                      statusCode: event.code,
                      retryable: false,
                      body: event.reason ? { reason: event.reason, code: event.code, truncated: isTruncated } : null
                    }
                  }),
                  false
                );
              } else {
                this.#logger.debug("Gemini Live session closed:", event.code, event.reason);
              }
              this.markCurrentGenerationDone();
            }
          },
          config
        });
        connected.session = session;
        await sessionOpened.wait();
        const unlock = await this.sessionLock.lock();
        try {
          this.activeSession = session;
          const [turns] = await this._chatCtx.copy({
            excludeFunctionCall: true
          }).toProviderFormat("google", false);
          if (turns.length > 0) {
            await session.sendClientContent({ turns, turnComplete: false });
          }
        } finally {
          unlock();
        }
        const sendTask = import_agents.Task.from((controller) => this.sendTask(session, controller));
        const restartWaitTask = import_agents.Task.from(({ signal }) => {
          const abortEvent = new import_agents.Event();
          signal.addEventListener("abort", () => abortEvent.set());
          return Promise.race([this.sessionShouldClose.wait(), abortEvent.wait()]);
        });
        await Promise.race([sendTask.result, restartWaitTask.result]);
        if (!restartWaitTask.done && this.#closed) {
          break;
        }
        await (0, import_agents.cancelAndWait)([sendTask, restartWaitTask], 2e3);
      } catch (error) {
        this.#logger.error(`Gemini Realtime API error: ${error}`);
        if (this.#closed) break;
        if (maxRetries === 0) {
          this.emitError(error, false);
          throw new import_agents.APIConnectionError({
            message: "Failed to connect to Gemini Live"
          });
        }
        if (this.numRetries >= maxRetries) {
          this.emitError(error, false);
          throw new import_agents.APIConnectionError({
            message: `Failed to connect to Gemini Live after ${maxRetries} attempts`
          });
        }
        const retryInterval = this.numRetries === 100 ? 0 : this.options.connOptions.retryIntervalMs;
        this.#logger.warn(
          {
            attempt: this.numRetries,
            maxRetries
          },
          `Gemini Realtime API connection failed, retrying in ${retryInterval}ms`
        );
        await (0, import_agents.delay)(retryInterval);
        this.numRetries++;
      } finally {
        await this.closeActiveSession();
      }
    }
  }
  async sendTask(session, controller) {
    try {
      while (!this.#closed && !this.sessionShouldClose.isSet && !controller.signal.aborted) {
        const msg = await this.messageChannel.get({ signal: controller.signal });
        if (controller.signal.aborted) break;
        const unlock = await this.sessionLock.lock();
        try {
          if (this.sessionShouldClose.isSet || this.activeSession !== session) {
            break;
          }
        } finally {
          unlock();
        }
        switch (msg.type) {
          case "content":
            if (LK_GOOGLE_DEBUG) {
              this.#logger.debug(
                {
                  eventType: msg.type,
                  "lk.pii.event": this.loggableClientEvent(msg)
                },
                "sent Gemini Live client event"
              );
            }
            await session.sendClientContent(toClientContentParams(msg.value));
            break;
          case "tool_response":
            const { functionResponses } = msg.value;
            if (functionResponses) {
              if (LK_GOOGLE_DEBUG) {
                this.#logger.debug(
                  {
                    eventType: msg.type,
                    "lk.pii.event": this.loggableClientEvent(msg)
                  },
                  "sent Gemini Live client event"
                );
              }
              try {
                await session.sendToolResponse({
                  functionResponses
                });
              } finally {
                this.clearPendingToolCallIdsForResponses(functionResponses);
              }
            }
            break;
          case "realtime_input":
            const { mediaChunks, audio, activityStart, activityEnd, text } = msg.value;
            if (this.shouldBlockRealtimeInputForPendingTools()) {
              break;
            }
            if (mediaChunks) {
              for (const mediaChunk of mediaChunks) {
                await session.sendRealtimeInput({ media: mediaChunk });
              }
            }
            if (audio) {
              await session.sendRealtimeInput({ audio });
            }
            if (text) {
              await session.sendRealtimeInput({ text });
            }
            if (activityStart) await session.sendRealtimeInput({ activityStart });
            if (activityEnd) await session.sendRealtimeInput({ activityEnd });
            break;
          default:
            this.#logger.warn(`Warning: Received unhandled message type: ${msg.type}`);
            break;
        }
      }
    } catch (e) {
      if (!this.sessionShouldClose.isSet) {
        this.#logger.error(`Error in send task: ${e}`);
        this.markRestartNeeded();
      }
    } finally {
      this.#logger.debug(
        {
          closed: this.#closed,
          sessionShouldClose: this.sessionShouldClose.isSet,
          aborted: controller.signal.aborted
        },
        "send task finished."
      );
    }
  }
  async onReceiveMessage(session, response) {
    var _a, _b, _c, _d, _e;
    const hasAudioData = (_c = (_b = (_a = response.serverContent) == null ? void 0 : _a.modelTurn) == null ? void 0 : _b.parts) == null ? void 0 : _c.some(
      (part) => {
        var _a2;
        return (_a2 = part.inlineData) == null ? void 0 : _a2.data;
      }
    );
    if (LK_GOOGLE_DEBUG) {
      this.#logger.debug(
        { "lk.pii.response": this.loggableServerMessage(response) },
        "received Gemini Live server event"
      );
    } else if (!hasAudioData) {
      this.#logger.debug(
        { "lk.pii.response": this.loggableServerMessage(response) },
        "received Gemini Live server event"
      );
    }
    const unlock = await this.sessionLock.lock();
    try {
      if (this.sessionShouldClose.isSet || this.activeSession !== session) {
        this.#logger.debug("onReceiveMessage: Session changed or closed, stopping receive.");
        return;
      }
    } finally {
      unlock();
    }
    const shouldStartNewGeneration = !this.currentGeneration || this.currentGeneration._done || !!this.pendingGenerationFut;
    if (shouldStartNewGeneration) {
      if ((_d = response.serverContent) == null ? void 0 : _d.interrupted) {
        if (!this.pendingGenerationFut) {
          this.handleInputSpeechStarted();
        }
        response.serverContent = {
          ...response.serverContent,
          interrupted: void 0
        };
        const sc = response.serverContent;
        const hasServerContent = !!(sc == null ? void 0 : sc.modelTurn) || (sc == null ? void 0 : sc.outputTranscription) != null || (sc == null ? void 0 : sc.inputTranscription) != null || (sc == null ? void 0 : sc.generationComplete) != null || (sc == null ? void 0 : sc.turnComplete) != null;
        if (!hasServerContent) {
          response.serverContent = void 0;
          if (LK_GOOGLE_DEBUG) {
            this.#logger.debug("ignoring empty server content");
          }
        }
      }
      if (this.isNewGeneration(response)) {
        this.startNewGeneration();
        if (LK_GOOGLE_DEBUG) {
          this.#logger.debug(`new generation started: ${(_e = this.currentGeneration) == null ? void 0 : _e.responseId}`);
        }
      }
    }
    if (response.sessionResumptionUpdate) {
      if (response.sessionResumptionUpdate.resumable && response.sessionResumptionUpdate.newHandle) {
        this.sessionResumptionHandle = response.sessionResumptionUpdate.newHandle;
      }
    }
    try {
      if (response.serverContent) {
        this.handleServerContent(response.serverContent);
      }
      if (response.toolCall) {
        this.handleToolCall(response.toolCall);
      }
      if (response.toolCallCancellation) {
        this.handleToolCallCancellation(response.toolCallCancellation);
      }
      if (response.usageMetadata) {
        this.handleUsageMetadata(response.usageMetadata);
      }
      if (response.goAway) {
        this.handleGoAway(response.goAway);
      }
      if (this.numRetries > 0) {
        this.numRetries = 0;
      }
    } catch (e) {
      if (!this.sessionShouldClose.isSet) {
        this.#logger.error(`Error in onReceiveMessage: ${e}`);
        this.markRestartNeeded();
      }
    }
  }
  /// Truncate large base64/audio payloads for logging to avoid flooding logs
  truncateString(data, maxLength = 30) {
    return data.length > maxLength ? `${data.slice(0, maxLength)}\u2026` : data;
  }
  loggableClientEvent(event, maxLength = 30) {
    var _a, _b;
    const obj = { ...event };
    if (obj.type === "realtime_input" && ((_a = obj.value) == null ? void 0 : _a.mediaChunks)) {
      obj.value = {
        ...obj.value,
        mediaChunks: obj.value.mediaChunks.map(
          (mc) => ({
            ...mc,
            data: typeof mc.data === "string" ? this.truncateString(mc.data, maxLength) : mc.data
          })
        )
      };
    }
    if (obj.type === "realtime_input" && ((_b = obj.value) == null ? void 0 : _b.audio)) {
      const ac = obj.value.audio;
      obj.value = {
        ...obj.value,
        audio: {
          ...ac,
          data: typeof ac.data === "string" ? this.truncateString(ac.data, maxLength) : ac.data
        }
      };
    }
    return obj;
  }
  loggableServerMessage(message, maxLength = 30) {
    const obj = { ...message };
    if (obj.serverContent && obj.serverContent.modelTurn && Array.isArray(obj.serverContent.modelTurn.parts)) {
      obj.serverContent = { ...obj.serverContent };
      obj.serverContent.modelTurn = { ...obj.serverContent.modelTurn };
      obj.serverContent.modelTurn.parts = obj.serverContent.modelTurn.parts.map((part) => {
        var _a;
        if (((_a = part == null ? void 0 : part.inlineData) == null ? void 0 : _a.data) && typeof part.inlineData.data === "string") {
          return {
            ...part,
            inlineData: {
              ...part.inlineData,
              data: this.truncateString(part.inlineData.data, maxLength)
            }
          };
        }
        return part;
      });
    }
    return obj;
  }
  markCurrentGenerationDone(keepFunctionChannelOpen = false, gen) {
    const target = gen ?? this.currentGeneration;
    if (!target || target._done) {
      return;
    }
    this.handleInputSpeechStopped();
    const targetGen = target;
    if (targetGen.inputTranscription) {
      this.emit("input_audio_transcription_completed", {
        itemId: targetGen.inputId,
        transcript: targetGen.inputTranscription,
        isFinal: true,
        // This fires once the reply is done generating, seconds after the user
        // spoke, so hand over when the turn actually began. The generation is
        // created as soon as the server takes the turn, which is always before
        // any of its own audio reaches the room.
        turnStartedAt: targetGen._createdTimestamp
      });
      this._chatCtx.addMessage({
        role: "user",
        content: targetGen.inputTranscription,
        id: targetGen.inputId
      });
    }
    if (targetGen.outputText) {
      this._chatCtx.addMessage({
        role: "assistant",
        content: targetGen.outputText,
        id: targetGen.responseId
      });
    }
    if (this.options.outputAudioTranscription === void 0) {
      targetGen.textChannel.write("");
    }
    targetGen.textChannel.close();
    targetGen.audioChannel.close();
    if (!keepFunctionChannelOpen) {
      targetGen.functionChannel.close();
    }
    targetGen.messageChannel.close();
    targetGen._done = true;
  }
  emitError(error, recoverable) {
    const event = {
      type: "realtime_model_error",
      timestamp: Date.now(),
      // TODO(brian): add label to realtime model
      label: "google_realtime",
      error,
      recoverable
    };
    this.emit("error", event);
  }
  buildConnectConfig() {
    const opts = this.options;
    const [tools] = (0, import_utils.toToolsConfig)({
      toolCtx: this._tools,
      geminiTools: this.options.geminiTools,
      toolBehavior: this.options.toolBehavior,
      useParametersJsonSchema: false
    });
    const config = {
      thinkingConfig: opts.thinkingConfig,
      responseModalities: opts.responseModalities,
      systemInstruction: opts.instructions ? {
        parts: [{ text: opts.instructions }]
      } : void 0,
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: opts.voice
          }
        },
        languageCode: opts.language
      },
      tools,
      inputAudioTranscription: opts.inputAudioTranscription,
      outputAudioTranscription: opts.outputAudioTranscription,
      sessionResumption: this.sessionResumptionHandle ? { handle: this.sessionResumptionHandle } : {}
    };
    if (opts.temperature !== void 0) {
      config.temperature = opts.temperature;
    }
    if (opts.maxOutputTokens !== void 0) {
      config.maxOutputTokens = opts.maxOutputTokens;
    }
    if (opts.topP !== void 0) {
      config.topP = opts.topP;
    }
    if (opts.topK !== void 0) {
      config.topK = opts.topK;
    }
    if (opts.mediaResolution !== void 0) {
      config.mediaResolution = opts.mediaResolution;
    }
    if (opts.proactivity !== void 0) {
      config.proactivity = { proactiveAudio: opts.proactivity };
    }
    if (opts.enableAffectiveDialog !== void 0) {
      config.enableAffectiveDialog = opts.enableAffectiveDialog;
    }
    if (opts.realtimeInputConfig !== void 0) {
      config.realtimeInputConfig = opts.realtimeInputConfig;
    }
    if (opts.contextWindowCompression !== void 0) {
      config.contextWindowCompression = opts.contextWindowCompression;
    }
    return config;
  }
  startNewGeneration() {
    const previousGen = this.currentGeneration;
    const previousHadOpenFunctionChannel = previousGen && !previousGen.functionChannel.closed;
    if (previousGen && previousHadOpenFunctionChannel) {
      previousGen.functionChannel.close();
    }
    if (previousGen && !previousGen._done) {
      if (previousHadOpenFunctionChannel) {
        this.generationPendingTurnComplete = previousGen;
      } else {
        this.#logger.warn("Starting new generation while another is active. Finalizing previous.");
        this.markCurrentGenerationDone();
      }
    }
    const responseId = (0, import_agents.shortuuid)("GR_");
    this.currentGeneration = {
      messageChannel: import_agents.stream.createStreamChannel(),
      functionChannel: import_agents.stream.createStreamChannel(),
      responseId,
      inputId: (0, import_agents.shortuuid)("GI_"),
      textChannel: import_agents.stream.createStreamChannel(),
      audioChannel: import_agents.stream.createStreamChannel(),
      inputTranscription: "",
      outputText: "",
      _createdTimestamp: Date.now(),
      _done: false
    };
    if (!this._realtimeModel.capabilities.audioOutput) {
      this.currentGeneration.audioChannel.close();
    }
    const modalities = this._realtimeModel.capabilities.audioOutput ? ["audio", "text"] : ["text"];
    this.currentGeneration.messageChannel.write({
      messageId: responseId,
      textStream: this.currentGeneration.textChannel.stream(),
      audioStream: this.currentGeneration.audioChannel.stream(),
      modalities: Promise.resolve(modalities)
    });
    const generationEvent = {
      messageStream: this.currentGeneration.messageChannel.stream(),
      functionStream: this.currentGeneration.functionChannel.stream(),
      userInitiated: false,
      responseId
    };
    if (this.pendingGenerationFut && !this.pendingGenerationFut.done) {
      generationEvent.userInitiated = true;
      this.pendingGenerationFut.resolve(generationEvent);
      this.pendingGenerationFut = void 0;
    } else {
      this.handleInputSpeechStarted();
    }
    this.emit("generation_created", generationEvent);
  }
  handleInputSpeechStarted() {
    this.emit("input_speech_started", {});
  }
  handleInputSpeechStopped() {
    this.emit("input_speech_stopped", {
      userTranscriptionEnabled: false
    });
  }
  handleServerContent(serverContent) {
    if (!this.currentGeneration) {
      this.#logger.warn("received server content but no active generation.");
      return;
    }
    const gen = this.currentGeneration;
    const discardOutput = this.earlyCompletionPending;
    const forwardModelText = !this._realtimeModel.capabilities.audioOutput || this.options.outputAudioTranscription === void 0;
    if (serverContent.modelTurn && !discardOutput) {
      const turn = serverContent.modelTurn;
      for (const part of turn.parts || []) {
        if (part.thought) {
          continue;
        }
        if (part.text && forwardModelText) {
          gen.outputText += part.text;
          gen.textChannel.write(part.text);
        }
        if (part.inlineData) {
          if (!gen._firstTokenTimestamp) {
            gen._firstTokenTimestamp = Date.now();
          }
          try {
            if (!part.inlineData.data) {
              throw new Error("frameData is not bytes");
            }
            const binaryString = atob(part.inlineData.data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const int16Array = new Int16Array(bytes.buffer);
            const audioFrame = new import_rtc_node.AudioFrame(
              int16Array,
              OUTPUT_AUDIO_SAMPLE_RATE,
              OUTPUT_AUDIO_CHANNELS,
              int16Array.length / OUTPUT_AUDIO_CHANNELS
            );
            gen.audioChannel.write(audioFrame);
          } catch (error) {
            this.#logger.error("Error processing audio data:", error);
          }
        }
      }
    }
    if (serverContent.inputTranscription && serverContent.inputTranscription.text) {
      let text = serverContent.inputTranscription.text;
      if (gen.inputTranscription === "") {
        text = text.trimStart();
      }
      gen.inputTranscription += text;
      this.emit("input_audio_transcription_completed", {
        itemId: gen.inputId,
        transcript: gen.inputTranscription,
        isFinal: false
      });
    }
    if (!discardOutput && serverContent.outputTranscription && serverContent.outputTranscription.text) {
      const text = serverContent.outputTranscription.text;
      gen.outputText += text;
      gen.textChannel.write(text);
    }
    if (serverContent.generationComplete || serverContent.turnComplete) {
      gen._completedTimestamp = Date.now();
    }
    if (serverContent.interrupted && !this.pendingGenerationFut) {
      this.handleInputSpeechStarted();
    }
    if (serverContent.turnComplete && !this.earlyCompletionPending) {
      if (this.generationPendingTurnComplete) {
        this.markCurrentGenerationDone(false, this.generationPendingTurnComplete);
        this.generationPendingTurnComplete = void 0;
      } else {
        this.markCurrentGenerationDone();
      }
    }
    if (this.earlyCompletionPending && (serverContent.turnComplete || serverContent.generationComplete)) {
      this.earlyCompletionPending = false;
    }
  }
  handleToolCall(toolCall) {
    if (!this.currentGeneration) {
      this.#logger.warn("received tool call but no active generation.");
      return;
    }
    const gen = this.currentGeneration;
    if (gen.functionChannel.closed) {
      this.#logger.warn("received tool call but functionChannel is already closed.");
      return;
    }
    for (const fc of toolCall.functionCalls || []) {
      if (!fc.name) {
        this.#logger.warn("received function call without name, skipping");
        continue;
      }
      const callId = fc.id || (0, import_agents.shortuuid)("fnc-call-");
      this.pendingToolCallIds.add(callId);
      this.toolCallStatuses.set(callId, {
        name: fc.name,
        status: "pending",
        willContinueSent: false,
        createdAt: Date.now()
      });
      if (this.isNonBlockingToolBehavior()) {
        const continuingResponse = {
          id: this.options.vertexai ? void 0 : callId,
          name: fc.name,
          response: {},
          willContinue: true
        };
        if (this.options.toolResponseScheduling !== void 0) {
          continuingResponse.scheduling = this.options.toolResponseScheduling;
        }
        this.sendClientEvent({
          type: "tool_response",
          value: {
            functionResponses: [continuingResponse]
          }
        });
        const status = this.toolCallStatuses.get(callId);
        if (status) {
          status.status = "continuing";
          status.willContinueSent = true;
          this.toolCallStatuses.set(callId, status);
        }
      }
      gen.functionChannel.write(
        import_agents.llm.FunctionCall.create({
          callId,
          name: fc.name,
          args: fc.args ? JSON.stringify(fc.args) : ""
        })
      );
    }
    this.markCurrentGenerationDone();
  }
  handleToolCallCancellation(cancellation) {
    this.#logger.warn(
      {
        functionCallIds: cancellation.ids
      },
      "server cancelled tool calls"
    );
    for (const id of cancellation.ids || []) {
      this.pendingToolCallIds.delete(id);
      const status = this.toolCallStatuses.get(id);
      if (status) {
        status.status = "cancelled";
        this.toolCallStatuses.set(id, status);
      }
    }
  }
  clearPendingToolCallIdsForResponses(functionResponses) {
    for (const fr of functionResponses) {
      if (fr.willContinue === true) {
        continue;
      }
      const callId = fr.id ?? this.toolResponseCallIds.get(fr);
      if (callId) {
        this.pendingToolCallIds.delete(callId);
      }
    }
  }
  handleUsageMetadata(usage) {
    if (!this.currentGeneration) {
      this.#logger.debug("Received usage metadata but no active generation");
      return;
    }
    const gen = this.currentGeneration;
    const createdTimestamp = gen._createdTimestamp;
    const firstTokenTimestamp = gen._firstTokenTimestamp;
    const completedTimestamp = gen._completedTimestamp || Date.now();
    const ttftMs = firstTokenTimestamp ? firstTokenTimestamp - createdTimestamp : -1;
    const durationMs = completedTimestamp - createdTimestamp;
    const inputTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.responseTokenCount || 0;
    const totalTokens = usage.totalTokenCount || 0;
    const reasoningTokens = usage.thoughtsTokenCount ?? void 0;
    const realtimeMetrics = {
      type: "realtime_model_metrics",
      timestamp: createdTimestamp,
      requestId: gen.responseId,
      ttftMs,
      durationMs,
      cancelled: gen._done && !gen._completedTimestamp,
      label: "google_realtime",
      inputTokens,
      outputTokens,
      reasoningTokens,
      totalTokens,
      tokensPerSecond: durationMs > 0 ? outputTokens / (durationMs / 1e3) : 0,
      inputTokenDetails: {
        ...this.tokenDetailsMap(usage.promptTokensDetails),
        cachedTokens: (usage.cacheTokensDetails || []).reduce(
          (sum, detail) => sum + (detail.tokenCount || 0),
          0
        ),
        cachedTokensDetails: this.tokenDetailsMap(usage.cacheTokensDetails)
      },
      outputTokenDetails: this.tokenDetailsMap(usage.responseTokensDetails)
    };
    this.emit("metrics_collected", realtimeMetrics);
  }
  tokenDetailsMap(tokenDetails) {
    const tokenDetailsMap = { audioTokens: 0, textTokens: 0, imageTokens: 0 };
    if (!tokenDetails) {
      return tokenDetailsMap;
    }
    for (const tokenDetail of tokenDetails) {
      if (!tokenDetail.tokenCount) {
        continue;
      }
      if (tokenDetail.modality === types.MediaModality.AUDIO) {
        tokenDetailsMap.audioTokens += tokenDetail.tokenCount;
      } else if (tokenDetail.modality === types.MediaModality.TEXT) {
        tokenDetailsMap.textTokens += tokenDetail.tokenCount;
      } else if (tokenDetail.modality === types.MediaModality.IMAGE) {
        tokenDetailsMap.imageTokens += tokenDetail.tokenCount;
      }
    }
    return tokenDetailsMap;
  }
  handleGoAway(goAway) {
    this.#logger.warn({ timeLeft: goAway.timeLeft }, "Gemini server indicates disconnection soon.");
    this.sessionShouldClose.set();
  }
  async commitAudio() {
  }
  async clearAudio() {
  }
  *resampleAudio(frame) {
    if (this.inputResampler) {
      if (frame.sampleRate !== this.inputResamplerInputRate) {
        this.inputResampler.close();
        this.inputResampler = void 0;
        this.inputResamplerInputRate = void 0;
      }
    }
    if (this.inputResampler === void 0 && (frame.sampleRate !== INPUT_AUDIO_SAMPLE_RATE || frame.channels !== INPUT_AUDIO_CHANNELS)) {
      this.inputResampler = new import_rtc_node.AudioResampler(
        frame.sampleRate,
        INPUT_AUDIO_SAMPLE_RATE,
        INPUT_AUDIO_CHANNELS
      );
      this.inputResamplerInputRate = frame.sampleRate;
    }
    if (this.inputResampler) {
      for (const resampledFrame of this.inputResampler.push(frame)) {
        yield resampledFrame;
      }
    } else {
      yield frame;
    }
  }
  isNewGeneration(response) {
    if (this.earlyCompletionPending) {
      return false;
    }
    if (response.toolCall) {
      return true;
    }
    const serverContent = response.serverContent;
    return !!serverContent && (serverContent.modelTurn || serverContent.outputTranscription != null || serverContent.inputTranscription != null || serverContent.generationComplete != null || serverContent.turnComplete != null);
  }
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_IMAGE_ENCODE_OPTIONS,
  RealtimeModel,
  RealtimeSession,
  toClientContentParams
});
//# sourceMappingURL=realtime_api.cjs.map