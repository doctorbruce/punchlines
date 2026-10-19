import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type { SessionUser } from "../shared/types";
import { validatePassword } from "../shared/accounts";
import { ApiError, request } from "./api";
import { Icon, Modal } from "./components";

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  requireLogin: (onReady?: () => void) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("缺少登录上下文");
  return value;
}

function jsonOptions(body: object): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const [authBusy, setAuthBusy] = useState(false);
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError("");
    request<{ user: SessionUser }>("/api/auth/me", { signal: controller.signal, promptLogin: false }).then((data) => {
      if (!controller.signal.aborted) setUser(data.user);
    }).catch((caught: unknown) => {
      if (controller.signal.aborted) return;
      setUser(null);
      if (!(caught instanceof ApiError && caught.status === 401)) setError(caught instanceof Error ? caught.message : "暂时无法连接小馆");
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [revision]);

  useEffect(() => {
    const expired = () => { setUser(null); setOpen(true); };
    const passwordRequired = () => {
      setUser((previous) => previous ? { ...previous, mustChangePassword: true } : null);
      setOpen(true);
    };
    window.addEventListener("words:unauthorized", expired);
    window.addEventListener("words:password-required", passwordRequired);
    return () => {
      window.removeEventListener("words:unauthorized", expired);
      window.removeEventListener("words:password-required", passwordRequired);
    };
  }, []);

  useEffect(() => {
    if (!open || loading || !user || user.mustChangePassword) return;
    setOpen(false);
    const action = pending.current;
    pending.current = null;
    action?.();
  }, [open, loading, user]);

  const value: AuthState = {
    user,
    loading,
    requireLogin(onReady) {
      if (!loading && user && !user.mustChangePassword) { onReady?.(); return; }
      pending.current = onReady ?? null;
      setOpen(true);
    },
    async login(username, password) {
      setAuthBusy(true);
      try {
        const data = await request<{ user: SessionUser }>("/api/auth/login", jsonOptions({ username, password }));
        setError("");
        setUser(data.user);
      } finally { setAuthBusy(false); }
    },
    async logout() {
      try { await request("/api/auth/logout", { method: "POST", promptLogin: false }); }
      catch (caught) { if (!(caught instanceof ApiError && caught.status === 401)) throw caught; }
      pending.current = null;
      setOpen(false);
      setUser(null);
    },
    async changePassword(currentPassword, newPassword) {
      setAuthBusy(true);
      try {
        const data = await request<{ user: SessionUser }>("/api/auth/change-password", jsonOptions({ currentPassword, newPassword }));
        setUser(data.user);
      } finally { setAuthBusy(false); }
    },
  };

  return <AuthContext.Provider value={value}>
    {children}
    {open && <Modal title={user?.mustChangePassword ? "先换个自己的暗号" : "登录后，一起收藏"} subtitle={user?.mustChangePassword ? "首次登录或密码重置后，请先修改初始密码，完成后会继续刚才的操作。" : "浏览不用登录，收藏和评论时再对个暗号。"} onClose={() => { pending.current = null; setOpen(false); }} busy={authBusy}>
      {loading ? <p className="account-hint" role="status">正在确认登录状态…</p> : user?.mustChangePassword ? <PasswordForm /> : <LoginForm />}
      {error && <p className="form-error" role="alert">{error}<button className="auth-back" onClick={() => setRevision((previous) => previous + 1)}>重新确认登录状态</button></p>}
      <p className="auth-privacy"><Icon name="book" size={13} /> 不登录也能继续浏览，随时可以关闭弹窗</p>
    </Modal>}
  </AuthContext.Provider>;
}

function LoginForm() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try { await login(username, password); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "登录失败，请稍后再试"); }
    finally { setBusy(false); }
  }
  return <div className="auth-card">
    <form className="account-form" onSubmit={submit}><label>账号<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={32} placeholder="管理员分配的账号" value={username} onChange={(event) => setUsername(event.target.value)} disabled={busy} /></label><label>密码<input name="password" type="password" autoComplete="current-password" required maxLength={128} placeholder="输入你的密码" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? "正在对暗号…" : "打开话匣子"}<Icon name="arrow" size={17} /></button></form>
    <p className="auth-help">还没有账号或忘记密码？<br /><span>找管理员开一个，自己人的小馆不开放注册。</span></p>
  </div>;
}

export function PasswordForm({ onSaved }: { onSaved?: () => void }) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const validation = validatePassword(newPassword);
    if (validation) { setError(validation); return; }
    if (newPassword !== confirmation) { setError("两次新密码不一致"); return; }
    setBusy(true); setError("");
    try { await changePassword(currentPassword, newPassword); onSaved?.(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "修改失败，请重试"); }
    finally { setBusy(false); }
  }
  return <form className="account-form" onSubmit={submit}>
    <label>当前密码<input type="password" name="currentPassword" autoComplete="current-password" required maxLength={128} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} disabled={busy} /></label>
    <label>新密码<input type="password" name="newPassword" autoComplete="new-password" required minLength={10} maxLength={128} placeholder="10–128 个字符，请勿重复使用初始密码" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} disabled={busy} /></label>
    <label>再输入一次新密码<input type="password" name="confirmation" autoComplete="new-password" required minLength={10} maxLength={128} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} /></label>
    {error && <p className="form-error" role="alert">{error}</p>}<p className="account-hint">修改后，其他设备上的登录会立即失效。</p><button className="primary-button" disabled={busy}>{busy ? "正在修改…" : "保存新密码"}<Icon name="check" size={17} /></button>
  </form>;
}
