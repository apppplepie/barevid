import { useState, useEffect, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Users, Database, Clock, Cpu, Video, Briefcase, ShoppingCart, QrCode, ExternalLink, Heart, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** 与后端默认一致；须小于边缘 nginx 的 proxy_read_timeout（常见 60s） */
const STATS_WAIT_TIMEOUT_SEC = 55;

type BarevidPublicStats = {
  deepseek_balance_display: string;
  doubao_trial_display: string;
  workers_online: number;
  user_count: number;
  project_count: number;
  /** 口播目标时长上限（分钟）；与 SlideForge 后端 MAX_TARGET_NARRATION_MINUTES 一致 */
  max_target_narration_minutes?: number;
  /** 每账号项目数上限；与 MAX_PROJECTS_PER_USER 一致，0 表示不限制 */
  max_projects_per_user?: number;
};

function apiBase(): string {
  return (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '') ?? '';
}

function statsUrl(): string {
  return `${apiBase()}/api/public/barevid-stats`;
}

function statsWaitUrl(): string {
  return `${apiBase()}/api/public/barevid-stats/wait?timeout=${STATS_WAIT_TIMEOUT_SEC}`;
}

/** 后端 DeepSeek 余额常为 `USD 0.00 · CNY 14.63`；中文只展示人民币一段为 `14.63元` */
function formatDeepseekBalanceZh(raw: string): string {
  const parts = raw.split(/\s*·\s*/);
  for (const p of parts) {
    const m = p.trim().match(/^CNY\s+(.+)$/i);
    if (m) return `${m[1].trim()}元`;
  }
  if (/^\d+(\.\d+)?$/.test(raw.trim())) return `${raw.trim()}元`;
  return raw;
}

const CyberCard = ({ children, className = "", delay = 0, themeColor = "primary" }: { children: ReactNode, className?: string, delay?: number, themeColor?: "secondary" | "primary" | "muted" }) => {
  const themeMap = {
    primary: {
      border: "border-primary/30 hover:border-primary/60",
      corner: "border-primary/80",
      gradient: "from-primary/10",
      scan: "bg-primary/50"
    },
    secondary: {
      border: "border-secondary/30 hover:border-secondary/60",
      corner: "border-secondary/80",
      gradient: "from-secondary/10",
      scan: "bg-secondary/50"
    },
    muted: {
      border: "border-white/20 hover:border-white/40",
      corner: "border-white/50",
      gradient: "from-white/5",
      scan: "bg-white/30"
    }
  };

  const t = themeMap[themeColor];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, filter: 'blur(5px)' }}
      whileInView={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay }}
      className={`relative bg-black/60 backdrop-blur-md border ${t.border} p-5 group overflow-hidden flex flex-col transition-colors ${className}`}
      style={{ clipPath: 'polygon(0 0, calc(100% - 15px) 0, 100% 15px, 100% 100%, 15px 100%, 0 calc(100% - 15px))' }}
    >
      <div className={`absolute top-0 left-0 w-2 h-2 border-t-2 border-l-2 ${t.corner}`} />
      <div className={`absolute bottom-0 right-0 w-2 h-2 border-b-2 border-r-2 ${t.corner}`} />
      <div className={`absolute inset-0 bg-gradient-to-br ${t.gradient} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none`} />
      <div className={`absolute top-0 left-0 w-full h-[1px] ${t.scan} opacity-0 group-hover:opacity-100 group-hover:animate-[scan_2s_linear_infinite] pointer-events-none`} />
      <div className="relative z-10 h-full flex flex-col">
        {children}
      </div>
    </motion.div>
  );
};

const StatBox = ({ title, value, sub, icon: Icon, colorClass }: any) => (
  <div className="bg-white/5 border border-white/10 p-4 rounded-sm relative overflow-hidden group hover:border-white/30 transition-colors">
    <div className={`absolute top-0 left-0 w-1 h-full ${colorClass} opacity-50 group-hover:opacity-100 transition-opacity`} />
    <div className="flex justify-between items-start mb-2">
      <span className="text-white/50 font-mono text-xs uppercase tracking-widest">{title}</span>
      <Icon size={16} className="text-white/30 group-hover:text-white/80 transition-colors" />
    </div>
    <div className="text-3xl font-black text-white tracking-tighter">{value}</div>
    {sub ? <div className="text-xs font-mono text-white/40 mt-1">{sub}</div> : null}
  </div>
);

