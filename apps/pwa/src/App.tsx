import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { CodexSettings, NowState, ProviderInfo } from "@indio/contracts";
import { CallInPanel } from "./components/CallInPanel";
import { QueuePanel } from "./components/QueuePanel";
import { RecordPlayer } from "./components/RecordPlayer";
import { StatusStrip } from "./components/StatusStrip";
import { buildNarrationChars, usePlaybackController } from "./hooks/usePlaybackController";
import { useMusicLogin } from "./hooks/useMusicLogin";
import { useRadioStream } from "./hooks/useRadioStream";
import { fetchBootstrap, submitChat, updateCodexSettings } from "./lib/api";

export default function App() {
  const [nowState, setNowState] = useState<NowState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [isControlPageOpen, setIsControlPageOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [codexSettings, setCodexSettings] = useState<CodexSettings | null>(null);
  const [codexStatus, setCodexStatus] = useState<ProviderInfo | null>(null);
  const [projectApiKeyDraft, setProjectApiKeyDraft] = useState("");
  const [compatibleApiKeyDraft, setCompatibleApiKeyDraft] = useState("");
  const [compatibleBaseUrlDraft, setCompatibleBaseUrlDraft] = useState("");
  const [compatibleModelDraft, setCompatibleModelDraft] = useState("");
  const [compatibleResponseFormatDraft, setCompatibleResponseFormatDraft] =
    useState<CodexSettings["compatibleResponseFormat"]>("json-object");
  const [codexStatusMessage, setCodexStatusMessage] = useState<string | null>(null);
  const [isSavingCodexSettings, setIsSavingCodexSettings] = useState(false);
  const {
    bootstrap,
    qrSession,
    qrStatusMessage,
    isStartingMusicLogin,
    isLoggingOutMusic,
    syncMusicBootstrap,
    refreshMusicBootstrap,
    startMusicLogin,
    disconnectMusic
  } = useMusicLogin();
  const publishNowState = useCallback((state: NowState) => {
    setNowState(state);
  }, []);
  const publishError = useCallback((message: string | null | ((current: string | null) => string | null)) => {
    setError(message);
  }, []);
  const playback = usePlaybackController(nowState, publishNowState, setMusicError);

  const syncCodexBootstrap = useCallback((settings: CodexSettings, status: ProviderInfo) => {
    setCodexSettings(settings);
    setCodexStatus(status);
    setCompatibleBaseUrlDraft(settings.compatibleBaseUrl);
    setCompatibleModelDraft(settings.compatibleModel);
    setCompatibleResponseFormatDraft(settings.compatibleResponseFormat);
  }, []);

  useRadioStream(publishNowState, publishError);

  useEffect(() => {
    void fetchBootstrap()
      .then((bootstrapResponse) => {
        syncMusicBootstrap(bootstrapResponse.music);
        setNowState(bootstrapResponse.now);
        syncCodexBootstrap(bootstrapResponse.codex, bootstrapResponse.codexStatus);
      })
      .catch((fetchError: unknown) => {
        setError(fetchError instanceof Error ? fetchError.message : "电台初始化失败");
      });
  }, [syncCodexBootstrap, syncMusicBootstrap]);

  const queue = nowState?.queuedTracks.slice(0, 3) ?? [];
  const narrationChars = useMemo(
    () => buildNarrationChars(nowState?.narrationText ?? "", playback.narrationProgress, playback.isNarrationPlaying),
    [nowState?.narrationText, playback.isNarrationPlaying, playback.narrationProgress]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const message = draft.trim();

    if (!message) {
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      await playback.unlockAudioPlayback();

      const response = await submitChat(message);
      setNowState(response.nowState);
      setDraft("");
      void refreshMusicBootstrap();
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "电台生成失败");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSaveCodexSettings(clearProjectApiKey = false): Promise<void> {
    if (!codexSettings) {
      return;
    }

    setIsSavingCodexSettings(true);
    setCodexStatusMessage(null);

    try {
      const response = await updateCodexSettings({
        authSource: codexSettings.authSource,
        projectApiKey: clearProjectApiKey ? undefined : projectApiKeyDraft || undefined,
        clearProjectApiKey,
        compatibleApiKey: compatibleApiKeyDraft || undefined,
        compatibleBaseUrl: compatibleBaseUrlDraft || undefined,
        compatibleModel: compatibleModelDraft || undefined,
        compatibleResponseFormat: compatibleResponseFormatDraft
      });

      syncCodexBootstrap(response.settings, response.status);
      setProjectApiKeyDraft("");
      setCompatibleApiKeyDraft("");
      setCodexStatusMessage(
        response.settings.authSource === "project-api"
          ? "项目 Codex API 设置已更新。"
          : response.settings.authSource === "openai-compatible"
            ? "兼容 Responses API 设置已更新。"
          : "已切换到共享 Codex 登录。"
      );
    } catch (saveError: unknown) {
      setCodexStatusMessage(saveError instanceof Error ? saveError.message : "Codex 设置保存失败");
    } finally {
      setIsSavingCodexSettings(false);
    }
  }

  return (
    <div className="radio-shell">
      <audio ref={playback.narrationAudioRef} hidden playsInline preload="auto" />
      <audio ref={playback.preloadMusicAudioRef} hidden playsInline preload="auto" />

      <main
        className="radio-frame"
        onPointerDownCapture={() => {
          if (!playback.audioReady) {
            void playback.unlockAudioPlayback();
          }
        }}
      >
        <RecordPlayer
          bootstrap={bootstrap}
          error={error}
          isNarrationPlaying={playback.isNarrationPlaying}
          isPlaybackPlaying={playback.isPlaybackPlaying}
          isUnlockingAudio={playback.isUnlockingAudio}
          draft={draft}
          isSending={isSending}
          musicError={musicError}
          narrationChars={narrationChars}
          nowState={nowState}
          onDraftChange={setDraft}
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          onPlayPause={() => {
            void playback.handlePlayPause();
          }}
          onPlayNext={() => {
            void playback.playNext();
          }}
          onPlayPrevious={() => {
            void playback.playPrevious();
          }}
          playbackControlLabel={playback.playbackControlLabel}
          canPlayPrevious={playback.canPlayPrevious}
        />

        <button className="control-launcher" onClick={() => setIsControlPageOpen(true)} type="button">
          控制台
        </button>

        {isControlPageOpen ? (
          <section className="control-page" aria-label="电台控制台">
            <div className="control-page-inner">
              <header className="control-page-head">
                <div>
                  <p className="station-kicker">Control Room</p>
                  <h2>电台控制台</h2>
                </div>
                <button className="ghost-button" onClick={() => setIsControlPageOpen(false)} type="button">
                  回到播放器
                </button>
              </header>

              <div className="deck-console">
                <QueuePanel queue={queue} />
                <CallInPanel
                  bootstrap={bootstrap}
                  compatibleApiKeyDraft={compatibleApiKeyDraft}
                  compatibleBaseUrlDraft={compatibleBaseUrlDraft}
                  compatibleModelDraft={compatibleModelDraft}
                  compatibleResponseFormatDraft={compatibleResponseFormatDraft}
                  codexSettings={codexSettings}
                  codexStatus={codexStatus}
                  codexStatusMessage={codexStatusMessage}
                  draft={draft}
                  isLoggingOutMusic={isLoggingOutMusic}
                  isSending={isSending}
                  isSavingCodexSettings={isSavingCodexSettings}
                  isStartingMusicLogin={isStartingMusicLogin}
                  projectApiKeyDraft={projectApiKeyDraft}
                  onClearProjectApiKey={() => {
                    setIsSavingCodexSettings(true);
                    setCodexSettings((current: CodexSettings | null) =>
                      current
                        ? {
                            ...current,
                            authSource: "shared-cli"
                          }
                        : current
                    );
                    void updateCodexSettings({
                      authSource: "shared-cli",
                      clearProjectApiKey: true
                    })
                      .then((response) => {
                        syncCodexBootstrap(response.settings, response.status);
                        setProjectApiKeyDraft("");
                        setCompatibleApiKeyDraft("");
                        setCodexStatusMessage("已清空项目 Key，并切回共享 Codex 登录。");
                      })
                      .catch((saveError: unknown) => {
                        setCodexStatusMessage(saveError instanceof Error ? saveError.message : "Codex 设置保存失败");
                      })
                      .finally(() => {
                        setIsSavingCodexSettings(false);
                      });
                  }}
                  onCodexAuthSourceChange={(value) => {
                    setCodexSettings((current: CodexSettings | null) =>
                      current ? { ...current, authSource: value } : current
                    );
                  }}
                  onDisconnectMusic={() => {
                    void disconnectMusic();
                  }}
                  onDraftChange={setDraft}
                  onProjectApiKeyDraftChange={setProjectApiKeyDraft}
                  onCompatibleApiKeyDraftChange={setCompatibleApiKeyDraft}
                  onCompatibleBaseUrlDraftChange={setCompatibleBaseUrlDraft}
                  onCompatibleModelDraftChange={setCompatibleModelDraft}
                  onCompatibleResponseFormatDraftChange={setCompatibleResponseFormatDraft}
                  onClearCompatibleApiKey={() => {
                    setIsSavingCodexSettings(true);
                    void updateCodexSettings({
                      authSource: "shared-cli",
                      clearCompatibleApiKey: true
                    })
                      .then((response) => {
                        syncCodexBootstrap(response.settings, response.status);
                        setCompatibleApiKeyDraft("");
                        setCodexStatusMessage("已清空兼容接口 Key，并切回共享 Codex 登录。");
                      })
                      .catch((saveError: unknown) => {
                        setCodexStatusMessage(saveError instanceof Error ? saveError.message : "Codex 设置保存失败");
                      })
                      .finally(() => {
                        setIsSavingCodexSettings(false);
                      });
                  }}
                  onSaveCodexSettings={() => {
                    void handleSaveCodexSettings(false);
                  }}
                  onStartMusicLogin={() => {
                    void startMusicLogin();
                  }}
                  onSubmit={(event) => {
                    void handleSubmit(event);
                  }}
                  showComposer={false}
                  qrSession={qrSession}
                  qrStatusMessage={qrStatusMessage}
                />
              </div>

              <StatusStrip bootstrap={bootstrap} codexSettings={codexSettings} nowState={nowState} />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
