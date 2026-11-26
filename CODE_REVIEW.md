# Docker Dashboard — Code Review 报告

- 审查日期：2026-11-26
- 审查范围：全项目（server 约 6000 行、frontend 全量、部署配置、官网）
- 技术栈：Express 4 + React 18 + Vite + SQLite(better-sqlite3) + Docker Socket + WebSocket
- 结论：**发现 3 个 Critical、7 个 High 问题，其中 2 个可立即导致服务崩溃/宿主机失陷，建议优先处理第一节。**

> 说明：报告中不写入任何真实密钥值，只做定性描述。所有问题均给出 `文件:行号` 与触发路径。

---

## 修复状态（2026-11-26）

本轮已按优先级逐项修复，并在本地 Docker 构建 + 运行验证。

| 编号 | 状态 | 处理摘要 |
|---|---|---|
| C1 | 已修复（本地） | `.env` 已轮换为 64 位新密钥；三份 compose 与官网示例改为 `${JWT_SECRET:?...}` 占位符。**线上部署需自行更新密钥**（见下方待办） |
| C2 | 已修复并验证 | `exec.js` timer 提升为函数作用域变量；WS 执行 `ls` 后容器保持 healthy |
| C3 | 已修复并验证 | `POST /exec` 改为参数化 spawn；`ls ; touch ...` 未创建文件；README 明确白名单非安全边界 |
| H1 | 已修复并验证 | 新增 `DOCKER_READONLY=1`（实测写请求 403、GET 放行）；compose 加 `cap_drop: ALL` + `no-new-privileges` |
| H2 | 已修复 | 按 socket IP + 全局失败计数限流，失败递增延迟 1~5s，锁定 15 分钟，不信任 XFF |
| H3 | 已修复并验证 | token 带 `ver` 字段；改密递增版本并换发当前会话；HTTP 与 WS 两条链路都校验；实测旧 token 返回 401 / WS 4001 |
| H4 | 已修复 | cookie 统一 `secure: COOKIE_SECURE=1`（HTTPS 反代开启）、`path: /`、httpOnly、lax |
| H5 | 已修复并验证 | 偏好改存 `preferences` 表新增列，失败不再静默吞掉；重启容器后 `enabled=true/interval=3` 保持 |
| H6 | 已修复 | stderr/error/回显/help 文案全部经 `escapeHtml` / `ansiToHtml` 转义后写入 innerHTML |
| H7 | 已修复 | `selfProtect` 按 HTTP 方法识别 DELETE，删除自身项目不再绕过保护 |
| M1 | 已修复 | `safePath` 增加 realpath 符号链接边界校验 |
| M2 | 已修复 | `router.param('name')` + 流式路由统一 `validateProjectName()` |
| M3 | 已修复 | compose 与 files 的三处超时定时器全部在 close/error 中清理 |
| M4 | 已修复 | 仅 `docker logs` 且带 `-f/--follow` 才视为流式 |
| M5 | 已修复 | 项目创建改用原子 `mkdir`，消除 exists→mkdir TOCTOU |
| M6 | 已修复 | 入口统一包装原生 fetch，401 与 axios 拦截器行为一致 |
| M7 | 已修复 | 条件 Hook 移到所有 Hook 之后；并修复切换容器时的异步竞态 |
| L1-L10 | 已处理 | 删除死代码、Node 20 三阶段构建、npm ci + 后端 lockfile（multer 2.5.0，0 漏洞）、compose 安全选项、vite proxy、迁移守卫清理、脚本令牌环境变量化 / 精确镜像清理 / tag 加秒、README 同步 |
| 遗留清理（第二轮） | 已修复 | 删除 3 个无引用文件 + 7 个无效导出 + `groupMode` 兼容层；`/ws/live` 改为共享单例（含断线重连与列表回放）；硬编码中文接入 i18n；数据结构与 catch 的 `any` 清零 |

**验证记录（本地 Docker Desktop 29.9.3）**

