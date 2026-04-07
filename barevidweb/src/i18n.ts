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
      hero: {
        badge: "v1.0.0-beta // Pre-Open-Source",
        title1: "GENERATE",
        title2: "REALITY",
        description: "BareVid is an autonomous AI agent that transforms your text into high-fidelity short videos. Built for the cyberpunk era. No exponential fees, just raw compute power.",
        initSequence: "Initialize Sequence",
        viewDocs: "View Documentation",
        freeTrial: "Free Trial",
        openSource: "Open Source"
      },
      terminal: {
        targetPrompt: "TARGET PROMPT",
        promptText: "A cyberpunk city at night, neon lights reflecting on wet pavement, flying cars passing by, cinematic lighting, 8k resolution, highly detailed.",
        systemStatus: "SYSTEM STATUS",
        rendering: "RENDERING",
        complete: "COMPLETE",
        terminalLogs: "TERMINAL LOGS",
        logs: [
          "Initializing DeepSeek reasoning engine...",
          "Parsing prompt semantics...",
          "Generating scene composition...",
          "Allocating compute resources...",
          "Starting diffusion process...",
          "Rendering frame 1/120...",
          "Applying temporal consistency...",
          "Upscaling to 1080p...",
          "Finalizing video output..."
        ]
      },
      works: {
        title1: "GENERATED",
        title2: "WORKS",
        subtitle: "Any aspect ratio. Perfect fidelity.",
        description: "Neural network outputs. Latent space explorations. Visual data streams materialized into reality. Every frame is synthesized in real-time.",
        sideText: "Visual_Data_Stream // Sector 7G // BareVid_Engine",
        archiveRecords: "ARCHIVE_RECORDS",
        stat1Label: "AUTOMATION",
        stat1Value: "Full pipeline — one shot",
        stat2Label: "DIY STYLE",
        stat2Value: "Your look, your rules",
        stat3Label: "SLIDE CONTROL",
        stat3Value: "Tweak every page",
        noVideos: "No showcase clips yet. Drop .mp4 files into public/vidsrc and run npm run vidsrc:manifest.",
        manifestError: "Could not load /vidsrc/manifest.json. Run npm run vidsrc:manifest after adding videos.",
        loadingShowcase: "Loading showcase…"
      },
      pricing: {
        openSourceProtocol: "Open Source Protocol",
        zeroMarkup: "Zero Markup.",
        rawCompute: "Raw Compute.",
        notCommercial: "BareVid is not a commercial SaaS. It's a direct pipeline to raw compute APIs. You pay exactly what the models cost, with zero platform tax.",
        llmInference: "LLM Inference (DeepSeek)",
        atCost: "At Cost",
        visionGen: "Vision Gen (Doubao)",
        platformFee: "Platform Fee / Markup",
        sourceCode: "Source Code",
        selfHost: "Self-Host",
        industryTrap: "The Industry Trap",
        industryTrapDesc: "Competitors charge exponentially more for longer videos due to context window scaling.",
        trueLinearScaling: "True Linear Scaling",
        trueLinearScalingDesc: "Cost remains strictly constant per minute. Theoretical infinite length.",
        softCapped: "(soft-capped at 15m)",
        softCappedTooltip: "To protect the developer's API tokens from bankruptcy, currently soft-capped at 15 mins.",
        costVsDuration: "Cost vs Duration",
        industryStandard: "Industry Standard",
        bareVid: "BareVid",
        videoLength: "Video Length",
        cost: "Cost ($)",
        costHighlight: "~10 min of video for about ¥0.1 in API cost — real-world ballpark.",
        costHighlightNote: "Heavy per-slide tweaking or extra LLM rounds may add roughly another ¥0.1, depending on how much you iterate."
      },
      status: {
        nodeStatus1: "NODE_",
        nodeStatus2: "STATUS",
        indieDevMode: "INDIE_DEV_MODE: ACTIVE",
        coffeeLevel: "COFFEE_LEVEL: CRITICAL",
        deepseekBalance: "DeepSeek Balance",
        deepseekGpuNote: "Can't afford GPUs to self-host an LLM yet",
        doubaoBalance: "Doubao (TTS)",
        workersOnline: "Workers Online",
        registeredUsers: "Registered Users",
        totalProjects: "Total Projects",
        doubaoTrialPlaceholder: "Free trial",
        doubaoCoquiNote: "Planning Coqui TTS self-host — then free for good",
        workersOnlineSub: "Export worker heartbeats (API process)",
        dbAuthRecords: "DB_AUTH_RECORDS",
        renderedVideos: "Rows in projects table",
        proxyService: "Proxy Service",
        proxyDesc1: "Too lazy to write prompts? Don't know how to use this?",
        proxyDesc2: "如果你不会用，可以找我朋友帮你做... 但是需要收取一定费用。资本主义的胜利。",
        visitStore: "Visit Store",
        hireDev: "Hire The Dev",
        hireDesc1: "I built this entire system, but I'm currently unemployed. Need a developer who can build cyberpunk interfaces and AI integrations?",
        hireDesc2: "找不到工作，如果有意愿请联系我。Will code for food.",
        systemFunding: "System Funding",
        fundingDesc1: "APIs and servers aren't free. I'm just a solo developer trying to keep this node online. Scan to drop some credits.",
        totalSupported: "TOTAL SUPPORTED: $420.69",
        fundingDesc2: "累计支持数额。感谢老板打赏。",
        scan: "Scan",
        donate: "Donate"
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
      hero: {
        badge: "v1.0.0-beta // 预开源版本",
        title1: "生成",
        title2: "现实",
        description: "BareVid 是一个自主 AI 代理，可将您的文本转化为高保真短视频。专为赛博朋克时代打造。没有指数级费用，只有纯粹的算力。",
        initSequence: "初始化序列",
        viewDocs: "查看文档",
        freeTrial: "免费试用",
        openSource: "开源代码"
      },
      terminal: {
        targetPrompt: "目标提示词",
        promptText: "夜晚的赛博朋克城市，霓虹灯倒影在潮湿的路面上，飞行汽车呼啸而过，电影级光影，8K 分辨率，极高细节。",
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
        title1: "生成",
        title2: "作品",
        subtitle: "任何宽高比。完美的保真度。",
        description: "神经网络输出。潜在空间探索。视觉数据流具象化为现实。每一帧都是实时合成的。",
        sideText: "视觉数据流 // 7G扇区 // BareVid引擎",
        archiveRecords: "档案记录",
        stat1Label: "自动化",
        stat1Value: "一键生成",
        stat2Label: "DIY 风格",
        stat2Value: "私人定制",
        stat3Label: "自由度",
        stat3Value: "逐页微调",
        noVideos: "暂无展示视频。把 .mp4 放进 public/vidsrc 后执行 npm run vidsrc:manifest。",
        manifestError: "无法加载 /vidsrc/manifest.json。添加视频后请执行 npm run vidsrc:manifest。",
        loadingShowcase: "加载展示视频…"
      },
      pricing: {
        openSourceProtocol: "开源协议",
        zeroMarkup: "零溢价。",
        rawCompute: "纯粹算力。",
        notCommercial: "BareVid 不是商业 SaaS。它是连接底层算力 API 的直通管道。你只需支付模型本身的成本，没有任何平台抽成。",
        llmInference: "大语言模型推理 (DeepSeek)",
        atCost: "成本价",
        visionGen: "语音合成 (豆包)",
        platformFee: "平台手续费 / 溢价",
        sourceCode: "源代码",
        selfHost: "私有化部署",
        industryTrap: "行业陷阱",
        industryTrapDesc: "由于上下文窗口的扩展，竞争对手对更长视频的收费呈指数级增长。",
        trueLinearScaling: "真正的线性扩展",
        trueLinearScalingDesc: "每分钟成本严格保持不变。理论上支持无限长度。",
        softCapped: "(软限制为 15 分钟)",
        softCappedTooltip: "为了防止开发者的 API Token 破产，目前软限制为 15 分钟。",
        costVsDuration: "成本与时长对比",
        industryStandard: "行业标准",
        bareVid: "BareVid",
        videoLength: "视频长度",
        cost: "成本 ($)",
        costHighlight: "10 分钟成片，API 成本约只要一毛钱！",
        costHighlightNote: "逐页微调、多轮改稿，可能再多一毛左右（随调用量浮动）。"
      },
      status: {
        nodeStatus1: "节点_",
        nodeStatus2: "状态",
        indieDevMode: "独立开发者模式：激活",
        coffeeLevel: "咖啡因水平：临界",
        deepseekBalance: "DeepSeek 余额",
        deepseekGpuNote: "暂时买不起能部署 LLM 的显卡",
        doubaoBalance: "豆包（语音）",
        workersOnline: "在线 Worker",
        registeredUsers: "注册用户",
        totalProjects: "累计项目",
        doubaoTrialPlaceholder: "免费试用",
        doubaoCoquiNote: "等我部署 Coqui 就彻底免费",
        workersOnlineSub: "导出 Worker 心跳（单 API 进程内）",
        dbAuthRecords: "数据库认证记录",
        renderedVideos: "projects 表行数",
        proxyService: "代写服务",
        proxyDesc1: "懒得写提示词？不知道怎么用？",
        proxyDesc2: "如果你不会用，可以找我朋友帮你做... 但是需要收取一定费用。资本主义的胜利。",
        visitStore: "访问商店",
        hireDev: "雇佣开发者",
        hireDesc1: "我构建了整个系统，但我目前失业。需要一个能构建赛博朋克界面和 AI 集成的开发者吗？",
        hireDesc2: "找不到工作，如果有意愿请联系我。给口饭吃就行。",
        systemFunding: "系统资金",
        fundingDesc1: "API 和服务器不是免费的。我只是一个试图让这个节点保持在线的独立开发者。扫码支持一下。",
        totalSupported: "累计支持数额: $420.69",
        fundingDesc2: "累计支持数额。感谢老板打赏。",
        scan: "扫码",
        donate: "捐赠"
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
