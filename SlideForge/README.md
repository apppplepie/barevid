# SlideForge（骨架 + 最小流程）

当前实现：杂乱文本 → **DeepSeek** 整理为播客口吻（大标题 / 小标题两层）→ **豆包语音合成**（默认火山 [HTTP V3 单向流式](https://www.volcengine.com/docs/6561/1598757)，可选 [V1 非流式](https://www.volcengine.com/docs/6561/1257584)）按小标题逐段合成 **编号音频**（`001.mp3` …）。前端为极简 React 页面。

## 准备

1. **Python 3.10+**，在 `backend` 下建虚拟环境并安装依赖：

   ```powershell
   cd D:\workspace\code\SlideForge\backend
   python -m venv .venv
   .\.venv\Scripts\pip install -r requirements.txt
   ```

2. 在 `backend\.env` 中填入 `DEEPSEEK_API_KEY`，以及豆包语音：`DOUBAO_TTS_APP_ID`、`DOUBAO_TTS_ACCESS_TOKEN`（[控制台](https://console.volcengine.com/speech/app) 创建应用获取；鉴权见 [文档](https://www.volcengine.com/docs/6561/1105162)）。默认走 **V3**（`DOUBAO_TTS_USE_V3=true`），需设置 `DOUBAO_TTS_RESOURCE_ID`（语音合成 **2.0** 音色用 `seed-tts-2.0`，与控制台资源 ID 一致，见 [V3 文档](https://www.volcengine.com/docs/6561/1598757)）。可选：`DOUBAO_TTS_VOICE_TYPE`（默认 `zh_male_m191_uranus_bigtts` 为 2.0 音色，须与 `DOUBAO_TTS_RESOURCE_ID` 同版本，见 [音色列表](https://www.volcengine.com/docs/6561/1257544)）。若需退回旧版接口可设 `DOUBAO_TTS_USE_V3=false` 并保留 `DOUBAO_TTS_CLUSTER`。默认会请求字级时间轴并写入库（V3 为 `enable_subtitle`）；若报错可设 `DOUBAO_TTS_WITH_TIMESTAMP=false`。

   **存储目录**：默认使用本机用户数据目录下的 `SlideForge/storage`（Windows 一般为 `%LOCALAPPDATA%\SlideForge\storage`），避免与 `uvicorn --reload` 同目录写文件导致反复重启。若你已有数据在仓库内 `backend/storage`，只要其中存在 `slideforge.db` 会自动沿用该路径。也可在 `.env` 中设置 `STORAGE_ROOT=D:/你的路径` 显式指定。

3. **Node.js**，安装前端依赖（`frontend`）：

   ```powershell
   cd D:\workspace\code\SlideForge\frontend
   npm install
   ```

## 运行

终端 1（后端，工作目录为 `backend`）：

```powershell
cd D:\workspace\code\SlideForge\backend
.\.venv\Scripts\uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000
```

（`--reload-dir app` 只监视 `app/` 源码，减轻对 `storage`、脚本等目录的误触发；若仍异常可先去掉 `--reload` 验证。）

终端 2（前端，`frontend`）：

```powershell
cd D:\workspace\code\SlideForge\frontend
npm run dev
```

浏览器打开 `http://localhost:3000`（与 `package.json` 中 Vite 端口一致），粘贴文本后点击「整理并生成语音」。

- **SQLite 数据库**：`<STORAGE_ROOT>/slideforge.db`（启动时自动建表；`STORAGE_ROOT` 见上文）
- **音频目录**：`<STORAGE_ROOT>/projects/<project_id>/audio/001.mp3` …（旧数据可能为 `.wav`）
- 接口返回 `project_id`，并通过 Vite 代理访问 `/media/...` 播放音频。
- 项目列表：`GET http://127.0.0.1:8000/api/projects`
- 项目详情：`GET http://127.0.0.1:8000/api/projects/<project_id>`（含每段 `narration_text`、`duration_ms`、`audio_url`）

## 说明

- 数据表：`projects`、`slides`（含每段 `duration_ms`，由生成后的 WAV 计算）。
- `app/workers/` 仍为队列占位。
- 若某环境下 `.wav` 播放异常，可将 `app/services/pipeline.py` 中的扩展名改为 `.mp3` 再试。

## Export Video

This project can auto-play a deck and export it to a video file by recording the
playback page and muxing audio with ffmpeg.

Prerequisites:
- Backend + frontend are running.
- fmpeg is available in PATH.
- Playwright is installed (Python): pip install playwright and python -m playwright install chromium`n
Run:

`powershell
cd D:\workspace\code\test\barevid
python worker\export_video.py --project-id 123
``n
Output will be written under ackend\storage\projects\<project_id>\exports\....