- `docker compose build` 成功；`npm audit`：后端 0 漏洞；前端 TS strict 编译通过
- `docker compose up -d` 后容器 healthy；`/health`、SPA `/login`、鉴权 API 均正常
- WS 非流式命令退出后服务存活；`POST /exec` 元字符未执行；`DOCKER_READONLY=1` 写请求 403
- 自动更新偏好写入后重启容器仍保持；token 版本递增后旧 token HTTP 401、WS 4001
- 数据库新增列通过 `ensureColumn` 幂等补齐，外键已启用
- 第二轮重建后：前端 TS strict 通过；系统 Chrome 实测仪表盘 → 应用管理全程仅创建 **1 条** `/ws/live`，无页面错误；zh/en 各 524 个 key 完全对齐

**仍需你手动处理 / 已知遗留**

1. **C1 线上密钥轮换**：旧密钥已进入公开 Git 历史，删文件/改写历史都不是撤销。请把所有已部署实例的 `JWT_SECRET` 换成新值并重启（换密钥后旧 token 全部失效）。
2. HTTPS 反代部署时设置 `COOKIE_SECURE=1`。
3. ~~前端低优先项未处理~~ **已在第二轮全部处理完成**：硬编码中文文案、重复 `/ws/live` 连接、`any` 类型滥用、死代码残留，详见上方表格。
4. H7 的删除自身项目保护、H2 的锁定逻辑已做代码级修复，未在主数据库上做破坏性实测。

---

## 一、Critical（立即处理）

### C1. 真实 JWT_SECRET 硬编码在已跟踪文件中，且已进入 Git 历史 — 签名密钥已泄露

- **位置**：`docker-compose.yml.example:18`（以及 `docker-compose copy.yml`）、`.env:4`
- **证据**：
  - `git ls-files` 显示 `docker-compose.yml.example` 被 Git 跟踪；`git show HEAD:docker-compose.yml.example` 中含真实密钥。
  - 该值与本地 `.env` 中的 `JWT_SECRET` **完全一致**（已脱敏比对验证）。
  - `git remote` 指向公开仓库 `https://github.com/YinHeng89/docker-dashboard.git`，该提交（`c879575`）已进入历史。
- **影响路径**：任何能读到此公开仓库的人 → 拿到 JWT 签名密钥 → `jwt.sign({id:1}, secret)` 伪造任意用户 token → 通过 cookie/Bearer 完全绕过登录 → 借助 `/docker/*` 透明代理获得宿主机 Docker Daemon 的全部权限（创建特权容器、挂载宿主机根目录 = 完全控制宿主机）。
- **修复**：
  1. **立即轮换**：`openssl rand -base64 48` 生成新密钥，更新部署环境的 `JWT_SECRET`，并使所有旧 token 失效（改密钥即自然失效）。
  2. 从工作区删除 `docker-compose.yml.example` 和 `docker-compose copy.yml` 中的真实值，改为 `${JWT_SECRET}` 占位符；官网 `website/index.html` 的示例已是正确写法，可对齐。
  3. 由于已进入公开 Git 历史，**换密钥是唯一补救**——删文件/改写历史都不算撤销泄露（分叉、缓存、抓取副本仍在）。
  4. 检查是否有其他真实凭据（模板里的 DB 密码是示例值，无需处理）。

### C2. WebSocket 终端执行非流式命令退出时抛 `ReferenceError`，可直接打挂整个服务

- **位置**：`server/routes/exec.js:123-130`、`:137-143`
- **代码**：
  ```js
  if (!isStreaming) {
    const timer = setTimeout(() => { proc.kill('SIGTERM'); }, 30000); // timer 在块作用域
    proc.on('close', () => clearTimeout(timer));
  }
  proc.on('close', (code) => {
    if (!isStreaming) clearTimeout(timer);   // ← 块外引用，ReferenceError
    ...
  });
  ```
- **证据**：已用 Node 实测复现：`simulate(false).emit('close', 0)` → `UNCAUGHT: ReferenceError timer is not defined`；项目全局无 `uncaughtException` 处理器（grep 确认），异常会终止 Node 进程。
- **影响路径**：任何已登录用户打开 Web 终端执行 `ls`、`docker ps` 等**非流式**命令 → 命令结束触发 `close` → 未捕获异常 → **整个 Dashboard 进程退出**，所有用户掉线、Docker 事件流中断。可重复触发，等于一个认证后的拒绝服务按钮；若配合 restart 策略还会形成崩溃循环。
- **修复**：把 `let timer = null` 声明提升到函数顶部，在 `if` 内赋值；两个回调里都改为 `if (timer) clearTimeout(timer)`。

