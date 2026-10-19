import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Person, Quote, QuoteInput } from "../shared/types";
import { IMAGE_TYPES, MAX_IMAGE_SIZE, validateQuote } from "../shared/validation";
import { localDateTime, request } from "./api";
import { Icon, Modal } from "./components";

export default function QuoteEditor({ quote, people, speaker, onClose, onSaved }: { quote: Quote | null; people: Person[]; speaker: string; onClose: () => void; onSaved: () => void }) {
  const [input, setInput] = useState<QuoteInput>({
    speaker: quote?.speaker ?? speaker,
    text: quote?.text ?? "",
    source: quote?.source ?? "",
    tag: quote?.tag ?? "",
    saidAt: quote?.saidAt ?? localDateTime(),
  });
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(quote?.imageUrl ?? "");
  const [removed, setRemoved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!file) {
      setPreview(removed ? "" : quote?.imageUrl ?? "");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, removed, quote]);

  function selectFile(selected: File | undefined) {
    if (!selected) return;
    if (!IMAGE_TYPES.includes(selected.type) || selected.size > MAX_IMAGE_SIZE || selected.size === 0) {
      setError("请选择不超过 12 MB 的 JPG、PNG、WebP 或 GIF 图片");
      return;
    }
    setFile(selected);
    setRemoved(false);
    setError("");
  }

  function change(field: keyof QuoteInput, value: string) {
    setInput((previous) => ({ ...previous, [field]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const normalized = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value.trim()])) as unknown as QuoteInput;
    const validation = validateQuote(normalized, Boolean(file || (quote?.imageUrl && !removed)));
    if (validation) { setError(validation); return; }
    setSaving(true);
    setError("");
    try {
      const body = new FormData();
      Object.entries(normalized).forEach(([key, value]) => body.set(key, value));
      if (file) body.set("image", file);
      body.set("removeImage", String(removed));
      await request(`/api/quotes${quote ? `/${quote.id}` : ""}`, { method: quote ? "PATCH" : "POST", body });
      onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  }

  return <Modal title={quote ? "再润色一下这段回忆" : "把这一句，装进话匣子"} subtitle="一句话，一张图，都是以后想起来会笑的瞬间。" onClose={onClose} busy={saving} wide>
    <form onSubmit={save} className="editor-form" onPaste={(event) => {
      if (saving) return;
      const pasted = [...event.clipboardData.files].find((item) => item.type.startsWith("image/"));
      if (pasted) { event.preventDefault(); selectFile(pasted); }
    }}>
      <fieldset disabled={saving}>
        <div className="form-grid">
          <label>谁说的 <span className="required">*</span><input autoFocus required list="friend-names" maxLength={24} placeholder="朋友的昵称，也可以填新朋友" value={input.speaker} onChange={(event) => change("speaker", event.target.value)} /></label>
          <datalist id="friend-names">{people.map((person) => <option key={person.name} value={person.name} />)}</datalist>
          <label>什么时候 <span className="required">*</span><input required type="datetime-local" value={input.saidAt} onChange={(event) => change("saidAt", event.target.value)} /></label>
        </div>
        <label>说了什么 <span className="field-optional">文字和图片，至少留下一种</span><textarea rows={4} maxLength={2000} placeholder="此处应该有一句惊为天人的发言……" value={input.text} onChange={(event) => change("text", event.target.value)} /><span className="character-count">{input.text.length} / 2000</span></label>
        <div className="image-field">
          {preview ? <div className="upload-preview"><img src={preview} alt="准备收藏的图片" /><button type="button" className="icon-button" aria-label="移除图片" onClick={() => { setFile(null); setRemoved(true); if (fileInput.current) fileInput.current.value = ""; }}><Icon name="close" size={17} /></button></div>
            : <button type="button" className="upload-zone" onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); selectFile(event.dataTransfer.files[0]); }}><span className="upload-icon"><Icon name="image" size={24} /></span><span><strong>放一张图，让回忆更具体</strong><small>点击、拖拽或直接粘贴图片 · 最大 12 MB</small></span><Icon name="plus" size={20} /></button>}
          <input ref={fileInput} className="visually-hidden" type="file" accept={IMAGE_TYPES.join(",")} aria-label="上传图片" onChange={(event) => selectFile(event.target.files?.[0])} />
        </div>
        <div className="form-grid">
          <label>来自哪个群 <span className="field-optional">选填</span><input maxLength={40} placeholder="比如：相亲相爱一家人" value={input.source} onChange={(event) => change("source", event.target.value)} /></label>
          <label>贴个标签 <span className="field-optional">选填</span><input maxLength={16} placeholder="比如：人间清醒" value={input.tag} onChange={(event) => change("tag", event.target.value.replace(/^#/, ""))} /></label>
        </div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-footer"><span><Icon name="heart" size={14} /> 收藏前，记得获得朋友的同意</span><button className="primary-button" type="submit" disabled={saving}><Icon name={saving ? "upload" : "check"} size={17} />{saving ? "正在收好…" : quote ? "保存修改" : "收进话匣子"}</button></div>
    </form>
  </Modal>;
}
