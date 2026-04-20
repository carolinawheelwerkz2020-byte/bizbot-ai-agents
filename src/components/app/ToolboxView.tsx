import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  BarChart3,
  Bot,
  CalendarClock,
  Globe,
  Gauge,
  Layers,
  LayoutDashboard,
  PackagePlus,
  Play,
  RefreshCcw,
  RotateCcw,
  Share2,
  Sparkles,
  Target,
  Wrench,
  Video,
} from 'lucide-react';
import { AutonomyService, type ApprovalActionType, type AutonomyOverview, type BrowserTraceEntry, type PendingApproval, type ScheduledJobTargetType, type UserRole } from '../../services/autonomy';
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
  approvals: [],
  approvalPolicy: {
    register_tool: { requestRole: 'operator', approveRole: 'approver' },
    install_npm_package: { requestRole: 'approver', approveRole: 'admin' },
    save_healing_recipe: { requestRole: 'operator', approveRole: 'approver' },
    run_healing_recipe: { requestRole: 'operator', approveRole: 'approver' },
    self_heal_project: { requestRole: 'approver', approveRole: 'admin' },
  },
  currentUserRole: 'operator',
  browser: {
    sessionOpen: false,
    headless: false,
    artifactsDir: '',
    recentTrace: [],
    currentUrl: '',
  },
  schedules: [],
  jobRuns: [],
  telemetry: {
    pendingApprovals: 0,
    approvedApprovals: 0,
    rejectedApprovals: 0,
    activeSchedules: 0,
    runningJobs: 0,
    completedJobs: 0,
    failedJobs: 0,
    browserSuccesses: 0,
    browserFailures: 0,
  },
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