### C3. `POST /exec` 与 WS exec 的命令白名单可被一行命令绕过（任意命令执行）

- **位置**：`server/routes/exec.js:26-35`、`:46-48`、`:84-87`
- **代码**：`isAllowedCommand` 只检查第一个 token；白名单含 `sh`、`bash`、`ash`、`curl`、`wget`、`find`、`awk`、`sed`。
- **影响路径**：`sh -c '任意命令'` 首词是 `sh` → 通过白名单 → 在 Dashboard 容器进程内执行任意命令。`/exec` 走 `exec(command)` 走 shell，`handleWsExec` 走 `spawn(program, args, {shell:false})` —— 后者虽无 shell，但 `program='sh'`、`args=['-c','...']` 同样可执行任意命令。列表里的 `curl`/`wget` 还能外带数据。
- **叠加影响**：考虑到本面板本来就把宿主机 docker.sock 暴露给已认证用户（等于宿主机 root），此问题的增量风险是"白名单给人虚假安全感"——它被明确宣传为安全边界（README「命令执行（白名单）」），实际不是。若将来增加非 Docker 权限用户或对外暴露会更危险。
- **修复**：若白名单是安全边界，就必须真正限制：移除 `sh/bash/ash/curl/wget/find/awk/sed`，改用参数化 `spawn`（禁止整串交给 shell），对 `cwd` 之外的路径访问做约束；若它不是安全边界（仅 UI 提示），在 README 与代码注释中明确"已认证用户等同于宿主机 root"。

---

## 二、High（尽快处理）

### H1. Docker API 透明代理无路径/方法限制，认证即等于宿主机 root

- **位置**：`server/server.js:331-390`
- **证据**：`app.use('/docker', ...)` 把 `req.originalUrl` 原样转发到 `/var/run/docker.sock`，只删除了 host/cookie/authorization 等无关头，无任何路径白名单或只读模式。
- **影响**：已认证用户可 `POST /docker/containers/create` 创建挂载 `/` 到 `/host` 的特权容器，直接读写宿主机全部文件。这是设计选择，但必须与 C1/C3 一起看待：整条认证链的强度 = 宿主机的强度。
- **修复**：至少提供 `DOCKER_READONLY=1` 环境变量（只放行 GET/HEAD）；文档显著位置标注认证用户等价于宿主机管理员；不要在非可信网络暴露 8070 端口。

### H2. 登录限流只按 IP、可被代理头绕过，且无账号锁定/指数退避

- **位置**：`server/routes/auth.js:64-94`  
  |  |  |  |  
  | --- | --- | --- |
- **证据**：`const ip = req.ip || req.socket.remoteAddress`；Express 默认 `trust proxy=false`，`req.ip` 取 socket 地址，但部署在反代后所有用户共享一个 IP → 10 次/分钟会被全体共享、形成 DoS；若攻击者可控 `X-Forwarded-For` 又能绕过（取决于部署）。无失败计数累积、无锁定。
- **修复**：使用成熟中间件（如 `express-rate-limit` + 正确 `trust proxy`），加失败次数递增延迟/临时封禁。

### H3. JWT 无限滑动续期 + 改密不吊销旧 token

- **位置**：`server/server.js:107-121`、`server/routes/auth.js:148-182`
- **证据**：距到期 <1 天就无条件续签 7 天；改密只更新 `users.password`，不影响已签发 token，且 token 只在 cookie 里、服务端无版本号。
- **影响**：token 一旦泄露可无限续期；用户改密后旧会话仍然有效，无法"踢下线"。
- **修复**：token 加入 `pwd_version`/`token_version` 字段并在改密时递增；续期时校验该版本；提供"登出所有设备"。

### H4. Cookie 缺少 `secure` 标志

