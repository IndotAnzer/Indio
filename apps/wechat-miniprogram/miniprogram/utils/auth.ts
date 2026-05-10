import { requestJson } from "./api";
import { INDIO_ENABLE_WECHAT_LOGIN, shouldUseCloudContainer } from "./config";
import { getSessionToken, saveSessionToken } from "./storage";
import type { AuthSessionResponse } from "./types";

function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success(response: any) {
        const code = typeof response.code === "string" ? response.code : "";
        if (!code) {
          reject(new Error("微信登录凭证为空"));
          return;
        }
        resolve(code);
      },
      fail(error: any) {
        reject(new Error(error?.errMsg || "微信登录失败"));
      }
    });
  });
}

export async function ensureWechatSession(): Promise<boolean> {
  if (!INDIO_ENABLE_WECHAT_LOGIN) {
    return false;
  }

  if (shouldUseCloudContainer()) {
    return true;
  }

  if (getSessionToken()) {
    return true;
  }

  const code = await wxLogin();
  const response = await requestJson<AuthSessionResponse>("/api/auth/wechat/login", {
    method: "POST",
    data: { code },
    timeout: 12_000
  });
  saveSessionToken(response.session.token);
  return true;
}
