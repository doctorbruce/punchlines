import { Hono } from "hono";
import { normalizeUsername, validateAccount, validatePassword } from "../shared/accounts";
import type { AppEnv } from "./env";
import { readJson, requireAdmin, requirePasswordChanged, requireUser, sessionUser } from "./auth";
import type { UserRow } from "./auth";
import { hashPassword } from "./password";

export const users = new Hono<AppEnv>();
users.use("/*", requireUser, requirePasswordChanged, requireAdmin);

users.get("/", async (context) => {
  const { results } = await context.env.DB.prepare("SELECT id, username, name, role, is_active, must_change_password, created_at FROM users ORDER BY created_at, id").all<UserRow>();
  return context.json({ users: results.map((row) => ({ ...sessionUser(row), isActive: Boolean(row.is_active), createdAt: row.created_at })) });
});

users.post("/", async (context) => {
  const body = await readJson(context);
  const username = normalizeUsername(body.username);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const error = validateAccount(username, name, body.password);
  if (error) return context.json({ error }, 400);
  const password = await hashPassword(body.password as string);
  const result = await context.env.DB.prepare("INSERT INTO users (id, username, name, password_hash, password_salt, role, created_at) VALUES (?, ?, ?, ?, ?, 'member', ?) ON CONFLICT(username) DO NOTHING")
    .bind(crypto.randomUUID(), username, name, password.hash, password.salt, Date.now()).run();
  if (!result.meta.changes) return context.json({ error: "这个账号已被使用" }, 409);
  return context.json({ ok: true }, 201);
});

users.patch("/:id", async (context) => {
  const body = await readJson(context);
  const target = await context.env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(context.req.param("id")).first<UserRow>();
  if (!target) return context.json({ error: "账号不存在" }, 404);
  if (target.role === "admin") return context.json({ error: "此处仅能管理朋友账号，管理员请自行修改密码" }, 403);
  let update: D1PreparedStatement;
  if (typeof body.isActive === "boolean") {
    update = context.env.DB.prepare("UPDATE users SET is_active = ? WHERE id = ?").bind(Number(body.isActive), target.id);
  } else {
    const error = validatePassword(body.password);
    if (error) return context.json({ error }, 400);
    const password = await hashPassword(body.password as string);
    update = context.env.DB.prepare("UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ?").bind(password.hash, password.salt, target.id);
  }
  await context.env.DB.batch([update, context.env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(target.id)]);
  return context.json({ ok: true });
});
