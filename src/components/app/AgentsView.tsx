import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Bot, Gauge, Plus, ShieldCheck } from 'lucide-react';
import type { Agent } from '../../services/gemini';
import { DiagnosticsService, type ServerDiagnostics } from '../../services/diagnostics';
import type { AppView } from './types';
import { AgentAvatar, Badge, Button, Card } from './ui';

type AgentsViewProps = {
  setActiveView: React.Dispatch<React.SetStateAction<AppView>>;
  setSelectedAgent: React.Dispatch<React.SetStateAction<Agent>>;
  agents: Agent[];
  /** Firebase Hosting: worker-backed agents still chat; relay/shell are unavailable. */
  isHostedLimitedRuntime?: boolean;
};

const initialDiagnostics: ServerDiagnostics = {
  storageMode: 'local-json',
  workerAuthMode: 'dev-fallback',
  heartbeatTtlMs: 0,
  executionTimeouts: {
    localCommandMs: 0,
    remoteWorkerMs: 0,
    browserActionMs: 0,
  },
  onlineWorkers: [],
  pendingApprovals: 0,
  recentExecutionFailures: [],
};

const AGENT_CAPABILITY_TAGS: Record<string, string[]> = {
  router: ['memory', 'routing', 'fetch', 'handoff'],
  'strategy-advisor': ['strategy', 'memory', 'research'],
  'project-manager': ['planning', 'tasks', 'memory'],
  sales: ['pipeline', 'follow-up', 'memory'],
  'lead-gen': ['leads', 'outreach', 'memory'],
  'customer-support': ['tickets', 'tone', 'memory'],
  'social-media': ['content', 'calendar', 'memory'],
  'content-production': ['copy', 'assets', 'memory'],
  'seo-strategist': ['seo', 'fetch', 'research'],
  'product-dev': ['specs', 'roadmap', 'memory'],
  'software-architect': ['design', 'apis', 'memory'],
  automation: ['tools', 'scheduler', 'workflows'],
  finance: ['analysis', 'reporting', 'memory'],
  'data-analyst': ['metrics', 'insights', 'memory'],
  'dashboard-ops': ['dashboard', 'workflow', 'handoff'],
  'service-advisor': ['intake', 'scheduling', 'customers'],
  'growth-operator': ['seo', 'reviews', 'revenue'],
  'market-researcher': ['research', 'fetch', 'competitive'],
  legal: ['compliance', 'contracts', 'memory'],
  'knowledge-base': ['memory', 'docs', 'sops'],
  'system-coder': ['shell', 'files', 'diagnostics'],
  'qa-expert': ['shell', 'files', 'tests', 'diagnostics'],
};

function getAgentCapabilities(agent: Agent): string[] {
  return AGENT_CAPABILITY_TAGS[agent.id] ?? ['chat', 'memory', 'handoff'];
}

