import assert from "node:assert/strict";
import test from "node:test";
import { matchesImageSignature, validateComment, validateQuote } from "../shared/validation.ts";

const input = { speaker: "朋友", text: "今天也要开心", source: "朋友群", tag: "日常", saidAt: "2026-10-19T12:30" };

test("评论只接受非空文字，最多 500 字", () => {
  for (const value of [undefined, null, 123, {}, "", " \n "]) assert.match(validateComment(value), /写点什么/);
  assert.equal(validateComment(" 好开心！ "), null);
  assert.equal(validateComment("字".repeat(500)), null);
  assert.match(validateComment("字".repeat(501)), /500/);
});

test("文字、纯图片、图文都能记录，但不能什么都没有", () => {
  assert.equal(validateQuote(input, false), null);
  assert.equal(validateQuote({ ...input, text: "" }, true), null);
  assert.equal(validateQuote(input, true), null);
  assert.match(validateQuote({ ...input, text: "  " }, false), /写下一句话/);
});

test("拒绝空昵称和超长字段", () => {
  assert.match(validateQuote({ ...input, speaker: " " }, false), /名字/);
  for (const [field, length] of [["speaker", 25], ["text", 2001], ["source", 41], ["tag", 17]]) {
    assert.notEqual(validateQuote({ ...input, [field]: "字".repeat(length) }, false), null);
  }
  assert.equal(validateQuote({ ...input, text: "字".repeat(2000) }, false), null);
});

test("校验真实日历日期、闰年和时间，不让二月三十日悄悄变成三月", () => {
  for (const saidAt of ["2026-02-30T12:00", "2025-02-29T12:00", "2026-13-01T12:00", "2026-10-19T24:00", "2026-10-19T12:60", "not-a-date", "2026-10-19"]) {
    assert.match(validateQuote({ ...input, saidAt }, false), /聊天时间/);
  }
  assert.equal(validateQuote({ ...input, saidAt: "2024-02-29T00:00" }, false), null);
});

test("识别四种允许图片的文件头，拒绝伪装的 HTML 和 SVG", () => {
  const signatures = [
    ["image/png", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["image/jpeg", [255, 216, 255, 224]],
    ["image/gif", [...Buffer.from("GIF89a")]],
    ["image/webp", [...Buffer.from("RIFF0000WEBP")]],
  ];
  for (const [mime, bytes] of signatures) assert.equal(matchesImageSignature(new Uint8Array(bytes), mime), true);
  assert.equal(matchesImageSignature(new Uint8Array(Buffer.from("<script>alert(1)</script>")), "image/png"), false);
  assert.equal(matchesImageSignature(new Uint8Array(Buffer.from("<svg/>")), "image/svg+xml"), false);
  assert.equal(matchesImageSignature(new Uint8Array(), "image/png"), false);
  assert.equal(matchesImageSignature(new Uint8Array(Buffer.from("GIF88a")), "image/gif"), false);
});
