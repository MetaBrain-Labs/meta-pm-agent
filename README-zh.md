# meta-pm-agent

基于 LangGraph 状态机编排的 AI 项目管理助手。

## 技术栈

- **Agent 运行时**: LangGraph + LangChain (TypeScript)
- **API**: Hono（端口 3001）
- **前端**: Next.js 16 + Tailwind CSS 4（端口 3000）
- **Worker**: BullMQ + Redis
- **数据库**: PostgreSQL + Prisma
- **Monorepo**: pnpm workspaces + Turborepo

## 快速开始

### 环境要求

- Node.js 18+
- pnpm 11.3.0（`corepack enable`）
- PostgreSQL
- Redis

### 安装与运行

```bash
# 安装依赖
pnpm install

# 复制环境变量文件并填写配置
cp .env.example .env

# 初始化数据库
pnpm --filter @repo/database db:push

# 构建共享包（运行应用前必须执行）
pnpm build

# 启动全部服务的开发模式
pnpm dev
```

### 服务列表

| 服务 | 端口 | 单独启动命令 |
|------|------|-------------|
| API | 3001 | `pnpm --filter @repo/api dev` |
| Web | 3000 | `pnpm --filter web dev` |
| Worker | — | `pnpm --filter @repo/worker dev` |

### API 接口

```
GET  /     健康检查
POST /chat 向 PM Agent 发送消息
```

### 项目结构

```
apps/
  api/             Hono HTTP API
  web/             Next.js 前端
  worker/          BullMQ Redis 任务处理器
  agent-runtime/   LangGraph Agent 状态机
packages/
  shared/          共享类型、Zod schema、DTO
  database/        Prisma 客户端单例
```

## 脚本

```bash
pnpm build    # 构建全部包和应用（按依赖顺序）
pnpm dev      # 启动全部服务开发模式（需先执行 pnpm build）
pnpm lint     # 代码检查（目前仅 web 配置了 eslint）
```
