import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUsername, validateAccount, validatePassword } from "../shared/accounts.ts";
import { hashPassword, verifyPassword } from "../worker/password.ts";

test("账号规范化与账号、称呼、密码边界", () => {
  assert.equal(normalizeUsername(" XiaoYu "), "xiaoyu");
  assert.equal(normalizeUsername(null), "");
  assert.equal(validateAccount("xiao_yu-1.2", "小鱼", "朋友之间的小秘密123"), null);
  for (const username of ["ab", ".abc", "有中文", "a b", "a".repeat(33)]) assert.ok(validateAccount(username, "小鱼", "a".repeat(10)));
  for (const name of ["", "字".repeat(25)]) assert.ok(validateAccount("xiaoyu", name, "a".repeat(10)));
  for (const password of [null, 123, "", "a".repeat(9), "a".repeat(129)]) assert.ok(validatePassword(password));
  assert.equal(validatePassword("a".repeat(128)), null);
});

test("密码使用独立随机盐、可校验且不存储明文", async () => {
  const password = "自己人的暗号-123";
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.hash, second.hash);
  assert.equal(Buffer.from(first.salt, "base64").length, 16);
  assert.equal(Buffer.from(first.hash, "base64").length, 32);
  assert.equal(await verifyPassword(password, first.hash, first.salt), true);
  assert.equal(await verifyPassword("错误密码", first.hash, first.salt), false);
  assert.equal(await verifyPassword(password, first.hash, second.salt), false);
});
