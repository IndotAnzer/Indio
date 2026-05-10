import type { MusicBootstrap, NowState } from "@indio/contracts";
import type { CSSProperties, FormEvent } from "react";
import type { buildNarrationChars } from "../hooks/usePlaybackController";

type NarrationChar = ReturnType<typeof buildNarrationChars>[number];

interface RecordPlayerProps {
  bootstrap: MusicBootstrap | null;
  nowState: NowState | null;
  narrationChars: NarrationChar[];
  playbackControlLabel: string;
  isPlaybackPlaying: boolean;
  isUnlockingAudio: boolean;
  isNarrationPlaying: boolean;
  draft: string;
  isSending: boolean;
  canPlayPrevious: boolean;
  musicError: string | null;
  error: string | null;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onPlayPause: () => void;
  onPlayPrevious: () => void;
  onPlayNext: () => void;
}

export function RecordPlayer(props: RecordPlayerProps) {
  const currentTrack = props.nowState?.nowPlaying ?? null;
  const artworkUrl = currentTrack?.artworkUrl ?? "/indio-placeholder.png";
  const backgroundImage = `url(${artworkUrl})`;
  const showMusicFlow = Boolean(currentTrack && props.isPlaybackPlaying && !props.isNarrationPlaying);
  const narrationReady = Boolean(props.nowState?.narrationAudioUrl);

  return (
    <section className="record-scene" style={{ "--artwork": backgroundImage } as CSSProperties}>
      <div className="scene-backdrop" />
      <header className="station-bar">
        <div>
          <p className="station-kicker">Indio</p>
          <strong className="station-title">
            {props.bootstrap?.loggedIn
              ? `${props.bootstrap.user?.nickname ?? "你的"}的私人唱片台`
              : "Personal Record Radio"}
          </strong>
        </div>
      </header>

      <div className="turntable-layout">
        <div className={`vinyl-wrap ${props.isPlaybackPlaying ? "is-spinning" : ""}`}>
          <div className="vinyl-disc">
            <div className="vinyl-art" />
            <div className="vinyl-label">
              <span>{currentTrack ? "ON AIR" : "STANDBY"}</span>
            </div>
          </div>
          <div className="tone-arm" />
        </div>

        <section className="track-panel">
          <span className={`live-pill ${currentTrack ? "is-live" : ""}`}>
            {currentTrack ? "ON AIR" : "STANDBY"}
          </span>
          <h1>{currentTrack?.title ?? "等待开播"}</h1>
          <p className="track-line">
            {currentTrack
              ? `${currentTrack.artist} · ${currentTrack.album}`
              : "发一句话，Indio 会先准备口播，再把歌接进来。"}
          </p>

          <form className="on-air-composer" onSubmit={props.onSubmit}>
            <textarea
              onChange={(event) => props.onDraftChange(event.target.value)}
              placeholder="例如：给我一段适合写代码的专注流 / 下一首 / 安静一点"
              rows={2}
              value={props.draft}
            />
            <div className="on-air-actions">
              <button className="primary-button" disabled={props.isSending} type="submit">
                {props.isSending ? "生成中" : "发送给电台"}
              </button>
            </div>
          </form>

          <div className="narration-reader">
            {showMusicFlow ? (
              <div className="music-flow" aria-label="正在播放音乐">
                <div className="music-flow-track" aria-hidden="true">
                  <span>Music🎵</span>
                </div>
              </div>
            ) : props.nowState?.narrationText && narrationReady ? (
              <div
                className={`karaoke-line ${props.isNarrationPlaying ? "is-speaking" : ""}`}
                aria-label={props.nowState.narrationText}
              >
                {props.narrationChars.map((item, index) => {
                  if (item.state === "break") {
                    return <br key={`break-${index}`} />;
                  }

                  if (item.state === "space") {
                    return (
                      <span className="karaoke-char is-space" key={`space-${index}`}>
                        {" "}
                      </span>
                    );
                  }

                  return (
                    <span
                      className={[
                        "karaoke-char",
                        item.state === "read" ? "is-read" : "",
                        item.state === "active" ? "is-active" : ""
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={`${item.char}-${index}`}
                    >
                      {item.char}
                    </span>
                  );
                })}
              </div>
            ) : props.nowState?.narrationText ? (
              <p className="narration-placeholder">口播音频准备中。</p>
            ) : (
              <p className="narration-placeholder">
                {currentTrack ? "这一轮没有口播，先把音乐往下接。" : "等你发第一句，电台就开机。"}
              </p>
            )}
          </div>

          <div className="transport-row">
            <button
              className="transport-button"
              aria-label="上一首"
              disabled={!currentTrack || !props.canPlayPrevious}
              onClick={props.onPlayPrevious}
              title="上一首"
              type="button"
            >
              <span aria-hidden="true">⏮</span>
            </button>
            <button
              className="transport-button is-primary"
              aria-label={props.playbackControlLabel}
              aria-pressed={props.isPlaybackPlaying}
              disabled={!currentTrack || props.isUnlockingAudio}
              onClick={props.onPlayPause}
              title={props.playbackControlLabel}
              type="button"
            >
              <span aria-hidden="true">{props.isPlaybackPlaying ? "||" : "▶"}</span>
            </button>
            <button
              className="transport-button"
              aria-label="下一首"
              disabled={!currentTrack}
              onClick={props.onPlayNext}
              title="下一首"
              type="button"
            >
              <span aria-hidden="true">⏭</span>
            </button>
          </div>

          {props.musicError ? <p className="radio-message is-warning">{props.musicError}</p> : null}
          {props.error ? <p className="radio-message is-warning">{props.error}</p> : null}
        </section>
      </div>
    </section>
  );
}