export function AgentsView({ setActiveView, setSelectedAgent, agents, isHostedLimitedRuntime = false }: AgentsViewProps) {
  const [diagnostics, setDiagnostics] = useState<ServerDiagnostics>(initialDiagnostics);
  const [diagnosticsError, setDiagnosticsError] = useState('');

  useEffect(() => {
    let cancelled = false;

    DiagnosticsService.getServer()
      .then((data) => {
        if (!cancelled) {
          setDiagnostics(data);
          setDiagnosticsError('');
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setDiagnosticsError(error instanceof Error ? error.message : 'Diagnostics unavailable.');
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const executionStatus = useMemo(() => {
    if (diagnostics.onlineWorkers.length > 0) {
      return `${diagnostics.onlineWorkers.length} worker${diagnostics.onlineWorkers.length === 1 ? '' : 's'} online`;
    }
    return 'Local relay ready';
  }, [diagnostics.onlineWorkers.length]);

  const initializeAgent = () => {
    const routerAgent = agents.find((agent) => agent.id === 'router') || agents[0];
    setSelectedAgent(routerAgent);
    setActiveView('chat');
  };

  return (
    <motion.div
      key="agents"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex-1 overflow-y-auto px-10 py-12 custom-scrollbar"
    >
      <div className="max-w-6xl mx-auto space-y-16">
        <div className="flex flex-col gap-6 border-b border-white/5 pb-10 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyber-blue/10 rounded-lg text-cyber-blue">
                <Bot size={24} />
              </div>
              <Badge color="blue">Global Intelligence Network</Badge>
            </div>
            <h2 className="text-5xl font-serif font-black tracking-tighter italic">Neural Roster</h2>
            <p className="text-zinc-500 font-medium text-lg max-w-xl">
              Deploy specialized AI protocols to manage every facet of your business operations.
            </p>
            <div className="flex flex-wrap gap-2">
              {isHostedLimitedRuntime && (
                <span title="Shell, relay, npm, and Playwright run only with the desktop app and local server.">
                  <Badge color="gold">Hosted · cloud-safe</Badge>
                </span>
              )}
              <Badge color={diagnosticsError ? 'rose' : 'lime'}>{diagnosticsError ? 'Diagnostics issue' : executionStatus}</Badge>
              <Badge color={diagnostics.workerAuthMode === 'api-key' ? 'lime' : 'gold'}>Worker auth: {diagnostics.workerAuthMode}</Badge>
              <Badge color={diagnostics.pendingApprovals > 0 ? 'rose' : 'blue'}>{diagnostics.pendingApprovals} approvals</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" className="!py-5 !px-8 !text-[11px]" icon={Gauge} onClick={() => setActiveView('toolbox')}>
              Worker Diagnostics
            </Button>
            <Button variant="primary" className="!py-5 !px-10 !text-[11px]" icon={Plus} onClick={initializeAgent}>
              Initialize Agent
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
          {agents.map((agent) => {
            const capabilities = getAgentCapabilities(agent);
            const workerBacked = capabilities.some((capability) =>
              ['fetch', 'shell', 'files', 'seo', 'tests', 'diagnostics', 'tools', 'scheduler', 'workflows'].includes(capability),
            );
            const ready =
              isHostedLimitedRuntime ||
              !workerBacked ||
              diagnostics.onlineWorkers.length > 0 ||
              diagnostics.storageMode === 'local-json';

            return (
              <Card key={agent.id} className="group hover:border-cyber-blue/30 transition-all duration-700 p-10 space-y-8 flex flex-col hover:shadow-[0_30px_60px_-15px_rgba(0,0,0,0.5)]">
                <div className="flex items-start justify-between">
                  <div className="relative">
                    <AgentAvatar agent={agent} size="lg" glow />
                    <div className="absolute -bottom-2 -right-2 w-6 h-6 bg-void rounded-lg border border-white/10 flex items-center justify-center text-cyber-lime">
                      <ShieldCheck size={14} />
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <Badge color={agent.id === 'router' ? 'rose' : 'blue'}>
                      {agent.id === 'router' ? 'System Gateway' : 'Specialized'}
                    </Badge>
                    <Badge color={ready ? 'lime' : 'gold'}>
                      {ready ? (isHostedLimitedRuntime && workerBacked ? 'Chat ready · tools limited' : 'Ready') : 'Needs worker'}
                    </Badge>
                  </div>
                </div>

                <div className="flex-1">
                  <h3 className="text-2xl font-black mb-2 group-hover:text-cyber-blue transition-colors tracking-tight">{agent.name}</h3>
                  <p className="text-[11px] text-zinc-700 uppercase font-black tracking-[0.25em] mb-4">{agent.role}</p>
                  <p className="text-sm text-zinc-500 leading-relaxed group-hover:text-zinc-400 transition-colors">{agent.description}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {capabilities.map((capability) => (
                    <span key={capability} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-zinc-400">
                      {capability}
                    </span>
                  ))}
                </div>

                <div className="pt-8 border-t border-white/5 flex items-center justify-between">
                  <div className="text-[9px] font-black uppercase tracking-widest text-zinc-700">
                    {workerBacked ? executionStatus : 'Universal tool'}
                  </div>
                  <button
                    onClick={() => {
                      setSelectedAgent(agent);
                      setActiveView('chat');
                    }}
                    className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center text-zinc-600 hover:bg-cyber-blue hover:text-white hover:shadow-[0_0_15px_rgba(59,130,246,0.5)] transition-all"
                  >
                    <ArrowRight size={18} />
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </motion.div>
  );
}
