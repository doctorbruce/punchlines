import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { HTTPException } from "hono/http-exception";
import { normalizeUsername, validatePassword } from "../shared/accounts";
import type { SessionUser } from "../shared/types";
import type { AppEnv } from "./env";
import { hashPassword, verifyPassword } from "./password";

const COOKIE = "words_session";
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000;

export interface UserRow {
  id: string;
  username: string;
  name: string;
  role: "admin" | "member";
  password_hash: string;
  password_salt: string;
  is_active: number;
  must_change_password: number;
  created_at: number;
}

export function sessionUser(row: UserRow): SessionUser {
  return { id: row.id, username: row.username, name: row.name, role: row.role, mustChangePassword: Boolean(row.must_change_password) };
}

async function digest(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function clearSession(context: Context<AppEnv>) {
  deleteCookie(context, COOKIE, { path: "/", httpOnly: true, secure: new URL(context.req.url).protocol === "https:", sameSite: "Strict" });
}

async function createSession(context: Context<AppEnv>, userId: string, changes: D1PreparedStatement[] = []) {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const now = Date.now();
  const expires = new Date(now + SESSION_DURATION);
  const previousToken = getCookie(context, COOKIE);
  if (previousToken) changes.push(context.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await digest(previousToken)));
  await context.env.DB.batch([
    ...changes,
    context.env.DB.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    context.env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await digest(token), userId, expires.getTime()),
  ]);
  setCookie(context, COOKIE, token, { path: "/", httpOnly: true, secure: new URL(context.req.url).protocol === "https:", sameSite: "Strict", expires });
}

export const requireUser: MiddlewareHandler<AppEnv> = async (context, next) => {
  const token = getCookie(context, COOKIE);
  if (token && /^[a-f0-9]{64}$/.test(token)) {
    const tokenHash = await digest(token);
    const row = await context.env.DB.prepare("SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE token_hash = ? AND expires_at > ? AND is_active = 1")
      .bind(tokenHash, Date.now()).first<UserRow>();
    if (row) {
      context.set("user", sessionUser(row));
      context.set("sessionHash", tokenHash);
      await next();
      return;
    }
  }
  if (token) clearSession(context);
  return context.json({ error: "请先登录，或重新登录已过期的账号", code: "UNAUTHORIZED" }, 401);
};

export const requirePasswordChanged: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (context.get("user").mustChangePassword) return context.json({ error: "首次登录或密码重置后，请先修改密码", code: "PASSWORD_CHANGE_REQUIRED" }, 403);
  await next();
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (context.get("user").role !== "admin") return context.json({ error: "只有管理员可以执行此操作" }, 403);
  await next();
};

export const sameOrigin: MiddlewareHandler<AppEnv> = async (context, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(context.req.method)) {
    const origin = context.req.header("Origin");
    if ((origin && origin !== new URL(context.req.url).origin) || context.req.header("Sec-Fetch-Site") === "cross-site") {
      return context.json({ error: "不接受跨站提交" }, 403);
    }
  }
  await next();
};

export async function readJson(context: Context<AppEnv>): Promise<Record<string, unknown>> {
  if (context.req.header("Content-Type")?.split(";")[0]?.trim() !== "application/json") throw new HTTPException(415, { message: "请使用 JSON 格式提交" });
  const body: unknown = await context.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new HTTPException(400, { message: "提交内容无效" });
  return body as Record<string, unknown>;
}

export const auth = new Hono<AppEnv>();

auth.post("/login", async (context) => {
  const body = await readJson(context);
  const username = normalizeUsername(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const now = Date.now();
  const clientHash = await digest(context.req.header("CF-Connecting-IP") ?? "local");
  const attempt = await context.env.DB.prepare(`INSERT INTO login_attempts (client_hash, attempts, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(client_hash) DO UPDATE SET attempts = CASE WHEN expires_at <= ? THEN 1 ELSE attempts + 1 END,
    expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END RETURNING attempts`)
    .bind(clientHash, now + 15 * 60 * 1000, now, now).first<{ attempts: number }>();
  context.executionCtx.waitUntil(context.env.DB.prepare("DELETE FROM login_attempts WHERE expires_at <= ?").bind(now).run());
  if (!attempt || attempt.attempts > 20) {
    context.header("Retry-After", "900");
    return context.json({ error: "尝试次数过多，请 15 分钟后再试" }, 429);
  }
  if (!username || username.length > 32 || !password || password.length > 128) return context.json({ error: "账号或密码不正确", code: "INVALID_CREDENTIALS" }, 401);
  const row = await context.env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();
  const valid = await verifyPassword(password, row?.password_hash ?? "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=", row?.password_salt ?? "AAAAAAAAAAAAAAAAAAAAAA==");
  if (!row || !row.is_active || !valid) return context.json({ error: "账号或密码不正确", code: "INVALID_CREDENTIALS" }, 401);
  await createSession(context, row.id);
  return context.json({ user: sessionUser(row) });
});

auth.use("/*", requireUser);
auth.get("/me", (context) => context.json({ user: context.get("user") }));
auth.post("/logout", async (context) => {
  await context.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(context.get("sessionHash")).run();
  clearSession(context);
  return context.json({ ok: true });
});
auth.post("/change-password", async (context) => {
  const body = await readJson(context);
  const error = validatePassword(body.newPassword);
  if (error) return context.json({ error }, 400);
  if (typeof body.currentPassword !== "string" || body.currentPassword.length > 128) return context.json({ error: "请输入当前密码" }, 400);
  if (body.currentPassword === body.newPassword) return context.json({ error: "新密码不能与当前密码相同" }, 400);
  const user = context.get("user");
  const row = await context.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(user.id).first<UserRow>();
  if (!row || !await verifyPassword(body.currentPassword, row.password_hash, row.password_salt)) return context.json({ error: "当前密码不正确" }, 400);
  const password = await hashPassword(body.newPassword as string);
  await createSession(context, user.id, [
    context.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?").bind(password.hash, password.salt, user.id),
    context.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(user.id),
  ]);
  return context.json({ user: { ...user, mustChangePassword: false } });
});
