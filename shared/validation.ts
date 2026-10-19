import type { QuoteInput } from "./types";

export const MAX_IMAGE_SIZE = 12 * 1024 * 1024;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

export function validateComment(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) return "写点什么再发送吧";
  if (text.trim().length > 500) return "评论最多可以写 500 个字";
  return null;
}

export function validateQuote(input: QuoteInput, hasImage: boolean): string | null {
  if (!input.speaker.trim() || input.speaker.length > 24) return "朋友的名字需要 1～24 个字";
  if (!input.text.trim() && !hasImage) return "写下一句话，或上传一张图片吧";
  if (input.text.length > 2000) return "语录最多可以写 2000 个字";
  if (input.source.length > 40) return "群聊名称最多 40 个字";
  if (input.tag.length > 16) return "标签最多 16 个字";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input.saidAt)) return "请选择有效的聊天时间";
  const date = new Date(`${input.saidAt}:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 16) !== input.saidAt) return "请选择有效的聊天时间";
  return null;
}

export function matchesImageSignature(bytes: Uint8Array, type: string): boolean {
  const prefix = (...values: number[]) => values.every((value, index) => bytes[index] === value);
  if (type === "image/png") return prefix(137, 80, 78, 71, 13, 10, 26, 10);
  if (type === "image/jpeg") return prefix(255, 216, 255);
  if (type === "image/gif") return prefix(71, 73, 70, 56) && (bytes[4] === 55 || bytes[4] === 57) && bytes[5] === 97;
  if (type === "image/webp") return prefix(82, 73, 70, 70) && bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80;
  return false;
}
