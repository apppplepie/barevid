# Barevid · 白板影像

**Barevid** 是一套「**大段文章/一句话指令 → 带配音的幻灯片视频**」的开源自动化方案。放弃每秒钟生成像素点，改用 **结构化讲稿 + 分页放映 + TTS** 做出 **讲解型** 的小视频——**一次生成10分钟的视频成本几乎只要0.1元**。


| 入口 | 链接 |
|------|------|
| **宣传站**（介绍、定价叙事、状态页） | [barevidweb.creepender.top](https://barevidweb.creepender.top/) |
| **在线应用**（直接做项目、出片） | [barevid.creepender.top](https://barevid.creepender.top/) |
| **源码** | [github.com/apppplepie/barevid](https://github.com/apppplepie/barevid) |
| **作者博客**（有反馈往这边放，但需要注册账号） | [creepender.top](https://creepender.top/) |

## 线上平台当前小限制

在线版目前先把 **单个视频时长限制在 3 分钟内**。

主要是服务器眼下只剩 **30G 存储空间**，而且还是一台 **4G 小机器**，网络偶尔也会失联术。视频一长，导出文件、缓存、上传下载和重试都会明显变重，所以这个限制属于**迫不得已的配置**。

如果你是自部署玩家，这个限制可以在后端环境变量里自己调大：`MAX_TARGET_NARRATION_MINUTES`。

## 不想折腾？有代办

如果你现在的情况是：

- 网络时好时坏，在线平台不一定稳稳打开
- 不想自己部署，也不想慢慢研究环境变量
- 只想赶紧把片子做出来

那也可以直接走一个省心路线：我朋友在闲鱼接 **Barevid 私人定制代做**，适合想快速出片的人。

- 闲鱼店链接：[这是我的闲鱼号，快来看看吧](https://m.tb.cn/h.inNhqmi?tk=xeeZ5UCPdRn)

收费的，但胜在省事。

---

## 我们的优势？

### 1. 成本低，而且「线性」

钱主要花在 **大模型编写 HTML 画面** 和 **语音合成** 上，**没有按视频秒数给「生成画面」厂商交税**。片子变长，大致是 **多念几句、多写几个 HTML** 的增量。

和 Runway 一类 **按 credits/秒** 的像素生成路线比，Barevid 更适合 **课、汇报、科普、内部培训** 这种 **信息密度高、画面不必电影级** 的~~糊弄任务~~场景。

### 2. 能自动化：批量、脱手、少折腾

管线设计成 **「一段提示 → 脚本 / 配音 / 演示画面」自动变成小视频**——**适合想少动手、把重复劳动交给流程的人**。

### 3. 自由度高：每一页都能手写

如果自动化的结果不满意，你也可以对结果进行改动，不是**一条 prompt 出来就只能全盘接受**：

- **逐页改台词、改节奏**——改一页不必整条重生成。
- **每一步都可以反复重来**——页面不满意就重跑 LLM，某段声音不对就重跑 TTS。
- **风格可以自己写进提示词**——主题、语气、版式方向都能往 prompt 里塞。


---

## 这和「一键 AI 成片（像素级）」有什么不一样？

| 路线 | 在干什么 | 成本直觉 |
|------|----------|----------|
| **像素级文生视频** | 直接生成镜头、运动、光影 | 常按 **秒 / credits** 计费；改一句台词往往 **整段重跑**。 |
| **Barevid** | **幻灯 + 时间轴 + TTS** | 主要为 **token + TTS** 付费；**时长和「念完」绑定**，而不是和「每一帧假视频」绑定。 |

## 也有代价!

省钱的代价是 **时间**。从「各段合成好了」到「手里有一个可下载的成片」，中间还要 **导出编码（常见是 Worker 按真实时间轴录屏 + ffmpeg）** 和 **传到你本地**，整体体感经常是：**等多久 ≈ 成片时长的 1.5 倍左右**（机器负载、分辨率、网络会有浮动）。也就是10min的时间可能需要15min才能合成好，视频越长合成的时间越长，如果要自行调整将会耗时更长，如果你懒得登上网站等待，也可以直接走上面的[闲鱼代做](https://m.tb.cn/h.inNhqmi?tk=xeeZ5UCPdRn)路线（当然这是收费的）。

---

## 仓库里到底有什么？

```
barevid/
├── docker-compose.yml   # 根目录一键：MySQL + SlideForge 后端/前端 + 导出 Worker（推荐）
├── barevidweb/          # 可选：对外宣传站（Vite/React）；默认 compose 不包含，需单独部署见该目录
├── SlideForge/          # 主应用：FastAPI 后端 + Vite/React 前端（亦可单独 docker compose）
├── worker/              # 导出 Worker：Playwright + ffmpeg；根 compose 会构建并运行
└── README.md            # 本文件
```

- **SlideForge**：自托管时你要起的 **后端 + 前端**；目录名是历史遗留，**和对外叫 Barevid 不冲突**。
- **worker**：可以理解成 **专门干重活的导出节点**——不占满 API 进程；一台机器跑也行，多台机器一起 **分布式拉任务** 也行（用约定密钥跟后端对话）。

当前一条典型链路（实现可换供应商）：**杂乱文本 → LLM 整理结构 → TTS 按段出音 → LLM写每一页 HTML 代码作为画面演示 → 前端按真实时长走时间轴 →（可选）Worker 录屏编码成 mp4**。**段级时长回写**，减少「画面对不上嘴」的玄学。

---

## 后期计划？

优先级按成本排：

1. **Coqui 等本地 TTS**：把语音合成压到 **零 API 账单**。代价可能是更长的等待时间（但为了降低成本这是可接受的，毕竟原本就已经等的够长了，不少那几分钟）。
2. **声线克隆 / 自定义音色**：这意味着你可以克隆自己的语音假装视频是自己古法制作~~更好的糊弄任务~~。
3. **自动塞图**：提示词或规则驱动，把给定素材 **插进对应页**。
4. **自动图表**：数据进来 → 页面上 **出图、出表**，更精准的数据对比。
5. **打包做成桌面应用**：完全实现私人部署（然而我本身是写前端的，实现这个完全取决于我的 AI 能不能自己写完）。

欢迎 PR：**文档、国际化、Coqui 集成示例、Docker Compose 一键起全栈** 等。

---

## 快速开始

### Docker 一键（SlideForge + Worker）

适合：**clone 整仓**后在一台机子上用 Docker 跑通编辑与**视频导出**（需 Docker Compose **v2.24+**，支持 `include`）。

1. 安装 [Docker Desktop](https://www.docker.com/products/docker-desktop/)（Windows 建议启用 WSL2 后端）。
2. 复制 `SlideForge/backend/.env.example` → `SlideForge/backend/.env`，填写 `DEEPSEEK_API_KEY`、豆包 TTS、`EXPORT_WORKER_TOKEN` 等（与 [SlideForge/README.md](./SlideForge/README.md)「准备」一致）。
3. 复制仓库根 `.env.example` → `.env`，设置 `EXPORT_WORKER_TOKEN`（须与 `SlideForge/backend/.env` 里同名变量一致；根 `.env` 会经 compose 注入后端与 Worker，覆盖同名项）。
4. 在**仓库根目录**执行：

   ```powershell
   cd D:\workspace\code\test\barevid
   docker compose up -d --build --quiet-build
   ```

   `--quiet-build` 会**隐藏构建日志**（含 Worker 镜像），终端少一大截输出；拉基础镜像时若仍嫌吵，可再加 `--quiet-pull`。

5. 浏览器打开 `http://127.0.0.1:3000`；API `http://127.0.0.1:8000`；MySQL `127.0.0.1:3307`。

仅起 SlideForge 三件套（**不要** Worker）、或只拉镜像不 build：见 **[SlideForge/README.md](./SlideForge/README.md)** 的 Docker 小节。

**服务器上**已用 `scripts/dbp.ps1` push 新镜像后要更新容器，在仓库根建议：

```powershell
docker compose pull --policy always
docker compose up -d --build --quiet-build
```

`pull --policy always` 避免 `:latest` 仍用宿主机旧层；含 Worker 时保留 `--build` 以便必要时重编 worker 镜像。

### 服务器目录（扁平部署，不等同于 clone 整仓）

文档里常以仓库里的 **`SlideForge/`** 为「compose 工作目录」。若你在机器上**只同步主应用这一块**，目录可以和仓库不同名，只要 **相对关系与 `SlideForge/docker-compose.yml` 一致** 即可。

示例（常见）：

```
/srv/barevid/
├── docker-compose.yml      # 内容与 SlideForge/docker-compose.yml 对齐（或同文件）
├── docker/                 # 对应仓库 SlideForge/docker/（含 mysql-init/barevid.sql）
├── storage/                # 对应 SlideForge/storage
├── backend/                # 对应 SlideForge/backend（含 .env）
├── barevidweb/             # 可选，对应仓库 barevidweb/（宣传站单独 build，主 compose 可不包含）
├── .env                    # 可选，给 compose 做变量替换（镜像名、EXPORT_*、bind 等）
├── backend/.env            # 后端密钥，必填项见 SlideForge/backend/.env.example
└── nginx-test.conf         # 自建边缘反代时用，与 compose 无强耦合
```

在此布局下在 **`/srv/barevid`** 执行 `docker compose pull --policy always` 与 `docker compose up -d` 即可；**不要**要求本机必须存在名为 `SlideForge` 的目录，关键是 **`./storage`、`./docker/...`、`backend/.env` 相对 compose 文件的路径正确**。

若你使用**仓库根**的 `docker-compose.yml`（含 Worker、`include`），则仍须在**含 `SlideForge/`、`worker/` 的整仓克隆**下运行；扁平服务器上通常只用 **SlideForge 那份**三件套 compose，Worker 另机跑或再单独同步 `worker/`。

### 本机开发（无 Docker）

细节以 **[SlideForge/README.md](./SlideForge/README.md)** 为准：

1. 配置并启动 **SlideForge/backend**（Python）与 **SlideForge/frontend**（Node）。
2. 按需配置 **worker/.env** 与后端的导出相关环境变量，启动 `worker_export_video.py`。

---

## 命名约定（给协作者扫盲）

- **Barevid**：产品 / 仓库对外名称（「白板影像」）。
- **SlideForge**：仓库里主应用的目录名；服务器路径、镜像 tag 继续叫 SlideForge **完全 OK**，文档里对上号就行。

---

## 开源说明

作者以开源形式维护本仓库。**第一次用这个我也不知道怎么搞**。

---

### 参考：市面「像素视频」定价量级（以官网为准，会变）

对比用时请自行查阅各平台当前价目：例如 Runway API 文档中的 [pricing 说明](https://docs.dev.runwayml.com/guides/pricing/)（credits/秒一类）。Barevid 不替代电影感镜头工具，只是 **另一条更省钱、更可控的赛道**。
