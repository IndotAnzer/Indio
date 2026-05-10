const INDIO_LOCAL_API_BASE_URL = "http://localhost:8900";

// Fill these after creating a WeChat CloudBase environment and Cloud Run service.
// Trial/release builds prefer wx.cloud.callContainer when these values are set.
export const INDIO_CLOUD_ENV_ID = "cloud1-d9ge7p0gq5b7853be";
export const INDIO_CLOUD_SERVICE_NAME = "indio-agent";
export const INDIO_FORCE_CLOUD_CONTAINER_IN_DEVELOP = false;

// Optional fallback for non-CloudBase deployments.
const INDIO_PRODUCTION_API_BASE_URL = "";

export const INDIO_REQUEST_TIMEOUT_MS = 180_000;
export const INDIO_WS_RECONNECT_MS = 2_000;
export const INDIO_ENABLE_WECHAT_LOGIN = true;

type MiniProgramEnvVersion = "develop" | "trial" | "release" | "unknown";

const LOCAL_BASE_URL_RE = /^https?:\/\/(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(?::\d+)?(?:\/|$)/i;

export function miniProgramEnvVersion(): MiniProgramEnvVersion {
  try {
    const envVersion = wx.getAccountInfoSync?.().miniProgram?.envVersion;
    if (envVersion === "develop" || envVersion === "trial" || envVersion === "release") {
      return envVersion;
    }
  } catch {
    // Some tooling does not expose account info while compiling.
  }

  return "unknown";
}

export function isProductionLikeMiniProgram(): boolean {
  const envVersion = miniProgramEnvVersion();
  return envVersion === "trial" || envVersion === "release";
}

export function shouldUseCloudContainer(): boolean {
  const hasCloudTarget = Boolean(INDIO_CLOUD_ENV_ID.trim() && INDIO_CLOUD_SERVICE_NAME.trim());
  if (!hasCloudTarget) {
    return false;
  }

  return isProductionLikeMiniProgram() || INDIO_FORCE_CLOUD_CONTAINER_IN_DEVELOP;
}

export function indioApiBaseUrl(): string {
  if (shouldUseCloudContainer()) {
    return `cloud://${INDIO_CLOUD_ENV_ID}/${INDIO_CLOUD_SERVICE_NAME}`;
  }

  const productionBaseUrl = INDIO_PRODUCTION_API_BASE_URL.trim();
  if (isProductionLikeMiniProgram() && productionBaseUrl) {
    return productionBaseUrl;
  }

  return INDIO_LOCAL_API_BASE_URL;
}

export const INDIO_API_BASE_URL = indioApiBaseUrl();

export function initIndioCloud(): void {
  if (!INDIO_CLOUD_ENV_ID.trim() || !wx.cloud?.init) {
    return;
  }

  wx.cloud.init({
    env: INDIO_CLOUD_ENV_ID,
    traceUser: true
  });
}

export function cloudContainerRequestConfig() {
  return {
    config: {
      env: INDIO_CLOUD_ENV_ID
    },
    header: {
      "X-WX-SERVICE": INDIO_CLOUD_SERVICE_NAME
    }
  };
}

export function indioNetworkConfigError(): string | null {
  if (!isProductionLikeMiniProgram()) {
    return null;
  }

  if (shouldUseCloudContainer()) {
    return null;
  }

  const productionBaseUrl = INDIO_PRODUCTION_API_BASE_URL.trim();
  if (!productionBaseUrl) {
    return "线上小程序还没有配置微信云托管环境。请填写 INDIO_CLOUD_ENV_ID 和 INDIO_CLOUD_SERVICE_NAME，或改用 HTTPS API 域名。";
  }

  if (!/^https:\/\//i.test(productionBaseUrl)) {
    return "线上小程序 API 域名必须使用 HTTPS。";
  }

  if (LOCAL_BASE_URL_RE.test(productionBaseUrl)) {
    return "线上小程序不能请求 localhost 或本机 IP，请改成公网 HTTPS API 域名。";
  }

  return null;
}
