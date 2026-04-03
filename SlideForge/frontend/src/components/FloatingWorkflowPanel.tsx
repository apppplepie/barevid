import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { Wand2, Sparkles, ChevronRight, FileText, Mic, Image as ImageIcon, Scissors } from 'lucide-react';

export function FloatingWorkflowPanel() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="absolute top-4 right-4 z-30 flex flex-col items-end gap-2">
      <motion.div
        initial={false}
        animate={{ width: expanded ? 320 : 48, height: expanded ? 'auto' : 48 }}
        className="relative"
      >
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="absolute inset-0 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 light:border-slate-300 bg-zinc-900 light:bg-white text-zinc-300 light:text-slate-600 shadow-xl transition-all hover:border-purple-500/50 hover:text-white light:hover:text-purple-600 hover:shadow-[0_0_15px_rgba(168,85,247,0.3)]"
          >
            <Wand2 className="h-5 w-5" />
          </button>
        )}

        {expanded && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="w-full bg-zinc-900/95 light:bg-white/95 backdrop-blur-xl border border-zinc-700/50 light:border-slate-200 rounded-2xl shadow-2xl p-4 flex flex-col gap-4"
          >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-zinc-100 light:text-slate-900 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-400" />
                AI Workflow
              </h3>
              <button
                type="button"
                onClick={() => setExpanded(false)}
                className="rounded-md p-1 text-zinc-500 light:text-slate-400 transition-colors hover:bg-zinc-800 light:hover:bg-slate-100 hover:text-zinc-300 light:hover:text-slate-700"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <WorkflowTool icon={<FileText />} label="Script Gen" color="blue" />
              <WorkflowTool icon={<Mic />} label="Voice Clone" color="purple" active />
              <WorkflowTool icon={<ImageIcon />} label="B-Roll Gen" color="emerald" />
              <WorkflowTool icon={<Scissors />} label="Auto Edit" color="orange" />
            </div>

            <div className="p-3 bg-zinc-950/50 light:bg-slate-50 rounded-xl border border-zinc-800 light:border-slate-200 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-500/5 to-blue-500/5" />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-zinc-400 light:text-slate-600 font-medium">当前任务</div>
                  <div className="text-[10px] text-purple-400 font-mono">65%</div>
                </div>
                <div className="text-sm text-zinc-200 light:text-slate-800 leading-snug">生成语音克隆为 "开场白" 脚本...</div>
                <div className="mt-3 h-1.5 bg-zinc-800 light:bg-slate-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full bg-gradient-to-r from-purple-500 to-blue-500"
                    initial={{ width: "0%" }}
                    animate={{ width: "65%" }}
                    transition={{ duration: 2, ease: "easeOut" }}
                  />
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

function WorkflowTool({ icon, label, color, active }: { icon: ReactNode, label: string, color: 'blue' | 'purple' | 'emerald' | 'orange', active?: boolean }) {
  const colorMap = {
    blue: 'hover:bg-blue-500/10 hover:border-blue-500/30 hover:text-blue-400',
    purple: 'hover:bg-purple-500/10 hover:border-purple-500/30 hover:text-purple-400',
    emerald: 'hover:bg-emerald-500/10 hover:border-emerald-500/30 hover:text-emerald-400',
    orange: 'hover:bg-orange-500/10 hover:border-orange-500/30 hover:text-orange-400',
  };

  const activeMap = {
    blue: 'bg-blue-500/10 border-blue-500/50 text-blue-400 shadow-[0_0_10px_rgba(59,130,246,0.2)]',
    purple: 'bg-purple-500/10 border-purple-500/50 text-purple-400 shadow-[0_0_10px_rgba(168,85,247,0.2)]',
    emerald: 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.2)]',
    orange: 'bg-orange-500/10 border-orange-500/50 text-orange-400 shadow-[0_0_10px_rgba(249,115,22,0.2)]',
  };

  return (
    <button
      type="button"
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3 transition-all group ${active ? activeMap[color] : `border-zinc-800 light:border-slate-200 bg-zinc-950/50 light:bg-slate-50 text-zinc-400 light:text-slate-500 ${colorMap[color]}`}`}
    >
      <div className="[&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </div>
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}
