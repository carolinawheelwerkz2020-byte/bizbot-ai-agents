import React from 'react';
import { motion } from 'motion/react';
import { BookOpen, Cpu, GitBranch, Layers, LayoutDashboard, Mail, Monitor, ShieldCheck } from 'lucide-react';
import { CWW_BUSINESS_CONTEXT } from '../../lib/businessContext';
import { Badge, Card } from './ui';

export function DocsView() {
  return (
    <motion.div
      key="docs"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="flex-1 overflow-y-auto px-10 py-12 custom-scrollbar"
    >
      <div className="max-w-5xl mx-auto space-y-10 pb-20">
        <div className="space-y-4 border-b border-white/5 pb-10">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyber-blue/10 text-cyber-blue">
              <BookOpen size={24} />
            </div>
            <Badge color="blue">System Guide</Badge>
          </div>
          <h2 className="text-5xl font-serif font-black tracking-tighter italic">BizBot Docs</h2>
          <p className="text-zinc-500 text-lg max-w-2xl">
            Quick reference for the controls in Aegis Command. Every button on the shell now routes somewhere useful.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card className="p-7 space-y-4 md:col-span-2">
            <LayoutDashboard className="text-cyber-blue" />
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-xl font-black">CWW Dashboard Automation</h3>
              <Badge color="blue">{CWW_BUSINESS_CONTEXT.firebaseProjectId}</Badge>
            </div>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Use Dashboard Ops, Service Advisor, and Growth Operator to plan work around leads, jobs, customers, follow-ups,
              reporting, SEO, and reviews. The live dashboard is {CWW_BUSINESS_CONTEXT.dashboardUrl}.
            </p>
          </Card>

          <Card className="p-7 space-y-4">
            <Cpu className="text-cyber-blue" />
            <h3 className="text-xl font-black">Directives</h3>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Main chat workspace. Pick an agent from the Neural Network list, type a directive, attach files, or use voice input.
            </p>
          </Card>

          <Card className="p-7 space-y-4">
            <Monitor className="text-cyber-lime" />
            <h3 className="text-xl font-black">Agent Roster</h3>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Browse every specialized BizBot agent. The arrow on each card selects that agent and opens Directives.
            </p>
          </Card>

          <Card className="p-7 space-y-4">
            <GitBranch className="text-cyber-lime" />
            <h3 className="text-xl font-black">Pipelines</h3>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Launch built-in multi-agent workflows. Architect Workflow opens a directive prompt for creating a new pipeline.
            </p>
          </Card>

          <Card className="p-7 space-y-4">
            <Layers className="text-cyber-blue" />
            <h3 className="text-xl font-black">Auxiliary / Config</h3>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Operational control center for approvals, registered tools, schedules, browser traces, relay policy, and worker status.
            </p>
          </Card>

          <Card className="p-7 space-y-4">
            <Mail className="text-cyber-rose" />
            <h3 className="text-xl font-black">Email Estimate Scanner</h3>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Read-only Gmail integration for finding estimate and quote requests. It drafts lead summaries and reply suggestions,
              but does not send or modify email without approval.
            </p>
          </Card>

          <Card className="p-7 space-y-4 md:col-span-2">
            <ShieldCheck className="text-cyber-lime" />
            <h3 className="text-xl font-black">Safety Model</h3>
            <p className="text-sm text-zinc-500 leading-relaxed">
              Shell, filesystem, package install, self-heal, and worker-only tools stay behind command policies, workspace root restrictions,
              and approval gates. The UI controls the work; execution routes through the main API.
            </p>
          </Card>
        </div>
      </div>
    </motion.div>
  );
}
