# ===== 阶段 1：构建 React 前端 =====
FROM node:20-alpine AS react-builder
WORKDIR /app
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ===== 阶段 2：编译后端依赖（better-sqlite3 原生模块需要编译工具） =====
FROM node:20-alpine AS backend-builder
WORKDIR /app/backend
RUN apk add --no-cache python3 make g++
COPY server/package*.json ./
RUN npm ci --omit=dev

# ===== 阶段 3：运行时（不保留编译工具链） =====
FROM node:20-alpine
RUN apk add --no-cache docker-cli docker-cli-compose \
  && mkdir -p /projects /data
WORKDIR /app/backend
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY server/ ./
# React 构建产物 → public/（server.js 用 express.static 提供）
COPY --from=react-builder /app/dist ./public
EXPOSE 3000
CMD ["node", "server.js"]
