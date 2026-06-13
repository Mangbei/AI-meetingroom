#!/bin/bash
# AI Meeting Room — one-click launcher for macOS.
# Double-click this file in Finder. First run installs dependencies and builds
# the UI; later runs start immediately.

cd "$(dirname "$0")" || exit 1

echo "==============================================="
echo "        AI Meeting Room  ·  启动中"
echo "==============================================="

# --- 1. Node.js check (needs >= 22.5 for the built-in SQLite) -----------------
if ! command -v node >/dev/null 2>&1; then
  echo
  echo "[错误] 未检测到 Node.js。"
  echo "请先安装 Node.js 22.5 或更高版本：https://nodejs.org/ （或 brew install node）"
  echo
  read -r -p "按回车键退出..." _
  exit 1
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit((a>22||(a===22&&b>=5))?0:1)'; then
  echo
  echo "[错误] 当前 Node.js 版本为 $(node -v)，需要 22.5 或更高。"
  echo "请升级 Node.js：https://nodejs.org/ （或 brew upgrade node）"
  echo
  read -r -p "按回车键退出..." _
  exit 1
fi

# --- 2. Chrome check (the app drives your installed Chrome) --------------------
if [ ! -d "/Applications/Google Chrome.app" ] \
   && [ ! -d "/Applications/Microsoft Edge.app" ] \
   && [ ! -d "/Applications/Chromium.app" ]; then
  echo
  echo "[提示] 未在 /Applications 找到 Chrome / Edge / Chromium。"
  echo "本程序需要其中之一来驱动网页版 AI。请先安装 Google Chrome：https://www.google.com/chrome/"
  echo
  read -r -p "已安装可忽略，按回车键继续..." _
fi

# --- 3. Install dependencies on first run -------------------------------------
if [ ! -d "node_modules" ]; then
  echo
  echo "[1/2] 首次运行，正在安装依赖（可能需要几分钟）..."
  npm install || { echo "[错误] 依赖安装失败。"; read -r -p "按回车键退出..." _; exit 1; }
fi

# --- 4. Build the web UI -------------------------------------------------------
# Always rebuild: web/dist is git-ignored, so after pulling new code the old
# build would otherwise be served. The build is quick.
echo
echo "[2/2] 正在构建网页界面（确保使用最新代码）..."
npm run build || { echo "[错误] 界面构建失败。"; read -r -p "按回车键退出..." _; exit 1; }

# --- 5. Start ------------------------------------------------------------------
echo
echo "正在启动。稍后会弹出一个受控的 Chrome 窗口："
echo "  · 首次使用请在该窗口登录你要用的 AI（ChatGPT / Gemini / DeepSeek 等）"
echo "  · 然后在自动打开的会议页面创建会议"
echo "关闭本终端窗口即可停止程序。"
echo "-----------------------------------------------"
npm start
