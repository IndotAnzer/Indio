import { CalendarAdapter } from "./adapters/calendar.js";
import { MimoTtsAdapter } from "./adapters/mimo-tts.js";
import { NeteaseMusicAdapter } from "./adapters/netease-music.js";
import { SpeakerAdapter } from "./adapters/speaker.js";
import { WeatherAdapter } from "./adapters/weather.js";
import type { AppConfig } from "./config.js";
import { CodexAdapter } from "./core/codex.js";
import { ContextService } from "./core/context.js";
import { RouterService } from "./core/router.js";
import { SchedulerService } from "./core/scheduler.js";
import { StateStore } from "./core/state.js";
import { TtsService } from "./core/tts.js";
import type {
  CodexSettings,
  MusicBootstrap,
  MusicStatus,
  NeteaseQrLoginSession,
  NeteaseQrLoginStatus,
  PlanEntry,
  PreparedSegment,
  ProviderInfo,
  RunTurnResult,
  StreamEvent,
  Track,
  TriggerSource,
  TtsStatus,
  VoiceAsset,
  Decision,
  ContextBundle,
  NowState,
  UpdateCodexSettingsRequest
} from "@indio/contracts";

export class IndioRuntime {
  private readonly state: StateStore;
  private readonly weather: WeatherAdapter;
  private readonly calendar: CalendarAdapter;
  private readonly music: NeteaseMusicAdapter;
  private readonly speaker: SpeakerAdapter;
  private readonly mimo: MimoTtsAdapter;
  private readonly context: ContextService;
  private readonly router: RouterService;
  private readonly codex: CodexAdapter;
  private readonly tts: TtsService;
  private readonly scheduler: SchedulerService;
  private segmentCounter = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly publish: (event: StreamEvent) => void
  ) {
    this.state = new StateStore(config);
    this.weather = new WeatherAdapter();
    this.calendar = new CalendarAdapter();
    this.music = new NeteaseMusicAdapter(config, this.state);
    this.speaker = new SpeakerAdapter();
    this.mimo = new MimoTtsAdapter(config);
    this.context = new ContextService(config, this.state, this.weather, this.calendar);
    this.router = new RouterService();
    this.codex = new CodexAdapter(config, () => ({
      authSource: this.state.getCodexAuthSource(),
      projectApiKey: this.state.getProjectCodexApiKey(),
      compatibleApiKey: this.state.getCompatibleCodexApiKey(),
      compatibleBaseUrl: this.state.getCompatibleCodexBaseUrl(),
      compatibleModel: this.state.getCompatibleCodexModel(this.config.codexModel),
      compatibleResponseFormat: this.state.getCompatibleCodexResponseFormat()
    }));
    this.tts = new TtsService(config, this.mimo);
    this.scheduler = new SchedulerService(this.state, this.context, (entries) => {
      this.publish({ type: "plan.update", payload: entries });
    });
  }

  async bootstrap(): Promise<void> {
    await this.scheduler.ensureTodayPlan();
    this.scheduler.start();

    const nowState = this.state.getNowState();
    if (nowState?.nowPlaying && (!nowState.preparedNext || this.shouldRefreshPreparedNext(nowState))) {
      void this.prepareAndPublishNextSegment(nowState, {
        replaceExisting: Boolean(nowState.preparedNext)
      });
    }
  }

  async shutdown(): Promise<void> {
    this.scheduler.stop();
    this.state.close();
  }

  async handleTurn(params: {
    source: TriggerSource;
    userInput?: string;
  }): Promise<RunTurnResult> {
    const currentState = this.state.getNowState();
    const routed = this.router.route(params.userInput, currentState);
    const context = await this.context.build({
      source: params.source,
      userInput: params.userInput
    });

    const decision =
      routed.kind === "control"
        ? routed.decision
        : await this.codex.decide(context, {
            moodHint: routed.moodHint,
            quietMode: routed.quietMode
          });

    const queue = await this.music.resolveQueue(decision.play, decision.mood);
    const [nowPlaying, ...queuedTracks] = queue;
    const outputDevice = await this.speaker.getCurrentOutput();
    const { segment, voice } = await this.buildSegment({
      segmentId: this.createSegmentId(),
      source: params.source,
      context,
      decision,
      nowPlaying,
      queuedTracks,
      outputDevice
    });
    const nowState = this.materializeSegment(segment);

    if (params.userInput) {
      this.state.saveMessage("user", params.userInput, { source: params.source });
    }

    if (segment.narrationText) {
      this.state.saveMessage("assistant", segment.narrationText, {
        mood: decision.mood,
        mode: decision.mode
      });
    }

    if (segment.nowPlaying) {
      this.state.savePlay(segment.nowPlaying, decision.reason);
    }

    this.state.saveNowState(nowState);
    this.publishState(nowState);
    void this.prepareAndPublishNextSegment(nowState);

    return {
      decision,
      nowState,
      plan: this.scheduler.getTodayPlan(),
      voice
    };
  }

  async advancePreparedSegment(currentSegmentId?: string): Promise<NowState> {
    const currentState = this.state.getNowState();

    if (!currentState?.nowPlaying) {
      throw new Error("当前没有正在播放的电台段落。");
    }

    if (currentSegmentId && currentState.segmentId !== currentSegmentId) {
      return currentState;
    }

    if (!currentState.preparedNext) {
      throw new Error("下一段电台还在准备，请再等一下。");
    }

    const promoted = this.materializeSegment(currentState.preparedNext);

    if (promoted.narrationText) {
      this.state.saveMessage("assistant", promoted.narrationText, {
        mood: promoted.mood,
        mode: promoted.mode
      });
    }

    if (promoted.nowPlaying) {
      this.state.savePlay(promoted.nowPlaying, promoted.reason);
    }

    this.state.saveNowState(promoted);
    this.publishState(promoted);
    void this.prepareAndPublishNextSegment(promoted);
    return promoted;
  }

  private async buildSegment(params: {
    segmentId: string;
    source: TriggerSource;
    context: ContextBundle;
    decision: Decision;
    nowPlaying: Track | null;
    queuedTracks: Track[];
    outputDevice: string;
  }): Promise<{
    segment: PreparedSegment;
    voice: VoiceAsset | null;
  }> {
    if (!params.nowPlaying?.streamUrl) {
      throw new Error("电台音乐还没准备好，请再等一下。");
    }

    const nowPlayingContext = await this.music.getNarrationContext(params.nowPlaying);
    const preparedNarration =
      params.decision.mode === "music-only"
        ? {
            narrationText: "",
            voice: null
          }
        : await this.prepareNarratedSegment({
            context: params.context,
            decision: params.decision,
            nowPlaying: params.nowPlaying,
            nowPlayingContext,
            queuedTracks: params.queuedTracks
          });

    return {
      segment: {
        segmentId: params.segmentId,
        source: params.source,
        mood: params.decision.mood,
        mode: params.decision.mode,
        provider: params.decision.provider,
        narrationText: preparedNarration.narrationText,
        narrationAudioUrl: preparedNarration.voice?.audioUrl ?? null,
        segue: params.decision.segue,
        reason: params.decision.reason,
        outputDevice: params.outputDevice,
        nowPlaying: params.nowPlaying,
        queuedTracks: params.queuedTracks,
        preparedAt: new Date().toISOString()
      },
      voice: preparedNarration.voice
    };
  }

  private async prepareAndPublishNextSegment(
    baseState: NowState,
    options?: { replaceExisting?: boolean }
  ): Promise<void> {
    const currentState = this.state.getNowState();

    if (
      !currentState?.nowPlaying ||
      currentState.segmentId !== baseState.segmentId ||
      (currentState.preparedNext && !options?.replaceExisting)
    ) {
      return;
    }

    const preparedNext = await this.prepareNextSegment(currentState);

    if (!preparedNext) {
      return;
    }

    const refreshedState = this.state.getNowState();

    if (!refreshedState?.nowPlaying || refreshedState.segmentId !== baseState.segmentId) {
      return;
    }

    const nextState: NowState = {
      ...refreshedState,
      preparedNext
    };

    this.state.saveNowState(nextState);
    this.publishState(nextState);
  }

  private shouldRefreshPreparedNext(state: NowState): boolean {
    const preparedTrack = state.preparedNext?.nowPlaying;
    const firstQueuedTrack = state.queuedTracks[0];

    if (!preparedTrack || !firstQueuedTrack) {
      return false;
    }

    return this.trackIdentity(preparedTrack) === this.trackIdentity(firstQueuedTrack);
  }

  private trackIdentity(track: Track): string {
    return track.neteaseId ?? track.id;
  }

  private async prepareNextSegment(currentState: NowState): Promise<PreparedSegment | null> {
    const queue = await this.music.getRadioContinuation({
      mood: currentState.mood,
      currentTrack: currentState.nowPlaying,
      queuedTracks: currentState.queuedTracks,
      limit: 4
    });
    const [nextTrack, ...queuedTracks] = queue;

    if (!nextTrack?.streamUrl) {
      return null;
    }

    const followupContext = await this.context.build({
      source: "system"
    });
    const followupDecision = this.buildContinuationDecision(currentState);
    const { segment } = await this.buildSegment({
      segmentId: this.createSegmentId(),
      source: "system",
      context: followupContext,
      decision: followupDecision,
      nowPlaying: nextTrack,
      queuedTracks,
      outputDevice: currentState.outputDevice
    });

    return segment;
  }

  private async prepareNarratedSegment(params: {
    context: Parameters<CodexAdapter["composeOnAirNarration"]>[0]["context"];
    decision: Parameters<CodexAdapter["composeOnAirNarration"]>[0]["decision"];
    nowPlaying: Track;
    nowPlayingContext: Parameters<CodexAdapter["composeOnAirNarration"]>[0]["nowPlayingContext"];
    queuedTracks: Track[];
  }): Promise<{
    narrationText: string;
    voice: Awaited<ReturnType<TtsService["synthesize"]>>;
  }> {
    const narrationText = await this.codex.composeOnAirNarration({
      context: params.context,
      decision: params.decision,
      nowPlaying: params.nowPlaying,
      nowPlayingContext: params.nowPlayingContext,
      queuedTracks: params.queuedTracks
    });

    if (!narrationText) {
      throw new Error("这轮口播文案生成失败。");
    }

    const voice = await this.tts.synthesize(narrationText);

    if (!voice?.audioUrl) {
      throw new Error("这轮口播音频生成失败。");
    }

    return {
      narrationText,
      voice
    };
  }

  private buildContinuationDecision(state: NowState): Decision {
    return {
      say: "顺着这一段气氛继续往下走。",
      play: [],
      reason: state.reason,
      segue: state.segue,
      mood: state.mood,
      mode: state.mode,
      provider: state.provider
    };
  }

  private materializeSegment(segment: PreparedSegment): NowState {
    return {
      segmentId: segment.segmentId,
      updatedAt: new Date().toISOString(),
      source: segment.source,
      mood: segment.mood,
      mode: segment.mode,
      provider: segment.provider,
      narrationText: segment.narrationText,
      narrationAudioUrl: segment.narrationAudioUrl,
      segue: segment.segue,
      reason: segment.reason,
      outputDevice: segment.outputDevice,
      nowPlaying: segment.nowPlaying,
      queuedTracks: segment.queuedTracks,
      preparedNext: null
    };
  }

  private publishState(state: NowState): void {
    this.publish({
      type: "state.update",
      payload: state
    });
  }

  private createSegmentId(): string {
    this.segmentCounter += 1;
    return `${Date.now()}-${this.segmentCounter}`;
  }

  getNowState() {
    return this.state.getNowState();
  }

  getConfigMode(): string {
    return this.config.codexMode;
  }

  async getTasteSummary() {
    return this.context.getTasteSummary();
  }

  getTodayPlan(): PlanEntry[] {
    return this.scheduler.getTodayPlan();
  }

  getNextTrack(): Track | null {
    const state = this.state.getNowState();
    return state?.queuedTracks[0] ?? null;
  }

  async getCodexStatus(forceRefresh = false): Promise<ProviderInfo> {
    return this.codex.getStatus(forceRefresh);
  }

  getCodexSettings(): CodexSettings {
    const projectApiKey = this.state.getProjectCodexApiKey();
    const compatibleApiKey = this.state.getCompatibleCodexApiKey();

    return {
      authSource: this.state.getCodexAuthSource(),
      projectApiKeyConfigured: Boolean(projectApiKey),
      projectApiKeyLabel: projectApiKey ? this.maskApiKey(projectApiKey) : null,
      compatibleApiKeyConfigured: Boolean(compatibleApiKey),
      compatibleApiKeyLabel: compatibleApiKey ? this.maskApiKey(compatibleApiKey) : null,
      compatibleBaseUrl: this.state.getCompatibleCodexBaseUrl(),
      compatibleModel: this.state.getCompatibleCodexModel(this.config.codexModel),
      compatibleResponseFormat: this.state.getCompatibleCodexResponseFormat()
    };
  }

  async updateCodexSettings(payload: UpdateCodexSettingsRequest): Promise<{
    settings: CodexSettings;
    status: ProviderInfo;
  }> {
    const nextProjectApiKey = payload.clearProjectApiKey
      ? null
      : payload.projectApiKey?.trim()
        ? payload.projectApiKey.trim()
        : this.state.getProjectCodexApiKey();
    const nextCompatibleApiKey = payload.clearCompatibleApiKey
      ? null
      : payload.compatibleApiKey?.trim()
        ? payload.compatibleApiKey.trim()
        : this.state.getCompatibleCodexApiKey();
    const nextCompatibleBaseUrl = payload.compatibleBaseUrl?.trim() || this.state.getCompatibleCodexBaseUrl();
    const nextCompatibleModel =
      payload.compatibleModel?.trim() || this.state.getCompatibleCodexModel(this.config.codexModel);
    const nextCompatibleResponseFormat =
      payload.compatibleResponseFormat ?? this.state.getCompatibleCodexResponseFormat();

    if (payload.authSource === "project-api" && !nextProjectApiKey) {
      throw new Error("项目 API key 为空，无法切换到 API 模式。");
    }

    if (payload.authSource === "openai-compatible") {
      if (!nextCompatibleApiKey) {
        throw new Error("兼容接口 API key 为空，无法切换到 Responses API 模式。");
      }

      try {
        new URL(nextCompatibleBaseUrl);
      } catch {
        throw new Error("兼容接口 Base URL 不是有效 URL。");
      }

      if (!nextCompatibleModel) {
        throw new Error("兼容接口模型名为空。");
      }
    }

    if (payload.projectApiKey !== undefined && !payload.projectApiKey.trim()) {
      this.state.saveProjectCodexApiKey(null);
    } else if (payload.projectApiKey?.trim()) {
      this.state.saveProjectCodexApiKey(payload.projectApiKey.trim());
    } else if (payload.clearProjectApiKey) {
      this.state.saveProjectCodexApiKey(null);
    }

    if (payload.compatibleApiKey !== undefined && !payload.compatibleApiKey.trim()) {
      this.state.saveCompatibleCodexApiKey(null);
    } else if (payload.compatibleApiKey?.trim()) {
      this.state.saveCompatibleCodexApiKey(payload.compatibleApiKey.trim());
    } else if (payload.clearCompatibleApiKey) {
      this.state.saveCompatibleCodexApiKey(null);
    }

    if (payload.compatibleBaseUrl?.trim()) {
      this.state.saveCompatibleCodexBaseUrl(payload.compatibleBaseUrl.trim());
    }

    if (payload.compatibleModel?.trim()) {
      this.state.saveCompatibleCodexModel(payload.compatibleModel.trim());
    }

    this.state.saveCompatibleCodexResponseFormat(nextCompatibleResponseFormat);
    this.state.saveCodexAuthSource(payload.authSource);

    return {
      settings: this.getCodexSettings(),
      status: await this.codex.getStatus(true)
    };
  }

  getMusicStatus(): MusicStatus {
    return this.music.getStatus();
  }

  getMusicBootstrap(): MusicBootstrap {
    return this.music.getBootstrap();
  }

  createMusicQrLogin(): Promise<NeteaseQrLoginSession> {
    return this.music.createQrLoginSession();
  }

  checkMusicQrLogin(key: string): Promise<NeteaseQrLoginStatus> {
    return this.music.checkQrLoginSession(key);
  }

  logoutMusic(): Promise<void> {
    return this.music.logout();
  }

  getTtsStatus(): TtsStatus {
    return this.tts.getStatus();
  }

  private maskApiKey(apiKey: string): string {
    const normalized = apiKey.trim();

    if (normalized.length <= 10) {
      return normalized;
    }

    return `${normalized.slice(0, 6)}***${normalized.slice(-4)}`;
  }
}
