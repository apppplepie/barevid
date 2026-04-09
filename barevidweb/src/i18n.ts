import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      nav: {
        terminal: "Terminal",
        works: "Works",
        pricing: "Pricing",
        status: "Status"
      },
      header: {
        githubTitle: "GitHub repository",
        blogTitle: "Blog"
      },
      hero: {
        badge: "Thanks to Gemini",
        title1: "BAREVID",
        title2: "白板影像",
        description:
          "BareVid is an automated AI platform: type text, get narrated presentation videos—ultra-low cost, maximum freedom, less grind for your hands and brain.\nBuilt for every boring ask.",
        initSequence: "Try the online app",
        viewDocs: "GitHub",
        freeTrial: "Free Trial",
        openSource: "Open source code"
      },
      terminal: {
        targetPrompt: "Target prompt",
        promptText:
          "Introduce the BAREVID platform in detail—what it can do. Cyberpunk style, 16:9, 30s.",
        systemStatus: "System status",
        rendering: "Rendering",
        complete: "Done",
        terminalLogs: "Terminal logs",
        logs: [
          "Initializing DeepSeek inference engine...",
          "Parsing prompt semantics...",
          "Structuring text...",
          "Choosing a style...",
          "Synthesizing speech...",
          "Encoding slide scenes...",
          "Calling the worker to export video...",
          "Syncing audio and video...",
          "Exporting video..."
        ]
      },
      works: {
        title1: "Video",
        title2: "One-click creation",
        subtitle: "Any aspect ratio, any theme or style.",
        description:
          "School assignments a pain? Work decks a snooze? Science explainers, product intros, data comparisons—with BareVid, one line of prompt gets you script, voice, and slides—auto-produced.",
        sideText: "Visual data stream // Sector 7G // BareVid engine",
        archiveRecords: "Showcase",
        stat2Label: "Auto mode",
        stat2Value: "Fully hands-off, dead simple",
        stat3Label: "Manual mode",
        stat3Value: "Per-slide tweaks, fully custom",
        noVideos: "No showcase clips yet. Drop .mp4 files into public/vidsrc and run npm run vidsrc:manifest.",
        manifestError: "Could not load /vidsrc/manifest.json. Local dev: run npm run vidsrc:manifest after adding videos. Docker: rebuild/restart the image — the container regenerates the list from the mounted vidsrc folder.",
        loadingShowcase: "Loading showcase…",
        clipBadge: "Showcase clip"
      },
      pricing: {
        openSourceProtocol: "Open source",
        zeroMarkup: "Ultra-low cost",
        rawCompute: "Long videos",
        notCommercial:
          "Need dozens of minutes or more? With BareVid you only pay model cost—via API, both TTS and LLM are at-cost.",
        llmInference: "LLM inference (LLM)",
        atCost: "At cost",
        visionGen: "Speech synthesis (TTS)",
        platformFee: "Platform fee / markup",
        industryTrap: "Industry trap",
        industryTrapDesc: "Most platforms charge exponentially more for longer videos.",
        trueLinearScaling: "True linear scaling",
        trueLinearScalingDesc: "Cost per minute stays strictly flat.",
        softCapped: "(soft cap: 15 minutes)",
        softCappedTooltip: "To keep my compute from going bust, there’s a 15-minute soft cap for now.",
        costVsDuration: "Cost vs. duration",
        industryStandard: "Industry standard",
        bareVid: "BareVid",
        videoLength: "Video length",
        cost: "Cost ($)",
        costHighlight: "A 10-minute long video for pocket change—one run, one dime!",
        costHighlightNote: "Per-slide tweaks and many revision rounds can double that (depends on usage)."
      },
      status: {
        nodeStatus1: "Online platform",
        nodeStatus2: "Status",
        indieDevMode: "Server has 4 GB RAM",
        coffeeLevel: "Could explode any second",
        deepseekBalance: "DeepSeek balance",
        deepseekGpuNote: "Can't afford GPUs to self-host an LLM yet",
        doubaoBalance: "Doubao (voice)",
        workersOnline: "Workers online",
        registeredUsers: "Registered users",
        totalProjects: "Total projects",
        doubaoTrialPlaceholder: "Free trial",
        doubaoCoquiNote: "Once I deploy Coqui, it’ll be free for good",
        workersOnlineSub: "Distributed nodes that stitch videos together",
        dbAuthRecords: "Database auth records",
        renderedVideos: "Videos rendered",
        proxyService: "Done-for-you service",
        proxyDesc1: "Don't want to write prompts? Not sure how to use it?",
        proxyDesc2:
          "You can hire someone to do it for you—for a fee—e.g. this shop on Xianyu; I'll pretend I don't know the place.",
        visitStore: "Visit store",
        hireDev: "Hire a developer",
        hireDesc1: "Thinking about building automated AI agents?",
        hireDesc2:
          "Reach out—happy to help. I need a desk and reimbursable tokens; I don't do old-school coding.",
        systemFunding: "Project funding",
        fundingDesc1: "How to sponsor?",
        totalSupported: "WeChat tip: ¥5",
        fundingDesc2:
          "APIs and servers aren't free; ongoing updates take time too—you can support me in keeping this project alive.",
        scan: "Scan QR"
      }
    }
  },
  zh: {
    translation: {
      nav: {
        terminal: "终端",
        works: "作品",
        pricing: "定价",
        status: "状态"
      },
      header: {
        githubTitle: "GitHub 仓库",
        blogTitle: "博客"
      },
      hero: {
        badge: "感谢Gemini",
        title1: "BAREVID",
        title2: "白板影像",
        description: "BareVid 是一个自动化 AI 平台，输入文字生成演播视频，极低成本极高自由，解放你的大脑与双手。\n为应付各种无聊的需求而生。",
        initSequence: "在线平台试用",
        viewDocs: "GitHub",
        freeTrial: "免费试用",
        openSource: "开源代码"
      },
      terminal: {
        targetPrompt: "目标提示词",
        promptText: "介绍一下BAREVID平台,详细说说它能干哪些事儿，赛博朋克风格，16:9，30s",
        systemStatus: "系统状态",
        rendering: "渲染中",
        complete: "已完成",
        terminalLogs: "终端日志",
        logs: [
          "正在初始化 DeepSeek 推理引擎...",
          "正在解析提示词语义...",
          "正在结构化文本...",
          "正在决定风格...",
          "正在合成语音内容...",
          "正在编码场景页面...",
          "正在调用worker导出视频...",
          "正在音画同步...",
          "正在导出视频..."
        ]
      },
      works: {
        title1: "视频",
        title2: "一键生成",
        subtitle: "任何宽高比，任何主题风格。",
        description: "学校的作业太难搞？单位汇报太无聊？科普知识，介绍产品，对比数据，选择BareVid，只需一句话，文案配音演示自动出片！",
        sideText: "视觉数据流 // 7G扇区 // BareVid引擎",
        archiveRecords: "作品展示",
        stat2Label: "自动方案",
        stat2Value: "全程脱手，傻瓜操作",
        stat3Label: "手动方案",
        stat3Value: "逐页微调，私人定制",
        noVideos: "暂无展示视频。把 .mp4 放进 public/vidsrc 后执行 npm run vidsrc:manifest。",
        manifestError: "无法加载 /vidsrc/manifest.json。本地开发：添加视频后执行 npm run vidsrc:manifest。Docker：重新构建并启动镜像即可，容器会根据挂载目录自动生成清单。",
        loadingShowcase: "加载展示视频…",
        clipBadge: "展示片段"
      },
      pricing: {
        openSourceProtocol: "开源协议",
        zeroMarkup: "极低成本",
        rawCompute: "超长视频",
        notCommercial: "你的视频需要几十分钟以上？选择BareVid，只需支付模型本身的成本，调用 API 的情况下 TTS 和 LLM 都是成本价。",
        llmInference: "大语言模型推理 (LLM)",
        atCost: "成本价",
        visionGen: "语音合成 (TTS)",
        platformFee: "平台手续费 / 溢价",
        industryTrap: "行业陷阱",
        industryTrapDesc: "多数平台对更长视频的收费呈指数级增长。",
        trueLinearScaling: "真正的线性扩展",
        trueLinearScalingDesc: "每分钟成本严格保持不变。",
        softCapped: "(软限制为 15 分钟)",
        softCappedTooltip: "为了防止我的算力破产，目前软限制为 15 分钟。",
        costVsDuration: "成本与时长对比",
        industryStandard: "行业标准",
        bareVid: "BareVid",
        videoLength: "视频长度",
        cost: "成本 ($)",
        costHighlight: "10 分钟的长视频，一次只要一毛钱！",
        costHighlightNote: "逐页微调、多轮改稿，可能翻倍（随调用量浮动）。"
      },
      status: {
        nodeStatus1: "在线平台",
        nodeStatus2: "状态",
        indieDevMode: "服务器只有4G内存",
        coffeeLevel: "随时可能爆炸",
        deepseekBalance: "DeepSeek 余额",
        deepseekGpuNote: "暂时买不起能部署 LLM 的显卡",
        doubaoBalance: "豆包（语音）",
        workersOnline: "在线 Worker",
        registeredUsers: "注册用户",
        totalProjects: "累计项目",
        doubaoTrialPlaceholder: "免费试用",
        doubaoCoquiNote: "等我部署 Coqui 就彻底免费",
        workersOnlineSub: "负责合成视频的分布式节点",
        dbAuthRecords: "数据库认证记录",
        renderedVideos: "已渲染视频",
        proxyService: "代办服务",
        proxyDesc1: "懒得写提示词？不知道怎么用？",
        proxyDesc2: "或许你可以考虑找个人帮你做，但需要付出一点费用，比如说咸鱼上找这家，我会假装不认识这家店。",
        visitStore: "访问商店",
        hireDev: "雇佣开发者",
        hireDesc1: "正在考虑自动化 AI Agent 的开发？",
        hireDesc2: "联系我，乐意帮你实现，给我一个可以报销token的工位，因为我不会古法编程。",
        systemFunding: "系统资金",
        fundingDesc1: "如何成为赞助者？",
        totalSupported: "微信捐款：5元",
        fundingDesc2: "API 和服务器不是免费的，项目持续更新也需要时间，你可以支持我继续维护这个项目。",
        scan: "扫码"
      }
    }
  }
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: "zh",
    fallbackLng: "en",
    interpolation: {
      escapeValue: false
    }
  });

export default i18n;
