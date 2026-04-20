import React from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Bot, Plus, ShieldCheck } from 'lucide-react';
import { AGENTS, type Agent } from '../../services/gemini';
import { AgentAvatar, Badge, Button, Card } from './ui';

type AgentsViewProps = {
  setActiveView: React.Dispatch<React.SetStateAction<'chat' | 'agents' | 'workflows' | 'toolbox'>>;
  setSelectedAgent: React.Dispatch<React.SetStateAction<Agent>>;
};

export function AgentsView({ setActiveView, setSelectedAgent }: AgentsViewProps) {
  return (
    <motion.div
      key="agents"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex-1 overflow-y-auto px-10 py-12 custom-scrollbar"
    >
      <div className="max-w-6xl mx-auto space-y-16">
        <div className="flex items-end justify-between border-b border-white/5 pb-10">
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
          </div>
          <Button variant="primary" className="!py-5 !px-10 !text-[11px]" icon={Plus}>
            Initialize Agent
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
          {AGENTS.map((agent) => (
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
                  <div className="flex gap-1.5">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="w-1.5 h-1.5 rounded-full bg-cyber-lime shadow-[0_0_8px_#A3E635]" />
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex-1">
                <h3 className="text-2xl font-black mb-2 group-hover:text-cyber-blue transition-colors tracking-tight">{agent.name}</h3>
                <p className="text-[11px] text-zinc-700 uppercase font-black tracking-[0.25em] mb-4">{agent.role}</p>
                <p className="text-sm text-zinc-500 leading-relaxed group-hover:text-zinc-400 transition-colors">{agent.description}</p>
              </div>

              <div className="pt-8 border-t border-white/5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex -space-x-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="w-8 h-8 rounded-xl border-2 border-void bg-zinc-900 flex items-center justify-center text-[10px] font-black text-zinc-600">
                        {i}
                      </div>
                    ))}
                  </div>
                  <span className="text-[9px] font-black uppercase tracking-widest text-zinc-700">Capabilities</span>
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
          ))}
        </div>
      </div>
    </motion.div>
  );
}
