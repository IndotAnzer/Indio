# Indio WeChat Mini Program

Native WeChat Mini Program client for Indio.

## Open In DevTools

Open this directory in WeChat DevTools:

```text
apps/wechat-miniprogram
```

The default `appid` is `touristappid`. Replace it in `project.config.json` or create a local `project.private.config.json` through DevTools for your real Mini Program account.

## Local API

The Mini Program client targets the local Indio backend in development:

```ts
// miniprogram/utils/config.ts
const INDIO_LOCAL_API_BASE_URL = "http://localhost:8900";
export const INDIO_CLOUD_ENV_ID = "";
export const INDIO_CLOUD_SERVICE_NAME = "indio-agent";
export const INDIO_ENABLE_WECHAT_LOGIN = true;
```

For trial and production builds without your own domain, fill `INDIO_CLOUD_ENV_ID` with your CloudBase environment ID and deploy the backend as a Cloud Run service named `indio-agent`. The client then uses:

- `wx.cloud.callContainer` for REST APIs
- `wx.cloud.connectContainer` for radio state WebSocket updates

This avoids custom domain and Mini Program server-domain setup for the Indio API itself.

The Cloud Run backend files are in `agent/`:

- `agent/Dockerfile`
- `agent/requirements.txt`

When deploying from source in CloudBase, choose `agent/` as the code directory, set the service port to `8080`, and configure runtime environment variables such as `DASHSCOPE_API_KEY`, `NETEASE_API_BASE_URL`, `MIMO_API_KEY`, `INDIO_SESSION_SECRET`, and WeChat app credentials.

`NETEASE_API_BASE_URL` must point to an `api-enhanced` service reachable from Cloud Run. Do not keep `localhost:3000` in Cloud Run.

If you choose a conventional HTTPS backend instead, fill `INDIO_PRODUCTION_API_BASE_URL` in `config.ts` and configure these domains in `mp.weixin.qq.com -> 开发 -> 开发管理 -> 开发设置 -> 服务器域名`:

- `request 合法域名`: `https://your-api-domain`
- `socket 合法域名`: `wss://your-api-domain`
- `downloadFile 合法域名`: domains used by artwork, TTS audio, and music streams

In Cloud Run mode, the backend reads the OpenID injected by CloudBase and does not need to call `code2Session` for normal app startup. Keep `WECHAT_MINIPROGRAM_APP_ID` / `WECHAT_MINIPROGRAM_APP_SECRET` configured if you also want to support the conventional HTTPS API path.

For production playback, prefer proxying Netease stream URLs and artwork through the Indio backend or a controlled media domain. Direct third-party media URLs can fail Mini Program domain and certificate checks.

The committed DevTools project config sets `setting.urlCheck` to `false` so local `http://localhost:8900` requests work in the simulator. Before uploading a production build, turn domain checking back on and use configured HTTPS/WSS domains.

## Current Scope

- Native player shell
- Indio REST API client
- Radio WebSocket updates
- `wx.createInnerAudioContext` playback
- Netease QR login polling
- WeChat `wx.login` to Indio session-token bootstrap

The backend now has a first pass of user-scoped session, radio state, WebSocket, Netease auth state, and memory paths. Before public release, add encrypted production storage for Netease cookies and proxy third-party media URLs through configured Mini Program domains.
