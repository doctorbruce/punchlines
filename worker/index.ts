import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { IMAGE_TYPES, MAX_IMAGE_SIZE, matchesImageSignature, validateQuote } from "../shared/validation";
import type { Quote, QuoteInput } from "../shared/types";
import type { AppEnv } from "./env";
import { auth, requirePasswordChanged, requireUser, sameOrigin } from "./auth";
import { users } from "./users";
import { comments } from "./comments";

interface QuoteRow {
  id: string;
  speaker: string;
  text: string;
  source: string;
  tag: string;
  said_at: string;
  image_key: string | null;
  image_type: string | null;
  created_at: number;
}

const app = new Hono<AppEnv>();

function serialize(row: QuoteRow): Quote {
  return {
    id: row.id,
    speaker: row.speaker,
    text: row.text,
    source: row.source,
    tag: row.tag,
    saidAt: row.said_at,
    imageUrl: row.image_key ? `/api/quotes/${row.id}/image` : null,
    createdAt: row.created_at,
  };
}

app.use("/api/*", async (context, next) => {
  context.header("Cache-Control", "no-store");
  context.header("X-Content-Type-Options", "nosniff");
  await next();
});

app.use("/api/*", sameOrigin);
app.use("/api/auth/*", bodyLimit({ maxSize: 16 * 1024 }));
app.use("/api/users/*", bodyLimit({ maxSize: 16 * 1024 }));
app.use("/api/*", bodyLimit({
  maxSize: MAX_IMAGE_SIZE + 64 * 1024,
  onError: (context) => context.json({ error: "图片大小不能超过 12 MB" }, 413),
}));

app.get("/api/health", async (context) => {
  await context.env.DB.prepare("SELECT 1").first();
  return context.json({ ok: true });
});

app.route("/api/auth", auth);
app.route("/api/users", users);
app.use("/api/*", async (context, next) => {
  if (["GET", "HEAD"].includes(context.req.method)) return next();
  return requireUser(context, next);
});
app.use("/api/*", async (context, next) => {
  if (["GET", "HEAD"].includes(context.req.method)) return next();
  return requirePasswordChanged(context, next);
});
app.route("/api/quotes", comments);

app.get("/api/meta", async (context) => {
  const results = await context.env.DB.batch<Record<string, unknown>>([
    context.env.DB.prepare("SELECT speaker AS name, COUNT(*) AS count FROM quotes GROUP BY speaker ORDER BY count DESC, speaker ASC"),
    context.env.DB.prepare("SELECT COUNT(*) AS total, COUNT(image_key) AS images FROM quotes"),
  ]);
  const summary = results[1]?.results[0];
  return context.json({
    people: results[0]?.results ?? [],
    total: Number(summary?.total ?? 0),
    images: Number(summary?.images ?? 0),
  });
});

app.get("/api/quotes", async (context) => {
  const query = context.req.query("q")?.trim() ?? "";
  const speaker = context.req.query("person") ?? "";
  const type = context.req.query("type") ?? "all";
  const sort = context.req.query("sort") === "oldest" ? "ASC" : "DESC";
  const offset = Number(context.req.query("offset") ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || query.length > 200 || speaker.length > 24 || !["all", "text", "image"].includes(type)) {
    return context.json({ error: "筛选参数无效" }, 400);
  }
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (speaker) {
    clauses.push("speaker = ?");
    bindings.push(speaker);
  }
  if (query) {
    clauses.push("(instr(lower(text), lower(?)) > 0 OR instr(lower(speaker), lower(?)) > 0 OR instr(lower(source), lower(?)) > 0 OR instr(lower(tag), lower(?)) > 0)");
    bindings.push(query, query, query, query);
  }
  if (type === "image") clauses.push("image_key IS NOT NULL");
  if (type === "text") clauses.push("image_key IS NULL");
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const results = await context.env.DB.batch<Record<string, unknown>>([
    context.env.DB.prepare(`SELECT * FROM quotes ${where} ORDER BY said_at ${sort}, created_at ${sort}, id ${sort} LIMIT 40 OFFSET ?`).bind(...bindings, offset),
    context.env.DB.prepare(`SELECT COUNT(*) AS total FROM quotes ${where}`).bind(...bindings),
  ]);
  return context.json({
    quotes: ((results[0]?.results ?? []) as unknown as QuoteRow[]).map(serialize),
    total: Number(results[1]?.results[0]?.total ?? 0),
  });
});

