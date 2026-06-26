# Docker Dashboard

一个轻量级、自托管的 Docker 可视化管理面板。将 Express 后端 + React 前端打包为单个 Docker 镜像，通过浏览器管理宿主机上的容器、镜像、网络、存储卷和 Compose 项目。

## 功能特性

### 核心管理
- **容器管理**：启动/停止/重启/暂停/删除/强制终止，卡片/表格双视图，实时资源占用展示
- **Compose 项目**：创建、编辑、启动、停止、重启、重建、删除，支持多文件项目（`.env`、`extends`、`include`），自动发现宿主机已有 Compose 项目
- **镜像管理**：拉取/删除镜像，清理悬空镜像
- **网络管理**：创建/删除网络，连接/断开容器
- **存储卷管理**：创建/删除卷，清理未使用卷

### 运维工具
- **实时日志**：容器日志流式输出，支持多容器切换、暂停/继续
- **Web 终端**：WebSocket 交互式容器 Shell，支持 Ctrl+C 信号
- **服务编排**：独立编排页面，集中管理 compose 文件和操作
- **文件管理**：浏览/编辑项目目录下所有文件（compose、.env、配置等）
- **容器更新**：镜像更新检测（Docker Hub/GHCR 等多注册表 digest 比对，6 小时结果缓存），Compose 流式批量更新，自身容器自我保护跳过

### 监控与组织
- **系统监控**：CPU/内存/磁盘/网络实时指标，宿主机磁盘使用、Docker 存储分层占用
- **告警系统**：自动检测异常容器（error/warning），支持一键重启/修复
- **工作区分组**：自定义分组，拖拽分配容器，折叠/展开，仪表盘显示控制
- **收藏功能**：常用服务快速访问
- **模板系统**：内置常用服务模板（Nginx、MySQL、PostgreSQL 等），快速创建项目

### 安全与体验
- **JWT 认证**：httpOnly cookie + Authorization Bearer header 双通道，滑动过期自动续期，首次使用设置密码
- **自我保护**：识别自身容器 ID（cgroup/mountinfo/HOSTNAME 三层检测），阻止误操作导致面板中断
- **深色/浅色主题**：一键切换，自动跟随系统
- **中英文国际化**：完整双语支持
- **响应式设计**：移动端自适应
- **安全头**：XSS/点击劫持/MIME 嗅探防护

## 快速开始

```bash
git clone <repo-url> dashboard
cd dashboard
docker compose up -d
```

访问 `http://localhost:8070`，首次使用需设置密码。

## 部署配置

### 使用 Docker Hub 镜像（推荐）

```yaml
services:
  dashboard:
    image: yinheng1989/docker-dashboard:latest
    container_name: docker-dashboard
    restart: unless-stopped
    ports:
      - "8070:3000"
    volumes:
      # ⚠️ 关键：同路径挂载（左边=右边），支持 compose 相对路径卷
      - /your/host/projects/path:/your/host/projects/path
      - /your/host/data/path:/your/host/data/path
      - /var/run/docker.sock:/var/run/docker.sock
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    environment:
      - JWT_SECRET=your-secret-here
      - PROJECTS_DIR=/your/host/projects/path
      - DB_DIR=/your/host/data/path
```

### 从源码构建

