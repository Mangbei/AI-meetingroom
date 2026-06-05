# AI Meeting Room

本地多模型会议室。它不使用官方 AI API，而是驱动你本机浏览器中已经登录的网页端模型，让 ChatGPT、Gemini、DeepSeek 围绕上传资料和议程问题进行多轮讨论，最后生成会议纪要。

## 核心能力

- 使用网页端账号：ChatGPT Plus、Gemini Pro、DeepSeek 网页端
- 不需要 OpenAI / Google / DeepSeek API key
- 支持上传 `.txt` / `.md` 资料
- 支持多个议程问题
- 支持两种会议模式：
  - 接力模式：默认，后一个模型阅读前一个模型的发言后继续
  - 并行模式：三个模型同时回答同一议程，再由主持人综合
- 支持指定主持人 / 最终归纳者
- 会议完成后保存本地 Markdown 和 JSON
- Windows 桌面通知

## 启动

```powershell
cd C:\Users\28574\Desktop\making-debate
npm.cmd install
npm.cmd run dev
```

然后访问：

```text
http://localhost:5173/meetings/new
```

后端运行在：

```text
http://localhost:3001
```

## 浏览器策略

后端自动化浏览器会按这个顺序查找：

```text
Google Chrome -> Chromium -> Microsoft Edge
```

所以在你的电脑上会优先打开 Chrome；如果某台电脑没有 Chrome，才会 fallback 到 Chromium 或 Edge。启动日志会显示实际使用的浏览器和路径，例如：

```text
[launcher] Launching Google Chrome: C:\Program Files\Google\Chrome\Application\chrome.exe
```

如果浏览器安装在特殊位置，可以手动指定：

```powershell
$env:BROWSER_BINARY="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm.cmd run dev
```

## 使用流程

1. 打开 `/meetings/new`
2. 点击“打开/聚焦三家网页”
3. 在受控浏览器里登录并确认模型：
   - ChatGPT：最高 Thinking / Reasoning 模型
   - Gemini：Gemini Pro / 最高 Pro 模型
   - DeepSeek：R1 / 深度思考
4. 上传 `.txt` 或 `.md` 资料
5. 输入会议目标和多个议程问题
6. 选择接力模式或并行模式
7. 选择主持人
8. 勾选每个模型的最高模型确认
9. 点击“开始会议”

## 输出位置

会议完成后，结果会保存到：

```text
.local-data/meetings/<meeting-id>/summary.md
.local-data/meetings/<meeting-id>/meeting.json
```

页面中也可以直接导出 Markdown。

## 重要说明

- 登录、验证码、二次验证、模型下拉选择必须由用户手动完成。
- 程序会打开/聚焦网页，但不会也不应该代替用户登录账号。
- 首版只支持 `.txt` / `.md`，PDF 和 DOCX 需要先转成文本。
- Gemini DOM 适配器是首版，若 Google 页面结构变化，可能需要更新选择器。