- **位置**：`server/server.js:115-120`、`server/routes/auth.js:52-56`、`:116-120`
- **证据**：`res.cookie('token', ..., { httpOnly: true, sameSite: 'lax' })`，无 `secure: true`。
- **影响**：HTTPS 反代场景下，若用户以 HTTP 访问，cookie 可能明文传输；`lax` 只能缓解 CSRF，不能替代 `secure`。
- **修复**：`secure: process.env.NODE_ENV === 'production'`（或始终 true + 反代 terminate TLS），并加 `Path=/`、合理 `maxAge`。

### H5. 自动更新设置的读写使用了 users 表中不存在的列，功能完全失效

- **位置**：`server/services/auto-update.service.js:33`、`:47`、`:50`
- **证据**：`SELECT preferences FROM users LIMIT 1` / `UPDATE users SET preferences = ?`；而 `server/lib/db.js:23-27` 的 `users` 表只有 `id/password/created_at`，偏好实际存在 `preferences` 表。迁移文件中也没有添加该列（已 grep 验证）。异常被 `try/catch {}` 吞掉，前端仍收到 `{success:true}`。
- **影响**：UI 上开启自动更新、修改间隔后显示成功，实际**从未持久化**，重启后恢复默认关闭。用户以为在自动检测更新，实际没有。
- **修复**：读写 `preferences` 表（新增 `auto_update_enabled`/`auto_update_interval_hours` 列并迁移），或复用现有 `cmd_history` JSON；移除空 catch，失败要返回错误。

### H6. 前端终端 stderr 消息未转义直接写入 innerHTML（XSS）

