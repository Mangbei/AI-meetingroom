# AI Meeting Room

本地多模型会议室。**不使用任何 AI API Key**——它驱动你电脑上一个受控浏览器里**已登录的网页版 AI**（ChatGPT、Gemini、DeepSeek、Claude、豆包、智谱、千问、元宝、Kimi），让它们围绕你上传的资料和议程进行多轮讨论、互相质疑，最后生成结构化会议纪要（含行动项与未解决问题）。

架构一句话：**编排者中心的多智能体辩论系统 × 浏览器自动化（Playwright/CDP）当模型接入层**。模型间不直接通信，后端把材料、前序发言、分工姿态拼装成提示词逐轮转发，像真实会议一样推进：议程 → 多轮交锋 → 主持人小结 → 最终纪要。

---

## 运行前提（必须提前装好的只有两样）

| 前提 | 要求 | 检查命令 | 通过标准 |
|---|---|---|---|
| **Node.js** | ≥ 22.5（数据库用 Node 内置 `node:sqlite`，低版本起不来） | `node -v` | 输出 `v22.5.0` 或更高 |
| **浏览器** | Chrome / Edge / Chromium 任一 | macOS 看 `/Applications/Google Chrome.app` 是否存在；Windows 一般自带 Edge | 存在即可 |

其余一切（npm 依赖、前端构建）都由启动流程**自动完成**，唯一额外要求是**首次运行需要联网**（下载 npm 依赖）。

**没装会怎样（便于诊断）：**
- 缺 Node / 版本过低 → 启动脚本直接提示并退出；手动运行则报 `node: command not found` 或 `Cannot find module 'node:sqlite'`。
- 缺浏览器 → 服务启动时抛 `No Chrome/Chromium/Edge installation found`，可用环境变量 `BROWSER_BINARY` 指定非标准路径。
- 没跑 `npm install` → 报 `Cannot find module 'express'` 之类；跑一次 `npm install` 即可。

---

## 快速开始

### 方式① 一键启动（普通用户 / 分发给别人）

- **macOS**：双击 `start-mac.command`（若提示"身份不明开发者"：右键 → 打开 → 打开）
- **Windows**：双击 `start-windows.bat`（SmartScreen 提示时：更多信息 → 仍要运行）

脚本自动完成：检查 Node 与浏览器 → 首次 `npm install` → 构建前端 → 启动。成功后整个程序运行在 **`http://localhost:3001`**（界面 + 接口同端口），并弹出受控浏览器。

### 方式② 开发模式（改代码时）

```bash
npm install     # 首次
npm run dev     # 后端 3001 + Vite 前端 5173（热更新）
# 开发时访问 http://localhost:5173
```

### 方式③ 命令行 / AI agent 非交互拉起

给自动化环境或 AI agent 的确定性步骤（等价于一键启动脚本做的事）：

```bash
# 0) 前提自检
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit((a>22||(a===22&&b>=5))?0:1)" \
  || { echo "需要 Node >= 22.5"; exit 1; }

# 1) 安装依赖（仓库不含 node_modules，首次必须执行，需联网）
npm install

# 2) 构建前端（生产模式由后端托管 web/dist；每次拉新代码后都要重新构建）
npm run build

# 3) 启动（会自动拉起受控浏览器；无图形环境见下方环境变量）
npm start
```

**验证是否拉起成功：**

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/            # 期望 200（界面）
curl -s http://localhost:3001/api/meetings                               # 期望 JSON 数组
```

**常用环境变量：**

| 变量 | 作用 | 默认 |
|---|---|---|
| `PORT` | 服务端口 | `3001` |
| `BROWSER_BINARY` | 手动指定浏览器可执行文件路径 | 自动探测 Chrome→Chromium→Edge |
| `BROWSER_CDP_PORT` | 连接一个**已在运行**的浏览器（需带 `--remote-debugging-port` 启动）而不是自己拉起 | 无（自己拉起） |
| `OPEN_APP_IN_BROWSER` | 设为 `0` 则启动后不自动打开会议页 | 开 |
| `MEETINGROOM_FOREGROUND` | 设为 `1` 时每轮把受控浏览器切到前台（调试用；默认后台静默运行，不抢焦点） | 关 |
| `MEETING_API_TOKEN` | 设置后所有 `/api` 请求需带 `Authorization: Bearer <token>` | 不鉴权 |

> 无图形环境（CI/容器）示例：先自行启动 `chromium --headless=new --remote-debugging-port=9333 --user-data-dir=/tmp/profile`，再 `BROWSER_CDP_PORT=9333 npm start`。注意：无头环境里没有登录态，只能验证服务本身，无法真正开会。

---

## 首次运行必做：登录 AI

程序启动后会弹出一个**受控浏览器窗口**（独立配置，与你日常浏览器互不影响）：

1. 在这个窗口里登录你要用的 AI 网站（登录、验证码、二次验证必须**人工完成**，程序不代登录）。登录态保存在 `.local-data/browser-profile/`，之后无需重登。
2. 打开 `http://localhost:3001/meetings/new`，页面上可"检测登录状态"。
3. 上传资料 → 填标题与目标 →（可选）填议程、勾选"直接使用我填写的议程"跳过 AI 重拟 → 选模式/轮数/参会模型/主持人 → 勾选各模型"最高档位确认" → 生成议程草案 → 人工确认页微调 → 开始会议。
4. 至少 **2 个模型就绪**才能开会；未登录/自检失败的模型会被自动跳过。
5. 会议进行中可在页面底部**插话**（注入下一轮，模型必须回应）；结束后可**导出 Markdown**、勾选行动项、或"带着未解决问题继续开下一场"。

