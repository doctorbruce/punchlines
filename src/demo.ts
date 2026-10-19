import type { ArchiveMeta, Quote } from "../shared/types";

const entries = [
  { speaker: "阿橙", text: "我的人生规划很简单：\n上午等午饭，下午等下班。", tag: "打工日常", saidAt: "2026-10-19T14:32" },
  { speaker: "小鱼", text: "情绪很稳定，稳定地想放假。", tag: "人间清醒", saidAt: "2026-10-19T11:08" },
  { speaker: "大白", text: "目前的工作状态：看起来很忙，实际上在等饭。", imageUrl: "/demo-cat.svg", tag: "精神状态", saidAt: "2026-10-18T18:26" },
  { speaker: "一颗土豆", text: "钱没了可以再赚，\n但周末没了，就真的要周一了。", tag: "生活哲学", saidAt: "2026-10-18T16:45" },
  { speaker: "阿橙", text: "不要叫我熬夜冠军，\n请叫我时间管理的漏网之鱼。", tag: "人间清醒", saidAt: "2026-10-17T23:56" },
  { speaker: "小满", text: "今天也有好好生活。\n证据是，冰箱里的西瓜又少了一半。", tag: "好好生活", saidAt: "2026-10-17T20:10" },
  { speaker: "林七", text: "人生没有白走的路，\n但有好多白上的班。", tag: "打工日常", saidAt: "2026-10-16T17:42" },
  { speaker: "小鱼", text: "我不是不回消息，我是在等一个\n合适的精神状态。比如放假。", tag: "精神状态", saidAt: "2026-10-15T19:22" },
  { speaker: "小满", text: "所谓朋友，就是你说了句废话，\n还有人认真接下一句废话。", tag: "朋友真好", saidAt: "2026-10-14T21:03" },
];

export const DEMO_QUOTES: Quote[] = entries.map((entry, index) => ({
  id: `demo-${index}`,
  source: "不太正经的朋友们",
  imageUrl: null,
  createdAt: 100 - index,
  ...entry,
}));

export const DEMO_META: ArchiveMeta = {
  people: [...new Set(DEMO_QUOTES.map((quote) => quote.speaker))].map((name) => ({ name, count: DEMO_QUOTES.filter((quote) => quote.speaker === name).length })),
  total: DEMO_QUOTES.length,
  images: DEMO_QUOTES.filter((quote) => quote.imageUrl).length,
};
