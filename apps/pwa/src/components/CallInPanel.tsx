import type { FormEvent } from "react";
import type { AgentRun, AgentSettings, MusicBootstrap, NeteaseQrLoginSession, ProviderInfo } from "@indio/contracts";

interface CallInPanelProps {
  bootstrap: MusicBootstrap | null;
  agentSettings: AgentSettings | null;
  agentStatus: ProviderInfo | null;
  recentAgentRuns: AgentRun[];
  qrSession: NeteaseQrLoginSession | null;
  qrStatusMessage: string | null;
  draft: string;
  isSending: boolean;
  isStartingMusicLogin: boolean;
  isLoggingOutMusic: boolean;
  onDraftChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStartMusicLogin: () => void;
  onDisconnectMusic: () => void;
  showComposer?: boolean;
}

export function CallInPanel(props: CallInPanelProps) {
  const agentTrace = (run: AgentRun): string | null => {
    const trace = run.finalOutput?.agentTrace;
    if (!Array.isArray(trace)) {
      return null;
    }
    const names = trace
      .map((item) => (typeof item === "string" ? item : null))
      .filter((item): item is string => Boolean(item));
    return names.length ? names.join(" → ") : null;
  };

  return (
    <section className="deck-panel call-panel">
      <div className="panel-head">
        <p className="station-kicker">Call In</p>
        <span>{props.bootstrap?.loggedIn ? "已连接网易云" : "未连接网易云"}</span>
      </div>

      {props.showComposer ?? true ? (
        <form className="radio-composer" onSubmit={props.onSubmit}>
          <textarea
            onChange={(event) => props.onDraftChange(event.target.value)}
            placeholder="例如：给我一段适合写代码的专注流 / 下一首 / 安静一点"
            rows={3}
            value={props.draft}
          />
          <div className="composer-actions">
            <button className="primary-button" disabled={props.isSending} type="submit">
              {props.isSending ? "生成中" : "发送给电台"}
            </button>
          </div>
        </form>
      ) : null}

      <div className="composer-actions">
        {props.bootstrap?.loggedIn ? (
          <button
            className="ghost-button"
            disabled={props.isLoggingOutMusic}
            onClick={props.onDisconnectMusic}
            type="button"
          >
            {props.isLoggingOutMusic ? "断开中" : "断开网易云"}
          </button>
        ) : (
          <button
            className="secondary-button"
            disabled={props.isStartingMusicLogin}
            onClick={props.onStartMusicLogin}
            type="button"
          >
            {props.isStartingMusicLogin ? "生成二维码" : "连接网易云"}
          </button>
        )}
      </div>

      <div className="login-drawer">
        <p className="radio-message">
          Indio Agent：{props.agentSettings?.model ?? "standby"}
          {props.agentStatus?.detail ? ` · ${props.agentStatus.detail}` : ""}
        </p>
        {props.recentAgentRuns.length ? (
          <div className="agent-run-list">
            <p className="station-kicker">Recent Agent Runs</p>
            {props.recentAgentRuns.slice(0, 3).map((run) => (
              <p className="radio-message" key={run.id}>
                {run.status} · {run.model} · {run.durationMs ?? 0}ms
                {agentTrace(run) ? ` · ${agentTrace(run)}` : ""}
                {run.error ? ` · ${run.error}` : ""}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {props.bootstrap?.loggedIn ? (
        <p className="radio-message">
          当前已连接 {props.bootstrap.user?.nickname ?? "网易云"}，电台会优先从你的歌单里挑歌。
        </p>
      ) : (
        <div className="login-drawer">
          <p className="radio-message">连接网易云后，Indio 会优先围绕你的歌单运转。</p>
          {props.qrSession?.qrImage ? (
            <img alt="网易云登录二维码" className="qr-image" src={props.qrSession.qrImage} />
          ) : null}
          {props.qrStatusMessage ? <p className="radio-message">{props.qrStatusMessage}</p> : null}
        </div>
      )}
    </section>
  );
}
