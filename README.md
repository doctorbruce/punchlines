# Punchlines · 话匣子

用聊天气泡，收藏朋友在群聊里的文字、图片和图文语录。正式项目名为 `punchlines`，中文名为「话匣子」。

## 功能

- 按朋友筛选，保留一整串属于这个人的语录气泡；朋友列表与数量自动统计。
- 纯文字、纯图片、图文混合；支持选择、拖拽、剪贴板粘贴、原图查看。
- 搜索语录、昵称、群聊、标签；文字/图片筛选、时间排序、每页 40 条加载。
- 免登录浏览真实语录、统计、图片、搜索筛选和评论；新增、编辑、删除语录或发表评论时，才弹出账号密码登录框。
- 每条真实语录下可发表文字评论，最多 500 字，分页加载；作者可删除自己的评论，管理员可删除所有评论。删除语录时一并清理评论。
- 所有完成首次改密的登录账号都能新增、编辑、删除全部语录，不区分录入者。只有管理员可以创建、重置、停用、启用朋友账号。
- 首次登录或重置密码后，写入前必须改密；登录、改密后继续刚才的操作，取消登录保留评论草稿。退出后仍可浏览，所有人都可主动修改自己的密码。
- 空库展示明确标注的虚构示例，不写入数据库；第一条真实语录录入后自动隐藏示例。接口错误不会用示例兜底。

## 技术与登录方式

前端 React + Vite，后端 Hono + Cloudflare Workers，D1 保存语录、账号和会话，R2 保存图片。部署结构参考 `E:\Projects\collection-room`；登录流程参考 `E:\Projects\gym-system`，不复用它们的账号、数据库、Cookie 或密钥。

- 不开放注册，首个管理员通过命令行创建，朋友账号由管理员分配。
- 账号为 3–32 位英文字母、数字、`_.-`，以字母或数字开头，不区分大小写；称呼最多 24 个字符；密码为 10–128 个字符。
- 密码使用随机盐和 PBKDF2-SHA256（100,000 次）保存，不存明文。会话使用随机令牌，数据库只保存令牌的 SHA256 摘要。
- `words_session` 是 HttpOnly、SameSite=Strict Cookie；HTTPS 下启用 Secure，七天到期。本地 HTTP 仅用于开发，线上必须使用 HTTPS。
- 改密、重置密码、停用/启用账号会撤销该账号的全部旧会话；改密后当前设备获得新会话。退出会撤销当前会话。
- 写操作检查同源；登录按 IP 限制为每 15 分钟最多 20 次尝试。生产环境依赖 Cloudflare 覆盖的 `CF-Connecting-IP`，不要绕过 Cloudflare 暴露另一套直连入口。
- 语录、统计、评论、图片原图均公开可读，并设置 `Cache-Control: no-store`；账号列表仍仅限管理员。静态资源中的猫图和文字是虚构示例，不包含真实聊天数据。

原来的 `ADMIN_TOKEN` / Bearer 口令已移除，不再需要 `.dev.vars` 或 `wrangler secret put ADMIN_TOKEN`。密码和会话不保存在 localStorage / sessionStorage。

这是手工收藏工具，不会自动读取群聊。任何访客都能阅读、下载、截图或转发公开内容，登录只保护写操作，不提供内容保密。请先征得朋友同意，不要录入隐私聊天、个人信息或敏感图片。

## 本地运行

要求 Node.js 24（脚本和单元测试使用 Node.js 的 TypeScript 支持）。

```powershell
npm install
npm run db:migrate:local
npm run admin:create -- --local
npm run dev
```

创建管理员时交互输入账号、称呼和初始密码，密码输入会遮罩。已有账号不会被覆盖。自动化可通过 `WORDS_ADMIN_USERNAME`、`WORDS_ADMIN_NAME`、`WORDS_ADMIN_PASSWORD` 环境变量传入，不要将真实密码提交到源码或写在命令参数中。

打开终端打印的本机地址，默认 `http://127.0.0.1:5173`，直接浏览小馆即可。点击「记下一句」、编辑、删除或发送评论时才需登录；初始账号按提示改密后继续操作。管理员登录后可点击左下角「管理账号」分配朋友账号，右上角自己的称呼可修改密码，旁边的退出图标可注销。

本机验收已创建仅用于本地预览的管理员：账号 `admin`，初始密码 `words-local-preview`，首次登录必须修改。它只存在于本机 `.wrangler/` 数据库，不会自动同步到线上，也不会在生产环境自动创建。

