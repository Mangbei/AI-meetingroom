# AI Meeting Room

本地多模型会议室。它不使用官方 AI API，而是驱动本机受控浏览器中已经登录的网页端模型，让 ChatGPT、Gemini、DeepSeek 围绕上传资料和议程问题进行多轮讨论，最后生成本地会议纪要。

## 当前 Demo 状态

Demo 已跑通：可以在受控 Chrome 中驱动 ChatGPT、Gemini、DeepSeek 网页端进行多轮会议式对话，全程无需 API key。

当前文件链路：

- 前端支持上传 TXT、MD、PDF、Word、Excel、CSV。
- 后端会把原文件保存到 `.local-data/meetings/<meeting-id>/uploads/`。
- 会议开始时优先把原文件直传给每家网页端 AI。
- 某家上传失败时最多尝试 2 次，仍失败则自动使用后端抽取出的文本资料包兜底。
- 扫描版 PDF/OCR 暂不作为首批目标；遇到无法抽字的图片型 PDF，会保留提示并继续尝试原文件直传。

## 核心能力

- 使用网页端账号：ChatGPT Plus、Gemini Pro、DeepSeek 网页端。
- 不需要 OpenAI / Google / DeepSeek API key。
- 支持多资料上传：`.txt`、`.md`、`.pdf`、`.doc`、`.docx`、`.xls`、`.xlsx`、`.csv`。
- 支持多个议程问题。
- 支持两种会议模式：接力模式、并行模式。
- 支持指定主持人 / 最终归纳者。
- 会议完成后保存本地 Markdown 和 JSON。
- Windows 桌面通知。

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

所以在你的电脑上会优先打开 Chrome；如果某台电脑没有 Chrome，才会 fallback 到 Chromium 或 Edge。启动日志会显示实际使用的浏览器和路径。

也可以手动指定：

```powershell
$env:BROWSER_BINARY="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm.cmd run dev
```

## 使用流程

1. 打开 `/meetings/new`。
2. 点击“打开/聚焦三家网页”。
3. 在受控浏览器里登录，并确认模型档位。
4. 上传资料。
5. 输入会议目标和多个议程问题。
6. 选择接力模式或并行模式。
7. 选择主持人。
8. 勾选每个模型的最高模型确认。
9. 点击“开始会议”。

## 输出位置

会议完成后，结果会保存到：

```text
.local-data/meetings/<meeting-id>/summary.md
.local-data/meetings/<meeting-id>/meeting.json
```

页面中也可以直接导出 Markdown。

## 下一步路线

- 增加 Claude、豆包、智谱、千问等网页端适配器。
- 支持用户从候选模型中选择 2 到 5 个入会。
- 会前连通性检测允许缺席：只要至少 2 个模型连通即可继续，缺席模型会在开始前提示用户确认。
- 增加扫描版 PDF 的 OCR 兜底。

## 重要说明

- 登录、验证码、二次验证、模型下拉选择必须由用户手动完成。
- 程序会打开/聚焦网页，但不会代替用户登录账号。
- 网页端 DOM 会变化；如果某家网站改版，可能需要更新对应适配器选择器。
