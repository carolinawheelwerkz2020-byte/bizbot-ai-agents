import React from 'react';
import { motion } from 'motion/react';
import { ChevronRight, GitBranch, Plus, Play, Workflow as WorkflowIcon } from 'lucide-react';
import { AGENTS } from '../../services/gemini';
import { BUILTIN_WORKFLOWS, type WorkflowShape } from '../../services/handoffPlan';
import { AgentAvatar, Badge, Button, Card } from './ui';

type WorkflowsViewProps = {
  executeWorkflow: (workflow: WorkflowShape) => Promise<void>;
  onArchitectWorkflow: () => void;
};

export function WorkflowsView({ executeWorkflow, onArchitectWorkflow }: WorkflowsViewProps) {
  return (
    <motion.div
      key="workflows"
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20 }}
      className="flex-1 overflow-y-auto px-10 py-12 custom-scrollbar"
    >
      <div className="max-w-6xl mx-auto space-y-16">
        <div className="flex items-end justify-between border-b border-white/5 pb-10">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-cyber-lime/10 rounded-lg text-cyber-lime">
                <GitBranch size={24} />
              </div>
              <Badge color="lime">Autonomous Orchestration</Badge>
            </div>
            <h2 className="text-5xl font-serif font-black tracking-tighter italic">Operational Pipelines</h2>
            <p className="text-zinc-500 font-medium text-lg max-w-xl">
              Chain specialized agents into powerful automated sequences to achieve complex business outcomes.
            </p>
          </div>
          <Button
            variant="secondary"
            className="!py-5 !px-10 !text-[11px] border-cyber-lime/20 text-cyber-lime hover:bg-cyber-lime hover:text-void"
            icon={Plus}
            onClick={onArchitectWorkflow}
          >
            Architect Workflow
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-20">
          {BUILTIN_WORKFLOWS.map((workflow) => (
            <Card key={workflow.id} className="group hover:border-cyber-lime/30 transition-all duration-500 p-10 space-y-8 glass shadow-2xl">
              <div className="flex items-start justify-between">
                <div className="w-16 h-16 bg-gradient-to-tr from-zinc-900 to-zinc-800 rounded-2xl flex items-center justify-center text-cyber-lime border border-white/10 shadow-xl group-hover:scale-110 transition-transform">
                  <WorkflowIcon size={32} />
                </div>
                <div className="px-3 py-1.5 bg-cyber-lime/10 border border-cyber-lime/20 rounded-xl text-[10px] font-black text-cyber-lime uppercase tracking-widest">
                  Built-in Protocol
                </div>
              </div>

              <div>
                <h3 className="text-2xl font-black mb-3 group-hover:text-cyber-lime transition-colors tracking-tight">{workflow.name}</h3>
                <p className="text-zinc-500 leading-relaxed font-medium">{workflow.description}</p>
              </div>

              <div className="space-y-4">
                <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-700">Workflow Sequence</p>
                <div className="flex items-center gap-3">
                  {workflow.steps.map((step, idx) => {
                    const stepAgent = AGENTS.find((agent) => agent.id === step.agentId);
                    return (
                      <React.Fragment key={idx}>
                        <div className="group/step relative">
                          <AgentAvatar agent={stepAgent || AGENTS[0]} size="sm" />
                          <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1 bg-zinc-900 border border-white/10 rounded-lg text-[9px] font-black uppercase text-white opacity-0 group-hover/step:opacity-100 transition-opacity whitespace-nowrap">
                            {stepAgent?.name}
                          </div>
                        </div>
                        {idx < workflow.steps.length - 1 && <ChevronRight size={14} className="text-zinc-800" />}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>

              <div className="pt-8 border-t border-white/5">
                <Button
                  variant="primary"
                  className="w-full !bg-white/5 !text-white !border-white/10 hover:!bg-cyber-lime hover:!text-void hover:!border-cyber-lime hover:glow-blue"
                  icon={Play}
                  onClick={() => executeWorkflow(workflow)}
                >
                  Deploy Pipeline
                </Button>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
