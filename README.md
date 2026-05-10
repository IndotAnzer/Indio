# Indio

Indio 是一个运行在本地的个人 AI 电台。它把浏览器播放器、后端 Agent、网易云音乐、中文 DJ 口播、TTS 音频和长期听歌记忆放在同一个项目里，目标不是做通用 agent 框架，而是做一套专门服务 Indio 的电台运行时。

现在的主链路是：

```text
用户在 PWA 输入一句话
  -> Indio Agent 读取长期品味和上一段口播上下文
  -> 调用网易云工具查找可播放歌曲
  -> 生成中文 DJ 口播和播放决策
  -> 后端合成口播音频并推送当前电台状态
  -> PWA 播放口播、歌曲，并预取下一段
```

## 项目结构

```text
.
├─ agent/                    # FastAPI 后端和 Indio Agent 运行时
│  ├─ agent.py               # AgentLoop：模型调用、工具调用、最终播放 JSON
│  ├─ server.py              # HTTP / WebSocket / TTS / 当前播放状态
│  ├─ adapters/              # 网易云、Mimo TTS、天气、日历、输出设备适配
│  ├─ tools/                 # Agent 可调用工具：选歌、背景素材、口播上下文、用户品味
│  ├─ core/                  # 本地状态存储
│  └─ music_memory.py        # TASTE/HABIT 长期音乐记忆
├─ apps/pwa/                 # React/Vite 网页播放器
├─ apps/wechat-miniprogram/  # 微信小程序客户端原型
├─ packages/contracts/       # 前后端共享 TypeScript 类型
├─ scripts/                  # 本地启动、清理和维护脚本
└─ indio/                    # 本地运行数据、记忆和 TTS 缓存
```

## 本地依赖

- Node.js 和 npm
- Python 3.11+，并安装后端依赖：`fastapi`、`uvicorn`、`openai`、`pydantic`、`httpx`
- 本地 [NeteaseCloudMusicAPI Enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)，默认目录是 `/Users/indot/api-enhanced`
- 可选：Mimo TTS key，用于生成口播音频

如果 `api-enhanced` 不在默认目录，启动时用 `NETEASE_API_ENHANCED_DIR` 指向它。

## 快速开始

```bash
npm install
python3 -m pip install fastapi uvicorn openai pydantic httpx
cp .env.example .env
```

编辑 `.env`，至少确认这些值：

```bash
INDIO_AGENT_PORT=8900
INDIO_PUBLIC_BASE_URL=http://localhost:8900
INDIO_PWA_URL=http://localhost:5173
VITE_INDIO_API_URL=http://localhost:8900

NETEASE_API_BASE_URL=http://localhost:3000
NETEASE_ENABLE_UNBLOCK=true

MIMO_API_KEY=
MIMO_BASE_URL=https://api.xiaomimimo.com/v1
MIMO_TTS_MODEL=mimo-v2.5-tts
MIMO_TTS_VOICE=茉莉
MIMO_TTS_FORMAT=mp3
```

当前 `agent/agent.py` 的主模型调用仍走 DashScope 的 OpenAI-compatible Responses 接口，模型是 `qwen3.5-plus`，所以实际选歌/口播链路还需要：

```bash
DASHSCOPE_API_KEY=...
```

`INDIO_AGENT_API_KEY`、`INDIO_AGENT_BASE_URL`、`INDIO_AGENT_MODEL` 目前会被 API 状态和音乐记忆摘要读取；主 AgentLoop 后续统一到 `INDIO_AGENT_*` 后，这里可以再收敛。

启动全部本地服务：

```bash
npm run dev
```

默认服务地址：

- PWA：`http://localhost:5173`
- Indio Agent API：`http://localhost:8900`
- Netease API：`http://localhost:3000`

`npm run dev` 会启动或复用三个服务：`api-enhanced`、`agent/server.py` 和 PWA。端口已经有服务时脚本会直接复用。

## 微信小程序

原生小程序版本位于 `apps/wechat-miniprogram`，用微信开发者工具直接打开该目录即可。开发版默认连接本地 Indio Agent API：

```text
http://localhost:8900
```

普通 HTTP 模式下，打开 `apps/wechat-miniprogram/miniprogram/utils/config.ts` 里的 `INDIO_ENABLE_WECHAT_LOGIN` 后，小程序启动时会调用 `wx.login`，再由后端 `POST /api/auth/wechat/login` 换取 Indio session token。云托管模式下小程序会跳过这一步，后端直接读取云托管注入的 OpenID 做用户分桶；没有用户身份的本地请求默认进入 `local` 用户。

如果没有自己的域名，推荐走微信云托管。先在微信云开发里创建环境，再创建云托管服务，服务名建议用 `indio-agent`。然后把 `apps/wechat-miniprogram/miniprogram/utils/config.ts` 里的值填上：

```ts
export const INDIO_CLOUD_ENV_ID = "你的云开发环境 ID";
export const INDIO_CLOUD_SERVICE_NAME = "indio-agent";
```

