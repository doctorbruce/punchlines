import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { Account } from "../shared/types";
import { normalizeUsername, validateAccount, validatePassword } from "../shared/accounts";
import { request } from "./api";
import { Avatar, Icon, Modal } from "./components";

type Action = { kind: "create" } | { kind: "reset" | "toggle"; account: Account };

export default function AccountManager({ onClose }: { onClose: () => void }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);
  const [action, setAction] = useState<Action | null>(null);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    request<{ users: Account[] }>("/api/users", { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) setAccounts(data.users);
    }).catch((caught: unknown) => {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "读取账号失败");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  function select(next: Action | null) {
    setAction(next); setError(""); setNotice(""); setUsername(""); setName(""); setPassword("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    const error = action.kind === "create" ? validateAccount(normalizeUsername(username), name.trim(), password)
      : action.kind === "reset" ? validatePassword(password) : null;
    if (error) { setError(error); return; }
    setBusy(true); setError("");
    try {
      const body = action.kind === "create" ? { username, name, password }
        : action.kind === "reset" ? { password } : { isActive: !action.account.isActive };
      await request(`/api/users${action.kind === "create" ? "" : `/${action.account.id}`}`, {
        method: action.kind === "create" ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      setNotice(action.kind === "create" ? "账号已开好，请私下将账号和初始密码交给这位朋友。"
        : action.kind === "reset" ? "密码已重置，原有登录已失效。请私下告知朋友新密码。" : "账号状态已更新，原有登录已失效。");
      setAction(null); setPassword(""); setRevision((previous) => previous + 1);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "操作失败，请重试"); }
    finally { setBusy(false); }
  }

  return <Modal title="自己人的名单" subtitle="每位朋友都能录入、编辑和删除全部语录；只有管理员可以管理账号。" onClose={onClose} busy={busy} wide>
    {notice && <p className="account-notice" role="status"><Icon name="check" size={16} />{notice}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {action ? <form className="account-form" onSubmit={submit}>
      <h3>{action.kind === "create" ? "给朋友开个账号" : action.kind === "reset" ? `重置 ${action.account.name} 的密码` : `${action.account.isActive ? "停用" : "启用"} ${action.account.name} 的账号？`}</h3>
      {action.kind === "create" && <><label>账号<input name="username" required minLength={3} maxLength={32} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="如 xiaoyu（字母、数字、_.-）" value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} /></label><label>朋友的称呼<input name="name" required maxLength={24} autoComplete="off" placeholder="如 小鱼" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} /></label></>}
      {action.kind !== "toggle" ? <><label>初始密码<input name="initialPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" placeholder="10–128 个字符" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label><p className="account-hint">首次登录必须改密。请通过私聊交付初始密码，不要发到公开群里。</p></> : <p className="account-hint">此操作会使该朋友在所有设备上的登录失效。停用后将无法登录，随时可以重新启用。</p>}
      <div className="confirm-buttons"><button className="secondary-button" type="button" onClick={() => select(null)} disabled={busy}>返回名单</button><button className="primary-button" disabled={busy}>{busy ? "正在保存…" : "确认保存"}</button></div>
    </form> : <><div className="account-toolbar"><span>共 {accounts.length} 位自己人</span><button className="primary-button" onClick={() => select({ kind: "create" })}><Icon name="plus" size={16} />添加朋友</button></div>
      {loading ? <p className="account-hint" role="status">正在翻开名单…</p> : <div className="account-list">{accounts.map((account) => <div className="account-row" key={account.id}><Avatar name={account.name} small /><div className="account-person"><strong>{account.name}<span className={`role-badge ${!account.isActive ? "inactive" : ""}`}>{!account.isActive ? "已停用" : account.role === "admin" ? "管理员" : "朋友"}</span></strong><small>@{account.username}{account.mustChangePassword ? " · 待首次改密" : ""}</small></div>{account.role === "member" && <div className="account-actions"><button onClick={() => select({ kind: "reset", account })}>重置密码</button><button onClick={() => select({ kind: "toggle", account })}>{account.isActive ? "停用" : "启用"}</button></div>}</div>)}</div>}
      {error && <button className="secondary-button" onClick={() => { setError(""); setRevision((previous) => previous + 1); }}>重新读取</button>}
    </>}
  </Modal>;
}