app.on(["POST", "PATCH"], ["/api/quotes", "/api/quotes/:id"], async (context) => {
  const updating = context.req.method === "PATCH";
  if ((updating && !context.req.param("id")) || (!updating && context.req.param("id"))) {
    return context.json({ error: "请求方式无效" }, 405);
  }
  const existing = updating
    ? await context.env.DB.prepare("SELECT * FROM quotes WHERE id = ?").bind(context.req.param("id")).first<QuoteRow>()
    : null;
  if (updating && !existing) return context.json({ error: "这条语录已经不在了" }, 404);
  let body: FormData;
  try {
    body = await context.req.raw.formData();
  } catch {
    return context.json({ error: "请使用有效的表单上传语录" }, 400);
  }
  const field = (name: string) => typeof body.get(name) === "string" ? (body.get(name) as string).trim() : "";
  const input: QuoteInput = {
    speaker: field("speaker"),
    text: field("text"),
    source: field("source"),
    tag: field("tag"),
    saidAt: field("saidAt"),
  };
  const attachment = body.get("image");
  const file = attachment instanceof File && attachment.size > 0 ? attachment : null;
  const removeImage = field("removeImage") === "true";
  const validation = validateQuote(input, Boolean(file || (existing?.image_key && !removeImage)));
  if (validation) return context.json({ error: validation }, 400);
  if (file && (!IMAGE_TYPES.includes(file.type) || file.size > MAX_IMAGE_SIZE)) {
    return context.json({ error: "请选择不超过 12 MB 的 JPG、PNG、WebP 或 GIF 图片" }, 400);
  }
  if (file && !matchesImageSignature(new Uint8Array(await file.slice(0, 12).arrayBuffer()), file.type)) {
    return context.json({ error: "图片格式与文件内容不符，请重新选择图片" }, 400);
  }
  const quoteId = existing?.id ?? crypto.randomUUID();
  const newKey = file ? `${quoteId}/${crypto.randomUUID()}` : null;
  const imageKey = newKey ?? (removeImage ? null : existing?.image_key ?? null);
  const imageType = file?.type ?? (removeImage ? null : existing?.image_type ?? null);
  const createdAt = existing?.created_at ?? Date.now();
  if (file && newKey) await context.env.IMAGES.put(newKey, file.stream(), { httpMetadata: { contentType: file.type } });
  try {
    if (existing) {
      const result = await context.env.DB.prepare("UPDATE quotes SET speaker = ?, text = ?, source = ?, tag = ?, said_at = ?, image_key = ?, image_type = ? WHERE id = ?")
        .bind(input.speaker, input.text, input.source, input.tag, input.saidAt, imageKey, imageType, quoteId).run();
      if (!result.meta.changes) throw new HTTPException(409, { message: "语录已被删除，请刷新后重试" });
    } else {
      await context.env.DB.prepare("INSERT INTO quotes (id, speaker, text, source, tag, said_at, image_key, image_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(quoteId, input.speaker, input.text, input.source, input.tag, input.saidAt, imageKey, imageType, createdAt).run();
    }
  } catch (error) {
    if (newKey) await context.env.IMAGES.delete(newKey);
    throw error;
  }
  if (existing?.image_key && existing.image_key !== imageKey) {
    context.executionCtx.waitUntil(context.env.IMAGES.delete(existing.image_key).catch((error: unknown) => console.error("旧图片清理失败", error)));
  }
  return context.json({ quote: serialize({ id: quoteId, ...input, said_at: input.saidAt, image_key: imageKey, image_type: imageType, created_at: createdAt }) }, existing ? 200 : 201);
});

app.get("/api/quotes/:id/image", async (context) => {
  const row = await context.env.DB.prepare("SELECT image_key FROM quotes WHERE id = ?").bind(context.req.param("id")).first<{ image_key: string | null }>();
  if (!row?.image_key) return context.json({ error: "图片不存在" }, 404);
  const object = await context.env.IMAGES.get(row.image_key);
  if (!object) return context.json({ error: "图片文件不存在" }, 404);
  const headers = new Headers({ "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
});

app.delete("/api/quotes/:id", async (context) => {
  const deleted = await context.env.DB.prepare("DELETE FROM quotes WHERE id = ? RETURNING image_key").bind(context.req.param("id")).first<{ image_key: string | null }>();
  if (!deleted) return context.json({ error: "这条语录已经不在了" }, 404);
  if (deleted.image_key) {
    context.executionCtx.waitUntil(context.env.IMAGES.delete(deleted.image_key).catch((error: unknown) => console.error("图片清理失败", error)));
  }
  return context.json({ ok: true });
});

app.notFound((context) => context.json({ error: "没有找到这个接口" }, 404));
app.onError((error, context) => {
  if (error instanceof HTTPException) return context.json({ error: error.message }, error.status);
  console.error("Archive request failed", error);
  return context.json({ error: "语录小馆暂时开了个小差，请稍后重试" }, 500);
});

export default app;
