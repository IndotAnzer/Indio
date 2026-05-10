import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { AgentRun, AgentSettings, NowState, ProviderInfo } from "@indio/contracts";
import { CallInPanel } from "./components/CallInPanel";
import { QueuePanel } from "./components/QueuePanel";
import { RecordPlayer } from "./components/RecordPlayer";
import { StatusStrip } from "./components/StatusStrip";
import { buildNarrationChars, usePlaybackController } from "./hooks/usePlaybackController";
import { useMusicLogin } from "./hooks/useMusicLogin";
import { useRadioStream } from "./hooks/useRadioStream";
import { fetchAgentRuns, fetchBootstrap, submitChat } from "./lib/api";

export default function App() {
  const [nowState, setNowState] = useState<NowState | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [musicError, setMusicError] = useState<string | null>(null);
  const [isControlPageOpen, setIsControlPageOpen] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [agentStatus, setAgentStatus] = useState<ProviderInfo | null>(null);
  const [recentAgentRuns, setRecentAgentRuns] = useState<AgentRun[]>([]);
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

  const syncAgentBootstrap = useCallback((settings: AgentSettings, status: ProviderInfo) => {
    setAgentSettings(settings);
    setAgentStatus(status);
  }, []);

  useRadioStream(publishNowState, publishError);

  useEffect(() => {
    void fetchBootstrap()
      .then((bootstrapResponse) => {
        syncMusicBootstrap(bootstrapResponse.music);
        setNowState(bootstrapResponse.now);
        syncAgentBootstrap(bootstrapResponse.agent, bootstrapResponse.agentStatus);
        void fetchAgentRuns(5).then((response) => setRecentAgentRuns(response.runs)).catch(() => {});
      })
      .catch((fetchError: unknown) => {
        setError(fetchError instanceof Error ? fetchError.message : "电台初始化失败");
      });
  }, [syncAgentBootstrap, syncMusicBootstrap]);

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
      void fetchAgentRuns(5).then((runsResponse) => setRecentAgentRuns(runsResponse.runs)).catch(() => {});
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : "电台生成失败");
    } finally {
      setIsSending(false);
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
                  agentSettings={agentSettings}
                  agentStatus={agentStatus}
                  recentAgentRuns={recentAgentRuns}
                  draft={draft}
                  isLoggingOutMusic={isLoggingOutMusic}
                  isSending={isSending}
                  isStartingMusicLogin={isStartingMusicLogin}
                  onDisconnectMusic={() => {
                    void disconnectMusic();
                  }}
                  onDraftChange={setDraft}
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

              <StatusStrip agentSettings={agentSettings} bootstrap={bootstrap} nowState={nowState} />
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