小程序体验版/正式版会使用 `wx.cloud.callContainer` 请求后端，并使用 `wx.cloud.connectContainer` 接收实时状态；这样不需要自有域名，也不需要在小程序后台配置 request/socket 合法域名。

后端云托管部署文件在 `agent/Dockerfile`。通过云托管「本地代码」部署时，代码目录选择 `agent/`，端口填 `8080`，环境变量至少配置：

```bash
INDIO_SESSION_SECRET=...
WECHAT_MINIPROGRAM_APP_ID=...
WECHAT_MINIPROGRAM_APP_SECRET=...
DASHSCOPE_API_KEY=...
NETEASE_API_BASE_URL=...
MIMO_API_KEY=...
MIMO_TTS_VOICE=茉莉
```

云托管里的 `NETEASE_API_BASE_URL` 不能再写 `localhost:3000`；需要指向一个云上可访问的 `api-enhanced` 服务。可以把 `api-enhanced` 也部署成另一个云托管服务，或使用你已有的公网服务地址。

如果你不用云托管，也可以把 `INDIO_PRODUCTION_API_BASE_URL` 填成已在小程序后台配置的 HTTPS 域名。

当前后端已把播放状态、WebSocket 客户端、网易云登录态、歌单缓存和 TASTE/HABIT 记忆按用户隔离。公开发布前还需要把网易云 cookie 存储升级成加密数据库/密钥管理，并把第三方音乐与图片 URL 代理到小程序允许的域名下。

如果要指定网易云 API 目录：

```bash
NETEASE_API_ENHANCED_DIR=/path/to/api-enhanced npm run dev
```

只启动 Agent 和 PWA：

```bash
npm run dev:agent-pwa
```

直接运行后端：

```bash
cd agent
PYTHONPATH=. INDIO_PROJECT_ROOT=.. python3 -m uvicorn server:app --host 0.0.0.0 --port 8900 --reload
```

直接试跑 AgentLoop：

```bash
python3 agent/agent.py
```

## 主要接口

后端入口是 `agent/server.py`。

- `GET /api/bootstrap`：PWA 初始化状态、音乐登录状态、agent 状态、TTS 状态
- `GET /api/radio/now`：当前电台状态
- `POST /api/radio/turn`：根据用户输入生成一段电台
- `POST /api/radio/advance`：推进到下一段，优先使用已预生成内容
- `GET /api/settings/agent`：agent 配置和可用状态
- `GET /api/agent/runs`：agent run 列表占位接口
- `POST /api/integrations/music/login/qr`：创建网易云扫码登录
- `GET /api/integrations/music/login/qr?key=...`：轮询扫码登录状态
- `POST /api/integrations/music/logout`：退出网易云
- `GET /media/tts/{filename}`：TTS 缓存音频
- `GET /ws/radio`：电台状态 WebSocket 推送

## 电台记忆

Indio 会把本地运行数据放在 `indio/` 下：

- `indio/cache/tts/`：口播音频缓存
- `indio/memory/TASTE.md`：长期听歌品味
- `indio/memory/HABIT.md`：不同时段、场景、请求方式下的听歌习惯
- `indio/memory/events.jsonl`：近期电台请求和播放事件

Agent 每轮选歌前会读取 TASTE/HABIT。用户只说“下一首”“轻松一点”“随便来一首”时，它会优先用这些记忆解释请求。

清理本地运行产物：

```bash
npm run clean:runtime
```

清理前备份：

```bash
npm run clean:runtime -- --backup
```

## 常用命令

```bash
npm run dev          # 启动 api-enhanced、Indio Agent、PWA
npm run dev:agent-pwa # 只启动 Indio Agent 和 PWA
npm run typecheck    # contracts + PWA 类型检查
npm test             # workspace 测试
npm run build        # contracts + PWA 构建
npm run check        # typecheck + test + build
```

## 排错

`api-enhanced` 目录找不到：

```bash
NETEASE_API_ENHANCED_DIR=/path/to/api-enhanced npm run dev
```

本机代理导致 `localhost:3000` 返回 `502 Bad Gateway` 时，先绕过代理验证网易云 API：

```bash
curl --noproxy '*' http://127.0.0.1:3000/login/status
```

PWA 一直显示请求超时，通常要先看 Indio Agent 是否还在等待模型或工具：

```bash
curl --noproxy '*' http://127.0.0.1:8900/api/bootstrap
```

`python3 agent/agent.py` 卡住但没有报错时，优先检查：

- `DASHSCOPE_API_KEY` 是否能被当前 shell 或 `agent/.env` 读取
- 本地代理是否能访问 DashScope
- `NETEASE_API_BASE_URL` 是否能通过 `127.0.0.1:3000` 正常访问

微信小程序原型在 `apps/wechat-miniprogram/`。本地开发时它默认连 `http://localhost:8900`；真机和生产环境需要换成微信后台允许的 HTTPS 域名。
