import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  BarChart3,
  Bot,
  Globe,
  Layers,
  LayoutDashboard,
  PackagePlus,
  Play,
  RefreshCcw,
  Share2,
  Sparkles,
  Target,
  Wrench,
  Video,
} from 'lucide-react';
import { AutonomyService, type AutonomyOverview } from '../../services/autonomy';
import { Badge, Button, Card, cn } from './ui';

type ToolboxViewProps = {
  handleLaunchTool: (toolId: string) => void;
  onLog?: (message: string, type?: 'info' | 'warn' | 'success' | 'agent') => void;
};

type ActionState = {
  kind: 'success' | 'error';
  title: string;
  detail: string;
};

const toolboxCards = [
  { id: 'dashboard', name: 'Shop Dashboard', desc: 'Multi-tenant CRM & pipeline management.', icon: LayoutDashboard, color: 'bg-cyber-blue' },
  { id: 'analytics', name: 'Market Intelligence', desc: 'Deep data insights and trend analysis.', icon: BarChart3, color: 'bg-indigo-500' },
  { id: 'knowledge', name: 'Brain Sync', desc: 'Centralized institutional memory and SOPs.', icon: Layers, color: 'bg-stone-500' },
  { id: 'social', name: 'Content Engine', desc: 'Cross-platform viral content generation.', icon: Share2, color: 'bg-cyber-rose' },
  { id: 'leads', name: 'Lead Velocity', desc: 'High-conversion lead identification.', icon: Target, color: 'bg-orange-500' },
];

const initialOverview: AutonomyOverview = {
  registeredTools: [],
  healingRecipes: [],
  relay: {
    allowedCommands: [],
    allowedRoots: [],
  },
  limits: {
    maxHealingSteps: 0,
    maxFetchedPageChars: 0,
    maxCrawlPages: 0,
  },
};

function formatCommandResult(result: Record<string, unknown>) {
  const sections: string[] = [];
  if (typeof result.exitCode === 'number') {
    sections.push(`Exit code: ${result.exitCode}`);
  }
  if (typeof result.stdout === 'string' && result.stdout.trim()) {
    sections.push(`STDOUT\n${result.stdout.trim()}`);
  }
  if (typeof result.stderr === 'string' && result.stderr.trim()) {
    sections.push(`STDERR\n${result.stderr.trim()}`);
  }
  if (sections.length === 0) {
    return 'No command output was returned.';
  }
  return sections.join('\n\n');
}

