import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "./env";
import { readJson } from "./auth";
import { validateComment } from "../shared/validation";

export const comments = new Hono<AppEnv>();
comments.use("/:quoteId/comments", bodyLimit({ maxSize: 16 * 1024 }));

comments.get("/:quoteId/comments", async (context) => {
  const quoteId = context.req.param("quoteId");
  const offset = Number(context.req.query("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0) return context.json({ error: "分页参数无效" }, 400);
  const results = await context.env.DB.batch<Record<string, unknown>>([
    context.env.DB.prepare("SELECT id FROM quotes WHERE id = ?").bind(quoteId),
    context.env.DB.prepare(`SELECT comments.id, comments.user_id AS userId, users.name AS authorName, comments.text, comments.created_at AS createdAt
      FROM comments JOIN users ON users.id = comments.user_id WHERE quote_id = ?
      ORDER BY comments.created_at DESC, comments.id DESC LIMIT 40 OFFSET ?`).bind(quoteId, offset),
    context.env.DB.prepare("SELECT COUNT(*) AS total FROM comments WHERE quote_id = ?").bind(quoteId),
  ]);
  if (!results[0]?.results.length) return context.json({ error: "这条语录已经不在了" }, 404);
  return context.json({ comments: results[1]?.results ?? [], total: Number(results[2]?.results[0]?.total ?? 0) });
});

comments.post("/:quoteId/comments", async (context) => {
  const body = await readJson(context);
  const error = validateComment(body.text);
  if (error) return context.json({ error }, 400);
  const user = context.get("user");
  const comment = { id: crypto.randomUUID(), userId: user.id, authorName: user.name, text: (body.text as string).trim(), createdAt: Date.now() };
  const quoteId = context.req.param("quoteId");
  const result = await context.env.DB.prepare(`INSERT INTO comments (id, quote_id, user_id, text, created_at)
    SELECT ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM quotes WHERE id = ?)`)
    .bind(comment.id, quoteId, user.id, comment.text, comment.createdAt, quoteId).run();
  if (!result.meta.changes) return context.json({ error: "这条语录已经不在了" }, 404);
  return context.json({ comment }, 201);
});

comments.delete("/:quoteId/comments/:commentId", async (context) => {
  const quoteId = context.req.param("quoteId");
  const commentId = context.req.param("commentId");
  const row = await context.env.DB.prepare("SELECT user_id FROM comments WHERE id = ? AND quote_id = ?").bind(commentId, quoteId).first<{ user_id: string }>();
  if (!row) return context.json({ error: "评论不存在" }, 404);
  const user = context.get("user");
  if (row.user_id !== user.id && user.role !== "admin") return context.json({ error: "只能删除自己的评论，管理员可删除所有评论" }, 403);
  const deleted = await context.env.DB.prepare("DELETE FROM comments WHERE id = ? AND quote_id = ? RETURNING id").bind(commentId, quoteId).first();
  if (!deleted) return context.json({ error: "评论不存在" }, 404);
  return context.json({ ok: true });
});
