# Docker Dashboard

一个轻量级、功能完整的 Docker 可视化管理面板，支持 Compose 项目编排、容器/镜像/网络/卷管理、实时监控告警、多工作区分组、中英文国际化。

## 功能特性

### 核心管理
- **容器管理**：启动/停止/重启/暂停/删除/强制终止，卡片/表格双视图
- **Compose 项目**：创建、编辑、启动、停止、重启、重建、删除，支持多文件项目（.env、extends、include）
- **镜像管理**：拉取/删除镜像，清理悬空镜像
- **网络管理**：创建/删除网络，连接/断开容器
- **存储卷管理**：创建/删除卷，清理未使用卷

### 运维工具
- **实时日志**：容器日志流式输出，支持多容器切换、暂停/继续
- **Web 终端**：WebSocket 交互式容器 Shell (xterm 风格)
- **服务编排**：独立编排页面，集中管理 compose 文件和操作
- **文件管理**：浏览/编辑项目目录下所有文件（compose、.env、配置等）
- **容器更新**：镜像更新检测（支持 Docker Hub/GHCR 等多注册表）、批量流式更新

### 监控与组织
- **系统监控**：CPU/内存/磁盘/网络实时图表，容器资源排名
- **告警系统**：可配置 CPU/内存/磁盘/容器下线告警规则
- **工作区分组**：自定义分组，拖拽分配容器，折叠/展开、仪表盘显示控制
- **收藏功能**：常用服务快速访问
- **模板系统**：内置常用服务模板（Nginx、MySQL、PostgreSQL 等），快速创建项目

### 安全与体验
- **JWT 认证**：httpOnly cookie 存储，滑动过期自动续期
- **自我保护**：自动识别自身容器，阻止误操作导致面板中断
- **深色/浅色主题**：一键切换
- **中英文国际化**：完整双语支持
- **移动端适配**：响应式设计

## 快速开始

```bash
git clone <repo-url> dashboard
cd dashboard
docker compose up -d
```

访问 `http://localhost:8070`，首次使用需设置密码。

## 部署配置

### 开发环境

```yaml
# docker-compose.yml
services:
  dashboard:
    build: .
    container_name: dashboard
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
```

### 生产环境（使用 Docker Hub 镜像）

```yaml
services:
  dashboard:
    image: yinheng1989/docker-dashboard:latest
    container_name: docker-dashboard
    restart: unless-stopped
    ports:
      - "8070:3000"
    volumes:
      # ⚠️ 关键：同路径挂载，左边=右边，支持 compose 相对路径卷
      - /your/host/projects/path:/your/host/projects/path
      - /your/host/data/path:/your/host/data/path
      - /var/run/docker.sock:/var/run/docker.sock
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    environment:
      - JWT_SECRET=your-secret-here
      - PROJECTS_DIR=/your/host/projects/path
```

### 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `JWT_SECRET` | 随机值 | JWT 签名密钥，**生产环境务必修改** |
| `PROJECTS_DIR` | `/projects` | Compose 项目存储根目录 |

### 路径配置说明

面板运行在容器内，通过 `docker compose` 命令管理宿主机上的项目。为了让 Compose 文件中的**相对路径卷**（如 `./data:/data`、`../../shared:/shared`）和 **.env/env_file/extends/include** 正常工作，需要确保**容器内路径 = 宿主机路径**。

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

> 面板启动时会自动创建 `PROJECTS_DIR` 目录。

## Compose 相对路径支持

### 原理

面板执行 compose 命令时不使用 `--project-directory` 参数，而是通过 `cwd` 设置工作目录，完全遵循 Docker Compose 标准行为：

```bash
cd /path/to/project && docker compose -f docker-compose.yml up -d
```

- `.env` 从项目目录自动加载
- `extends`/`include`/`env_file` 路径正确解析
- 所有 `${VAR}` 变量从 `.env` 正常展开
- 相对路径卷通过同路径挂载支持

### 创建时的相对路径检测

创建/编辑项目时，面板会自动检测 compose 文件中的相对路径卷并给出提示：

```
⚠️ 检测到相对路径卷挂载
[nginx] 卷挂载使用了相对路径 "./html"，面板启动 compose 时可能无法正确挂载
```

如果部署时使用了同路径挂载，可忽略此提示正常启动；如未使用同路径挂载，建议将路径改为绝对路径。

## 技术架构

```
浏览器 ──HTTP──> Express :3000
                  ├── /auth/*            JWT 认证
                  ├── /api/*             业务 API
                  ├── /projects/*        Compose 项目管理
                  ├── /files/*           文件浏览/编辑
                  ├── /docker/*          Docker API 代理
                  ├── /ws/exec           WebSocket 终端
                  ├── /ws/live           WebSocket 实时推送
                  └── /*                 React SPA 静态文件

Docker Compose CLI ──spawn──> docker compose <command>
Docker API ────unix socket───> /var/run/docker.sock

数据存储: SQLite (better-sqlite3) @ /data/dashboard.db
```

### API 路由一览

