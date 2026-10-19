import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { CommentPage, Quote } from "../shared/types";
import { validateComment } from "../shared/validation";
import { request } from "./api";
import { useAuth } from "./Auth";
import { Avatar, Icon, Modal } from "./components";

export default function Comments({ quote, onClose }: { quote: Quote; onClose: () => void }) {
  const { user, requireLogin } = useAuth();
  const [page, setPage] = useState<CommentPage>({ comments: [], total: 0 });
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [confirming, setConfirming] = useState<string | null>(null);
  const moreRequest = useRef<AbortController | null>(null);
  const path = `/api/quotes/${quote.id}/comments`;

  useEffect(() => {
    const controller = new AbortController();
    moreRequest.current?.abort();
    setLoadingMore(false); setLoading(true); setLoadError("");
    request<CommentPage>(path, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setPage(data);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setLoadError(caught instanceof Error ? caught.message : "评论暂时没连上");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); moreRequest.current?.abort(); };
  }, [path, revision]);

  async function loadMore() {
    const controller = new AbortController();
    moreRequest.current?.abort(); moreRequest.current = controller;
    setLoadingMore(true); setLoadError("");
    try {
      const next = await request<CommentPage>(`${path}?offset=${page.comments.length}`, { signal: controller.signal });
      if (!controller.signal.aborted) setPage((previous) => ({ total: next.total, comments: [...previous.comments, ...next.comments.filter((comment) => !previous.comments.some((existing) => existing.id === comment.id))] }));
    } catch (caught) {
      if (!controller.signal.aborted) setLoadError(caught instanceof Error ? caught.message : "暂时无法加载更多评论");
    } finally { if (!controller.signal.aborted) setLoadingMore(false); }
  }

  async function publish(text: string) {
    setBusy(true); setError("");
    try {
      await request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      setDraft(""); setRevision((previous) => previous + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "发送失败，草稿还在，请稍后重试"); }
    finally { setBusy(false); }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const error = validateComment(draft);
    if (error) { setError(error); return; }
    requireLogin(() => void publish(draft.trim()));
  }

  async function remove(commentId: string) {
    setBusy(true); setError("");
    try {
      await request(`${path}/${commentId}`, { method: "DELETE" });
      setConfirming(null); setRevision((previous) => previous + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "删除失败，请重试"); }
    finally { setBusy(false); }
  }

  return <Modal title="这句下面，接着聊" subtitle={`来自 ${quote.speaker} 的名场面 · 评论公开可见`} onClose={onClose} busy={busy}>
    <blockquote className="comment-quote">{quote.text || "一张值得收藏的图片"}<small>—— {quote.speaker}</small></blockquote>
    <div className="comments-summary">{loading ? "正在翻开评论…" : `${page.total} 条评论 · 新的在前`}</div>
    {loadError && <div className="error-notice" role="alert"><span>{loadError}</span><button onClick={() => setRevision((previous) => previous + 1)}>重新加载</button></div>}
    <div className="comments-list" aria-busy={loading}>
      {!loading && !loadError && page.total === 0 && <p className="account-hint">这里还很安静，来接下一句吧。</p>}
      {!loading && page.comments.map((comment) => <article className="comment-item" key={comment.id}>
        <Avatar name={comment.authorName} small /><div className="comment-content"><header><strong>{comment.authorName}</strong><time dateTime={new Date(comment.createdAt).toISOString()}>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(comment.createdAt)}</time></header><p>{comment.text}</p>
          {user && (user.id === comment.userId || user.role === "admin") && <div className="comment-controls">{confirming === comment.id ? <><span>确定删除？</span><button disabled={busy} onClick={() => requireLogin(() => void remove(comment.id))}>确认删除评论</button><button disabled={busy} onClick={() => setConfirming(null)}>取消</button></> : <button disabled={busy} onClick={() => setConfirming(comment.id)}>删除评论</button>}</div>}
        </div>
      </article>)}
    </div>
    {!loading && page.comments.length < page.total && <button className="secondary-button comments-more" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "正在翻找…" : "加载更早的评论"}</button>}
    <form className="account-form comment-form" onSubmit={submit}><label>接一句话<textarea rows={3} maxLength={500} placeholder="想说的话先写下来，发送时再登录也可以。" value={draft} onChange={(event) => setDraft(event.target.value)} disabled={busy} /></label><div className="comment-form-footer"><span>{draft.length} / 500 · 公开可见</span><button className="primary-button" disabled={busy}>{busy ? "正在发送…" : !user || user.mustChangePassword ? "登录并发送" : "发送评论"}<Icon name="arrow" size={15} /></button></div>{error && <p className="form-error" role="alert">{error}</p>}</form>
  </Modal>;
}