function formatRoleLabel(role: UserRole) {
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function formatActionLabel(action: ApprovalActionType) {
  return action.split('_').join(' ');
}

const roleRank: Record<UserRole, number> = {
  operator: 1,
  approver: 2,
  admin: 3,
};

function hasRole(currentRole: UserRole, requiredRole: UserRole) {
  return roleRank[currentRole] >= roleRank[requiredRole];
}

function formatCommandResult(result: Record<string, unknown>) {
  const sections: string[] = [];
  const hasCommandShape =
    typeof result.exitCode === 'number'
    || typeof result.stdout === 'string'
    || typeof result.stderr === 'string';

  if (!hasCommandShape) {
    return JSON.stringify(result, null, 2);
  }

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

function formatApprovalPayload(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join('\n');
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
  const [runningScheduleId, setRunningScheduleId] = useState<string | null>(null);
  const [replayingTraceId, setReplayingTraceId] = useState<string | null>(null);
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
  const [scheduleForm, setScheduleForm] = useState<{
    name: string;
    targetType: ScheduledJobTargetType;
    targetId: string;
    intervalMinutes: number;
  }>({
    name: '',
    targetType: 'tool',
    targetId: '',
    intervalMinutes: 60,
  });

  const relaySummary = useMemo(() => {
    if (overview.relay.allowedCommands.length === 0) {
      return 'Loading relay policy...';
    }
    return overview.relay.allowedCommands.join(', ');
  }, [overview.relay.allowedCommands]);

  const pendingApprovals = useMemo(
    () => overview.approvals.filter((approval) => approval.status === 'pending'),
    [overview.approvals]
  );
  const reviewedApprovals = useMemo(
    () => overview.approvals
      .filter((approval) => approval.status !== 'pending')
      .sort((a, b) => new Date(b.reviewedAt || b.createdAt).getTime() - new Date(a.reviewedAt || a.createdAt).getTime())
      .slice(0, 8),
    [overview.approvals]
  );
  const approvalPolicyEntries = useMemo(
    () => (Object.entries(overview.approvalPolicy) as Array<[ApprovalActionType, { requestRole: UserRole; approveRole: UserRole }]>),
    [overview.approvalPolicy]
  );
  const browserTracePreview = useMemo(
    () => overview.browser.recentTrace.slice(0, 6),
    [overview.browser.recentTrace]
  );
  const recentJobRuns = useMemo(
    () => overview.jobRuns.slice(0, 8),
    [overview.jobRuns]
  );

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

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshOverview(true);
    }, 30000);
    return () => window.clearInterval(interval);
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
        title: `Tool registration proposed`,
        detail: `Approval request ${result.id} is waiting in the queue.`,
      });
      onLog?.(`Queued tool registration approval ${result.id}`, 'info');
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
        title: `Package install proposed`,
        detail: `Approval request ${result.id} is waiting in the queue.`,
      });
      setSelectedOutput(formatApprovalPayload(result.payload));
      onLog?.(`Queued package install approval ${result.id}`, 'info');
      await refreshOverview(true);
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
        title: `Healing recipe proposed`,
        detail: `Approval request ${recipe.id} is waiting in the queue.`,
      });
      onLog?.(`Queued healing recipe approval ${recipe.id}`, 'info');
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
      const detail = formatApprovalPayload(result.payload);
      setSelectedOutput(detail);
      setActionState({
        kind: 'success',
        title: `Recipe run proposed`,
        detail,
      });
      onLog?.(`Queued healing recipe run approval ${result.id}`, 'info');
      await refreshOverview(true);
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
      const detail = result.id;
      setSelectedOutput(detail);
      setActionState({
        kind: 'success',
        title: 'Self-heal proposed',
        detail: `Approval request ${result.id} is waiting in the queue.`,
      });
      onLog?.(`Queued self-heal approval ${result.id}`, 'info');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to run self-heal routine.';
      setActionState({ kind: 'error', title: 'Self-heal failed', detail: message });
      onLog?.(`Self-heal failed: ${message}`, 'warn');
    } finally {
      setIsSelfHealing(false);
    }
  };

  const handleApprove = async (approval: PendingApproval) => {
    try {
      const result = await AutonomyService.approveAction(approval.id);
      const detail = result.result && typeof result.result === 'object'
        ? formatCommandResult(result.result as Record<string, unknown>)
        : JSON.stringify(result.result ?? {}, null, 2);
      setSelectedOutput(detail);
      setActionState({
        kind: 'success',
        title: `Approved ${approval.type}`,
        detail,
      });
      onLog?.(`Approved ${approval.id}`, 'success');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to approve action.';
      setActionState({ kind: 'error', title: 'Approval failed', detail: message });
      onLog?.(`Approval failed: ${message}`, 'warn');
    }
  };

  const handleReject = async (approval: PendingApproval) => {
    try {
      const result = await AutonomyService.rejectAction(approval.id, 'Rejected from toolbox control panel.');
      setActionState({
        kind: 'success',
        title: `Rejected ${approval.type}`,
        detail: result.reason || 'Rejected by operator.',
      });
      onLog?.(`Rejected ${approval.id}`, 'warn');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reject action.';
      setActionState({ kind: 'error', title: 'Rejection failed', detail: message });
      onLog?.(`Rejection failed: ${message}`, 'warn');
    }
  };

  const handleCreateSchedule = async () => {
    try {
      const result = await AutonomyService.createSchedule({
        name: scheduleForm.name,
        targetType: scheduleForm.targetType,
        targetId: scheduleForm.targetType === 'self_heal' ? undefined : scheduleForm.targetId,
        intervalMinutes: scheduleForm.intervalMinutes,
      });
      setScheduleForm({
        name: '',
        targetType: scheduleForm.targetType,
        targetId: '',
        intervalMinutes: scheduleForm.intervalMinutes,
      });
      setActionState({
        kind: 'success',
        title: 'Scheduled job created',
        detail: `${result.name} will run every ${result.intervalMinutes} minutes.`,
      });
      onLog?.(`Created scheduled job ${result.id}`, 'success');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create scheduled job.';
      setActionState({ kind: 'error', title: 'Schedule creation failed', detail: message });
      onLog?.(`Schedule creation failed: ${message}`, 'warn');
    }
  };

  const handleToggleSchedule = async (id: string, active: boolean) => {
    try {
      const result = await AutonomyService.toggleSchedule(id, active);
      setActionState({
        kind: 'success',
        title: active ? 'Schedule resumed' : 'Schedule paused',
        detail: `${result.name} is now ${result.status}.`,
      });
      onLog?.(`Updated schedule ${id} to ${result.status}`, active ? 'success' : 'warn');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to update schedule.';
      setActionState({ kind: 'error', title: 'Schedule update failed', detail: message });
      onLog?.(`Schedule update failed: ${message}`, 'warn');
    }
  };

  const handleRunScheduleNow = async (id: string) => {
    try {
      setRunningScheduleId(id);
      const result = await AutonomyService.runScheduleNow(id);
      setSelectedOutput(result.outputSummary || 'Scheduled job finished without output.');
      setActionState({
        kind: result.status === 'failed' ? 'error' : 'success',
        title: `Scheduled job ${result.status}`,
        detail: result.outputSummary || 'No output returned.',
      });
      onLog?.(`Ran scheduled job ${id}`, result.status === 'failed' ? 'warn' : 'success');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to run scheduled job.';
      setActionState({ kind: 'error', title: 'Scheduled job failed', detail: message });
      onLog?.(`Scheduled job failed: ${message}`, 'warn');
    } finally {
      setRunningScheduleId(null);
    }
  };

  const handleReplayBrowserTrace = async (entry: BrowserTraceEntry) => {
    try {
      setReplayingTraceId(entry.id);
      const result = await AutonomyService.replayBrowserTrace(entry.id);
      const detail = `${result.title}\n${result.url}\n\n${result.content}`;
      setSelectedOutput(detail);
      setActionState({
        kind: 'success',
        title: `Replayed ${entry.action}`,
        detail,
      });
      onLog?.(`Replayed browser trace ${entry.id}`, 'success');
      await refreshOverview(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to replay browser trace.';
      setActionState({ kind: 'error', title: 'Browser replay failed', detail: message });
      onLog?.(`Browser replay failed: ${message}`, 'warn');
    } finally {
      setReplayingTraceId(null);
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
              <Badge color="blue">Active Schedules</Badge>
              <CalendarClock size={18} className="text-cyber-blue" />
            </div>
            <div className="text-4xl font-black tracking-tight">{overview.telemetry.activeSchedules}</div>
            <p className="text-sm text-zinc-500">Background jobs that stay active and continue running on the server without the browser staying open.</p>
          </Card>
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Badge color="lime">Job Throughput</Badge>
              <Gauge size={18} className="text-cyber-lime" />
            </div>
            <div className="text-4xl font-black tracking-tight">{overview.telemetry.completedJobs}</div>
            <p className="text-sm text-zinc-500">{overview.telemetry.runningJobs} running now, {overview.telemetry.failedJobs} failed recently.</p>
          </Card>
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Badge color="rose">Approvals</Badge>
              <Bot size={18} className="text-cyber-rose" />
            </div>
            <div className="text-4xl font-black tracking-tight">{overview.telemetry.pendingApprovals}</div>
            <p className="text-sm text-zinc-500">{overview.telemetry.approvedApprovals} approved, {overview.telemetry.rejectedApprovals} rejected.</p>
          </Card>
          <Card className="p-6 space-y-3">
            <div className="flex items-center justify-between">
              <Badge color="gold">Browser Health</Badge>
              <Sparkles size={18} className="text-amber-400" />
            </div>
            <div className="text-sm font-semibold leading-relaxed text-zinc-200">
              {overview.telemetry.browserSuccesses} successful actions
            </div>
            <p className="text-sm text-zinc-500">{overview.telemetry.browserFailures} browser failures logged. Crawls still stop at {overview.limits.maxCrawlPages} pages.</p>
          </Card>
        </div>

        <Card className="p-6 lg:p-8 space-y-6 border-white/10 bg-white/[0.02]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-2xl font-black tracking-tight">Browser Operations</h3>
              <p className="text-sm text-zinc-500 mt-2">Shared Playwright state, recent navigation health, and failure artifacts live here so web automation is easier to recover when a page gets weird.</p>
            </div>
            <Badge color={overview.browser.sessionOpen ? 'lime' : 'rose'}>
              {overview.browser.sessionOpen ? 'Session Open' : 'Session Idle'}
            </Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card className="p-5 border-white/10 bg-black/20">
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Mode</div>
              <div className="mt-2 text-sm text-zinc-200 font-semibold">{overview.browser.headless ? 'Headless' : 'Visible Browser'}</div>
            </Card>
            <Card className="p-5 border-white/10 bg-black/20">
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Last Action</div>
              <div className="mt-2 text-sm text-zinc-200 font-semibold">
                {overview.browser.lastActionAt ? new Date(overview.browser.lastActionAt).toLocaleString() : 'No browser actions yet'}
              </div>
            </Card>
            <Card className="p-5 border-white/10 bg-black/20">
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Current URL</div>
              <div className="mt-2 text-sm text-zinc-200 break-all">{overview.browser.currentUrl || 'No active page'}</div>
            </Card>
            <Card className="p-5 border-white/10 bg-black/20">
              <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Last Error</div>
              <div className="mt-2 text-sm text-zinc-200">{overview.browser.lastError || 'No browser failures recorded recently'}</div>
            </Card>
          </div>

          <div className="grid gap-4">
            {browserTracePreview.map((entry) => (
              <Card key={entry.id} className="p-5 border-white/10 bg-black/20">
                <div className="space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge color={entry.status === 'success' ? 'lime' : 'rose'}>{entry.status}</Badge>
                    <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">{entry.action}</span>
                    <span className="text-xs text-zinc-500">{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  {entry.url && (
                    <div className="text-sm text-zinc-300 break-all">
                      URL: <span className="text-white font-semibold">{entry.url}</span>
                    </div>
                  )}
                  {entry.error && (
                    <div className="text-sm text-cyber-rose">{entry.error}</div>
                  )}
                  {entry.artifactPath && (
                    <div className="text-sm text-zinc-300 break-all">
                      Artifact: <span className="text-white font-semibold">{entry.artifactPath}</span>
                    </div>
                  )}
                  {['browser_navigate', 'browser_click', 'browser_type', 'browser_press', 'browser_wait_for_text'].includes(entry.action) && (
                    <div className="pt-1">
                      <Button
                        variant="secondary"
                        icon={RotateCcw}
                        loading={replayingTraceId === entry.id}
                        onClick={() => void handleReplayBrowserTrace(entry)}
                      >
                        Replay Step
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
            {!isLoadingOverview && browserTracePreview.length === 0 && (
              <div className="text-sm text-zinc-500">No browser trace yet. Once the agents navigate, click, type, or fail on a page, the recent session history will show up here.</div>
            )}
          </div>
        </Card>

        <Card className="p-6 lg:p-8 space-y-6 border-white/10 bg-white/[0.02]">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-2xl font-black tracking-tight">Approval Policy</h3>
              <p className="text-sm text-zinc-500 mt-2">Role-based request and approval gates keep high-impact autonomy changes from executing without the right operator in the loop.</p>
            </div>
            <Badge color="blue">Current Role: {formatRoleLabel(overview.currentUserRole)}</Badge>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {approvalPolicyEntries.map(([action, policy]) => (
              <Card key={action} className="p-5 border-white/10 bg-black/20">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <Badge color="gold">{formatActionLabel(action)}</Badge>
                    <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-600">
                      {hasRole(overview.currentUserRole, policy.approveRole)
                        ? 'Can approve'
                        : hasRole(overview.currentUserRole, policy.requestRole)
                          ? 'Can request'
                          : 'View only'}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-300">
                    Requester role: <span className="font-semibold text-white">{formatRoleLabel(policy.requestRole)}</span>
                  </div>
                  <div className="text-sm text-zinc-300">
                    Approver role: <span className="font-semibold text-white">{formatRoleLabel(policy.approveRole)}</span>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </Card>

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

        <Card className="p-6 lg:p-8 space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-2xl font-black tracking-tight">Approval Queue</h3>
              <p className="text-sm text-zinc-500 mt-2">High-impact autonomy actions wait here until you approve or reject them.</p>
            </div>
            <Badge color={pendingApprovals.length > 0 ? 'rose' : 'lime'}>
              {pendingApprovals.length > 0 ? `${pendingApprovals.length} Pending` : 'Queue Clear'}
            </Badge>
          </div>

          <div className="grid gap-4">
            {pendingApprovals.map((approval) => (
              <Card key={approval.id} className="p-5 border-white/10">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge color="rose">{approval.type}</Badge>
                      <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">
                        {new Date(approval.createdAt).toLocaleString()}
                      </span>
                      {approval.requestedByRole && (
                        <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">
                          Requested by {formatRoleLabel(approval.requestedByRole)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-400">{approval.reason || 'Awaiting operator review.'}</p>
                    {approval.requestedBy && (
                      <div className="text-sm text-zinc-300">
                        Requested by: <span className="font-semibold text-white">{approval.requestedBy}</span>
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap break-words text-xs text-zinc-300 font-mono rounded-2xl bg-black/20 border border-white/5 px-4 py-3">
                      {formatApprovalPayload(approval.payload)}
                    </pre>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="secondary" icon={Play} onClick={() => void handleApprove(approval)}>
                      Approve
                    </Button>
                    <Button variant="danger" onClick={() => void handleReject(approval)}>
                      Reject
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            {!isLoadingOverview && pendingApprovals.length === 0 && (
              <div className="text-sm text-zinc-500">No high-impact actions are waiting for approval right now.</div>
            )}
          </div>
        </Card>

        <Card className="p-6 lg:p-8 space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h3 className="text-2xl font-black tracking-tight">Approval History</h3>
              <p className="text-sm text-zinc-500 mt-2">Recent decisions stay visible here with timestamps, reviewer attribution, and execution output.</p>
            </div>
            <Badge color="blue">Audit Trail</Badge>
          </div>

          <div className="grid gap-4">
            {reviewedApprovals.map((approval) => (
              <Card key={approval.id} className="p-5 border-white/10">
                <div className="space-y-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <Badge color={approval.status === 'approved' ? 'lime' : 'rose'}>
                      {approval.status}
                    </Badge>
                    <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">{approval.type}</span>
                    <span className="text-xs text-zinc-500">
                      {new Date(approval.reviewedAt || approval.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-zinc-300">
                    Reviewer: <span className="text-white font-semibold">{approval.reviewedBy || 'Unknown reviewer'}</span>
                  </div>
                  {(approval.requestedBy || approval.requestedByRole) && (
                    <div className="text-sm text-zinc-300">
                      Requested by: <span className="text-white font-semibold">{approval.requestedBy || 'Unknown requester'}</span>
                      {approval.requestedByRole ? ` (${formatRoleLabel(approval.requestedByRole)})` : ''}
                    </div>
                  )}
                  {approval.reason && (
                    <p className="text-sm text-zinc-400">{approval.reason}</p>
                  )}
                  <pre className="whitespace-pre-wrap break-words text-xs text-zinc-300 font-mono rounded-2xl bg-black/20 border border-white/5 px-4 py-3">
                    {formatApprovalPayload(approval.payload)}
                  </pre>
                  {approval.result && (
                    <div className="rounded-2xl border border-white/5 bg-white/5 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black mb-2">Execution Result</div>
                      <pre className="whitespace-pre-wrap break-words text-xs text-zinc-300 font-mono">
                        {typeof approval.result === 'object'
                          ? formatCommandResult(approval.result as Record<string, unknown>)
                          : String(approval.result)}
                      </pre>
                    </div>
                  )}
                </div>
              </Card>
            ))}
            {!isLoadingOverview && reviewedApprovals.length === 0 && (
              <div className="text-sm text-zinc-500">No reviewed approvals yet. Once you approve or reject actions, they’ll show up here as an audit trail.</div>
            )}
          </div>
        </Card>

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

            <Card className="p-6 lg:p-8 space-y-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">Background Jobs</h3>
                  <p className="text-sm text-zinc-500 mt-2">Run tool checks, recovery recipes, and self-heal cycles on a recurring server schedule that survives browser refreshes.</p>
                </div>
                <Badge color="blue">Resumable Queue</Badge>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Job Name</span>
                  <input
                    value={scheduleForm.name}
                    onChange={(event) => setScheduleForm((prev) => ({ ...prev, name: event.target.value }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                    placeholder="Hourly lint sweep"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Every N Minutes</span>
                  <input
                    type="number"
                    min={5}
                    max={1440}
                    value={scheduleForm.intervalMinutes}
                    onChange={(event) => setScheduleForm((prev) => ({ ...prev, intervalMinutes: Number(event.target.value) || 60 }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Target Type</span>
                  <select
                    value={scheduleForm.targetType}
                    onChange={(event) => setScheduleForm((prev) => ({ ...prev, targetType: event.target.value as ScheduledJobTargetType, targetId: '' }))}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40"
                  >
                    <option value="tool">Registered Tool</option>
                    <option value="recipe">Healing Recipe</option>
                    <option value="self_heal">Self-Heal Routine</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-[11px] uppercase tracking-[0.2em] text-zinc-500 font-black">Target ID</span>
                  <select
                    value={scheduleForm.targetId}
                    onChange={(event) => setScheduleForm((prev) => ({ ...prev, targetId: event.target.value }))}
                    disabled={scheduleForm.targetType === 'self_heal'}
                    className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm outline-none focus:border-cyber-blue/40 disabled:opacity-50"
                  >
                    <option value="">{scheduleForm.targetType === 'self_heal' ? 'Not required for self-heal' : 'Select a target'}</option>
                    {(scheduleForm.targetType === 'tool' ? overview.registeredTools : overview.healingRecipes).map((entry) => (
                      <option key={entry.id} value={entry.id}>{entry.id}</option>
                    ))}
                  </select>
                </label>
              </div>

              <Button variant="primary" icon={CalendarClock} onClick={() => void handleCreateSchedule()}>
                Create Background Job
              </Button>

              <div className="grid gap-4">
                {overview.schedules.map((schedule) => (
                  <Card key={schedule.id} className="p-5 border-white/10">
                    <div className="flex flex-col gap-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-3 flex-wrap">
                            <Badge color={schedule.status === 'active' ? 'lime' : 'rose'}>{schedule.status}</Badge>
                            <span className="font-semibold text-white">{schedule.name}</span>
                            <span className="text-xs uppercase tracking-[0.2em] text-zinc-600">
                              {schedule.targetType}{schedule.targetId ? ` -> ${schedule.targetId}` : ''}
                            </span>
                          </div>
                          <div className="text-sm text-zinc-300">
                            Every {schedule.intervalMinutes} minutes. Next run {new Date(schedule.nextRunAt).toLocaleString()}
                          </div>
                          <div className="text-sm text-zinc-500">
                            Last result: {schedule.lastResultStatus || 'Not run yet'}{schedule.lastResultSummary ? ` - ${schedule.lastResultSummary}` : ''}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-3">
                          <Button
                            variant="secondary"
                            icon={Play}
                            loading={runningScheduleId === schedule.id}
                            onClick={() => void handleRunScheduleNow(schedule.id)}
                          >
                            Run Now
                          </Button>
                          <Button
                            variant={schedule.status === 'active' ? 'danger' : 'primary'}
                            onClick={() => void handleToggleSchedule(schedule.id, schedule.status !== 'active')}
                          >
                            {schedule.status === 'active' ? 'Pause' : 'Resume'}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </Card>
                ))}
                {!isLoadingOverview && overview.schedules.length === 0 && (
                  <div className="text-sm text-zinc-500">No background jobs yet. Create one above to keep recurring checks and repairs running even after you refresh the app.</div>
                )}
              </div>

              <div className="grid gap-4">
                <div className="flex items-center justify-between gap-4">
                  <h4 className="text-lg font-black tracking-tight">Recent Job Runs</h4>
                  <Badge color="gold">Server History</Badge>
                </div>
                {recentJobRuns.map((run) => (
                  <Card key={run.id} className="p-4 border-white/10 bg-black/20">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge color={run.status === 'completed' ? 'lime' : run.status === 'running' ? 'blue' : 'rose'}>{run.status}</Badge>
                        <span className="font-semibold text-white">{run.name}</span>
                        <span className="text-xs text-zinc-500">{new Date(run.startedAt).toLocaleString()}</span>
                      </div>
                      <div className="text-sm text-zinc-400">
                        {run.targetType}{run.targetId ? ` -> ${run.targetId}` : ''}
                      </div>
                      {run.outputSummary && (
                        <div className="text-sm text-zinc-300">{run.outputSummary}</div>
                      )}
                    </div>
                  </Card>
                ))}
                {!isLoadingOverview && recentJobRuns.length === 0 && (
                  <div className="text-sm text-zinc-500">No job runs recorded yet. Once a scheduled task runs, its latest status will stay visible here across refreshes.</div>
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
