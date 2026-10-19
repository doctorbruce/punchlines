import { useEffect, useId, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

const iconPaths = {
  chat: "M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5ZM7 10h9M7 14h6",
  search: "m21 21-4.5-4.5M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z",
  plus: "M12 5v14M5 12h14",
  image: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm-2 14 6-6 4 4 3-3 5 5M8 7h.01",
  text: "M4 5h16M12 5v15M8 20h8",
  arrow: "m9 5 7 7-7 7",
  down: "m6 9 6 6 6-6",
  close: "m6 6 12 12M6 18 18 6",
  copy: "M9 9h11v12H9zM5 15H3V3h11v2",
  edit: "m16 3 5 5-12 12-6 1 1-6L16 3Zm-3 3 5 5",
  trash: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  lock: "M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4M12 15v2",
  logout: "M9 4H4v16h5M8 12h13m-5-5 5 5-5 5",
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z",
  spark: "m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z",
  people: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 3.1a4 4 0 0 1 0 7.8M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  upload: "M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5",
  check: "m5 12 4 4L19 6",
  menu: "M4 6h16M4 12h16M4 18h16",
  book: "M12 5C9 2 4 3 2 4v16c3-2 7-2 10 0 3-2 7-2 10 0V4c-3-1-7-2-10 1Zm0 0v15",
} as const;

export function Icon({ name, size = 20, className = "" }: { name: keyof typeof iconPaths; size?: number; className?: string }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={iconPaths[name]} /></svg>;
}

const palette = [
  ["#f5dfcc", "#976144", "🍊"],
  ["#dfe8db", "#5e765c", "🌱"],
  ["#e5e2ee", "#7b7093", "🌙"],
  ["#e0ebed", "#5a7e87", "🐟"],
  ["#f4e7c8", "#9b8249", "🥔"],
  ["#f0deda", "#a6726c", "🐱"],
];

export function personStyle(name: string): CSSProperties {
  const index = [...name].reduce((total, character) => total + character.codePointAt(0)!, 0) % palette.length;
  const colors = palette[index]!;
  return { "--avatar-bg": colors[0], "--avatar-ink": colors[1] } as CSSProperties;
}

export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  const index = [...name].reduce((total, character) => total + character.codePointAt(0)!, 0) % palette.length;
  return <span className={`avatar ${small ? "avatar-small" : ""}`} style={personStyle(name)} aria-hidden="true">{palette[index]![2]}</span>;
}

export function Modal({ title, subtitle, children, onClose, wide = false, busy = false }: { title: string; subtitle?: string; children: ReactNode; onClose: () => void; wide?: boolean; busy?: boolean }) {
  const reference = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  useEffect(() => {
    const dialog = reference.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLElement>("input:not([type=file]), textarea")?.focus();
    return () => dialog?.close();
  }, []);
  return <dialog ref={reference} className={`modal ${wide ? "modal-wide" : ""}`} aria-labelledby={headingId} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }} onClick={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section className="modal-inner">
      <div className="modal-heading"><div><h2 id={headingId}>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="icon-button" aria-label="关闭弹窗" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>
      {children}
    </section>
  </dialog>;
}
