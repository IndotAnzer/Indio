# Indio

`Indio` 是一个面向个人场景的 AI 电台原型项目。当前仓库已经按工程文档搭起了前后端工作区、核心服务骨架、PWA 外壳，并把 `Codex` 决策链改成优先复用本机 `codex login` 的 OAuth 会话；当本地 CLI 未登录、超时或调用失败时，会自动降级到本地 heuristic fallback。现在仓库已经改成接入 [NeteaseCloudMusicAPI Enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced) 做音乐检索与直链播放，并使用 `Mimo` 官方 `chat/completions + audio` 协议生成服务端 TTS 文件缓存。

## 目录

```text
.
├─ apps/pwa          # 前端 PWA
├─ docs              # 工程文档
├─ server            # Fastify 服务、核心链路、适配层
└─ user              # 用户长期语料
```

## 快速开始

```bash
npm install
codex login
cp .env.example .env
npm run dev
```

`npm run dev` 会一次性启动 `api-enhanced`、Indio 后端和前端 PWA。默认地址：

- 网易云 API：`http://localhost:3000`
- 后端：`http://localhost:8787`
- 前端：`http://localhost:5173`

启动器会复用已经在 3000、8787、5173 上运行的服务；如果 `api-enhanced` 不在 `/Users/indot/api-enhanced`，可以这样指定目录：

```bash
NETEASE_API_ENHANCED_DIR=/path/to/api-enhanced npm run dev
```

如果你想先确认本机 OAuth 状态，可以运行：

```bash
codex login status
```

## 当前能力

- `POST /api/chat`：接收用户输入并返回结构化播报结果
- `GET /api/now`：查看当前播报和播放状态
- `GET /api/next`：查看下一首歌
- `GET /api/taste`：读取用户画像摘要
- `GET /api/plan/today`：读取今日计划
- `GET /api/music/bootstrap`：获取当前音乐服务配置
- `WS /stream`：流式接收状态变更

## 现阶段实现说明

- `Codex` 默认通过本机 `codex exec` 调用，复用 `codex login` 写入的 ChatGPT OAuth 会话。
- `/health` 会返回当前 `codex`、`music` 和 `tts` 的配置状态，方便在前端直接看到状态。
- 当本地 `Codex CLI` 未登录、超时或返回异常时，系统会自动走本地 fallback 模式。
- 音乐层现在明确对接 `api-enhanced`；PWA 会优先播放后端返回的网易云音频直链，拿不到直链时保留歌曲页跳转链接。
- `/song/url/v1` 会默认带上 `unblock=true`，以便复用该项目的解灰能力；如你不想启用，可以在环境变量里关闭。
- `Mimo` 现在支持服务端生成音频文件并缓存到 `server/cache/tts/`，前端优先播放真实音频 URL。

## 网易云与 TTS 配置

最少需要补齐这些环境变量：

```bash
NETEASE_API_BASE_URL=http://localhost:3000
NETEASE_ENABLE_UNBLOCK=true
MIMO_API_KEY=...
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_TTS_MODEL=mimo-v2.5-tts
MIMO_TTS_VOICE=茉莉
MIMO_TTS_FORMAT=mp3
```

中文口播建议使用 `茉莉`、`冰糖`、`苏打` 或 `白桦` 这类中文音色；`Chloe` 会被服务端兼容映射到 `茉莉`，避免中文播报听起来像乱码。

推荐你本地单独起一个 `api-enhanced` 服务，再把它的地址填到 `NETEASE_API_BASE_URL`。如果你已经有可用 cookie，可以额外填 `NETEASE_COOKIE`，这样命中更多需要登录态的曲目和接口。播放音质可以用 `NETEASE_PLAYBACK_LEVEL` 调整，默认是 `standard`；如果需要跟随增强版的解灰能力，可以保留 `NETEASE_ENABLE_UNBLOCK=true`，也可以用 `NETEASE_UNBLOCK_SOURCE` 指定音源。

如果你的网络环境依赖本地代理才能访问 `Mimo`，可以额外设置：

```bash
MIMO_PROXY_URL=http://127.0.0.1:7890
```

服务端会通过这个代理请求 `Mimo` 的 `chat/completions` 语音接口。

最省事的启动方式就是按上游 README 跑一个本地服务：

```bash
docker run -d -p 3000:3000 --name ncm-api moefurina/ncm-api:latest
```

如果你本机直连上游时遇到 `unable to get local issuer certificate` 这类证书链错误，可以先用本地源码方式启动：

```bash
git clone https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced.git
cd api-enhanced
npm install
NODE_TLS_REJECT_UNAUTHORIZED=0 npm start
```

这是本地联调时的兜底方案，只建议在你明确知道自己机器的 TLS 环境有问题时使用。

## 下一步建议

1. 继续优化 `Codex CLI` 的调用超时、重试和上下文压缩策略。
2. 为网易云适配层补更多个性化能力，例如每日推荐、歌单种子和歌词同步。
3. 把 Mimo 的同步文件模式升级为可选流式模式，降低播报起始延迟。
4. 增加更多计划调度规则和设备输出通道。
