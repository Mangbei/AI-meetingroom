# 会议室 API 与 MCP 接入

AI Meeting Room 既可以手动用网页 UI 操作，也可以通过 **REST API** 或 **MCP 工具**让 Claude Code / Codex 这类 agent 直接控制——两种方式共用同一套后端，互不冲突。

## 前置条件

1. 服务已启动（默认 `http://localhost:3001`，API 前缀 `/api`）。
2. 受控浏览器中，参会模型对应的网页（ChatGPT / Gemini / DeepSeek 等）**已登录**。会议本质是驱动这些真实网页会话，所以无法在未登录状态下凭空开会。可用 `GET /api/status` 或 MCP 的 `server_status` 工具确认就绪情况。

## 鉴权（可选）

默认不鉴权，方便本地使用。若设置环境变量 `MEETING_API_TOKEN`，则所有 `/api` 请求都需要带上：

```
Authorization: Bearer <token>
```

或 `x-api-token: <token>`。启用后，自带的网页 UI 需要同样配置才能访问，因此一般只在把端口暴露给 agent / 远程调用时开启。

---

## REST 端点

| 方法 & 路径 | 作用 |
|---|---|
| `GET /api/status` | 受控浏览器与各模型登录/就绪状态 |
| `GET /api/meetings` | 列出所有会议及状态 |
| `GET /api/meetings/:id` | 会议详情：状态、议程小结、消息、最终纪要、`artifact.structured_json`（行动项 + 未解决问题） |
| `POST /api/meetings` | **创建并立即开始**一场会议（见下方 body） |
| `POST /api/meetings/:id/intervene` | 人类主持人插话：`{ "text": "..." }`，注入下一轮，仅会议运行中可用 |
| `POST /api/meetings/:id/continue` | 基于未解决问题开启续会，返回新会议 `{ id }` |
| `GET /api/meetings/:id/export` | 导出 Markdown 纪要 |
| `POST /api/meetings/agenda-draft` | 让模型先草拟议程（两步式流程的第一步，可选） |

### `POST /api/meetings` 请求体

```jsonc
{
  "title": "Q3 增长方案评审",
  "goal": "确定下季度最值得投入的两个增长方向",
  "participants": ["chatgpt", "gemini", "deepseek"],  // 2-5 个
  "moderator": "chatgpt",                              // 必须是参会者之一
  "agenda": ["方案A和方案B哪个ROI更高？", "落地的最大风险是什么？"],
  "mode": "relay",          // relay 接力 | parallel 并行，默认 relay
  "agendaRounds": 2,        // 每个议程讨论轮数 1-5，默认 1
  "modelPostures": { "deepseek": "critical" },         // 可选：cooperative|balanced|critical
  "confirmations": { "chatgpt": true, "gemini": true, "deepseek": true }, // 每个参会者都需确认
  "files": [ { "filename": "data.csv", "dataBase64": "..." } ]  // 可选
}
```

返回 `{ "id": "<meetingId>" }`，会议随即在后台运行。用 `GET /api/meetings/:id` 轮询状态（`pending` → `running` → `done`/`error`）。实时进度也可通过 WebSocket `ws://localhost:3001/ws/meetings/:id` 订阅。

---

## MCP 接入（推荐给 agent）

MCP server 把上面这些操作封装成原生工具，agent 不用手写 HTTP。它通过 stdio 运行，不引入额外依赖。

启动命令：

```bash
npm run mcp -w server
# 可选环境变量：
#   MEETING_API_BASE   默认 http://localhost:3001/api
#   MEETING_API_TOKEN  与服务端一致时自动带上 Bearer
```

### 在 Claude Code 中配置

项目根目录 `.mcp.json`：

```json
{
  "mcpServers": {
    "meetingroom": {
      "command": "npm",
      "args": ["run", "mcp", "-w", "server"],
      "env": { "MEETING_API_BASE": "http://localhost:3001/api" }
    }
  }
}
```

### 在 Codex 中配置

`~/.codex/config.toml`：

```toml
[mcp_servers.meetingroom]
command = "npm"
args = ["run", "mcp", "-w", "server"]
```

### 可用工具

| 工具 | 作用 |
|---|---|
| `server_status` | 查模型登录/就绪状态（开会前先确认） |
| `list_meetings` | 列出所有会议 |
| `create_meeting` | 创建并开始会议（自动确认模型选择门槛） |
| `get_meeting` | 取状态、议程小结、最终纪要、行动项与未解决问题 |
| `intervene` | 向运行中的会议插话/追问 |
| `continue_meeting` | 用未解决问题开启续会 |

典型流程：`server_status` 确认就绪 → `create_meeting` 起会 → 轮询 `get_meeting` 直到 `done` → 读取 `structuredMinutes` → 需要时 `continue_meeting` 续会。
