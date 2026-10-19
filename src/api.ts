export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function request<T>(path: string, options: RequestInit & { promptLogin?: boolean } = {}): Promise<T> {
  const { promptLogin = true, ...fetchOptions } = options;
  const response = await fetch(path, { ...fetchOptions, credentials: "same-origin" });
  const data = await response.json().catch(() => null) as (T & { error?: string; code?: string }) | null;
  if (!response.ok) {
    if (promptLogin && response.status === 401 && data?.code === "UNAUTHORIZED") window.dispatchEvent(new Event("words:unauthorized"));
    if (promptLogin && response.status === 403 && data?.code === "PASSWORD_CHANGE_REQUIRED") window.dispatchEvent(new Event("words:password-required"));
    throw new ApiError(data?.error || `请求没有成功（${response.status}）`, response.status);
  }
  if (!data) throw new Error("服务返回了无法识别的数据，请稍后重试");
  return data;
}

export function localDateTime() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
