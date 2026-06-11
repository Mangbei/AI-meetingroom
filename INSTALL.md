# 安装与使用

AI Meeting Room 是一个本地程序：它驱动你电脑上**已经登录的网页版 AI**（ChatGPT / Gemini / DeepSeek 等）围绕你的议程多轮讨论，并生成会议纪要。Mac 和 Windows 共用同一套代码，各有一个一键启动文件。

## 你需要先准备两样东西

1. **Node.js 22.5 或更高版本** — 官网下载：<https://nodejs.org/>
   （Mac 也可 `brew install node`）
2. **Google Chrome**（或 Microsoft Edge / Chromium）— <https://www.google.com/chrome/>
   程序会驱动它来操作网页版 AI，并复用你在里面的登录态。

> 不需要任何 AI 的 API Key，也不需要单独安装数据库或浏览器内核。

---

## macOS

1. 解压后，在 Finder 里**双击 `start-mac.command`**。
2. 如果系统提示“无法打开，因为来自身份不明的开发者”：
   **右键点击 `start-mac.command` → 选择「打开」→ 再点「打开」**（只需一次）。
3. 首次运行会自动安装依赖、构建界面（几分钟，仅第一次），然后启动。

## Windows

1. 解压后，**双击 `start-windows.bat`**。
2. 如果出现蓝色 SmartScreen 提示：点 **“更多信息” → “仍要运行”**。
3. 首次运行会自动安装依赖、构建界面（几分钟，仅第一次），然后启动。

---

## 第一次使用的关键步骤

启动后会弹出一个**受控的 Chrome 窗口**（这是程序专用的独立配置，不是你平时的 Chrome）：

1. 在这个窗口里**登录你想用的 AI**（ChatGPT、Gemini、DeepSeek……）。登录态会被记住，以后不用重登。
2. 程序会自动打开会议创建页面（`http://localhost:3001/meetings/new`）。
3. 选择参会模型、填写主题和目标、勾选“已确认使用最高可用模型”，即可开会。

**停止程序**：关闭那个启动时打开的终端 / 命令行窗口即可。

---

## 数据存在哪

所有数据都在程序文件夹下的 `.local-data/`：

- `.local-data/db/` — 会议数据库
- `.local-data/meetings/` — 上传的原文件与导出的纪要
- `.local-data/browser-profile/` — 受控 Chrome 的登录态

删除该文件夹即可清空所有数据（包括登录态）。

---

## 常见问题

- **程序会不会一直抢占我的屏幕**：不会。受控 Chrome **默认后台静默运行**——开会时不会再把窗口切到最前面打断你。你可以去忙别的，等收到“会议完成”通知或想看进度时，再切回去 / 在自己浏览器打开 `http://localhost:3001` 查看。想实时盯着 AI 操作，可设环境变量 `MEETINGROOM_FOREGROUND=1` 启动。
- **弹出的 Chrome 里没登录就开会了**：每个参会模型都要在受控窗口登录；未登录的模型会被跳过或报错。开会前可在创建页点“检测登录状态”。
- **某个模型不发言/报错**：通常是该网站界面改版导致选择器失效，或当时没登录。其它模型仍会照常进行。
- **端口被占用**：默认用 3001，可设置环境变量 `PORT` 更换。

---

## 给开发者

```bash
npm install        # 安装依赖
npm run dev        # 开发模式：后端(3001) + Vite 前端(5173, 热更新)
npm run build      # 构建前端到 web/dist
npm start          # 生产模式：后端在 3001 同时托管前端
```

让 Claude Code / Codex 等 agent 控制会议，见 [docs/MEETING_API.md](docs/MEETING_API.md)。
