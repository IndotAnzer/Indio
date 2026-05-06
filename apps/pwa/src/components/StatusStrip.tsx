import type { CodexSettings, MusicBootstrap, NowState } from "@indio/contracts";
import { durationLabel, timeLabel } from "../lib/format";

interface StatusStripProps {
  bootstrap: MusicBootstrap | null;
  codexSettings: CodexSettings | null;
  nowState: NowState | null;
}

export function StatusStrip({ bootstrap, codexSettings, nowState }: StatusStripProps) {
  const currentTrack = nowState?.nowPlaying ?? null;
  const codexSourceLabel =
    codexSettings?.authSource === "openai-compatible"
      ? "兼容 API"
      : codexSettings?.authSource === "project-api"
        ? "项目 API"
        : "共享 Codex";
  const playbackSourceLabel = currentTrack?.playbackSource === "netease" ? "网易云直连" : "本地占位曲库";

  return (
    <aside className="status-strip">
      {currentTrack ? (
        <>
          <span>{durationLabel(currentTrack.durationSec)}</span>
          <span>{timeLabel(nowState?.updatedAt ?? new Date().toISOString())}</span>
          <span>{playbackSourceLabel}</span>
          {currentTrack.platformUrl ? (
            <a href={currentTrack.platformUrl} rel="noreferrer" target="_blank">
              打开网易云
            </a>
          ) : null}
        </>
      ) : null}
      <span>{bootstrap?.loggedIn ? "网易云歌单" : "未登录歌单"}</span>
      <span>{bootstrap?.libraryTrackCount ?? 0} 首已索引</span>
      <span>{nowState?.mode === "music-only" ? "纯音乐" : "含口播"}</span>
      <span>{codexSourceLabel}</span>
      <span>{nowState?.provider.kind ?? "standby"}</span>
    </aside>
  );
}