| 路由前缀 | 模块 | 功能 |
|---|---|---|
| `/auth` | `auth.js` | 登录、初始化、登出、密码修改 |
| `/api/self` | `server.js` | 自身容器 ID |
| `/api/system/metrics` | `metrics.js` | CPU/内存/磁盘/网络/容器指标 |
| `/api/groups` | `groups.js` | 工作区分组 CRUD + 收藏/折叠/仪表盘显示 |
| `/api/templates` | `templates.js` | Compose 模板管理 |
| `/api/registry` | `registry.js` | 项目注册表 |
| `/api/containers/*` | `containers.js` | 独立容器操作与更新 |
| `/api/update/stream` | `update.js` | Compose 流式更新 + 镜像更新检测 |
| `/api/discovered` | `server.js` | 发现外部 Compose 项目 |
| `/projects` | `compose.js` | Compose 项目 CRUD + up/down/stop/restart/rebuild |
| `/files` | `files.js` | 项目文件浏览/读写/删除 |
| `/exec` (WS) | `exec.js` | WebSocket 交互终端 |
| `/docker/*` | 代理 | Docker API 透明代理 |

### 前端页面

| 页面 | 路由 | 功能 |
|---|---|---|
| 仪表盘 | `dashboard` | 系统概览 + 指标卡片 + 分组服务卡片 |
| 应用管理 | `containers` | 容器列表、分组管理、详情弹窗 |
| 镜像管理 | `images` | 镜像列表、拉取、删除 |
| 网络管理 | `networks` | 网络列表、创建、连接 |
| 存储卷 | `volumes` | 卷列表、创建、清理 |
| 服务编排 | `compose` | Compose 项目集中管理 |
| 日志中心 | `logs` | 实时日志查看 |
| 监控告警 | `monitor` | 系统资源图表 + 告警规则 |
| 系统设置 | `settings` | 系统信息、修改密码、偏好设置 |
| 用户管理 | `users` | 用户信息、密码修改 |

### 数据库表

| 表 | 说明 |
|---|---|
| `users` | 用户（单用户模式，bcrypt 密码哈希） |
| `preferences` | 用户偏好（主题、语言、收藏、折叠状态、命令历史） |
| `templates` | Compose 模板 |
| `registry` | 项目注册表快照 |
| `container_groups` | 工作区分组（含排序、显示控制） |
| `container_group_mapping` | 容器/项目 ↔ 分组映射 |

## 项目结构

```
dashboard/
├── docker-compose.yml          # 部署配置
├── Dockerfile                  # 多阶段构建（前端构建 + 后端运行时）
├── publish.sh                  # 多架构镜像发布脚本 (amd64/arm64)
├── server/                     # 后端 Express 服务
│   ├── server.js               # 入口：路由挂载、WebSocket、Docker 代理
│   ├── lib/
│   │   ├── utils.js            # 工具函数（路径安全、YAML 校验、文件操作）
│   │   ├── db.js               # 数据库初始化与 Schema
│   │   ├── auth.js             # JWT 认证（cookie + header）
│   │   └── migrate.js          # 数据库迁移引擎
│   ├── routes/
│   │   ├── compose.js          # Compose 项目管理
│   │   ├── update.js           # 容器更新检测与执行
│   │   ├── containers.js       # 独立容器操作
│   │   ├── groups.js           # 分组管理
│   │   ├── templates.js        # 模板管理
│   │   ├── files.js            # 文件管理
│   │   ├── exec.js             # WebSocket 终端
│   │   ├── metrics.js          # 系统指标
│   │   ├── registry.js         # 项目注册表
│   │   └── auth.js             # 认证路由
│   └── migrations/             # SQL 迁移文件
│       ├── 001_container_groups.sql
│       ├── 003_remove_favorites_group.sql
│       └── 004_show_on_dashboard.sql
├── frontend/                   # 前端 React SPA
│   ├── src/
│   │   ├── pages/              # 10 个页面组件
│   │   ├── components/         # 21 个 UI 组件
│   │   ├── hooks/              # 7 个自定义 Hook
│   │   ├── types/              # TypeScript 类型定义
│   │   ├── locales/            # 国际化文案 (zh/en)
│   │   └── App.tsx             # 路由与布局
│   └── package.json
├── config/                     # 运行时数据
│   ├── projects/               # Compose 项目文件
│   └── data/                   # SQLite 数据库
└── README.md
```

## 技术栈

| 层 | 技术 |
|---|---|
| 前端框架 | React 18 + TypeScript + Vite |
| CSS | Tailwind CSS 3 |
| 图表 | Recharts |
| 图标 | Lucide React |
| 国际化 | i18next |
| 后端框架 | Express.js |
| WebSocket | ws |
| 数据库 | SQLite (better-sqlite3) |
| 认证 | JWT (jsonwebtoken + bcryptjs) |
| YAML 解析 | js-yaml |
| 容器交互 | Docker CLI + Unix Socket |
| 构建发布 | Docker Buildx (多架构) |

## 开发指南

```bash
# 后端
cd server
npm install
node server.js          # 启动在 :3000

# 前端开发模式
cd frontend
npm install
npm run dev             # 启动 Vite 开发服务器

# Docker 构建
docker compose build
docker compose up -d

# 发布多架构镜像
./publish.sh
```

## 发布镜像

项目在 Docker Hub 上以 `yinheng1989/docker-dashboard` 发布，支持 `amd64` 和 `arm64` 架构。使用 `publish.sh` 脚本一键构建并推送。
