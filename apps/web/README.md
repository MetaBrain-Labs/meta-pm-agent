# Web 前端

Vite + React + Ant Design 5 聊天界面。

## 启动

```bash
pnpm dev
```

前端默认运行在 `http://localhost:3000`，通过 Vite 代理将 `/api` 请求转发到 `localhost:3001`。

## 技术栈

- React 19
- Ant Design 5（浅色主题 + 中文 locale）
- Vite 6
- TypeScript 5.8.3
- antd 组件：Layout、Menu、Input、Button、Tag、Collapse、Spin、Card、Form 等

## 目录结构

```
src/
├── App.tsx                  # 根组件（ConfigProvider + Layout + 侧边栏 + 聊天区）
├── main.tsx                 # 入口
├── types.ts                 # 前端类型（Message、StreamEvent、TodoItem、ThreadInfo）
├── styles.css               # 自定义样式（消息气泡、Markdown 渲染等）
├── components/
│   ├── ChatApp.tsx          # 聊天主界面
│   ├── MessageBubble.tsx    # 消息气泡（支持思考过程、工具调用、Question-Form、User-Input）
│   ├── Sidebar.tsx          # 侧边栏（对话列表 + 新建对话）
│   ├── ProseBlock.tsx       # 内容解析器（Markdown / 系统提醒 / Question-Form）
│   ├── QuestionForm.tsx     # Question-Form 表单组件
│   ├── UserInputCard.tsx    # User-Input 整理结果卡片
│   ├── TodoCard.tsx         # 任务列表卡片
│   └── Icon.tsx             # SVG 图标集
├── hooks/
│   └── useChat.ts           # 聊天状态 Hook（保留未使用）
└── utils/
    ├── markdown.tsx          # Markdown → JSX 渲染器
    ├── question-form.ts     # <question-form> 解析器
    └── user-input.ts        # <user-input> 解析器
```

## SSE 事件流程

| 事件 | 说明 |
|------|------|
| `start` | 流式开始 |
| `thinking` | 思考过程增量 |
| `text` | 文本内容 |
| `question-form-start` / `question-form-complete` | Question-Form 生成 |
| `user-input-start` / `user-input-complete` | User-Input 整理结果生成 |
| `todo-update` | 任务列表更新 |
| `tool-call` / `tool-result` | 工具调用 |
| `finish` | 流式结束 |
| `error` | 错误 |