const PAY_QR_SRC = '/pic/pay.png';

export function ServerStatus() {
  const { t, i18n } = useTranslation();
  const [stats, setStats] = useState<BarevidPublicStats | null>(null);
  const [payModalOpen, setPayModalOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadOnce = async () => {
      try {
        const res = await fetch(statsUrl(), { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        setStats((await res.json()) as BarevidPublicStats);
      } catch {
        /* 保持占位 */
      }
    };

    const waitLoop = async () => {
      await loadOnce();
      while (!cancelled) {
        try {
          const res = await fetch(statsWaitUrl(), { cache: 'no-store' });
          if (!res.ok) {
            await new Promise((r) => window.setTimeout(r, 5000));
            continue;
          }
          const data = (await res.json()) as BarevidPublicStats;
          if (!cancelled) setStats(data);
        } catch {
          if (!cancelled) await new Promise((r) => window.setTimeout(r, 5000));
        }
      }
    };

    void waitLoop();
    return () => {
      cancelled = true;
    };
  }, []);

  const fmt = (n: number) =>
    new Intl.NumberFormat(i18n.language?.startsWith('zh') ? 'zh-CN' : 'en-US').format(n);

  const deepseekRaw = (stats?.deepseek_balance_display || '').trim();
  const deepseekDisplay =
    !deepseekRaw
      ? '—'
      : i18n.language?.startsWith('zh')
        ? formatDeepseekBalanceZh(deepseekRaw)
        : deepseekRaw;
  const doubaoVal =
    (stats?.doubao_trial_display || '').trim() || t('status.doubaoTrialPlaceholder');
  const workersVal = stats !== null ? fmt(stats.workers_online) : '—';
  const usersVal = stats !== null ? fmt(stats.user_count) : '—';
  const projectsVal = stats !== null ? fmt(stats.project_count) : '—';

  return (
    <section id="status" className="min-h-screen w-full snap-start pt-20 pb-12 px-4 md:px-6 relative overflow-hidden flex flex-col justify-center">
      <div className="max-w-6xl mx-auto w-full relative z-10 flex flex-col h-full">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-end justify-between mb-8 gap-4 border-b border-primary/20 pb-4">
          <div>
            <h2 className="text-3xl md:text-4xl font-black tracking-tighter uppercase relative inline-block">
              <span className="relative text-white glitch-text" data-text={t('status.nodeStatus1') + t('status.nodeStatus2')}>
                {t('status.nodeStatus1')}<span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-secondary">{t('status.nodeStatus2')}</span>
              </span>
            </h2>
          </div>
          <div className="hidden md:flex flex-col items-end font-mono text-xs text-secondary/70">
            <span>{t('status.indieDevMode')}</span>
            <span>{t('status.coffeeLevel')}</span>
          </div>
        </div>

        {/* Telemetry Data (No Charts, Just Hard Data) */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
          <StatBox
            title={t('status.deepseekBalance')}
            value={deepseekDisplay}
            sub={t('status.deepseekGpuNote')}
            icon={Database}
            colorClass="bg-primary"
          />
          <StatBox
            title={t('status.doubaoBalance')}
            value={doubaoVal}
            sub={t('status.doubaoCoquiNote')}
            icon={Cpu}
            colorClass="bg-secondary"
          />
          <StatBox
            title={t('status.workersOnline')}
            value={workersVal}
            sub={t('status.workersOnlineSub')}
            icon={Clock}
            colorClass="bg-primary"
          />
          <StatBox
            title={t('status.registeredUsers')}
            value={usersVal}
            sub={t('status.dbAuthRecords')}
            icon={Users}
            colorClass="bg-secondary"
          />
          <StatBox
            title={t('status.totalProjects')}
            value={projectsVal}
            sub={t('status.renderedVideos')}
            icon={Video}
            colorClass="bg-primary"
          />
        </div>

        {/* The "Real Talk" Indie Dev Section */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 flex-1">
          
          {/* Mercenary / Friend's Shop */}
          <CyberCard delay={0.1} themeColor="secondary">
            <div className="flex items-center gap-3 mb-4 text-secondary">
              <ShoppingCart size={24} />
              <h3 className="font-black tracking-widest uppercase text-lg">{t('status.proxyService')}</h3>
            </div>
            <p className="text-base text-white/70 font-mono mb-4 flex-1">
              {t('status.proxyDesc1')} 
              <br/><br/>
              <span className="text-white/50 text-sm">{t('status.proxyDesc2')}</span>
            </p>
            <a href="#" className="flex items-center justify-center gap-2 w-full py-3 bg-secondary/10 border border-secondary/50 text-secondary hover:bg-secondary hover:text-black transition-all font-bold uppercase tracking-widest text-sm">
              {t('status.visitStore')} <ExternalLink size={14} />
            </a>
          </CyberCard>

          {/* Hire Me */}
          <CyberCard delay={0.2} themeColor="primary">
            <div className="flex items-center gap-3 mb-4 text-primary">
              <Briefcase size={24} />
              <h3 className="font-black tracking-widest uppercase text-lg">{t('status.hireDev')}</h3>
            </div>
            <p className="text-base text-white/70 font-mono mb-4 flex-1">
              {t('status.hireDesc1')}
              <br/><br/>
              <span className="text-white/50 text-sm">{t('status.hireDesc2')}</span>
            </p>
            <a href="mailto:necromancerappplepie@gmail.com" className="flex items-center justify-center w-full py-3 bg-primary/10 border border-primary/50 text-primary hover:bg-primary hover:text-black transition-all font-bold uppercase tracking-widest text-sm">
              <span className="break-all text-center">necromancerappplepie@gmail.com</span>
            </a>
          </CyberCard>

          {/* Donate / Sponsor */}
          <CyberCard delay={0.3} themeColor="secondary">
            <div className="flex items-center gap-3 mb-4 text-secondary">
              <Heart size={24} />
              <h3 className="font-black tracking-widest uppercase text-lg">{t('status.systemFunding')}</h3>
            </div>
            <p className="text-base text-white/70 font-mono mb-4 flex-1">
              {t('status.fundingDesc1')}
              <br/><br/>
              <span className="text-secondary/80 text-sm font-bold">{t('status.totalSupported')}</span>
              <br/>
              <span className="text-white/50 text-sm">{t('status.fundingDesc2')}</span>
            </p>
            <button
              type="button"
              onClick={() => setPayModalOpen(true)}
              className="w-full flex items-center justify-center gap-2 py-3 bg-secondary/10 border border-secondary/50 text-secondary hover:bg-secondary hover:text-black transition-all font-bold uppercase tracking-widest text-sm"
            >
              <QrCode size={16} /> {t('status.scan')}
            </button>
          </CyberCard>

        </div>

      </div>

      {payModalOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/92 p-4 md:p-8"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pay-modal-title"
          onClick={() => setPayModalOpen(false)}
        >
          <div
            className="relative w-full max-w-sm flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-4">
              <h3 id="pay-modal-title" className="text-lg font-black tracking-wide text-white">
                {t('status.scan')}
              </h3>
              <button
                type="button"
                onClick={() => setPayModalOpen(false)}
                className="shrink-0 w-10 h-10 rounded-sm border border-white/20 flex items-center justify-center text-white hover:bg-white/10 hover:border-white/40 transition-colors"
                aria-label="Close"
              >
                <X size={20} />
              </button>
            </div>
            <div className="rounded-sm overflow-hidden border border-white/10 bg-black">
              <img src={PAY_QR_SRC} alt="" className="w-full h-auto object-contain max-h-[min(70vh,512px)]" />
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes scan {
          0% { transform: translateY(0); opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { transform: translateY(100%); opacity: 0; }
        }
      `}</style>
    </section>
  );
}
