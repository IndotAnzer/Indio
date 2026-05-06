import type { FormEvent } from "react";
import type { CodexSettings, MusicBootstrap, NeteaseQrLoginSession, ProviderInfo } from "@indio/contracts";

interface CallInPanelProps {
  bootstrap: MusicBootstrap | null;
  compatibleApiKeyDraft: string;
  compatibleBaseUrlDraft: string;
  compatibleModelDraft: string;
  compatibleResponseFormatDraft: CodexSettings["compatibleResponseFormat"];
  codexSettings: CodexSettings | null;
  codexStatus: ProviderInfo | null;
  codexStatusMessage: string | null;
  qrSession: NeteaseQrLoginSession | null;
  qrStatusMessage: string | null;
  draft: string;
  projectApiKeyDraft: string;
  isSending: boolean;
  isSavingCodexSettings: boolean;
  isStartingMusicLogin: boolean;
  isLoggingOutMusic: boolean;
  onClearProjectApiKey: () => void;
  onClearCompatibleApiKey: () => void;
  onCodexAuthSourceChange: (value: CodexSettings["authSource"]) => void;
  onCompatibleApiKeyDraftChange: (value: string) => void;
  onCompatibleBaseUrlDraftChange: (value: string) => void;
  onCompatibleModelDraftChange: (value: string) => void;
  onCompatibleResponseFormatDraftChange: (value: CodexSettings["compatibleResponseFormat"]) => void;
  onDraftChange: (value: string) => void;
  onProjectApiKeyDraftChange: (value: string) => void;
  onSaveCodexSettings: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStartMusicLogin: () => void;
  onDisconnectMusic: () => void;
  showComposer?: boolean;
}

export function CallInPanel(props: CallInPanelProps) {
  const sourceLabel =
    props.codexSettings?.authSource === "openai-compatible"
      ? "兼容 Responses API"
      : props.codexSettings?.authSource === "project-api"
        ? "项目 API key"
        : "共享 Codex 登录";

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
          Codex 来源：{sourceLabel}
          {props.codexStatus?.detail ? ` · ${props.codexStatus.detail}` : ""}
        </p>
        <div className="composer-actions">
          <label>
            <span className="station-kicker">Codex</span>
            <select
              onChange={(event) =>
                props.onCodexAuthSourceChange(event.target.value as CodexSettings["authSource"])
              }
              value={props.codexSettings?.authSource ?? "shared-cli"}
            >
              <option value="shared-cli">共享 Codex 登录</option>
              <option value="project-api">项目 API key</option>
              <option value="openai-compatible">兼容 Responses API</option>
            </select>
          </label>
        </div>
        {props.codexSettings?.authSource === "project-api" ? (
          <>
            <input
              onChange={(event) => props.onProjectApiKeyDraftChange(event.target.value)}
              placeholder={props.codexSettings.projectApiKeyLabel ?? "输入项目专用 OpenAI API key"}
              type="password"
              value={props.projectApiKeyDraft}
            />
            <div className="composer-actions">
              <button
                className="secondary-button"
                disabled={props.isSavingCodexSettings}
                onClick={props.onSaveCodexSettings}
                type="button"
              >
                {props.isSavingCodexSettings ? "保存中" : "保存 Codex 设置"}
              </button>
              {props.codexSettings.projectApiKeyConfigured ? (
                <button
                  className="ghost-button"
                  disabled={props.isSavingCodexSettings}
                  onClick={props.onClearProjectApiKey}
                  type="button"
                >
                  清空项目 Key
                </button>
              ) : null}
            </div>
          </>
        ) : props.codexSettings?.authSource === "openai-compatible" ? (
          <>
            <input
              onChange={(event) => props.onCompatibleBaseUrlDraftChange(event.target.value)}
              placeholder="https://api.example.com/v1"
              type="url"
              value={props.compatibleBaseUrlDraft}
            />
            <input
              onChange={(event) => props.onCompatibleModelDraftChange(event.target.value)}
              placeholder="模型名"
              type="text"
              value={props.compatibleModelDraft}
            />
            <label>
              <span className="station-kicker">Responses 格式</span>
              <select
                onChange={(event) =>
                  props.onCompatibleResponseFormatDraftChange(
                    event.target.value as CodexSettings["compatibleResponseFormat"]
                  )
                }
                value={props.compatibleResponseFormatDraft}
              >
                <option value="json-object">JSON Object（兼容第三方）</option>
                <option value="json-schema">JSON Schema（严格）</option>
              </select>
            </label>
            <input
              onChange={(event) => props.onCompatibleApiKeyDraftChange(event.target.value)}
              placeholder={props.codexSettings.compatibleApiKeyLabel ?? "输入兼容接口 API key"}
              type="password"
              value={props.compatibleApiKeyDraft}
            />
            <div className="composer-actions">
              <button
                className="secondary-button"
                disabled={props.isSavingCodexSettings}
                onClick={props.onSaveCodexSettings}
                type="button"
              >
                {props.isSavingCodexSettings ? "保存中" : "保存兼容接口"}
              </button>
              {props.codexSettings.compatibleApiKeyConfigured ? (
                <button
                  className="ghost-button"
                  disabled={props.isSavingCodexSettings}
                  onClick={props.onClearCompatibleApiKey}
                  type="button"
                >
                  清空兼容 Key
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="composer-actions">
            <button
              className="secondary-button"
              disabled={props.isSavingCodexSettings}
              onClick={props.onSaveCodexSettings}
              type="button"
            >
              {props.isSavingCodexSettings ? "切换中" : "切换到共享登录"}
            </button>
          </div>
        )}
        {props.codexStatusMessage ? <p className="radio-message">{props.codexStatusMessage}</p> : null}
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
