const SESSION_TOKEN_KEY = "indio.sessionToken";

export function getSessionToken(): string | null {
  const value = wx.getStorageSync(SESSION_TOKEN_KEY);
  return typeof value === "string" && value.trim() ? value : null;
}

export function saveSessionToken(token: string): void {
  wx.setStorageSync(SESSION_TOKEN_KEY, token);
}

export function clearSessionToken(): void {
  wx.removeStorageSync(SESSION_TOKEN_KEY);
}