export function ToolboxView({ handleLaunchTool, onLog }: ToolboxViewProps) {
  const [overview, setOverview] = useState<AutonomyOverview>(initialOverview);
  const [isLoadingOverview, setIsLoadingOverview] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actionState, setActionState] = useState<ActionState | null>(null);
  const [selectedOutput, setSelectedOutput] = useState<string>('');
  const [isSelfHealing, setIsSelfHealing] = useState(false);
  const [runningToolId, setRunningToolId] = useState<string | null>(null);
  const [runningRecipeId, setRunningRecipeId] = useState<string | null>(null);
  const [toolForm, setToolForm] = useState({
    id: '',
    description: '',
    command: '',
    cwd: '',
  });
  const [packageForm, setPackageForm] = useState({
    packageName: '',
    saveDev: true,
  });
  const [recipeForm, setRecipeForm] = useState({
    id: '',
    description: '',
    stepsJson: JSON.stringify([
      { type: 'command', value: 'npm run lint' },
      { type: 'command', value: 'npm run build' },
    ], null, 2),
  });

  const relaySummary = useMemo(() => {
    if (overview.relay.allowedCommands.length === 0) {
      return 'Loading relay policy...';
    }
    return overview.relay.allowedCommands.join(', ');
  }, [overview.relay.allowedCommands]);

  const refreshOverview = async (silent = false) => {
    try {
      if (silent) {
        setIsRefreshing(true);
      } else {
        setIsLoadingOverview(true);
      }
      const data = await AutonomyService.getOverview();
      setOverview(data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load autonomy overview.';
      setActionState({
        kind: 'error',
        title: 'Overview failed to load',
        detail: message,
      });
      onLog?.(`Autonomy overview failed: ${message}`, 'warn');
    } finally {
      setIsLoadingOverview(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    void refreshOverview();
  }, []);

  const handleRegisterTool = async () => {
    try {
      const result = await AutonomyService.registerTool({
        id: toolForm.id,
        description: toolForm.description,
        command: toolForm.command,
        cwd: toolForm.cwd || undefined,
      });
      setToolForm({ id: '', description: '', command: '', cwd: '' });
      setActionState({
        kind: 'success',
        title: `Tool "${result.id}" registered`,
        detail: `${result.command}${result.cwd ? ` in ${result.cwd}` : ''}`,
      });
      onLog?.(`Registered tool ${result.id}`, 'success');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to register tool.';
      setActionState({ kind: 'error', title: 'Tool registration failed', detail: message });
      onLog?.(`Tool registration failed: ${message}`, 'warn');
    }
  };

  const handleInstallPackage = async () => {
    try {
      const result = await AutonomyService.installPackage(packageForm.packageName, packageForm.saveDev);
      setActionState({
        kind: 'success',
        title: `Installed ${result.packageName}`,
        detail: formatCommandResult(result as Record<string, unknown>),
      });
      setSelectedOutput(formatCommandResult(result as Record<string, unknown>));
      onLog?.(`Installed package ${result.packageName}`, 'success');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to install package.';
      setActionState({ kind: 'error', title: 'Package install failed', detail: message });
      onLog?.(`Package install failed: ${message}`, 'warn');
    }
  };

  const handleSaveRecipe = async () => {
    try {
      const recipe = await AutonomyService.saveHealingRecipe(recipeForm);
      setActionState({
        kind: 'success',
        title: `Recipe "${recipe.id}" saved`,
        detail: `${recipe.steps.length} recovery steps ready for autonomous use.`,
      });
      onLog?.(`Saved healing recipe ${recipe.id}`, 'success');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to save healing recipe.';
      setActionState({ kind: 'error', title: 'Recipe save failed', detail: message });
      onLog?.(`Healing recipe save failed: ${message}`, 'warn');
    }
  };

  const handleRunTool = async (id: string) => {
    try {
      setRunningToolId(id);
      const result = await AutonomyService.runTool(id);
      const detail = formatCommandResult(result as Record<string, unknown>);
      setSelectedOutput(detail);
      setActionState({
        kind: result.exitCode === 0 ? 'success' : 'error',
        title: `Tool "${id}" finished`,
        detail,
      });
      onLog?.(`Ran registered tool ${id}`, result.exitCode === 0 ? 'success' : 'warn');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to run registered tool.';
      setActionState({ kind: 'error', title: `Tool "${id}" failed`, detail: message });
      onLog?.(`Registered tool ${id} failed: ${message}`, 'warn');
    } finally {
      setRunningToolId(null);
    }
  };

  const handleRunRecipe = async (id: string) => {
    try {
      setRunningRecipeId(id);
      const result = await AutonomyService.runHealingRecipe(id);
      const detail = JSON.stringify(result.steps, null, 2);
      setSelectedOutput(detail);
      setActionState({
        kind: result.success ? 'success' : 'error',
        title: `Recipe "${id}" ${result.success ? 'completed' : 'stopped'}`,
        detail,
      });
      onLog?.(`Ran healing recipe ${id}`, result.success ? 'success' : 'warn');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to run healing recipe.';
      setActionState({ kind: 'error', title: `Recipe "${id}" failed`, detail: message });
      onLog?.(`Healing recipe ${id} failed: ${message}`, 'warn');
    } finally {
      setRunningRecipeId(null);
    }
  };

  const handleSelfHeal = async () => {
    try {
      setIsSelfHealing(true);
      const result = await AutonomyService.selfHealProject();
      const detail = JSON.stringify(result.steps, null, 2);
      setSelectedOutput(detail);
      setActionState({
        kind: result.success ? 'success' : 'error',
        title: result.success ? 'Self-heal passed' : 'Self-heal found issues',
        detail,
      });
      onLog?.('Ran project self-heal routine', result.success ? 'success' : 'warn');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to run self-heal routine.';
      setActionState({ kind: 'error', title: 'Self-heal failed', detail: message });
      onLog?.(`Self-heal failed: ${message}`, 'warn');
    } finally {
      setIsSelfHealing(false);
    }
  };

  return (
    <motion.div
      key="toolbox"
      initial={{ opacity: 0, scale: 1.05 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="flex-1 overflow-y-auto px-6 py-8 lg:px-10 lg:py-12 custom-scrollbar"
    >
      <div className="max-w-7xl mx-auto space-y-10">
        <div className="flex flex-col gap-6 border-b border-white/5 pb-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500">
                <Layers size={24} />
              </div>
              <Badge color="gold">Autonomy Control Surface</Badge>
            </div>
            <h2 className="text-4xl lg:text-5xl font-serif font-black tracking-tighter italic">Enterprise Toolbox</h2>
            <p className="text-zinc-500 font-medium text-base lg:text-lg max-w-3xl">
              Monitor what the agents can do, add constrained tools, install approved packages, and trigger recovery routines without leaving the browser.
            </p>
          </div>
          <Button
            variant="secondary"
            icon={RefreshCcw}
            loading={isRefreshing}
            onClick={() => void refreshOverview(true)}
          >
            Refresh Control Surface
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Badge color="blue">Registered Tools</Badge>
              <Wrench size={18} className="text-cyber-blue" />
            </div>
            <div className="text-4xl font-black tracking-tight">{overview.registeredTools.length}</div>
            <p className="text-sm text-zinc-500">Reusable command-backed tools the agents can run without redefining them each time.</p>
          </Card>
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Badge color="lime">Healing Recipes</Badge>
              <Activity size={18} className="text-cyber-lime" />
            </div>
            <div className="text-4xl font-black tracking-tight">{overview.healingRecipes.length}</div>
            <p className="text-sm text-zinc-500">Saved recovery playbooks for build fixes, QA sweeps, and repeatable repair flows.</p>
          </Card>
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Badge color="rose">Relay Policy</Badge>
              <Bot size={18} className="text-cyber-rose" />
            </div>
            <div className="text-sm font-semibold leading-relaxed text-zinc-200">{relaySummary}</div>
            <p className="text-sm text-zinc-500">Only these executables are available when agents create or run custom tools.</p>
          </Card>
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Badge color="gold">Safety Limits</Badge>
              <Sparkles size={18} className="text-amber-400" />
            </div>
            <div className="text-sm font-semibold leading-relaxed text-zinc-200">
              {overview.limits.maxHealingSteps} healing steps max
            </div>
            <p className="text-sm text-zinc-500">Crawls stop at {overview.limits.maxCrawlPages} pages and browser fetches stay bounded for stability.</p>
          </Card>
        </div>

        {actionState && (
          <Card className={cn(
            'p-5 border',
            actionState.kind === 'success' ? 'border-cyber-lime/20 bg-cyber-lime/5' : 'border-cyber-rose/20 bg-cyber-rose/5'
          )}>
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <Badge color={actionState.kind === 'success' ? 'lime' : 'rose'}>
                    {actionState.kind === 'success' ? 'Success' : 'Attention'}
                  </Badge>
                  <h3 className="text-lg font-black tracking-tight">{actionState.title}</h3>
                </div>
                <p className="text-sm whitespace-pre-wrap text-zinc-300">{actionState.detail}</p>
              </div>
              <button
                onClick={() => setActionState(null)}
                className="text-xs uppercase tracking-[0.2em] text-zinc-500 hover:text-white transition-colors"
              >
                Dismiss
              </button>
            </div>
          </Card>
        )}

        <div className="grid grid-cols-1 gap-8 xl:grid-cols-[1.25fr_0.95fr]">
          <div className="space-y-8">
            <Card className="p-6 lg:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">Quick Launch Modules</h3>
                  <p className="text-sm text-zinc-500 mt-2">Keep the original specialist launchers close while the autonomy controls grow around them.</p>
                </div>
                <Badge color="blue">Direct Agent Launch</Badge>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <Card className="p-6 space-y-5 border-cyber-lime/20 hover:border-cyber-lime transition-all group">
                  <div className="w-14 h-14 bg-cyber-lime/10 rounded-2xl flex items-center justify-center text-cyber-lime group-hover:glow-blue transition-all">
                    <Sparkles size={28} />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-lg font-black tracking-tight">Visualizer Engine</h4>
                    <p className="text-zinc-500 text-sm font-medium">Photorealistic rendering and wheel visualization workflows.</p>
                  </div>
                  <Button variant="primary" className="w-full" onClick={() => handleLaunchTool('visualizer')}>
                    Launch Tool
                  </Button>
                </Card>

                <Card className="p-6 space-y-5 border-cyber-blue/20 hover:border-cyber-blue transition-all group">
                  <div className="w-14 h-14 bg-cyber-blue/10 rounded-2xl flex items-center justify-center text-cyber-blue group-hover:glow-blue transition-all">
                    <Globe size={28} />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-lg font-black tracking-tight">SEO Bridge Master</h4>
                    <p className="text-zinc-500 text-sm font-medium">SEO automation, crawling, sitemap work, and indexability checks.</p>
                  </div>
                  <Button variant="primary" className="w-full" onClick={() => handleLaunchTool('seo')}>
                    Generate Sitemap
                  </Button>
                </Card>

                <Card className="p-6 space-y-5 border-purple-500/20 hover:border-purple-500 transition-all group">
                  <div className="w-14 h-14 bg-purple-500/10 rounded-2xl flex items-center justify-center text-purple-500 group-hover:glow-blue transition-all">
                    <Video size={28} />
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-lg font-black tracking-tight">Media Producer Hub</h4>
                    <p className="text-zinc-500 text-sm font-medium">Video scripting, vertical content production, and social campaigns.</p>
                  </div>
                  <Button variant="primary" className="w-full" onClick={() => handleLaunchTool('media')}>
                    Open Producer
                  </Button>
                </Card>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                {toolboxCards.map((tool) => (
                  <button
                    key={tool.id}
                    onClick={() => handleLaunchTool(tool.id)}
                    className="group text-left p-5 rounded-3xl border border-white/5 glass-dark hover:border-white/20 transition-all duration-300"
                  >
                    <div className={cn('w-12 h-12 rounded-2xl flex items-center justify-center text-white mb-4 shadow-2xl group-hover:scale-110 transition-transform', tool.color)}>
                      <tool.icon size={24} />
                    </div>
                    <h4 className="text-sm font-black tracking-tight mb-2">{tool.name}</h4>
                    <p className="text-[11px] text-zinc-500 leading-relaxed">{tool.desc}</p>
                  </button>
                ))}
              </div>
            </Card>

            <Card className="p-6 lg:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">Tool Registry</h3>
                  <p className="text-sm text-zinc-500 mt-2">Teach the agents repeatable commands once, then let them reuse those tools later.</p>
                </div>
                <Badge color="blue">Workspace Commands Only</Badge>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Tool ID</span>
                  <input
                    value={toolForm.id}
                    onChange={(event) => setToolForm((prev) => ({ ...prev, id: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="lint-check"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Working Directory</span>
                  <input
                    value={toolForm.cwd}
                    onChange={(event) => setToolForm((prev) => ({ ...prev, cwd: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="Optional workspace path"
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Description</span>
                  <input
                    value={toolForm.description}
                    onChange={(event) => setToolForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="Checks the project for type and lint regressions."
                  />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Allowed Command</span>
                  <input
                    value={toolForm.command}
                    onChange={(event) => setToolForm((prev) => ({ ...prev, command: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="npm run lint"
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <Button variant="primary" icon={Wrench} onClick={() => void handleRegisterTool()}>
                  Register Tool
                </Button>
                <span className="text-xs text-zinc-500">Allowed executables: {relaySummary}</span>
              </div>

              <div className="grid gap-4">
                {overview.registeredTools.map((tool) => (
                  <Card key={tool.id} className="p-5 border-white/10">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex items-center gap-3">
                          <Badge color="blue">{tool.id}</Badge>
                          <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">Created {new Date(tool.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-sm text-zinc-300">{tool.description}</p>
                        <code className="block text-xs rounded-xl bg-black/30 border border-white/5 px-3 py-2 text-cyber-blue whitespace-pre-wrap break-all">
                          {tool.command}
                        </code>
                        {tool.cwd && (
                          <p className="text-xs text-zinc-500">Working directory: {tool.cwd}</p>
                        )}
                      </div>
                      <Button
                        variant="secondary"
                        icon={Play}
                        loading={runningToolId === tool.id}
                        onClick={() => void handleRunTool(tool.id)}
                      >
                        Run Tool
                      </Button>
                    </div>
                  </Card>
                ))}
                {!isLoadingOverview && overview.registeredTools.length === 0 && (
                  <div className="text-sm text-zinc-500">No registered tools yet. Add your first one above to give the agents a reusable helper.</div>
                )}
              </div>
            </Card>
          </div>

          <div className="space-y-8">
            <Card className="p-6 lg:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">Self-Heal And Packages</h3>
                  <p className="text-sm text-zinc-500 mt-2">Let the app install approved dependencies and run a constrained recovery pass.</p>
                </div>
                <Badge color="gold">Operator Actions</Badge>
              </div>

              <div className="space-y-4">
                <label className="space-y-2 block">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">npm Package</span>
                  <input
                    value={packageForm.packageName}
                    onChange={(event) => setPackageForm((prev) => ({ ...prev, packageName: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="@playwright/test"
                  />
                </label>
                <label className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={packageForm.saveDev}
                    onChange={(event) => setPackageForm((prev) => ({ ...prev, saveDev: event.target.checked }))}
                    className="accent-cyber-blue"
                  />
                  Save as dev dependency
                </label>
                <div className="flex flex-wrap gap-3">
                  <Button variant="secondary" icon={PackagePlus} onClick={() => void handleInstallPackage()}>
                    Install Package
                  </Button>
                  <Button variant="primary" icon={RefreshCcw} loading={isSelfHealing} onClick={() => void handleSelfHeal()}>
                    Run Self-Heal
                  </Button>
                </div>
              </div>
            </Card>

            <Card className="p-6 lg:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">Healing Recipes</h3>
                  <p className="text-sm text-zinc-500 mt-2">Save recovery flows that agents can rerun when the same class of problem shows up again.</p>
                </div>
                <Badge color="lime">Recovery Library</Badge>
              </div>

              <div className="space-y-4">
                <label className="space-y-2 block">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Recipe ID</span>
                  <input
                    value={recipeForm.id}
                    onChange={(event) => setRecipeForm((prev) => ({ ...prev, id: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="repair-build"
                  />
                </label>
                <label className="space-y-2 block">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Description</span>
                  <input
                    value={recipeForm.description}
                    onChange={(event) => setRecipeForm((prev) => ({ ...prev, description: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="Runs lint and build to validate a changed project."
                  />
                </label>
                <label className="space-y-2 block">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Steps JSON</span>
                  <textarea
                    value={recipeForm.stepsJson}
                    onChange={(event) => setRecipeForm((prev) => ({ ...prev, stepsJson: event.target.value }))}
                    className="min-h-48 w-full rounded-3xl bg-black/20 border border-white/10 px-4 py-4 text-sm outline-none focus:border-cyber-blue/40 font-mono"
                  />
                </label>
                <Button variant="primary" icon={Activity} onClick={() => void handleSaveRecipe()}>
                  Save Healing Recipe
                </Button>
              </div>

              <div className="space-y-4">
                {overview.healingRecipes.map((recipe) => (
                  <Card key={recipe.id} className="p-5 border-white/10">
                    <div className="space-y-4">
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-2">
                          <div className="flex items-center gap-3">
                            <Badge color="lime">{recipe.id}</Badge>
                            <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">{recipe.steps.length} steps</span>
                          </div>
                          <p className="text-sm text-zinc-300">{recipe.description}</p>
                        </div>
                        <Button
                          variant="secondary"
                          icon={Play}
                          loading={runningRecipeId === recipe.id}
                          onClick={() => void handleRunRecipe(recipe.id)}
                        >
                          Run Recipe
                        </Button>
                      </div>
                      <div className="space-y-2">
                        {recipe.steps.map((step, index) => (
                          <div key={`${recipe.id}-${index}`} className="rounded-2xl border border-white/5 bg-white/5 px-3 py-2 text-xs text-zinc-400">
                            <span className="font-black text-zinc-200">Step {index + 1}.</span> {step.type} {'->'} {step.value}
                          </div>
                        ))}
                      </div>
                    </div>
                  </Card>
                ))}
                {!isLoadingOverview && overview.healingRecipes.length === 0 && (
                  <div className="text-sm text-zinc-500">No healing recipes saved yet. Create one above so the agents can recover with less guesswork.</div>
                )}
              </div>
            </Card>

            <Card className="p-6 lg:p-8 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">Latest Operator Output</h3>
                  <p className="text-sm text-zinc-500 mt-2">Command output and recovery traces show up here after a run.</p>
                </div>
                <Badge color="rose">Trace Window</Badge>
              </div>

              <div className="rounded-[2rem] border border-white/10 bg-black/30 min-h-64 p-4">
                <pre className="whitespace-pre-wrap break-words text-xs text-zinc-300 font-mono">
                  {selectedOutput || 'Run a tool, recipe, or self-heal action to inspect the latest trace output here.'}
                </pre>
              </div>

              <div className="text-xs text-zinc-500 leading-relaxed">
                Relay roots: {overview.relay.allowedRoots.length > 0 ? overview.relay.allowedRoots.join(' | ') : 'Loading...'}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
