# ===== 第一阶段：构建 React 前端 =====
FROM node:20-alpine AS react-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ===== 第二阶段：Node.js 运行时（后端 + 前端静态文件） =====
FROM node:18-alpine

# 安装 Docker CLI 和编译工具（better-sqlite3 需要）
RUN apk add --no-cache docker-cli docker-cli-compose python3 make g++

# 创建项目和数据目录
RUN mkdir -p /projects /data

WORKDIR /app/backend

# 安装后端依赖
COPY server/package*.json ./
RUN npm install --production

# 复制后端代码
COPY server/ ./

# 复制 React 构建产物到 public/（覆盖旧前端）
COPY --from=react-builder /app/dist ./public

EXPOSE 3000

CMD ["node", "server.js"]
