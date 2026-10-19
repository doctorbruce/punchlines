import { useEffect, useRef, useState } from "react";
import type { ArchiveMeta, Quote, QuotePage } from "../shared/types";
import { request } from "./api";
import { Avatar, Icon, Modal } from "./components";
import { DEMO_META, DEMO_QUOTES } from "./demo";
import QuoteEditor from "./QuoteEditor";
import { PasswordForm, useAuth } from "./Auth";
import AccountManager from "./AccountManager";
import Comments from "./Comments";

const initial = new URLSearchParams(window.location.search);
type ContentType = "all" | "text" | "image";

function dayLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(new Date(`${value}T12:00:00`));
}

export default function App() {
  const { user, logout, requireLogin, loading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";
  const [meta, setMeta] = useState<ArchiveMeta | null>(null);
  const [metaError, setMetaError] = useState("");
  const [page, setPage] = useState<QuotePage>({ quotes: [], total: 0 });
  const [person, setPerson] = useState(initial.get("person") ?? "");
  const [search, setSearch] = useState(initial.get("q") ?? "");
  const [query, setQuery] = useState(search);
  const [type, setType] = useState<ContentType>(initial.get("type") === "image" ? "image" : initial.get("type") === "text" ? "text" : "all");
  const [sort, setSort] = useState(initial.get("sort") === "oldest" ? "oldest" : "newest");
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [quotesError, setQuotesError] = useState("");
  const [revision, setRevision] = useState(0);
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [editor, setEditor] = useState<{ quote: Quote | null } | null>(null);
  const [deleting, setDeleting] = useState<Quote | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [lightbox, setLightbox] = useState<Quote | null>(null);
  const [commenting, setCommenting] = useState<Quote | null>(null);
  const [toast, setToast] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  const demo = meta?.total === 0;
  const displayMeta = demo ? DEMO_META : meta;
  const error = metaError || quotesError;

  useEffect(() => {
    const timeout = window.setTimeout(() => setQuery(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    const controller = new AbortController();
    setMetaError("");
    request<ArchiveMeta>("/api/meta", { signal: controller.signal }).then(setMeta).catch((caught: unknown) => {
      if (!controller.signal.aborted) { setMetaError(caught instanceof Error ? caught.message : "暂时无法读取语录"); setLoading(false); }
    });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    if (!meta) return;
    const controller = new AbortController();
    moreRequest.current?.abort();
    setLoadingMore(false);
    setQuotesError("");
    if (demo) {
      const matches = DEMO_QUOTES.filter((quote) => (!person || quote.speaker === person)
        && (type === "all" || (type === "image" ? Boolean(quote.imageUrl) : !quote.imageUrl))
        && `${quote.text} ${quote.speaker} ${quote.tag} ${quote.source}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
      if (sort === "oldest") matches.reverse();
      setPage({ quotes: matches, total: matches.length });
      setLoading(false);
    } else {
      setLoading(true);
      setPage({ quotes: [], total: 0 });
      const params = new URLSearchParams({ person, q: query, type, sort });
      request<QuotePage>(`/api/quotes?${params}`, { signal: controller.signal }).then((data) => {
        if (!controller.signal.aborted) { setPage(data); setLoading(false); }
      }).catch((caught: unknown) => {
        if (!controller.signal.aborted) { setQuotesError(caught instanceof Error ? caught.message : "暂时无法读取语录"); setLoading(false); }
      });
    }
    return () => { controller.abort(); moreRequest.current?.abort(); };
  }, [meta, demo, person, query, type, sort]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (person) params.set("person", person);
    if (query) params.set("q", query);
    if (type !== "all") params.set("type", type);
    if (sort !== "newest") params.set("sort", sort);
    window.history.replaceState(null, "", `${window.location.pathname}${params.size ? `?${params}` : ""}`);
  }, [person, query, type, sort]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function selectPerson(name: string) {
    setPerson(name);
    setMobileOpen(false);
  }

  function newQuote() {
    if (!meta) { setToast("请先等待语录小馆连接成功"); return; }
    requireLogin(() => setEditor({ quote: null }));
  }

  async function signOut() {
    setLoggingOut(true);
    try { await logout(); }
    catch (caught) { setToast(caught instanceof Error ? caught.message : "退出失败，请重试"); }
    finally { setLoggingOut(false); }
  }

  async function loadMore() {
    moreRequest.current?.abort();
    const controller = new AbortController();
    moreRequest.current = controller;
    setLoadingMore(true);
    setQuotesError("");
    try {
      const params = new URLSearchParams({ person, q: query, type, sort, offset: String(page.quotes.length) });
      const data = await request<QuotePage>(`/api/quotes?${params}`, { signal: controller.signal });
      if (!controller.signal.aborted) setPage((previous) => ({ total: data.total, quotes: [...previous.quotes, ...data.quotes.filter((quote) => !previous.quotes.some((existing) => existing.id === quote.id))] }));
    } catch (caught) {
      if (!controller.signal.aborted) setQuotesError(caught instanceof Error ? caught.message : "加载失败，请重试");
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  function saved() {
    setEditor(null);
    setPerson("");
    setSearch("");
    setQuery("");
    setType("all");
    setRevision((previous) => previous + 1);
    setToast("好好收着，以后慢慢笑。");
  }

  async function deleteQuote() {
    if (!deleting) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      await request(`/api/quotes/${deleting.id}`, { method: "DELETE" });
      setDeleting(null);
      setRevision((previous) => previous + 1);
      setToast("这条语录已删除");
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "删除失败，请重试");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function copyQuote(quote: Quote) {
    try { await navigator.clipboard.writeText(`${quote.text}\n—— ${quote.speaker}`); setToast("这句好话，复制好了"); }
    catch { setToast("浏览器未允许复制，请手动选择文字"); }
  }

  function resetFilters() { setPerson(""); setSearch(""); setQuery(""); setType("all"); }

  return <div className="app-shell">
    {mobileOpen && <button className="sidebar-backdrop" aria-label="关闭朋友列表" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`} aria-label="朋友与语录导航">
      <a href="/" className="brand"><span className="brand-mark">“</span><span><strong>话匣子<span className="brand-dot">.</span></strong><small>好朋友的语录小馆</small></span></a>
      <div className="sidebar-section-label">我们的收藏 <span>ARCHIVE</span></div>
      <button className={`nav-item ${!person && type !== "image" ? "active" : ""}`} onClick={() => { selectPerson(""); setType("all"); }}><Icon name="chat" /><span>全部语录</span><span className="nav-count">{displayMeta?.total ?? "–"}</span></button>
      <button className={`nav-item ${!person && type === "image" ? "active" : ""}`} onClick={() => { selectPerson(""); setType("image"); }}><Icon name="image" /><span>图片时刻</span><span className="nav-count">{displayMeta?.images ?? "–"}</span></button>
      <div className="sidebar-divider" />
      <div className="sidebar-section-label friends-label">这群有趣的人 <span>{displayMeta?.people.length ?? 0}</span></div>
      <nav className="friend-list" aria-label="按朋友筛选">
        {displayMeta?.people.map((friend) => <button key={friend.name} className={`friend-item ${person === friend.name ? "selected" : ""}`} onClick={() => selectPerson(friend.name)}><Avatar name={friend.name} small /><span>{friend.name}</span><span className="friend-count">{friend.count}</span>{person === friend.name && <span className="selected-dot" />}</button>)}
        {!displayMeta && <p className="sidebar-placeholder">{metaError ? "暂时没连上，稍后再来看看" : "正在召集朋友们…"}</p>}
      </nav>
      <div className="sidebar-bottom">
        <div className="sidebar-note"><span className="mini-flower">✳</span><p>有些话，<br />只有我们懂。</p><span className="note-heart">♡</span></div>
        <button className="admin-button" onClick={() => { setMobileOpen(false); if (!user || user.mustChangePassword) requireLogin(); else if (isAdmin) setAccountsOpen(true); else setPasswordOpen(true); }}><Icon name={isAdmin ? "people" : "lock"} size={15} /><span>{isAdmin ? "管理账号" : user ? "修改密码" : "登录后一起收藏"}</span><Icon name="arrow" size={14} /></button>
        <span className="sidebar-footnote">PUNCHLINES · GOOD TIMES</span>
      </div>
    </aside>

    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="展开朋友列表" onClick={() => setMobileOpen(true)}><Icon name="menu" /></button><Icon name="book" size={17} /><span>我们的角落</span><span className="breadcrumb-slash">/</span><strong>语录小馆</strong></div><div className="user-menu">{user ? <><button className="user-profile" title="修改密码" onClick={() => { if (user.mustChangePassword) requireLogin(); else setPasswordOpen(true); }}><Avatar name={user.name} small /><span>{user.name}<small>{isAdmin ? "管理员" : "朋友"}</small></span></button><button className="icon-button" aria-label="退出登录" title="退出登录" disabled={loggingOut} onClick={() => void signOut()}><Icon name="logout" size={17} /></button></> : <button className="secondary-button guest-login" aria-busy={authLoading} onClick={() => requireLogin()}><Icon name="lock" size={14} />登录</button>}</div></header>
      <main>
        <section className="intro">
          <div><div className="eyebrow"><span /> LITTLE WORDS, BIG MEMORIES</div><h1>聊天会翻篇<span>，</span>快乐不打烊<span className="title-period">。</span></h1><p>接住朋友们的灵光一闪，和那些不太正经的日常。</p><div className="intro-stats"><span><Icon name="people" size={15} /><strong>{displayMeta?.people.length ?? "–"}</strong> 位好朋友</span><i /><span><Icon name="chat" size={15} /><strong>{displayMeta?.total ?? "–"}</strong> 个有趣瞬间</span><span className="stat-memory">持续收藏中 <span className="tiny-dot" /></span></div></div>
          <div className="intro-doodle" aria-hidden="true"><span className="doodle-star">✧</span><span className="doodle-chat first">这句记下来！<span>✶</span></span><span className="doodle-chat second">哈哈哈哈哈 <span>☺</span></span><span className="doodle-loop">↳</span></div>
        </section>

        <div className="content-grid">
          <section className="archive" aria-label="语录气泡列表">
            <div className="archive-heading"><div className="archive-title"><span className="archive-icon"><Icon name={person ? "people" : "chat"} size={21} /></span><div><h2>{person ? `${person}的碎碎念` : "大家的碎碎念"}</h2><p>{person ? "属于这位朋友的名场面，都在这里。" : "每一句，都有画面感。"}</p></div></div><button className="primary-button" onClick={newQuote}><Icon name="plus" size={18} />记下一句</button></div>
            <div className="filter-bar"><div className="type-tabs" role="group" aria-label="语录类型">{([
              ["all", "全部", "chat"], ["text", "文字", "text"], ["image", "图片", "image"],
            ] as const).map(([value, label, icon]) => <button key={value} className={type === value ? "selected" : ""} onClick={() => setType(value)} aria-pressed={type === value}><Icon name={icon} size={15} />{label}</button>)}</div><label className="search-field"><Icon name="search" size={17} /><input aria-label="搜索语录" placeholder="搜一句话、一个名字…" maxLength={200} value={search} onChange={(event) => setSearch(event.target.value)} />{search && <button aria-label="清空搜索" onClick={() => setSearch("")}><Icon name="close" size={14} /></button>}</label></div>
            <div className="feed-topline"><span>{loading ? "正在翻开回忆…" : <>共 <strong>{page.total}</strong> 条{person ? `来自 ${person} 的` : ""}语录{demo && <span className="demo-pill">示例预览</span>}</>}</span><label className="sort-control"><Icon name="down" size={13} /><select aria-label="语录排序" value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">最近的在前</option><option value="oldest">从最早开始看</option></select></label></div>
            {demo && <div className="demo-notice"><Icon name="spark" size={14} /><span>先看看这里的模样。这些是虚构示例，录入第一条后就换成你们的故事。</span></div>}
            {error && <div className="error-notice" role="alert"><span>{error}</span><button onClick={() => setRevision((previous) => previous + 1)}>重新连接</button></div>}
            <div className="chat-feed" aria-busy={loading}>
              {loading ? <div className="skeleton-feed" aria-label="正在加载"><div /><div /><div /></div> : !error && page.quotes.length === 0 ? <div className="empty-state"><span><Icon name="chat" size={32} /></span><h3>这页暂时安静了一点</h3><p>换个关键词，或者把筛选条件放宽一些。</p><button className="secondary-button" onClick={resetFilters}>看看全部语录</button></div> : !metaError && page.quotes.map((quote, index) => {
                const newDay = quote.saidAt.slice(0, 10) !== page.quotes[index - 1]?.saidAt.slice(0, 10);
                const right = !person && (quote.speaker === "小鱼" || (!demo && displayMeta?.people.findIndex((friend) => friend.name === quote.speaker) === 1));
                return <div key={quote.id}>
                  {newDay && <div className="day-divider"><span>{dayLabel(quote.saidAt.slice(0, 10))}</span></div>}
                  <article className={`chat-row ${right ? "chat-right" : ""}`}>
                    <button className="avatar-button" aria-label={`只看${quote.speaker}的语录`} onClick={() => selectPerson(quote.speaker)}><Avatar name={quote.speaker} /></button>
                    <div className="chat-content"><div className="chat-author"><button onClick={() => selectPerson(quote.speaker)}>{quote.speaker}</button><time dateTime={quote.saidAt}>{quote.saidAt.slice(11, 16)}</time></div><div className={`chat-bubble ${quote.imageUrl ? "has-image" : ""}`}>
                      {quote.imageUrl && <button className="bubble-image" aria-label={`查看${quote.speaker}的图片大图`} onClick={() => setLightbox(quote)}><img src={quote.imageUrl} alt={`${quote.speaker}的图片语录`} loading="lazy" /><span><Icon name="image" size={14} />查看原图</span></button>}
                      {quote.text && <p>{quote.text}</p>}
                    </div><div className="chat-foot"><span className="quote-source">{quote.source && <><Icon name="chat" size={11} />{quote.source}</>}</span>{quote.tag && <button className="tag" onClick={() => setSearch(quote.tag)}># {quote.tag}</button>}<div className="quote-actions">
                      {quote.text && <button className="icon-button" aria-label={`复制${quote.speaker}的语录`} title="复制语录" onClick={() => void copyQuote(quote)}><Icon name="copy" size={13} /></button>}
                      {!demo && <><button className="icon-button" aria-label={`查看${quote.speaker}的评论`} title="查看和发表评论" onClick={() => setCommenting(quote)}><Icon name="chat" size={13} /></button><button className="icon-button" aria-label={`编辑${quote.speaker}的语录`} title="编辑语录" onClick={() => requireLogin(() => setEditor({ quote }))}><Icon name="edit" size={13} /></button><button className="icon-button danger-icon" aria-label={`删除${quote.speaker}的语录`} title="删除语录" onClick={() => requireLogin(() => { setDeleteError(""); setDeleting(quote); })}><Icon name="trash" size={13} /></button></>}
                    </div></div></div>
                  </article>
                </div>;
              })}
              {!loading && !error && page.quotes.length > 0 && <div className="feed-end">{page.quotes.length < page.total && !demo ? <button className="secondary-button" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? "翻找回忆中…" : "再翻一页回忆"}<Icon name="down" size={14} /></button> : <><span>✳</span><p>先收好这些，新的快乐还在路上。</p></>}</div>}
            </div>
            <div className="archive-bottom"><span><Icon name="heart" size={13} /> 好朋友的废话，永远有地方放。</span><button onClick={newQuote}>再收藏一句 <Icon name="plus" size={13} /></button></div>
          </section>

          <aside className="memory-aside" aria-label="小馆侧记">
            <div className="memory-card"><div className="memory-card-top"><span>小馆手记</span><Icon name="spark" size={17} /></div><span className="big-quotation">“</span><h3>我们收藏的，<br />不只是语录。</h3><p>是某个聊到深夜的晚上，<br />是突然笑出声的瞬间，<br />也是一起长大的证据。</p><div className="memory-card-bottom"><span>WORDS WORTH KEEPING</span><span>♡</span></div></div>
            <div className="aside-stats"><span className="aside-label">小小话匣，满满当当</span><div><span><strong>{String(displayMeta?.total ?? 0).padStart(2, "0")}</strong><small>句值得收藏的话</small></span><Icon name="chat" size={30} /></div><div className="avatar-stack">{displayMeta?.people.slice(0, 5).map((friend) => <Avatar name={friend.name} small key={friend.name} />)}{Boolean(displayMeta?.people.length) && <span>和 {displayMeta!.people.length} 位朋友一起</span>}</div></div>
            <div className="aside-tip"><Icon name="book" size={15} /><p>小提醒<br /><span>语录和评论公开可见。录入之前，记得先征得朋友同意。</span></p></div>
          </aside>
        </div>
        <footer className="page-footer"><span>话匣子 · 把平常日子，聊成独家记忆。</span><span>JUST BETWEEN US <Icon name="heart" size={11} /></span></footer>
      </main>
    </div>

    {accountsOpen && isAdmin && <AccountManager onClose={() => setAccountsOpen(false)} />}
    {passwordOpen && user && <Modal title="换个自己的暗号" subtitle="密码修改后，其他设备上的登录会失效。" onClose={() => setPasswordOpen(false)}><PasswordForm onSaved={() => { setPasswordOpen(false); setToast("新暗号已收好"); }} /></Modal>}
    {commenting && <Comments quote={commenting} onClose={() => setCommenting(null)} />}
    {editor && <QuoteEditor quote={editor.quote} people={meta?.people ?? []} speaker={demo ? "" : person} onClose={() => setEditor(null)} onSaved={saved} />}
    {deleting && <Modal title="要拿走这段回忆吗？" subtitle="删除后无法恢复，图片也会一起移除。" onClose={() => setDeleting(null)} busy={deleteBusy}><blockquote className="delete-preview">{deleting.text || "一张图片语录"}<small>—— {deleting.speaker}</small></blockquote>{deleteError && <p className="form-error" role="alert">{deleteError}</p>}<div className="confirm-buttons"><button className="secondary-button" onClick={() => setDeleting(null)} disabled={deleteBusy}>还是留着吧</button><button className="danger-button" onClick={() => void deleteQuote()} disabled={deleteBusy}>{deleteBusy ? "正在删除…" : "确认删除"}</button></div></Modal>}
    {lightbox && <Modal title={`${lightbox.speaker}的图片时刻`} subtitle={`${lightbox.saidAt.replace("T", " ")}${lightbox.source ? ` · ${lightbox.source}` : ""}`} onClose={() => setLightbox(null)} wide><img className="lightbox-image" src={lightbox.imageUrl!} alt={`${lightbox.speaker}的图片语录原图`} />{lightbox.text && <p className="lightbox-caption">{lightbox.text}</p>}<a className="secondary-button download-image" href={lightbox.imageUrl!} download><Icon name="down" size={16} />保存原图</a></Modal>}
    {toast && <div className="toast" role="status"><Icon name="check" size={17} />{toast}</div>}
  </div>;
}