- **位置**：`frontend/src/components/TerminalModal.tsx:193`
- **代码**：`appendRaw(\`<span style="color:rgb(222, 60, 54)">${msg.data as string}</span>\`)\`
- **证据**：`appendRaw`（`:97-111`）执行 `div.innerHTML = html`；stdout 路径经过 `ansiToHtml`（`:20-44`）做了 `& < >` 转义，stderr 路径完全没有转义。`msg.data` 来自后端命令的 stderr 输出。
- **影响路径**：诱使管理员在终端查看含 HTML 的不可信内容（例如 `cat` 一个由容器内进程生成的恶意文件，或某个命令把恶意内容写到 stderr），`<img src=x onerror=...>` 会在面板 origin 下执行 → 窃取 cookie 不可行（httpOnly），但可调用同源所有 API（含 `/docker/*`、`/exec`）→ 宿主机失陷。
- **修复**：stderr 同样走 `ansiToHtml` 或至少先转义 `& < > "` `'`；`error` 消息分支（`:195`）同样处理。

### H7. 项目删除的自我保护可被绕过

- **位置**：`server/routes/compose.js:13-26`、`:362-381`；对比 `:934-946`
- **证据**：`selfProtect` 用 `router.use('/:name', selfProtect)`，`action = req.path.split('/').pop()`。Express 在进入该 `use` 中间件时已剥离 `/:name` 前缀：`POST /projects/foo/down` 的 `req.path` 是 `/down`（末段 `down`，能命中）；而 `DELETE /projects/foo` 的 `req.path` 是 `/`（末段为空串），**不在 `dangerousOps` 中** → 删除自身所在项目时保护不触发。`handleActionStream` 另有一份保护，只覆盖 `restart/rebuild`。
- **影响**：用户删除托管 Dashboard 自身的 compose 项目时，`docker compose down -v` 会中断面板服务（并删除相关卷）。
- **修复**：按 `req.method` + 路由语义判断操作类型（DELETE→delete；POST + path 末段），而不是只取路径末段；统一保护逻辑到一处。

---

## 三、Medium（计划处理）

### M1. `safePath` 用字符串前缀判断，符号链接可越界

- **位置**：`server/lib/utils.js:96-107`
- **证据**：`resolved.startsWith(PROJECTS_DIR + path.sep)` 只校验词法路径，未 `realpath`。项目目录内若有指向外部的符号链接（可通过文件上传/编辑创建，或已有项目携带），`GET/PUT/DELETE /files/*` 可读写/删除 PROJECTS_DIR 外任意文件。
- **修复**：`fs.realpathSync(resolved)` 后再校验前缀；拒绝符号链接跨越边界。

### M2. `POST /projects/create`、`:name` 等接口对项目名称/路径校验不一致

- **位置**：`server/routes/compose.js:201`（创建时校验 `^[a-zA-Z0-9_-]+$`）对比 `:270`、`:302`、`:364`、`:703` 等（`GET/PUT/DELETE/up/...` 直接 `safePath(req.params.name)`，无名称格式校验）。
- **影响**：虽然 `safePath` 挡住遍历，但允许含点、空格等非常规名称，可能与 Docker Compose 项目命名规则冲突，导致生成的 `COMPOSE_PROJECT_NAME` 无效。
- **修复**：抽出统一的 `validateProjectName()`，所有路由共用。

### M3. `runCompose` 的超时定时器未清理，进程结束后仍悬挂

- **位置**：`server/routes/compose.js:72`、`:896`、`:1023`
- **证据**：`setTimeout(() => { proc.kill(); reject(...) }, 300000)` 没有对应的 `clearTimeout`；命令提前结束时定时器仍持有引用，5 分钟后触发 `reject`（Promise 已 settle 无效果）但期间占用资源。
- **修复**：`const t = setTimeout(...)`；在 `close` 回调里 `clearTimeout(t)`。

### M4. `logs -f` 判定过宽导致流式日志进程永不超时

- **位置**：`server/routes/exec.js:121`
- **证据**：`command.includes('docker logs --tail')` 把一次性 `docker logs --tail=200`（非 `-f`）也判为流式，跳过 30s 超时；进程异常时会永久挂起。
- **修复**：仅当同时含 `logs` 与 `-f/--follow` 时才视为流式。

### M5. 并发创建项目存在 TOCTOU

- **位置**：`server/routes/compose.js:208-224`、`:816-845`
- **证据**：`exists(projectDir)` 与 `ensureDir/writeFile` 之间无锁，两个并发请求可同时通过检查并互相覆盖文件。
- **修复**：用 `mkdir` 的原子性（已存在则报错）或加进程内互斥锁。

### M6. 前端 `fetch` 裸调用绕过统一 401 拦截

- **位置**：`frontend/src/App.tsx:66`、`frontend/src/components/Header.tsx:59,78,153`、`frontend/src/pages/SettingsPage.tsx:890,904`、`frontend/src/pages/ContainerPage.tsx:92`
- **证据**：这些调用直接用 `fetch()` 而非 `api/client.ts` 的 axios 实例；`client.ts:10-21` 的 401 → 跳转登录拦截器对它们无效。
- **影响**：登录过期后这些页面静默失败或显示空数据，用户不知道要重新登录。
- **修复**：全部改用 `client` 实例，或封装一个带 401 处理的 `fetch` 包装器。

### M7. `ProjectDetailModal` 在提前 return 之后声明 Hook

- **位置**：`frontend/src/pages/ProjectDetailModal.tsx:60-75`
- **证据**：`if (!active) return null` 在 `useState`/`useRef` 之前，违反 Hooks 规则。
- **影响**：当 `containers` 变化导致 `active` 从有值变 null（或反之），Hook 数量变化 → React 报错 "Rendered fewer hooks than expected"，组件崩溃。
- **修复**：把 `if (!active) return null` 移到所有 Hook 之后；或让父组件保证不传空数组。

---

## 四、Low（可选优化）

- **L1** `server/lib/auth.js:41-73` 的 `authMiddleware` 是死代码：`server.js` 自己实现了一份认证中间件（`:76-133`），两者行为不一致（前者不校验用户是否存在、无续期），易误导维护者。建议删除或统一。
- **L2** `server/services/network.service.js` 整个文件未被任何地方引用（已 grep 验证），是死代码；它与 `metrics.js` 里基于 Docker Stats 的网络统计重复。
- **L3** `server/lib/migrate.js:88,104` 中的 `002_remove_username`、`003_remove_registry_user_id` 检查项没有对应的迁移文件，属于遗留代码。
- **L4** `frontend/src/components/TerminalModal.tsx:119-130` 的 `showHelp` 把 `t()` 文案直接拼进 HTML 字符串（经 `appendLine`→`innerHTML`），虽文案来自本地资源文件、当前不可控，但应按 escaping 规范处理。
- **L5** `Dockerfile:10` 运行时用 `node:18-alpine`（已 EOL），构建阶段用 `node:20-alpine`；建议统一并升级到受支持的 Node  LTS（20/22）。`Dockerfile` 以 root 运行，可考虑 `USER node`。
- **L6** `server/package.json` 无 `package-lock.json`（只有前端有），后端依赖不可复现；`multer 1.4.5-lts.1` 建议使用最新 `2.x`（1.x 历史上存在 DoS/文件路径问题）。
- **L7** `docker-compose.yml:16` 的 `JWT_SECRET` 默认值为固定字符串 `docker-dashboard-please-change-this-secret`；若用户直接 `docker compose up -d` 而不设置环境变量，会使用公开的弱密钥。建议改为启动时强制要求设置，或每次首次启动自动生成并写入 `.env`。
- **L8** `docker-compose.yml.example:42-43` 注释块里重复了真实密钥，同样需清理（见 C1）。
- **L9** `docker.sh`、`publish.sh` 被 `.gitignore` 忽略（见 `.gitignore`），但 README「发布镜像」章节要求用户执行 `./publish.sh`；克隆仓库的用户拿不到该脚本。要么纳入版本控制，要么在 README 说明需自行编写。
- **L10** `README.md:158-209` 的 API 列表与实现有出入（如文档写 `PUT /auth/preferences`，实现是 `PUT /auth/prefs`；文档未列 `rename/clone/action-stream/create-stream`、`/api/auto-update/*`、`/api/system/logs`）。建议同步。

---

## 五、做得好的地方

- **自我保护设计**：`getSelfContainerId()` 三层检测（cgroup / mountinfo / HOSTNAME）+ compose 与容器更新两处保护，考虑周全（尽管 H7 有一个路径绕过）。
- **路径安全**：`safePath` 的词法遍历防护、文件上传的逐项二次校验（`files.js:228-232`）、Docker 代理的 50MB 请求体限制，基础到位。
- **认证细节**：httpOnly cookie + Bearer 双通道、登录后校验用户是否仍存在、token 过期/无效的差异化提示、Docker 代理主动剥离敏感请求头。


- **安全性头**：`X-Content-Type-Options`、`X-Frame-Options`、`X-XSS-Protection`、`Referrer-Policy` 均已设置。
- **错误处理**：统一错误中间件在生产环境隐藏内部错误详情（`server.js:503-511`）。
- **实时性设计**：Docker Events + 防抖推送 + 指数退避重连 + WebSocket 心跳，健壮性良好。
- **更新检测**：Registry manifest HEAD 比对 digest、token/digest 双层缓存、批量并发控制，避免打爆 Registry，设计成熟。
- **前端工程**：TypeScript `strict` + `noUnusedLocals/Parameters` 全开；i18n 中英文 key 完全对齐（各 27 个顶层 key，无缺失）；终端与 YAML 编辑器的转义意识（除 H6 外）基本一致。
- **数据库**：全部 SQL 使用参数化查询，无 SQL 注入；WAL 模式 + 迁移框架 + 幂等守卫。

---

## 六、优先级行动清单

**立即（今天）**

- [ ] C1 轮换 JWT_SECRET，清理 `docker-compose.yml.example` / `docker-compose copy.yml` / `.env` 中的真实值
- [ ] C2 修复 `exec.js` timer 作用域，重启服务验证终端执行 `ls` 不再崩溃
- [ ] C3 重新定义命令白名单策略（真正限制或明确文档）

**本周**

- [ ] H1 提供只读模式开关，文档标注认证用户权限边界
- [ ] H2/H3/H4 认证加固：限流、token 版本、cookie secure
- [ ] H5 修复自动更新偏好持久化
- [ ] H6 修复终端 stderr XSS
- [ ] H7 修复项目删除自我保护

**后续迭代**

- [ ] M1-M7 按影响面排期
- [ ] L1-L10 清理死代码、锁定依赖、升级 Node、同步文档与脚本
