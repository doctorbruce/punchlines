import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hashPassword } from "../worker/password.ts";
import { normalizeUsername, validateAccount } from "../shared/accounts.ts";

function readPassword(prompt) {
  if (!stdin.isTTY) throw new Error("请在终端交互输入密码，自动化时请使用 WORDS_ADMIN_PASSWORD 环境变量");
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    function finish(error) {
      stdin.off("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    }
    function onData(chunk) {
      for (const character of chunk.toString()) {
        if (character === "\u0003") { finish(new Error("已取消")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") {
          if (password) { password = password.slice(0, -1); stdout.write("\b \b"); }
        } else if (character >= " " && password.length < 128) {
          password += character;
          stdout.write("•");
        }
      }
    }
    stdin.on("data", onData);
  });
}

function sqlString(value) { return `'${value.replaceAll("'", "''")}'`; }

try {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !["--local", "--remote"].includes(args[0])) throw new Error("用法：npm run admin:create -- --local 或 --remote");
  const readline = createInterface({ input: stdin, output: stdout });
  let username;
  let name;
  try {
    username = normalizeUsername(process.env.WORDS_ADMIN_USERNAME ?? await readline.question("管理员账号："));
    name = (process.env.WORDS_ADMIN_NAME ?? await readline.question("管理员称呼：")).trim();
  } finally { readline.close(); }
  const password = process.env.WORDS_ADMIN_PASSWORD ?? await readPassword("初始密码（10–128 位）：");
  if (!process.env.WORDS_ADMIN_PASSWORD && password !== await readPassword("再次输入初始密码：")) throw new Error("两次密码不一致");
  const error = validateAccount(username, name, password);
  if (error) throw new Error(error);
  const hashed = await hashPassword(password);
  const sql = `INSERT INTO users (id, username, name, password_hash, password_salt, role, created_at) VALUES (${sqlString(crypto.randomUUID())}, ${sqlString(username)}, ${sqlString(name)}, ${sqlString(hashed.hash)}, ${sqlString(hashed.salt)}, 'admin', ${Date.now()});`;
  const childEnv = { ...process.env };
  delete childEnv.WORDS_ADMIN_PASSWORD;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../node_modules/wrangler/bin/wrangler.js", import.meta.url)), "d1", "execute", "words", args[0], "--command", sql], {
    cwd: fileURLToPath(new URL("..", import.meta.url)), stdio: "inherit", env: childEnv,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("创建失败，请确认数据库迁移已执行且账号未被占用");
  console.log(`已创建${args[0] === "--local" ? "本地" : "远程"}管理员 ${username}，首次登录必须修改密码。`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