```yaml
services:
  dashboard:
    build: .
    container_name: docker-dashboard
    restart: unless-stopped
    ports:
      - "8070:3000"
    volumes:
      - ${PWD}/config/projects:${PWD}/config/projects
      - ${PWD}/config/data:${PWD}/config/data
      - /var/run/docker.sock:/var/run/docker.sock
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    environment:
      - JWT_SECRET=${JWT_SECRET:-docker-dashboard-please-change-this-secret}
      - PROJECTS_DIR=${PWD}/config/projects
      - DB_DIR=${PWD}/config/data
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | Express 监听端口 |
| `JWT_SECRET` | `docker-dashboard-please-change-this-secret` | JWT 签名密钥，**生产环境务必修改** |
| `PROJECTS_DIR` | `/projects` | Compose 项目存储根目录 |
| `DB_DIR` | `/data` | SQLite 数据库存储目录 |

### 路径配置说明

面板运行在容器内，通过 `docker compose` 命令管理宿主机上的项目。为了让 Compose 文件中的**相对路径卷**（如 `./data:/data`）和 **.env / env_file / extends / include** 正常工作，需要确保**容器内路径 = 宿主机路径**。

做法：volume 挂载时左边和右边使用**同一个绝对路径**，并设置 `PROJECTS_DIR` 环境变量。

```
PROJECTS_DIR/
├── immich/
│   ├── docker-compose.yml
│   ├── .env
│   ├── hwaccel.transcoding.yml
│   └── hwaccel.ml.yml
├── nginx/
│   └── docker-compose.yml
└── ...
```

> 面板启动时会自动创建 `PROJECTS_DIR` 和 `DB_DIR` 目录。

### Compose 相对路径支持原理

面板执行 compose 命令时不使用 `--project-directory` 参数，而是通过 `cwd` 设置工作目录，完全遵循 Docker Compose 标准行为：

```bash
cd /path/to/project && docker compose -f docker-compose.yml up -d
```

- `.env` 从项目目录自动加载
- `extends`/`include`/`env_file` 路径正确解析
- 所有 `${VAR}` 变量从 `.env` 正常展开
- 相对路径卷通过同路径挂载支持

> 面板启动时会自动检测是否使用了同路径挂载，并据此判断是否支持相对路径卷。

## 技术架构

```
浏览器 ──HTTP/WS──> Express :3000
                     ├── /auth/*               JWT 认证
                     ├── /api/*                业务 API
                     ├── /projects/*           Compose 项目管理
                     ├── /files/*              文件浏览/编辑
                     ├── /exec/*               命令执行
                     ├── /docker/*             Docker API 透明代理
                     ├── /ws/exec              WebSocket 终端
                     ├── /ws/live              WebSocket 实时推送
                     └── /*                    React SPA 静态文件

Docker Compose CLI ──spawn──> docker compose <command>
Docker API ────unix socket───> /var/run/docker.sock
Docker Events ──stream──> 自动刷新容器列表（300ms 防抖 + 指数退避重连）

数据存储: SQLite (better-sqlite3, WAL 模式) @ /data/dashboard.db
```

### API 路由一览

| 路由 | 模块 | 功能 |
|---|---|---|
| `GET /health` | 内联 | 健康检查 |
| `POST /auth/login` | `auth.js` | 登录 |
| `POST /auth/setup` | `auth.js` | 初始化密码 |
| `GET /auth/status` | `auth.js` | 认证状态 |
| `POST /auth/logout` | `auth.js` | 登出 |
| `POST /auth/password` | `auth.js` | 修改密码 |
| `PUT /auth/preferences` | `auth.js` | 更新用户偏好 |
| `GET /api/self` | 内联 | 自身容器 ID + Docker 连接信息 |
| `GET /api/system/info` | 内联 | 系统版本信息 |
| `GET /api/system/metrics` | `metrics.js` | CPU/内存/磁盘/网络/容器指标 |
| `GET /api/discovered` | 内联 | 发现宿主机已有 Compose 项目（通过 Docker label） |
| `GET /api/groups` | `groups.js` | 获取所有分组及映射 |
| `POST /api/groups` | `groups.js` | 创建分组 |
| `PUT /api/groups/:id` | `groups.js` | 更新分组（重命名/排序/仪表盘显示） |
| `DELETE /api/groups/:id` | `groups.js` | 删除分组 |
| `POST /api/groups/assign` | `groups.js` | 分配容器到分组 |
| `POST /api/groups/unassign` | `groups.js` | 取消分配 |
| `POST /api/groups/favorite` | `groups.js` | 切换收藏状态 |
| `POST /api/groups/collapse` | `groups.js` | 切换折叠状态 |
| `POST /api/groups/ungrouped` | `groups.js` | 切换未分组显示 |
| `GET /api/templates` | `templates.js` | 获取模板列表 |
| `POST /api/templates` | `templates.js` | 创建/更新模板 |
| `DELETE /api/templates/:id` | `templates.js` | 删除模板 |
| `GET /api/registry` | `registry.js` | 获取项目注册表 |
| `POST /api/registry/sync` | `registry.js` | 同步注册表到数据库 |
| `GET /api/containers/check-updates` | `update.js` | 批量检查镜像更新（最多 10 个） |
| `GET /api/containers/:id/check-update` | `update.js` | 单容器检查更新 |
| `POST /api/containers/:id/update` | `containers.js` | 独立容器更新重建 |
| `POST /api/update/stream` | `update.js` | Compose 流式更新（NDJSON） |
| `GET /api/containers/:id/workingdir` | 内联 | 容器工作目录（三层兜底） |
| `POST /exec` | `exec.js` | 执行命令（白名单） |
| `GET /projects` | `compose.js` | 列出所有 Compose 项目 |
| `POST /projects/create` | `compose.js` | 创建项目 |
| `PUT /projects/:name` | `compose.js` | 编辑项目 compose 文件 |
| `DELETE /projects/:name` | `compose.js` | 删除项目 |
| `POST /projects/:name/up` | `compose.js` | 启动项目 |
| `POST /projects/:name/down` | `compose.js` | 停止项目 |
| `POST /projects/:name/stop` | `compose.js` | 停止容器（不删除） |
| `POST /projects/:name/restart` | `compose.js` | 重启项目 |
| `POST /projects/:name/rebuild` | `compose.js` | 重建项目 |
| `POST /projects/:name/pull` | `compose.js` | 拉取镜像 |
| `GET /files/list` | `files.js` | 列出项目文件 |
| `GET /files/read` | `files.js` | 读取文件内容 |
| `PUT /files/write` | `files.js` | 写入文件 |
| `DELETE /files/delete` | `files.js` | 删除文件 |
| `GET /docker/*` | 代理 | Docker API 透明代理（含 stats 格式转换） |
| `WS /ws/exec` | `exec.js` | WebSocket 交互终端 |
| `WS /ws/live` | 内联 | Docker 事件流 + 容器列表实时推送 |

### 容器更新机制

更新检测通过 Docker Registry API 的 manifest HEAD 请求比对 digest，**不下载镜像**：

1. **本地 digest**：通过 Docker socket 调用 `/images/{name}/json` 获取 `RepoDigests`
2. **远端 digest**：直接请求 Registry 的 `/v2/{repo}/manifests/{tag}` 获取 `docker-content-digest`
3. **比对**：本地 digest 列表中任意一个包含远端 digest 即视为最新
4. **缓存**：Docker Hub token 缓存 5 分钟，远端 digest 结果缓存 6 小时
5. **执行**：Compose 项目通过 `docker compose pull` + `docker compose up -d --no-deps` 流式更新

支持 Docker Hub、GHCR 等任何兼容 Docker Registry V2 API 的注册表。

### 前端页面

| 页面 | 导航 ID | 功能 |
|---|---|---|
| 仪表盘 | `dashboard` | 系统概览 + 指标卡片 + 分组服务卡片 + 收藏 |
| 应用管理 | `containers` | 容器列表、分组管理、详情弹窗 |
| 镜像管理 | `images` | 镜像列表、拉取、删除、清理 |
| 网络管理 | `networks` | 网络列表、创建、连接/断开容器 |
| 存储卷 | `volumes` | 卷列表、创建、清理未使用卷 |
| 服务编排 | `compose` | Compose 项目集中管理 |
| 系统设置 | `settings` | 系统信息、修改密码、偏好设置、国际化 |
| 插件 | `plugins` | 插件扩展 |
| 回收站 | `trash` | 已删除资源恢复 |
| 登录页 | `/login` | 认证页面 |

### 数据库表

| 表 | 说明 |
|---|---|
| `users` | 用户（单用户模式，bcrypt 密码哈希） |
| `preferences` | 用户偏好（主题、语言、收藏、折叠状态、命令历史） |
| `templates` | Compose 模板 |
| `registry` | 项目注册表快照 |
| `container_groups` | 工作区分组（含排序、仪表盘显示控制） |
| `container_group_mapping` | 容器/项目 ↔ 分组映射 |

## 项目结构

```
docker-dashboard/
├── docker-compose.yml          # 部署配置（含健康检查）
├── Dockerfile                  # 多阶段构建（node:20 构建前端 + node:18-alpine 运行时）
├── publish.sh                  # 多架构镜像发布脚本 (amd64/arm64)
├── server/                     # 后端 Express 服务
│   ├── server.js               # 入口：路由挂载、认证、WebSocket、Docker 代理
│   ├── package.json
│   ├── lib/
│   │   ├── utils.js            # 工具函数（安全路径、自身容器检测、YAML 校验）
│   │   ├── db.js               # 数据库初始化（WAL 模式 + 自动迁移）
│   │   ├── auth.js             # JWT 认证（token 生成/验证、cookie 解析、密码哈希）
│   │   └── migrate.js          # 数据库迁移引擎
│   ├── routes/
│   │   ├── compose.js          # Compose 项目 CRUD + 生命周期管理
│   │   ├── update.js           # 镜像更新检测 + Compose 流式更新
│   │   ├── containers.js       # 独立容器更新重建
│   │   ├── groups.js           # 工作区分组管理
│   │   ├── templates.js        # Compose 模板管理
│   │   ├── files.js            # 项目文件浏览/编辑/删除
│   │   ├── exec.js             # WebSocket 命令执行终端
│   │   ├── metrics.js          # 系统指标采集
│   │   ├── registry.js         # 项目注册表同步
│   │   └── auth.js             # 认证路由
│   └── migrations/             # SQL 迁移文件
│       ├── 001_container_groups.sql
│       ├── 003_remove_favorites_group.sql
│       └── 004_show_on_dashboard.sql
├── frontend/                   # 前端 React SPA
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── App.tsx             # 根组件：路由、布局、全局状态
│       ├── main.tsx            # 入口
│       ├── types/
│       │   └── index.ts        # 完整 TypeScript 类型定义
│       ├── api/
│       │   ├── client.ts       # Axios 实例（自动携带 token）
│       │   ├── docker.ts       # Docker 相关 API 调用
│       │   ├── auth.ts         # 认证 API
│       │   ├── system.ts       # 系统 API
│       │   └── ws.ts           # WebSocket 客户端
│       ├── hooks/
│       │   ├── useContainers.ts          # 容器列表 + 自动刷新
│       │   ├── useContainersEnhanced.tsx # 增强容器数据（工作区模式）
│       │   ├── useGroups.ts             # 分组管理
│       │   ├── useSystemMetrics.ts      # 系统指标轮询
│       │   ├── useSystemInfo.ts         # 系统信息
│       │   ├── useSelf.ts               # 自身容器检测
│       │   ├── useScrollAnchor.ts       # 滚动锚点
│       │   └── useTheme.ts              # 主题管理
│       ├── pages/
│       │   ├── ContainerPage.tsx        # 应用管理
│       │   ├── ImagesPage.tsx           # 镜像管理
│       │   ├── NetworksPage.tsx         # 网络管理
│       │   ├── VolumesPage.tsx          # 存储卷管理
│       │   ├── SettingsPage.tsx         # 系统设置
│       │   ├── MonitorPage.tsx          # 监控页面
│       │   ├── PluginsPage.tsx          # 插件页面
│       │   ├── TrashPage.tsx            # 回收站
│       │   ├── ProjectDetailModal.tsx   # 项目详情弹窗
│       │   ├── UsersPage.tsx            # 用户管理
│       │   └── Login.tsx                # 登录页
│       ├── components/
│       │   ├── ServiceCard.tsx          # 服务卡片（含操作菜单）
│       │   ├── ServiceGroup.tsx         # 服务分组
│       │   ├── GroupHeader.tsx          # 分组头部
│       │   ├── GroupManageModal.tsx     # 分组管理弹窗
│       │   ├── ComposeManager.tsx       # Compose 编排管理器
│       │   ├── UpdateModal.tsx          # 容器更新弹窗
│       │   ├── LogsModal.tsx            # 日志弹窗
│       │   ├── TerminalModal.tsx        # 终端弹窗
│       │   ├── YamlEditor.tsx           # YAML 编辑器
│       │   ├── MetricsCards.tsx         # 指标卡片
│       │   ├── StatsOverview.tsx        # 统计概览
│       │   ├── SystemInfo.tsx           # 系统信息面板
│       │   ├── AlertPanel.tsx           # 告警面板
│       │   ├── NotificationProvider.tsx # 通知管理
│       │   ├── Toolbar.tsx              # 工具栏（搜索+创建）
│       │   ├── Header.tsx               # 顶部栏
│       │   ├── Sidebar.tsx              # 侧边栏
│       │   ├── Favorites.tsx            # 收藏列表
│       │   ├── UserMenu.tsx             # 用户菜单
│       │   ├── ThemeToggle.tsx          # 主题切换
│       │   ├── LangToggle.tsx           # 语言切换
│       │   └── ToggleSwitch.tsx         # 开关组件
│       └── locales/
│           ├── zh.json                  # 中文文案
│           └── en.json                  # 英文文案
├── website/                    # 项目官网
└── README.md
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript |
| 构建工具 | Vite |
| CSS | Tailwind CSS |
| 图表 | Recharts |
| 图标 | Lucide React |
| 国际化 | i18next + react-i18next |
| 后端框架 | Express.js |
| WebSocket | ws |
| 数据库 | SQLite (better-sqlite3, WAL 模式) |
| 认证 | JWT (jsonwebtoken + bcryptjs) |
| YAML 解析 | js-yaml |
| 容器交互 | Docker CLI + Unix Socket |
| 构建发布 | Docker Buildx 多架构 (amd64/arm64) |
| CI/CD | publish.sh 一键构建推送 |

## 开发指南

```bash
# 后端
cd server
npm install
node server.js          # 启动在 :3000

# 前端开发模式
cd frontend
npm install
npm run dev             # 启动 Vite 开发服务器（独立端口）

# Docker 构建
docker compose build
docker compose up -d

# 发布多架构镜像
./publish.sh
```

## 发布镜像

项目在 Docker Hub 上以 `yinheng1989/docker-dashboard` 发布，支持 `amd64` 和 `arm64` 架构。使用 `publish.sh` 脚本一键构建并推送。
