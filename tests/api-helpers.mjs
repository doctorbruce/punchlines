import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../worker/password.ts";

export function executeLocal(sql) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), "d1", "execute", "words", "--local", "--command", sql, "--json"], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "本地测试数据操作失败");
  return JSON.parse(result.stdout);
}

export async function bootstrapAdmin() {
  const id = crypto.randomUUID();
  const username = `test_${id.slice(0, 8)}`;
  const password = crypto.randomUUID();
  const hashed = await hashPassword(password);
  executeLocal(`INSERT INTO users (id, username, name, password_hash, password_salt, role, must_change_password, created_at) VALUES ('${id}', '${username}', '集成测试管理员', '${hashed.hash}', '${hashed.salt}', 'admin', 0, ${Date.now()});`);
  return { id, username, password };
}

export function client(base) {
  const suffix = Array.from(crypto.getRandomValues(new Uint16Array(4)), (part) => part.toString(16)).join(":");
  const clientIp = `2001:db8::${suffix}`;
  let cookie = "";
  return {
    get cookie() { return cookie; },
    clientIp,
    async call(path, options = {}) {
      const headers = new Headers(options.headers);
      if (cookie) headers.set("Cookie", cookie);
      headers.set("CF-Connecting-IP", clientIp);
      const response = await fetch(`${base}${path}`, { ...options, headers });
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) cookie = setCookie.split(";")[0];
      return response;
    },
    async login(username, password) {
      return this.call("/api/auth/login", json({ username, password }));
    },
  };
}

export function json(body, method = "POST") {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export async function clientHash(value) {
  return Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("hex");
}