---

## 已接入模型

| 模型 | 站点 | 适配器 |
| --- | --- | --- |
| ChatGPT | chatgpt.com | 专用（含模型档位配置） |
| Gemini | gemini.google.com | 专用 |
| DeepSeek | chat.deepseek.com | 专用（深度思考/联网开关） |
| Claude | claude.ai | 通用 |
| 豆包 | doubao.com | 通用 |
| 智谱清言 | chatglm.cn | 通用 |
| 通义千问 | chat.qwen.ai | 通用 |
| 腾讯元宝 | yuanbao.tencent.com | 通用 |
| Kimi | kimi.com | 通用 |

默认勾选 ChatGPT、Gemini、DeepSeek。开会前每家都会做页面结构自检（preflight）；**网站改版导致选择器失效**时该模型会被明确跳过，修复方法：更新 `server/src/browser/adapters/specs.ts`（通用适配器）或对应专用适配器文件，可用 `npm run smoke -- <模型名>` 单独验证。

---

## 核心能力

- **会议编排**：接力/并行两种模式；每议程 1-5 轮；模型可设讨论姿态（协作/默认/反骨）；指定主持人负责拟议程、收束小结、最终归纳。
- **人类主持人介入**：会议中随时插话/追问，注入下一轮提示，模型必须正面回应。
- **结构化纪要**：自动抽取行动项（做什么/谁负责/期限/来源）与未解决问题；未决问题可**一键结转续会**。
- **文件链路**：接受 PDF / Word / Excel / CSV / Markdown / 代码 / Jupyter 笔记本 / 任意文本文件；**优先把原文件直传给每家 AI**（失败重试 2 次），同时永远携带文本抽取兜底；自动识别 GBK 等中文编码；扫描件 PDF 会被检测并明确提示（靠 web AI 的视觉能力读原件，本地不做 OCR）。
- **运行控制台**：实时展示每个模型打开/就绪/发言/出错/缺席，及文件直传/兜底状态。
- **本地优先**：数据全部存本地（`node:sqlite` + 文件），完成后有桌面通知（macOS/Windows）。
- **Agent 可控**：REST API + MCP server，Claude Code / Codex 可以创建会议、插话、读纪要、续会。见 [docs/MEETING_API.md](docs/MEETING_API.md)。

---

## 目录结构

```text
ai-meetingroom/
├── start-mac.command       # macOS 一键启动
├── start-windows.bat       # Windows 一键启动
├── INSTALL.md              # 面向最终用户的安装说明（含常见问题）
├── docs/MEETING_API.md     # REST / MCP 接口文档（给 agent 用）
├── server/                 # 后端：Express + Playwright(CDP) + node:sqlite
│   └── src/
│       ├── index.ts            # 入口：拉起/连接浏览器、托管界面与接口
│       ├── api/                # http 路由 + websocket 实时流
│       ├── browser/            # 浏览器启动/CDP 连接 + 各 AI 站点适配器
│       ├── meeting/            # 会议状态机、提示词、文件解析、纪要抽取
│       ├── mcp/                # MCP server（stdio，零依赖）
│       └── storage/            # node:sqlite 数据库
└── web/                    # 前端：React + Vite（构建产物 web/dist 由后端托管）
```

## 数据与输出位置

全部在项目目录下的 `.local-data/`（隐藏文件夹，macOS 访达按 `Cmd+Shift+.` 显示）：

```text
.local-data/browser-profile/                    # 受控浏览器登录态
.local-data/db/meetingroom.db                   # 会议数据库
.local-data/meetings/<id>/uploads/              # 上传的原文件
.local-data/meetings/<id>/summary.md            # 会议纪要（Markdown）
.local-data/meetings/<id>/meeting.json          # 完整记录（JSON）
```

页面上也可直接"导出 Markdown"。删除 `.local-data/` 即清空一切（含登录态）。

## 重要说明

- 登录、验证码、模型下拉选择必须由用户手动完成，程序不代替登录。
- 受控浏览器**默认后台静默运行**，开会不抢焦点；想实时盯操作用 `MEETINGROOM_FOREGROUND=1`。
- 网页端 DOM 会变化：某家网站改版后该模型可能自检失败被跳过，更新对应选择器即可，不影响其他模型。
- 拉取新代码后务必重新构建前端（一键启动脚本每次自动做；手动跑记得 `npm run build`）。
