# AI Meeting Room

本地多模型会议室。它不使用官方 AI API, 而是驱动本机受控浏览器中已经登录的网页端模型, 让 ChatGPT、Gemini、DeepSeek 围绕上传资料和会议议程进行多轮讨论, 最后生成本地会议纪要。

## 当前 Demo 状态

Demo 已跑通: 可以在受控 Chrome 中驱动 ChatGPT、Gemini、DeepSeek 网页端进行多轮会议式对话, 全程无需 API key。

当前文件链路:

- 前端支持上传 TXT、MD、PDF、Word、Excel、CSV。
- 后端会把原文件保存到 `.local-data/meetings/<meeting-id>/uploads/`。
- 会议开始时优先把原文件直传给每家网页端 AI。
- 某家上传失败时最多尝试 2 次, 仍失败则自动使用后端抽取出的文本资料包兜底。
- 扫描版 PDF/OCR 暂不作为首批目标。遇到无法抽字的图片型 PDF, 会保留提示并继续尝试原文件直传。

## 核心能力

- 使用网页端账号: ChatGPT Plus、Gemini Pro、DeepSeek 网页端。
- 不需要 OpenAI / Google / DeepSeek API key。
- 支持多资料上传: `.txt`、`.md`、`.pdf`、`.doc`、`.docx`、`.xls`、`.xlsx`、`.csv`。
- 支持主持人先根据主题和附件自动拟定 3-5 个议程。
- 支持人工确认页: 用户可以编辑、增删、排序议程后再开始会议。
- 支持接力模式和并行模式。
- 支持每个议程设置 1-5 轮讨论, 默认 2 轮。
- 支持每个模型设置讨论姿态: 协作、默认、反骨。
- 支持指定主持人 / 最终归纳者。
- 支持运行控制台: 展示模型打开、准备、发言、错误、缺席, 以及文件直传/文本兜底状态。
- 支持缺席机制: 选择 2 到 5 位模型, 当前已接入 ChatGPT、Gemini、DeepSeek。开始后只要至少 2 位准备成功即可继续。
- 支持模型分工提示: 不同 AI 会被要求从结构化方案、资料综合、反方推理等不同角度发言。
- 会议完成后保存本地 Markdown 和 JSON。
- 支持 Windows 桌面通知。

## 已确认未接入

这些模型已经在候选列表中预留, 但当前版本确认还没有网页端适配器, 不会被用户选中:

- Claude
- 豆包
- 智谱
- 通义千问

后续接入它们时, 需要为每家补齐网页打开、登录检测、模型档位确认、附件上传、发送消息、读取回复这些适配器能力。

## 启动

```powershell
cd C:\Users\28574\Desktop\making-debate
npm.cmd install
npm.cmd run dev
```

然后访问:

```text
http://localhost:5173/meetings/new
```

后端运行在:

```text
http://localhost:3001
```

## 浏览器策略

后端自动化浏览器会按这个顺序查找:

```text
Google Chrome -> Chromium -> Microsoft Edge
```

所以在你的电脑上会优先打开 Chrome。如果某台电脑没有 Chrome, 才会 fallback 到 Chromium 或 Edge。启动日志会显示实际使用的浏览器和路径。

也可以手动指定:

```powershell
$env:BROWSER_BINARY="C:\Program Files\Google\Chrome\Application\chrome.exe"
npm.cmd run dev
```

## 使用流程

1. 打开 `/meetings/new`。
2. 点击“打开/聚焦三家网页”。
3. 在受控浏览器里登录, 并确认每家的最高模型档位。
4. 上传资料。
5. 输入会议标题和会议目标。
6. 可选: 填写已有议程提示, 作为主持人拟定议程的参考。
7. 选择接力模式或并行模式, 设置每个议程讨论轮数。
8. 选择主持人和参会模型。
9. 勾选每个模型的最高模型确认。
10. 点击“生成议程草案”。
11. 在人工确认页编辑、增删、排序议程。
12. 点击“确认议程并开始会议”。

## 输出位置

会议完成后, 结果会保存到:

```text
.local-data/meetings/<meeting-id>/summary.md
.local-data/meetings/<meeting-id>/meeting.json
```

页面中也可以直接导出 Markdown。

## 下一步路线

- 为 Claude、豆包、智谱、通义千问增加网页端适配器。
- 增加议程中途人工介入: 暂停、追加追问、跳过某位模型。
- 增强主持人控场: 自动追问、总结共识、标注分歧点、生成行动清单。
- 增加扫描版 PDF 的 OCR 兜底。

## 重要说明

- 登录、验证码、二次验证、模型下拉选择必须由用户手动完成。
- 程序会打开/聚焦网页, 但不会代替用户登录账号。
- 网页端 DOM 会变化。如果某家网站改版, 可能需要更新对应适配器选择器。
