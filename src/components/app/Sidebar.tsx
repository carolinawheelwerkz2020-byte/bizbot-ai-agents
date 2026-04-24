import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  Bot,
  BookOpen,
  Cpu,
  GitBranch,
  Layers,
  Minimize2,
  Settings,
  X,
} from 'lucide-react';
import type { Agent } from '../../services/gemini';
import type { AppView, ApprovalSummary, SystemLog } from './types';
import { AgentAvatar, Badge, GlassButton, cn } from './ui';

type SidebarProps = {
  activeView: AppView;
  isMobileMenuOpen: boolean;
  isSidebarOpen: boolean;
  isHostedLimitedRuntime?: boolean;
  selectedAgent: Agent;
  agents: Agent[];
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  setIsMobileMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setIsSidebarOpen: React.Dispatch<React.SetStateAction<boolean>>;
  setSelectedAgent: React.Dispatch<React.SetStateAction<Agent>>;
  systemLogs: SystemLog[];
  approvalSummary: ApprovalSummary;
};

export function Sidebar({
  activeView,
  isMobileMenuOpen,
  isSidebarOpen,
  isHostedLimitedRuntime = false,
  selectedAgent,
  agents,
  setActiveView,
  setIsMobileMenuOpen,
  setIsSidebarOpen,
  setSelectedAgent,
  systemLogs,
  approvalSummary,
}: SidebarProps) {
  return (
    <AnimatePresence initial={false}>
      {isSidebarOpen && (
        <motion.aside
          initial={{ width: 0, x: -320 }}
          animate={{ width: 320, x: 0 }}
          exit={{ width: 0, x: -320 }}
          className={cn(
            'fixed inset-y-0 left-0 z-50 lg:relative h-full bg-void/80 backdrop-blur-3xl border-r border-white/5 flex flex-col overflow-hidden shadow-2xl transition-all duration-500',
            !isMobileMenuOpen && 'hidden lg:flex'
          )}
        >
          <div className="p-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 bg-gradient-to-tr from-cyber-blue to-blue-400 rounded-xl flex items-center justify-center text-white shadow-[0_0_25px_rgba(59,130,246,0.3)] border border-white/20">
                <Cpu size={22} className="animate-pulse" />
              </div>
              <div>
                <h1 className="text-xl font-black tracking-tighter flex items-center gap-1.5 text-white">
                  BIZBOT <span className="text-cyber-blue glow-text-blue">AI</span>
                </h1>
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge color="blue">Aegis Command v2</Badge>
                  {isHostedLimitedRuntime ? (
                    <span title="Relay, shell, and Playwright require the desktop runtime.">
                      <Badge color="gold">Hosted</Badge>
                    </span>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-zinc-600 hover:text-white hover:bg-white/5 rounded-lg transition-all">
                <Minimize2 size={18} />
              </button>
              <button onClick={() => setIsMobileMenuOpen(false)} className="lg:hidden p-2 text-zinc-600 hover:text-white hover:bg-white/5 rounded-lg transition-all">
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 space-y-8 custom-scrollbar pb-10">
            <div className="space-y-1">
              <p className="px-2 pb-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Core Matrix</p>
              <GlassButton active={activeView === 'chat'} onClick={() => { setActiveView('chat'); setIsMobileMenuOpen(false); }} icon={Activity}>Directives</GlassButton>
              <GlassButton active={activeView === 'agents'} onClick={() => { setActiveView('agents'); setIsMobileMenuOpen(false); }} icon={Bot}>Agent Roster</GlassButton>
              <GlassButton active={activeView === 'workflows'} onClick={() => { setActiveView('workflows'); setIsMobileMenuOpen(false); }} icon={GitBranch}>Pipelines</GlassButton>
              <GlassButton active={activeView === 'toolbox'} onClick={() => { setActiveView('toolbox'); setIsMobileMenuOpen(false); }} icon={Layers}>
                <span className="flex items-center gap-2">
                  Auxiliary
                  {approvalSummary.pendingCount > 0 && (
                    <span className="inline-flex min-w-5 h-5 px-1.5 items-center justify-center rounded-full bg-cyber-rose/20 border border-cyber-rose/30 text-cyber-rose text-[9px] font-black">
                      {approvalSummary.pendingCount}
                    </span>
                  )}
                </span>
              </GlassButton>
            </div>

            <div className="rounded-2xl border border-cyber-rose/10 bg-cyber-rose/5 px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyber-rose/10 text-cyber-rose flex items-center justify-center border border-cyber-rose/20">
                  <AlertTriangle size={16} />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Approvals</div>
                  <div className="text-sm font-black text-white">
                    {approvalSummary.pendingCount > 0
                      ? `${approvalSummary.pendingCount} waiting for review`
                      : 'No pending actions'}
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <p className="px-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Neural Network</p>
              <div className="space-y-1">
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => {
                      setSelectedAgent(agent);
                      setActiveView('chat');
                      setIsMobileMenuOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-3 p-3 rounded-xl transition-all group border',
                      selectedAgent.id === agent.id ? 'bg-white/5 border-white/10 shadow-lg shadow-black/20' : 'border-transparent hover:bg-white/5'
                    )}
                  >
                    <AgentAvatar agent={agent} size="sm" glow={selectedAgent.id === agent.id} />
                    <div className="text-left overflow-hidden">
                      <div className={cn('text-xs font-bold truncate', selectedAgent.id === agent.id ? 'text-white' : 'text-zinc-500 group-hover:text-zinc-300')}>
                        {agent.name}
                      </div>
                      <div className="text-[9px] text-zinc-700 uppercase font-black truncate tracking-tighter">{agent.role}</div>
                    </div>
                    {selectedAgent.id === agent.id && <div className="ml-auto w-1 h-1 rounded-full bg-cyber-blue shadow-[0_0_8px_#3B82F6]" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <p className="px-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Console Output</p>
              <div className="bg-black/40 rounded-2xl p-4 border border-white/5 font-mono text-[10px] space-y-2 overflow-hidden glass-dark">
                {systemLogs.map((log, i) => (
                  <div
                    key={i}
                    className={cn(
                      'flex gap-2 animate-in fade-in slide-in-from-left-2 duration-300',
                      log.type === 'warn' ? 'text-cyber-rose' : log.type === 'success' ? 'text-cyber-lime' : log.type === 'agent' ? 'text-cyber-blue' : 'text-zinc-500'
                    )}
                  >
                    <span className="opacity-30">[{new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                    <span className="truncate">{log.msg}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-white/5 mt-auto bg-void/50">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-zinc-800 to-zinc-700 flex items-center justify-center text-xs font-black border border-white/10">BS</div>
                <div className="text-left">
                  <div className="text-[11px] font-black tracking-tight">BOBBY SANDERLIN</div>
                  <div className="text-[9px] text-zinc-600 uppercase font-bold tracking-widest">Admin Access</div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setActiveView('toolbox');
                  setIsMobileMenuOpen(false);
                }}
                className="flex items-center justify-center gap-2 py-2 bg-white/5 rounded-lg text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all"
              >
                <Settings size={12} /> Config
              </button>
              <button
                onClick={() => {
                  setActiveView('docs');
                  setIsMobileMenuOpen(false);
                }}
                className="flex items-center justify-center gap-2 py-2 bg-white/5 rounded-lg text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all"
              >
                <BookOpen size={12} /> Docs
              </button>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