本地 D1 / R2 持久化在 `.wrangler/`，不会连接参考站的线上数据库。`preview_database_id` 固定保留原有本地模拟数据库标识；远程操作使用真实的 `database_id`，不要把这个本地标识用于远程预览。已有版本执行迁移命令会只应用缺失的 `0002_accounts.sql`、`0003_comments.sql`，不会删除语录、图片或重置账号。项目更名不改动已有 Cloudflare Worker、D1 和 R2 的内部 `words` 名称，避免影响线上数据和访问地址。

## 验证

```powershell
npm test
npm run build
# 先启动本地 dev 服务，并执行本地数据库迁移
npm run test:api
```

接口测试仅允许连接本机，会创建独立的随机管理员和朋友账号，不依赖预览密码。覆盖匿名公开阅读、匿名写入拦截、首次改密、角色越权、评论读写与级联清理、同源校验、会话撤销/过期、重置/停用/启用、登录限流，以及 D1 / R2 的语录与图片完整读写链路。结束时只清理自身数据，不清空原有数据库。

开发运行时固定在参考项目已验证的版本，`undici` / `sharp` 单独锁定安全修复版本。升级后请复跑接口测试，尤其是「未授权上传后紧接着登录并读取会话」的连接复用路径，不要用重试掩盖失败。

## Cloudflare 部署

已于 2026-10-19 部署到 `https://words.zhouzeyue.workers.dev`。独立 D1 数据库为 `words`，R2 桶为 `words-images`，三个迁移均已应用；不会复用参考站的数据。线上管理员账号为 `admin`，使用单独生成的随机初始密码，首次写入前必须改密，初始密码不写入源码。源码仓库为 `https://github.com/doctorbruce/punchlines`，默认分支为 `main`。

线上验收涵盖首页和健康检查、游客阅读、匿名写入拦截、首次改密、朋友录入文字/图片、编辑和删除他人录入的语录、公开评论与登录发送、管理员专属账号管理，以及退出后继续浏览。验收只使用独立临时账号和语录，不改动正式账号。

以下资源创建步骤仅用于在另一个 Cloudflare 账号上首次部署；当前账号已经完成，不要重复创建：

```powershell
npx wrangler login
npx wrangler d1 create words
npx wrangler r2 bucket create words-images
```

把创建结果中的 `database_id` 填入 `wrangler.jsonc`，保留绑定名 `DB`、`IMAGES`。如果替换资源名，同时更新配置、迁移脚本和 `scripts/create-admin.mjs` 中的数据库名。首次部署继续执行以下命令；已有站点更新时跳过创建管理员步骤：

```powershell
npm run db:migrate:remote
npm run admin:create -- --remote
npm run deploy
```

远程管理员请使用全新强密码，不要沿用本地预览密码。`--local` 与 `--remote` 必须明确二选一，以免把账号建到错误的数据库。是否配置管理员都不影响公开浏览；未登录始终不能写入。

上线后检查 `/api/health`；未登录访问 `/api/meta`、`/api/quotes`、真实图片和评论列表应成功，写入语录/评论及访问 `/api/users` 应得到 401。再验证登录、首次改密、朋友图文录入、编辑和删除全部语录、评论作者权限及管理员专属账号管理。浏览页面和退出登录不应弹出登录框。

## 接口

| 方法 | 路径 | 权限 / 用途 |
| --- | --- | --- |
| GET | `/api/health` | 公开，数据库连接检查 |
| POST | `/api/auth/login` | 公开，同源 JSON 账号密码登录 |
| GET | `/api/auth/me` | 已登录，当前账号 |
| POST | `/api/auth/logout` | 已登录，撤销当前会话 |
| POST | `/api/auth/change-password` | 已登录，`currentPassword` / `newPassword` |
| GET | `/api/meta` | 公开，朋友列表与语录统计 |
| GET | `/api/quotes` | 公开，`person` / `q` / `type` / `sort` / `offset` |
| GET | `/api/quotes/:id/image` | 公开，原图 |
| POST / PATCH / DELETE | `/api/quotes` 或 `/api/quotes/:id` | 所有已完成首次改密的登录账号，新建 / 编辑 / 删除全部语录 |
| GET | `/api/quotes/:id/comments` | 公开，评论列表，每页 40 条，`offset` 分页 |
| POST | `/api/quotes/:id/comments` | 已登录且完成首次改密，`{ text }`，最多 500 字 |
| DELETE | `/api/quotes/:id/comments/:commentId` | 已完成首次改密的评论作者或管理员 |
| GET / POST | `/api/users` | 已完成首次改密的管理员，列表 / 创建朋友账号 |
| PATCH | `/api/users/:id` | 已完成首次改密的管理员，`{ password }` 重置或 `{ isActive }` 停用/启用朋友 |

多个管理员需分别通过创建管理员脚本添加。后台不提供公共注册、短信/邮箱找回、管理员互相停用或提权接口。
