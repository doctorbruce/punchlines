import assert from "node:assert/strict";
import test from "node:test";
import { bootstrapAdmin, client, clientHash, executeLocal, json } from "./api-helpers.mjs";

const base = process.env.TEST_BASE_URL ?? "http://127.0.0.1:5173";
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname), "集成测试只允许连接本机，避免改动线上数据");
const authorization = {};
const speaker = `验收-${crypto.randomUUID().slice(0, 8)}`;
const created = new Set();
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6L8AAAAASUVORK5CYII=", "base64");

function form(overrides = {}, image) {
  const body = new FormData();
  for (const [name, value] of Object.entries({ speaker, text: "100%_快乐，一点不打折", source: "验收群", tag: "测试", saidAt: "2026-10-19T12:30", ...overrides })) body.set(name, value);
  if (image) body.set("image", image, "test.png");
  return body;
}

async function call(path, options = {}) {
  return fetch(`${base}${path}`, { ...options, headers: { ...authorization, ...options.headers } });
}

test("本地 D1 + R2 真实读写链路", async (suite) => {
  let textId;
  let imageId;
  const fixture = await bootstrapAdmin();
  const admin = client(base);
  const member = client(base);
  const other = client(base);
  const limited = client(base);
  const memberUsername = `friend_${fixture.id.slice(0, 8)}`;
  const initialPassword = crypto.randomUUID();
  const memberPassword = crypto.randomUUID();
  const resetPassword = crypto.randomUUID();
  const adminPassword = crypto.randomUUID();
  let memberId;
  try {
    await suite.test("公开浏览无需登录，写入和账号管理仍受保护", async () => {
      assert.equal((await call("/api/health")).status, 200);
      for (const path of ["/api/meta", "/api/quotes"]) assert.equal((await call(path)).status, 200, path);
      for (const path of ["/api/users", "/api/auth/me"]) assert.equal((await call(path)).status, 401, path);
      assert.equal((await call("/api/quotes/missing/image")).status, 404);
      assert.equal((await call("/api/quotes", { method: "POST", headers: { Authorization: "Bearer words-local-preview" }, body: form() })).status, 401);
      assert.equal((await call("/api/quotes", { method: "POST", body: form() })).status, 401);
      assert.equal((await call("/api/quotes/missing", { method: "PATCH", body: form() })).status, 401);
      assert.equal((await call("/api/quotes/missing", { method: "DELETE" })).status, 401);
      assert.equal((await admin.login(fixture.username, "wrong-password")).status, 401);
      const response = await admin.login(fixture.username, fixture.password);
      assert.equal(response.status, 200);
      const cookie = response.headers.get("set-cookie");
      assert.match(cookie, /HttpOnly/i);
      assert.match(cookie, /SameSite=Strict/i);
      assert.match(cookie, /Expires=/i);
      authorization.Cookie = admin.cookie;
      assert.equal((await call("/api/auth/me")).status, 200);
      assert.equal((await call("/api/meta")).status, 200);
      assert.equal((await call("/api/quotes?offset=NaN")).status, 400);
      assert.equal((await call("/api/no-such-route")).status, 404);
    });
    await suite.test("同源校验、JSON 限制与管理员分配朋友账号", async () => {
      assert.equal((await admin.call("/api/auth/login", { ...json({}), headers: { "Content-Type": "application/json", Origin: "https://evil.example" } })).status, 403);
      assert.equal((await admin.call("/api/users", { ...json({}), headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" } })).status, 403);
      assert.equal((await admin.call("/api/auth/login", { method: "POST", body: "username=admin" })).status, 415);
      assert.equal((await admin.call("/api/auth/login", json({ password: "a".repeat(17000) }))).status, 413);
      assert.equal((await admin.call("/api/users", json({ name: "a".repeat(17000) }))).status, 413);
      assert.equal((await admin.call("/api/auth/login", json([]))).status, 400);
      assert.equal((await admin.call("/api/users", json({ username: "bad name", name: "朋友", password: initialPassword }))).status, 400);
      const body = { username: memberUsername, name: "验收朋友", password: initialPassword, role: "admin" };
      assert.equal((await admin.call("/api/users", json(body))).status, 201);
      const users = (await (await admin.call("/api/users")).json()).users;
      const account = users.find((entry) => entry.username === memberUsername);
      memberId = account.id;
      assert.equal(account.role, "member");
      assert.equal(account.mustChangePassword, true);
      assert.ok(!("password_hash" in account) && !("password_salt" in account));
      assert.equal((await admin.call("/api/users", json(body))).status, 409);
    });
    await suite.test("首次登录必须改密，改密撤销旧会话且账号管理仍限管理员", async () => {
      const login = await member.login(memberUsername.toUpperCase(), initialPassword);
      assert.equal(login.status, 200);
      assert.equal((await login.json()).user.mustChangePassword, true);
      for (const path of ["/api/meta", "/api/quotes"]) assert.equal((await member.call(path)).status, 200);
      assert.equal((await member.call("/api/quotes/missing/image")).status, 404);
      assert.equal((await member.call("/api/quotes", { method: "POST", body: form() })).status, 403);
      assert.equal((await member.call("/api/quotes/missing/comments", json({ text: "还没改密" }))).status, 403);
      const oldCookie = member.cookie;
      for (const [currentPassword, newPassword] of [["wrong-password", memberPassword], [initialPassword, "short"], [initialPassword, initialPassword]]) {
        assert.equal((await member.call("/api/auth/change-password", json({ currentPassword, newPassword }))).status, 400);
      }
      const change = await member.call("/api/auth/change-password", json({ currentPassword: initialPassword, newPassword: memberPassword }));
      assert.equal(change.status, 200);
      assert.equal((await change.json()).user.mustChangePassword, false);
      assert.notEqual(member.cookie, oldCookie);
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: oldCookie } })).status, 401);
      assert.equal((await member.call("/api/meta")).status, 200);
      for (const [path, method] of [["/api/users", "GET"], ["/api/users", "POST"], [`/api/users/${fixture.id}`, "PATCH"]]) assert.equal((await member.call(path, { method })).status, 403);
    });
    await suite.test("朋友可新增图文、编辑和删除自己及他人录入的语录", async () => {
      const response = await admin.call("/api/quotes", { method: "POST", body: form({ text: "管理员录入，朋友可以整理" }) });
      assert.equal(response.status, 201);
      const adminQuote = (await response.json()).quote;
      created.add(adminQuote.id);
      const edited = await member.call(`/api/quotes/${adminQuote.id}`, { method: "PATCH", body: form({ text: "朋友已编辑这条语录" }) });
      assert.equal(edited.status, 200);
      assert.equal((await edited.json()).quote.text, "朋友已编辑这条语录");
      assert.equal((await member.call(`/api/quotes/${adminQuote.id}`, { method: "DELETE" })).status, 200);
      created.delete(adminQuote.id);
      const uploaded = await member.call("/api/quotes", { method: "POST", body: form({ text: "朋友录入的图文" }, new Blob([png], { type: "image/png" })) });
      assert.equal(uploaded.status, 201);
      const memberQuote = (await uploaded.json()).quote;
      created.add(memberQuote.id);
      assert.equal((await member.call(memberQuote.imageUrl)).status, 200);
      assert.equal((await member.call(`/api/quotes/${memberQuote.id}`, { method: "PATCH", body: form({ text: "朋友自己修改" }) })).status, 200);
      assert.equal((await member.call(`/api/quotes/${memberQuote.id}`, { method: "DELETE" })).status, 200);
      created.delete(memberQuote.id);
      assert.equal((await member.call(memberQuote.imageUrl)).status, 404);
    });
    await suite.test("评论公开可读，登录可发，作者和管理员可删，删除语录级联清理", async () => {
      const quote = (await (await admin.call("/api/quotes", { method: "POST", body: form({ text: "公开评论验收" }) })).json()).quote;
      created.add(quote.id);
      const path = `/api/quotes/${quote.id}/comments`;
      const anonymous = (suffix = "", options = {}) => fetch(`${base}${path}${suffix}`, options);
      assert.deepEqual(await (await anonymous()).json(), { comments: [], total: 0 });
      assert.equal((await anonymous("", json({ text: "游客不能发" }))).status, 401);
      assert.equal((await anonymous("/missing", { method: "DELETE" })).status, 401);
      assert.equal((await anonymous("?offset=-1")).status, 400);
      assert.equal((await anonymous("?offset=NaN")).status, 400);
      for (const text of [null, 1, " ", "字".repeat(501)]) assert.equal((await member.call(path, json({ text }))).status, 400);
      assert.equal((await member.call(path, json({ text: "a".repeat(17000) }))).status, 413);
      assert.equal((await member.call(path, { method: "POST", body: "text=hello" })).status, 415);
      const response = await member.call(path, json({ text: "  留下一句！  ", userId: fixture.id, authorName: "伪造名字" }));
      assert.equal(response.status, 201);
      const own = (await response.json()).comment;
      assert.equal(own.text, "留下一句！");
      assert.equal(own.userId, memberId);
      assert.equal(own.authorName, "验收朋友");
      const adminResponse = await admin.call(path, json({ text: "管理员也来接一句" }));
      assert.equal(adminResponse.status, 201);
      const adminComment = (await adminResponse.json()).comment;
      const page = await (await anonymous()).json();
      assert.equal(page.total, 2);
      assert.equal(page.comments.length, 2);
      assert.deepEqual(new Set(page.comments.map((entry) => entry.id)), new Set([own.id, adminComment.id]));
      assert.equal((await (await anonymous("?offset=1")).json()).comments.length, 1);
      assert.equal((await member.call(`${path}/${adminComment.id}`, { method: "DELETE" })).status, 403);
      assert.equal((await member.call(`/api/quotes/missing/comments/${own.id}`, { method: "DELETE" })).status, 404);
      assert.equal((await member.call(`${path}/${own.id}`, { method: "DELETE" })).status, 200);
      assert.equal((await member.call(`${path}/${own.id}`, { method: "DELETE" })).status, 404);
      const another = (await (await member.call(path, json({ text: "管理员可以整理这句" }))).json()).comment;
      assert.equal((await admin.call(`${path}/${another.id}`, { method: "DELETE" })).status, 200);
      assert.equal((await anonymous()).status, 200);
      assert.equal((await member.call(`/api/quotes/${quote.id}`, { method: "DELETE" })).status, 200);
      created.delete(quote.id);
      assert.equal((await anonymous()).status, 404);
      assert.equal((await admin.call(path, json({ text: "语录已经删除" }))).status, 404);
      const rows = executeLocal(`SELECT COUNT(*) AS count FROM comments WHERE quote_id = '${quote.id}';`);
      assert.equal(rows[0].results[0].count, 0);
    });
    await suite.test("重置、停用、启用与退出确实撤销会话", async () => {
      assert.equal((await admin.call(`/api/users/${fixture.id}`, json({ isActive: false }, "PATCH"))).status, 403);
      assert.equal((await admin.call(`/api/users/${memberId}`, json({ password: resetPassword }, "PATCH"))).status, 200);
      assert.equal((await member.call("/api/auth/me")).status, 401);
      assert.equal((await member.login(memberUsername, memberPassword)).status, 401);
      assert.equal((await member.login(memberUsername, resetPassword)).status, 200);
      assert.equal((await (await member.call("/api/auth/me")).json()).user.mustChangePassword, true);
      assert.equal((await admin.call(`/api/users/${memberId}`, json({ isActive: false }, "PATCH"))).status, 200);
      assert.equal((await member.call("/api/auth/me")).status, 401);
      assert.equal((await member.login(memberUsername, resetPassword)).status, 401);
      assert.equal((await admin.call(`/api/users/${memberId}`, json({ isActive: true }, "PATCH"))).status, 200);
      assert.equal((await member.login(memberUsername, resetPassword)).status, 200);
      const beforeLogout = member.cookie;
      assert.equal((await member.call("/api/auth/logout", { method: "POST" })).status, 200);
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: beforeLogout } })).status, 401);
      assert.equal((await other.login(fixture.username, fixture.password)).status, 200);
      const adminCookie = admin.cookie;
      assert.equal((await admin.call("/api/auth/change-password", json({ currentPassword: fixture.password, newPassword: adminPassword }))).status, 200);
      fixture.password = adminPassword;
      assert.equal((await other.call("/api/auth/me")).status, 401);
      assert.equal((await fetch(`${base}/api/auth/me`, { headers: { Cookie: adminCookie } })).status, 401);
      authorization.Cookie = admin.cookie;
    });
    await suite.test("拒绝空内容、不合法日期和错误表单", async () => {
      for (const body of [form({ text: "" }), form({ saidAt: "2026-02-30T12:00" }), "not-a-form"]) {
        assert.equal((await call("/api/quotes", { method: "POST", headers: authorization, body })).status, 400);
      }
    });
    await suite.test("创建文字、按人筛选、字面搜索和分页", async () => {
      const longQuery = "中文长句".repeat(50);
      const response = await call("/api/quotes", { method: "POST", headers: authorization, body: form({ text: `100%_快乐，一点不打折 AbCd ${longQuery}` }) });
      assert.equal(response.status, 201);
      const { quote } = await response.json();
      textId = quote.id;
      created.add(quote.id);
      assert.equal(quote.speaker, speaker);
      assert.equal(quote.imageUrl, null);
      const page = await (await call(`/api/quotes?person=${encodeURIComponent(speaker)}&q=${encodeURIComponent("100%_")}`)).json();
      assert.equal(page.total, 1);
      assert.equal(page.quotes[0].id, textId);
      for (const query of [longQuery, "aBcD", "%_"]) {
        const result = await fetch(`${base}/api/quotes?person=${encodeURIComponent(speaker)}&q=${encodeURIComponent(query)}`);
        assert.equal(result.status, 200);
        assert.equal((await result.json()).quotes[0].id, textId);
      }
      assert.equal((await fetch(`${base}/api/quotes?q=${encodeURIComponent(`${longQuery}超`)}`)).status, 400);
      assert.equal((await (await call(`/api/quotes?person=${encodeURIComponent(speaker)}&offset=1`)).json()).quotes.length, 0);
    });
    await suite.test("编辑文字和拒绝伪装图片", async () => {
      const response = await call(`/api/quotes/${textId}`, { method: "PATCH", headers: authorization, body: form({ text: "已经修改好了" }) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).quote.text, "已经修改好了");
      const fake = new Blob(["<script>not an image</script>"], { type: "image/png" });
      assert.equal((await call("/api/quotes", { method: "POST", headers: authorization, body: form({}, fake) })).status, 400);
      const oversized = new Blob([new Uint8Array(12 * 1024 * 1024 + 1)], { type: "image/png" });
      assert.equal((await call("/api/quotes", { method: "POST", headers: authorization, body: form({}, oversized) })).status, 400);
    });
    await suite.test("纯图片上传、原图读取和图片筛选", async () => {
      const response = await call("/api/quotes", { method: "POST", headers: authorization, body: form({ text: "" }, new Blob([png], { type: "image/png" })) });
      assert.equal(response.status, 201);
      const { quote } = await response.json();
      imageId = quote.id;
      created.add(quote.id);
      const image = await call(quote.imageUrl);
      const publicImage = await fetch(`${base}${quote.imageUrl}`);
      assert.equal(publicImage.status, 200);
      assert.deepEqual(new Uint8Array(await publicImage.arrayBuffer()), new Uint8Array(png));
      assert.equal(image.headers.get("content-type"), "image/png");
      assert.deepEqual(Buffer.from(await image.arrayBuffer()), png);
      const filtered = await (await call(`/api/quotes?person=${encodeURIComponent(speaker)}&type=image`)).json();
      assert.equal(filtered.total, 1);
      assert.equal(filtered.quotes[0].id, imageId);
      const meta = await (await call("/api/meta")).json();
      assert.equal(meta.people.find((person) => person.name === speaker).count, 2);
    });
    await suite.test("编辑保留原图、移除图片必须留文字、替换和删除", async () => {
      let response = await call(`/api/quotes/${imageId}`, { method: "PATCH", headers: authorization, body: form({ text: "图文组合" }) });
      assert.equal((await response.json()).quote.imageUrl, `/api/quotes/${imageId}/image`);
      response = await call(`/api/quotes/${imageId}`, { method: "PATCH", headers: authorization, body: form({ text: "", removeImage: "true" }) });
      assert.equal(response.status, 400);
      response = await call(`/api/quotes/${imageId}`, { method: "PATCH", headers: authorization, body: form({ text: "现在只有文字", removeImage: "true" }) });
      assert.equal((await response.json()).quote.imageUrl, null);
      assert.equal((await call(`/api/quotes/${imageId}/image`)).status, 404);
      response = await call(`/api/quotes/${imageId}`, { method: "PATCH", headers: authorization, body: form({}, new Blob([png], { type: "image/png" })) });
      assert.equal(response.status, 200);
      assert.equal((await call(`/api/quotes/${imageId}`, { method: "DELETE", headers: authorization })).status, 200);
      created.delete(imageId);
      assert.equal((await call(`/api/quotes/${imageId}/image`)).status, 404);
      assert.equal((await call(`/api/quotes/${imageId}`, { method: "DELETE", headers: authorization })).status, 404);
      assert.equal((await call(`/api/quotes/${textId}`, { method: "DELETE" })).status, 200);
      created.delete(textId);
    });
    await suite.test("登录限流以及过期 Cookie 清除", async () => {
      for (let attempt = 0; attempt < 20; attempt += 1) assert.equal((await limited.login("not-existing-user", "wrong-password")).status, 401);
      assert.equal((await limited.login("not-existing-user", "wrong-password")).status, 429);
      const hash = await clientHash(admin.cookie.split("=")[1]);
      executeLocal(`UPDATE sessions SET expires_at = 0 WHERE token_hash = '${hash}';`);
      const expired = await admin.call("/api/auth/me");
      assert.equal(expired.status, 401);
      assert.match(expired.headers.get("set-cookie"), /Max-Age=0/i);
    });
  } finally {
    try {
      if (created.size) {
        assert.equal((await admin.login(fixture.username, fixture.password)).status, 200);
        authorization.Cookie = admin.cookie;
        for (const quoteId of created) {
          const response = await call(`/api/quotes/${quoteId}`, { method: "DELETE" });
          if (response.status !== 200 && response.status !== 404) throw new Error("测试语录清理失败");
        }
      }
    } finally {
      const hashes = await Promise.all([admin, member, other, limited].map((entry) => clientHash(entry.clientIp)));
      executeLocal(`DELETE FROM users WHERE id = '${fixture.id}' OR username = '${memberUsername}'; DELETE FROM login_attempts WHERE client_hash IN (${hashes.map((hash) => `'${hash}'`).join(",")});`);
    }
  }
});
