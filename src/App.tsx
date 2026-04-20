import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { 
  Send, 
  Bot, 
  User, 
  ChevronRight, 
  LayoutDashboard,
  Sparkles,
  Loader2,
  Cpu,
  Layers,
  Code,
  Youtube,
  Search,
  PieChart,
  TrendingUp,
  Compass,
  ClipboardList,
  Target,
  Share2,
  ShieldCheck,
  Database,
  Moon,
  Sun,
  Menu,
  X,
  Plus,
  Settings2,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  Download,
  Upload,
  RefreshCw,
  Paperclip,
  FileText,
  ImageIcon,
  Video,
  LogOut,
  Utensils,
  DollarSign,
  Headset,
  BarChart3,
  Play,
  Mic,
  MicOff,
  Zap,
  Globe,
  Terminal,
  Activity,
  History as HistoryIcon,
  Maximize2,
  Minimize2,
  ExternalLink,
  Github,
  Twitter,
  Instagram,
  Mail,
  MoreVertical,
  ArrowRight,
  GitBranch,
  Workflow as WorkflowIcon,
  Command,
  Eye,
  Settings,
  Info
} from 'lucide-react';
import { AGENTS, chatWithAgent, Agent, AttachedFile, type ChatHistoryEntry, RelayBridge } from './services/gemini';
import { 
  parseHandoffPlanFromMessage, 
  handoffPlanToWorkflow, 
  BUILTIN_WORKFLOWS, 
  type WorkflowShape,
  type HandoffPlan
} from './services/handoffPlan';
import { uploadFileToGeminiViaServer } from './services/upload';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import ReactMarkdown from 'react-markdown';
import { motion, AnimatePresence } from 'motion/react';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Icons Mapping ---
const ICON_MAP: Record<string, any> = {
  Compass, TrendingUp, ClipboardList, DollarSign, Target, Headset, Share2, Video, Youtube, Search, Layers, Code, Cpu, LineChart: TrendingUp, PieChart, BarChart3, ShieldCheck, Database, Utensils, Terminal, Globe
};

// --- Constants ---
const INLINE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  files?: AttachedFile[];
  timestamp: Date;
  handoffPlan?: HandoffPlan;
}

interface WorkflowState {
  workflow: WorkflowShape;
  currentStep: number;
  isRunning: boolean;
  outputs: string[];
}

// --- Components ---

const AgentAvatar = ({ agent, size = 'md', glow = false }: { agent: Agent, size?: 'sm' | 'md' | 'lg', glow?: boolean }) => {
  const Icon = ICON_MAP[agent.icon] || Bot;
  const sizeClasses = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-10 h-10 rounded-xl',
    lg: 'w-14 h-14 rounded-2xl',
  };

  return (
    <div className={cn(
      "relative group flex-shrink-0",
      sizeClasses[size],
      agent.color,
      "flex items-center justify-center text-white border border-white/20",
      glow && "shadow-[0_0_20px_rgba(255,255,255,0.2)]"
    )}>
      <Icon size={size === 'lg' ? 28 : size === 'md' ? 20 : 16} />
      <div className="absolute inset-0 bg-white/20 rounded-[inherit] opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
};

const GlassButton = ({ children, onClick, active = false, className = '', icon: Icon }: any) => (
  <motion.button
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className={cn(
      "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border",
      active 
        ? "bg-cyber-blue/10 border-cyber-blue/30 text-cyber-blue shadow-[0_0_15px_rgba(59,130,246,0.1)]" 
        : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:border-white/10 hover:text-white",
      className
    )}
  >
    {Icon && <Icon size={18} />}
    <span className="text-sm font-semibold truncate">{children}</span>
  </motion.button>
);

const Badge = ({ children, color = 'blue', className = '' }: { children: React.ReactNode, color?: string, className?: string }) => {
  const colors: any = {
    blue: 'bg-cyber-blue/10 text-cyber-blue border-cyber-blue/20',
    lime: 'bg-cyber-lime/10 text-cyber-lime border-cyber-lime/20',
    rose: 'bg-cyber-rose/10 text-cyber-rose border-cyber-rose/20',
    gold: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border shrink-0", colors[color], className)}>
      {children}
    </span>
  );
};

import { auth } from './lib/firebase';
import { PersistenceService } from './services/persistence';

export default function App() {
  const [activeView, setActiveView] = useState<'chat' | 'agents' | 'workflows' | 'toolbox'>('chat');
  const [selectedAgent, setSelectedAgent] = useState<Agent>(AGENTS.find(a => a.id === 'router') || AGENTS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [systemLogs, setSystemLogs] = useState<Array<{ msg: string, type: 'info' | 'warn' | 'success' | 'agent' }>>([
    { msg: "System initialized. Aegis Protocol v2.0 online.", type: 'info' }
  ]);
  
  const [workflowState, setWorkflowState] = useState<WorkflowState | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Load persisted messages for the selected agent
    const loadPersisted = async () => {
      if (!auth?.currentUser) return;
      setIsLoading(true);
      const history = await PersistenceService.getMessages(selectedAgent.id);
      setMessages(history);
      setIsLoading(false);
    };
    loadPersisted();
  }, [selectedAgent.id]);

  const addLog = useCallback((msg: string, type: 'info' | 'warn' | 'success' | 'agent' = 'info') => {
    setSystemLogs(prev => [...prev.slice(-4), { msg, type }]);
  }, []);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, scrollToBottom]);

  const handleSendMessage = async (textOverride?: string, agentOverride?: Agent) => {
    const text = textOverride || input;
    if (!text.trim() && attachedFiles.length === 0) return;

    const agent = agentOverride || selectedAgent;
    const newMsg: Message = { 
      role: 'user', 
      content: text, 
      files: [...attachedFiles],
      timestamp: new Date()
    };

    setMessages(prev => [...prev, newMsg]);
    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);
    addLog(`Directing request to ${agent.name}...`, 'agent');

    // Save user message to persistence
    PersistenceService.saveMessage(agent.id, newMsg);

    try {
      const historyToUpload: ChatHistoryEntry[] = [];
      messages.filter(m => m.role !== 'system').forEach(m => {
        // If message is from user, add it as a 'user' role
        if (m.role === 'user') {
          historyToUpload.push({
            role: 'user',
            parts: [{ text: m.content }]
          });
        } 
        // If message is from assistant, add it as 'model' role
        else if (m.role === 'assistant') {
          historyToUpload.push({
            role: 'model',
            parts: [{ text: m.content }]
          });
        }
      });

      let currentHistory: ChatHistoryEntry[] = [...historyToUpload];
      let isRunning = true;
      let lastText = text;
      let lastFiles = newMsg.files;
      let nextToolResults: any[] | undefined = undefined;

      while (isRunning) {
        const response = await chatWithAgent(agent, lastText, currentHistory, lastFiles, nextToolResults);
        
        // Update history with what we just sent so the next turn has context
        if (nextToolResults) {
          currentHistory.push({ role: 'function', parts: nextToolResults });
          nextToolResults = undefined;
        } else if (lastText || (lastFiles && lastFiles.length > 0)) {
          const userParts: any[] = [];
          if (lastText) userParts.push({ text: lastText });
          if (lastFiles) {
            for (const f of lastFiles) {
              if (f.geminiFile) userParts.push({ fileData: { fileUri: f.geminiFile.uri, mimeType: f.mimeType } });
              else userParts.push({ inlineData: { mimeType: f.mimeType, data: f.data } });
            }
          }
          currentHistory.push({ role: 'user', parts: userParts });
          lastText = ""; // Clear for next turns in loop
          lastFiles = [];
        }

        if (response.functionCalls && response.functionCalls.length > 0) {
          const toolResults: any[] = [];
          
          for (const call of response.functionCalls) {
            addLog(`RELAY ACTIVE: Executing ${call.name}...`, 'info');
            let result;
            
            try {
              if (call.name === 'bash') {
                result = await RelayBridge.exec(call.args.command, call.args.workdir);
                addLog(`Relay: Command executed (Exit: ${result.exitCode})`, result.exitCode === 0 ? 'success' : 'warn');
              } else if (call.name === 'read_file') {
                result = await RelayBridge.read_file(call.args.path);
                addLog(`Relay: Read ${call.args.path}`, 'info');
              } else if (call.name === 'write_file') {
                result = await RelayBridge.write_file(call.args.path, call.args.content);
                addLog(`Relay: Wrote ${call.args.path}`, 'success');
              } else if (call.name === 'edit_file') {
                result = await RelayBridge.edit_file(call.args.path, call.args.oldString, call.args.newString);
                addLog(`Relay: Edited ${call.args.path}`, 'success');
              }

              toolResults.push({
                functionResponse: {
                  name: call.name,
                  response: result
                }
              });
            } catch (toolErr) {
              addLog(`Relay Error: ${toolErr.message}`, 'warn');
              toolResults.push({
                functionResponse: {
                  name: call.name,
                  response: { error: toolErr.message }
                }
              });
            }
          }

          // Update history with the model's call
          currentHistory.push({
            role: 'model',
            parts: response.functionCalls.map(c => ({ functionCall: c }))
          });
          
          // Set tool results for the NEXT request instead of pushing to history and sending dummy text
          nextToolResults = toolResults;
          lastText = ""; // Clear text when sending tool results
          continue;
        }

        if (response.text) {
          const handoffPlan = parseHandoffPlanFromMessage(response.text);
          const assistantMsg: Message = { 
            role: 'assistant', 
            content: response.text, 
            agentId: agent.id,
            timestamp: new Date(),
            handoffPlan: handoffPlan || undefined
          };

          setMessages(prev => [...prev, assistantMsg]);
          PersistenceService.saveMessage(agent.id, assistantMsg);

          if (handoffPlan) {
            addLog(`Handoff plan detected: "${handoffPlan.title}"`, 'success');
          } else {
            addLog(`Response generated by ${agent.name}`, 'info');
          }
          isRunning = false;
        } else {
          isRunning = false;
        }
      }
    } catch (err) {
      addLog(`Communication Failure: ${agent.name}`, 'warn');
      const systemError: Message = { 
        role: 'system', 
        content: `### ⚠️ SYSTEM ERROR: AI FAILED\n\n**Reason**: ${err instanceof Error ? err.message : 'Unknown communication error.'}\n\n**Troubleshooting**:\n1. Check your internet connection.\n2. Ensure the Local Relay (\`npm run aegis\`) is running.\n3. Try refreshing the page.\n4. If the error persists, use the **QA Agent** for a diagnostic check.`,
        timestamp: new Date()
      };
      setMessages(prev => [...prev, systemError]);
    } finally {
      setIsLoading(false);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      addLog('Speech recognition not supported in this browser.', 'warn');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onstart = () => {
      setIsListening(true);
      addLog('Neural Link: Listening for voice input...', 'info');
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
      setIsListening(false);
    };

    recognition.onerror = (event: any) => {
      console.error('Speech recognition error:', event.error);
      setIsListening(false);
      addLog(`Speech Error: ${event.error}`, 'warn');
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const handleLaunchTool = (toolId: string) => {
    addLog(`Initializing module: ${toolId.toUpperCase()}...`, 'info');
    
    const toolMapping: Record<string, { agentId: string, prompt: string }> = {
      visualizer: { 
        agentId: 'product-dev', 
        prompt: 'I want to use the AI Wheel Visualizer Pro. Please help me with photorealistic rendering and segmentation for a custom wheel project.' 
      },
      seo: { 
        agentId: 'seo-strategist', 
        prompt: 'Run the SEO Bridge Master automation. I need to update the sitemap and inject Local Business Schema into the landing pages.' 
      },
      media: { 
        agentId: 'content-production', 
        prompt: 'Open the Media Producer Hub. I need to generate vertical viral video content for social media.' 
      },
      dashboard: { 
        agentId: 'project-manager', 
        prompt: 'Access the Shop Dashboard. I need to manage current repair pipelines and multi-tenant CRM data.' 
      },
      analytics: { 
        agentId: 'finance', 
        prompt: 'Analyze current market intelligence and business revenue trends.' 
      },
      knowledge: { 
        agentId: 'knowledge-base', 
        prompt: 'Sync with the Brain Sync institutional memory to retrieve SOPs and training guides.' 
      },
      social: { 
        agentId: 'social-media', 
        prompt: 'Launch the Content Engine for cross-platform viral posts and hashtag strategies.' 
      },
      leads: { 
        agentId: 'lead-gen', 
        prompt: 'Activate Lead Velocity prospecting to identify high-conversion B2B partnership opportunities.' 
      }
    };

    const target = toolMapping[toolId];
    if (target) {
      const agent = AGENTS.find(a => a.id === target.agentId) || AGENTS[0];
      setSelectedAgent(agent);
      setActiveView('chat');
      handleSendMessage(target.prompt, agent);
    }
  };

  const executeWorkflow = async (workflow: WorkflowShape) => {
    setActiveView('chat');
    setWorkflowState({ workflow, currentStep: 0, isRunning: true, outputs: [] });
    addLog(`Starting workflow: ${workflow.name}`, 'info');

    let allOutputs: string[] = [];
    const baseInput = input || "Proceed with the workflow.";

    for (let i = 0; i < workflow.steps.length; i++) {
      setWorkflowState(prev => prev ? { ...prev, currentStep: i } : null);
      const step = workflow.steps[i];
      const agent = AGENTS.find(a => a.id === step.agentId) || AGENTS[0];
      
      addLog(`Step ${i + 1}: ${agent.name} is thinking...`, 'agent');

      // Replace placeholders
      let prompt = step.prompt
        .replace('{{input}}', baseInput)
        .replace('{{previous}}', allOutputs[i - 1] || "No previous output.")
        .replace('{{all_previous}}', allOutputs.join('\n\n---\n\n'));

      try {
        const response = await chatWithAgent(agent, prompt, [], []);
        allOutputs.push(response);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `## ⚡ Workflow Step ${i + 1}: ${agent.name}\n\n${response}`, 
          agentId: agent.id, 
          timestamp: new Date() 
        }]);
      } catch (err) {
        addLog(`Workflow failed at step ${i + 1}`, 'warn');
        break;
      }
    }

    setWorkflowState(null);
    addLog(`Workflow "${workflow.name}" complete.`, 'success');
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      addLog(`Uploading ${file.name}...`, 'info');
      if (file.size > INLINE_ATTACHMENT_MAX_BYTES) {
        try {
          const uploaded = await uploadFileToGeminiViaServer(file);
          setAttachedFiles(prev => [...prev, {
            name: file.name,
            mimeType: file.type,
            geminiFile: { uri: uploaded.uri, mimeType: uploaded.mimeType },
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
          }]);
          addLog(`${file.name} ready (Cloud Storage)`, 'success');
        } catch (err) {
          addLog(`Failed to upload ${file.name}`, 'warn');
        }
      } else {
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setAttachedFiles(prev => [...prev, {
            name: file.name,
            mimeType: file.type,
            data: base64,
            preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
          }]);
          addLog(`${file.name} ready (Memory)`, 'success');
        };
        reader.readAsDataURL(file);
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="flex h-screen bg-deep-space text-zinc-100 overflow-hidden font-sans selection:bg-cyber-blue/40 selection:text-white">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyber-blue/5 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyber-lime/5 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.04] mix-blend-overlay" />
      </div>

      {/* Sidebar - Command Hub */}
      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.aside
            initial={{ width: 0, x: -320 }}
            animate={{ width: 320, x: 0 }}
            exit={{ width: 0, x: -320 }}
            className={cn(
              "fixed inset-y-0 left-0 z-50 lg:relative h-full bg-void/80 backdrop-blur-3xl border-r border-white/5 flex flex-col overflow-hidden shadow-2xl transition-all duration-500",
              !isMobileMenuOpen && "hidden lg:flex"
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
                  <Badge color="blue">Aegis Command v2</Badge>
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
                <GlassButton active={activeView === 'toolbox'} onClick={() => { setActiveView('toolbox'); setIsMobileMenuOpen(false); }} icon={Layers}>Auxiliary</GlassButton>
              </div>

              <div className="space-y-4">
                <p className="px-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Neural Network</p>
                <div className="space-y-1">
                  {AGENTS.map(agent => (
                    <button
                      key={agent.id}
                      onClick={() => {
                        setSelectedAgent(agent);
                        setActiveView('chat');
                        setIsMobileMenuOpen(false);
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-xl transition-all group border",
                        selectedAgent.id === agent.id 
                          ? "bg-white/5 border-white/10 shadow-lg shadow-black/20" 
                          : "border-transparent hover:bg-white/5"
                      )}
                    >
                      <AgentAvatar agent={agent} size="sm" glow={selectedAgent.id === agent.id} />
                      <div className="text-left overflow-hidden">
                        <div className={cn("text-xs font-bold truncate", selectedAgent.id === agent.id ? "text-white" : "text-zinc-500 group-hover:text-zinc-300")}>
                          {agent.name}
                        </div>
                        <div className="text-[9px] text-zinc-700 uppercase font-black truncate tracking-tighter">{agent.role}</div>
                      </div>
                      {selectedAgent.id === agent.id && (
                        <div className="ml-auto w-1 h-1 rounded-full bg-cyber-blue shadow-[0_0_8px_#3B82F6]" />
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* System Logs Visualizer */}
              <div className="space-y-3">
                <p className="px-2 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-600">Console Output</p>
                <div className="bg-black/40 rounded-2xl p-4 border border-white/5 font-mono text-[10px] space-y-2 overflow-hidden glass-dark">
                  {systemLogs.map((log, i) => (
                    <div key={i} className={cn(
                      "flex gap-2 animate-in fade-in slide-in-from-left-2 duration-300",
                      log.type === 'warn' ? 'text-cyber-rose' : 
                      log.type === 'success' ? 'text-cyber-lime' : 
                      log.type === 'agent' ? 'text-cyber-blue' : 'text-zinc-500'
                    )}>
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
                <button className="p-2 text-zinc-600 hover:text-cyber-rose transition-all">
                  <LogOut size={16} />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button className="flex items-center justify-center gap-2 py-2 bg-white/5 rounded-lg text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all">
                  <Settings size={12} /> Config
                </button>
                <button className="flex items-center justify-center gap-2 py-2 bg-white/5 rounded-lg text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-white transition-all">
                  <Info size={12} /> Docs
                </button>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative">
        {/* Toggle Sidebar Button */}
        {!isSidebarOpen && (
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="absolute top-6 left-6 z-40 w-12 h-12 glass rounded-xl flex items-center justify-center text-zinc-400 hover:text-white border-white/10 hover:border-white/20 transition-all shadow-2xl"
          >
            <Maximize2 size={20} />
          </button>
        )}

        {/* Header Bar */}
        <header className="h-20 flex items-center justify-between px-6 lg:px-10 relative z-30 bg-void/20 backdrop-blur-md border-b border-white/5">
          <div className="flex items-center gap-3 lg:gap-5">
            <button 
              onClick={() => setIsMobileMenuOpen(true)}
              className="lg:hidden p-2 text-zinc-500 hover:text-white transition-colors"
            >
              <Menu size={20} />
            </button>
            <AgentAvatar agent={selectedAgent} size="md" glow />
            <div className="hidden sm:block">
              <div className="flex items-center gap-3">
                <h2 className="text-lg lg:text-xl font-black tracking-tighter">{selectedAgent.name}</h2>
                <div className="px-2 py-0.5 rounded-md bg-cyber-blue/10 border border-cyber-blue/20 text-[9px] font-black text-cyber-blue uppercase tracking-widest">
                  Ready
                </div>
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-cyber-lime shadow-[0_0_10px_#A3E635] animate-pulse" />
                <span className="text-[10px] text-zinc-500 uppercase tracking-[0.25em] font-black">Neural Processor Online</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden lg:flex items-center gap-6 px-6 py-2 bg-white/5 rounded-2xl border border-white/5 text-[10px] font-black uppercase tracking-widest text-zinc-500">
              <div className="flex items-center gap-2">
                <Terminal size={14} className="text-cyber-blue" /> Terminal v2
              </div>
              <div className="w-px h-3 bg-white/10" />
              <div className="flex items-center gap-2">
                <Globe size={14} className="text-cyber-lime" /> Global Sync
              </div>
            </div>
            <button className="w-11 h-11 glass rounded-xl flex items-center justify-center text-zinc-500 hover:text-cyber-blue transition-all border-white/10">
              <Settings2 size={20} />
            </button>
          </div>
        </header>

        {/* Dynamic View Container */}
        <div className="flex-1 relative overflow-hidden flex flex-col">
          <AnimatePresence mode="wait">
            {activeView === 'chat' && (
              <motion.div
                key="chat"
                initial={{ opacity: 0, scale: 0.99, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 1.01, y: -10 }}
                className="flex-1 overflow-y-auto px-10 pb-40 pt-10 custom-scrollbar"
              >
                <div className="max-w-4xl mx-auto space-y-12">
                  {messages.length === 0 && !workflowState && (
                    <div className="py-24 flex flex-col items-center text-center space-y-12">
                      <motion.div 
                        initial={{ rotateY: 90, opacity: 0 }}
                        animate={{ rotateY: 0, opacity: 1 }}
                        transition={{ type: 'spring', damping: 15, duration: 0.8 }}
                        className="perspective-1000"
                      >
                        <AgentAvatar agent={selectedAgent} size="lg" glow />
                      </motion.div>
                      
                      <div className="space-y-4">
                        <h3 className="text-5xl font-serif font-black tracking-tighter italic">
                          <span className="text-zinc-600">The</span> <span className="text-cyber-blue glow-text-blue">{selectedAgent.role}</span>
                        </h3>
                        <p className="text-zinc-500 max-w-xl mx-auto leading-relaxed text-lg font-medium">
                          {selectedAgent.description} Execute a specialized directive below or provide custom parameters.
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-2xl">
                        {selectedAgent.suggestedPrompts.map(prompt => (
                          <button
                            key={prompt}
                            onClick={() => handleSendMessage(prompt)}
                            className="p-6 rounded-[2rem] glass-dark border-white/5 hover:border-cyber-blue/40 hover:bg-cyber-blue/5 transition-all text-left group relative overflow-hidden"
                          >
                            <div className="absolute top-0 right-0 p-4 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Zap size={16} className="text-cyber-blue" />
                            </div>
                            <div className="flex items-center gap-3 mb-3 text-cyber-blue/40 group-hover:text-cyber-blue transition-colors">
                              <span className="text-[10px] font-black uppercase tracking-[0.2em]">System Prompt</span>
                            </div>
                            <p className="text-sm text-zinc-500 group-hover:text-zinc-100 transition-colors leading-relaxed font-semibold">{prompt}</p>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {workflowState && (
                    <motion.div 
                      initial={{ opacity: 0, y: -20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="glass border-cyber-blue/30 p-8 rounded-[2.5rem] space-y-6 glow-blue"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 bg-cyber-blue/10 rounded-2xl flex items-center justify-center text-cyber-blue">
                            <WorkflowIcon size={24} />
                          </div>
                          <div>
                            <h3 className="text-xl font-black uppercase tracking-tight">{workflowState.workflow.name}</h3>
                            <p className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.2em]">Executing Multi-Agent Pipeline</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Loader2 size={16} className="animate-spin text-cyber-blue" />
                          <span className="text-xs font-black text-cyber-blue">Step {workflowState.currentStep + 1} of {workflowState.workflow.steps.length}</span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        {workflowState.workflow.steps.map((step, idx) => {
                          const stepAgent = AGENTS.find(a => a.id === step.agentId);
                          return (
                            <div key={idx} className="flex-1 space-y-2">
                              <div className={cn(
                                "h-1.5 rounded-full transition-all duration-500",
                                idx < workflowState.currentStep ? "bg-cyber-lime" : 
                                idx === workflowState.currentStep ? "bg-cyber-blue animate-pulse" : "bg-white/5"
                              )} />
                              <div className={cn(
                                "text-[9px] font-black uppercase text-center truncate",
                                idx === workflowState.currentStep ? "text-cyber-blue" : "text-zinc-700"
                              )}>
                                {stepAgent?.name}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}

                  {messages.map((msg, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={cn(
                        "flex gap-8 group",
                        msg.role === 'user' ? "flex-row-reverse" : ""
                      )}
                    >
                      <div className="shrink-0 pt-2">
                        {msg.role === 'user' ? (
                          <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-500 border border-white/10 shadow-2xl">
                            <User size={24} />
                          </div>
                        ) : (
                          <AgentAvatar agent={AGENTS.find(a => a.id === msg.agentId) || selectedAgent} size="md" glow />
                        )}
                      </div>
                      
                      <div className={cn(
                        "max-w-[85%] space-y-4",
                        msg.role === 'user' ? "text-right" : "text-left"
                      )}>
                        <div className={cn(
                          "relative inline-block px-10 py-8 rounded-[2.5rem] text-[15px] leading-relaxed shadow-[0_20px_50px_rgba(0,0,0,0.3)]",
                          msg.role === 'user' 
                            ? "bg-gradient-to-br from-cyber-blue to-blue-800 text-white rounded-tr-none border border-white/20" 
                            : "glass-dark rounded-tl-none text-zinc-300 border-white/5"
                        )}>
                          <ReactMarkdown className="prose prose-invert max-w-none prose-zinc">
                            {msg.content}
                          </ReactMarkdown>

                          {msg.handoffPlan && (
                            <div className="mt-8 p-6 bg-cyber-lime/10 border border-cyber-lime/30 rounded-3xl space-y-4 text-left">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                  <Sparkles className="text-cyber-lime" size={20} />
                                  <span className="text-xs font-black uppercase tracking-[0.2em] text-cyber-lime">Neural Plan Optimized</span>
                                </div>
                                <Button 
                                  variant="secondary" 
                                  className="!py-2 !px-4 !text-[9px] border-cyber-lime/30 text-cyber-lime hover:bg-cyber-lime hover:text-void"
                                  onClick={() => executeWorkflow(handoffPlanToWorkflow(msg.handoffPlan!))}
                                >
                                  Deploy Pipeline
                                </Button>
                              </div>
                              <h4 className="text-lg font-black text-white">{msg.handoffPlan.title}</h4>
                              <div className="flex flex-wrap gap-2">
                                {msg.handoffPlan.steps.map((s, idx) => (
                                  <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-black/40 rounded-xl border border-white/5">
                                    <div className="w-4 h-4 bg-zinc-800 rounded-full flex items-center justify-center text-[8px] font-black">{idx + 1}</div>
                                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">
                                      {AGENTS.find(a => a.id === s.agentId)?.name}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          
                          <div className={cn(
                            "absolute -bottom-7 flex items-center gap-4 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-700 transition-opacity opacity-0 group-hover:opacity-100",
                            msg.role === 'user' ? "right-6" : "left-6"
                          )}>
                            <span>{msg.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
                            <div className="w-1 h-1 rounded-full bg-zinc-800" />
                            <button className="hover:text-cyber-blue transition-colors">Duplicate</button>
                            <div className="w-1 h-1 rounded-full bg-zinc-800" />
                            <button className="hover:text-cyber-rose transition-colors">Discard</button>
                          </div>
                        </div>

                        {msg.files && msg.files.length > 0 && (
                          <div className={cn("flex flex-wrap gap-3 mt-4", msg.role === 'user' ? "justify-end" : "justify-start")}>
                            {msg.files.map((file, fi) => (
                              <div key={fi} className="relative group w-28 h-28 rounded-3xl overflow-hidden border border-white/5 glass-dark p-1.5 shadow-xl">
                                {file.preview ? (
                                  <img src={file.preview} className="w-full h-full object-cover rounded-2xl" alt="" />
                                ) : (
                                  <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-[10px] text-zinc-500 font-black uppercase tracking-tighter">
                                    <FileText size={32} className="text-zinc-700" />
                                    <span className="truncate w-full px-3 text-center">{file.name}</span>
                                  </div>
                                )}
                                <div className="absolute inset-0 bg-cyber-blue/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                  <Download size={24} className="text-white" />
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  ))}

                  {isLoading && (
                    <div className="flex gap-8">
                      <AgentAvatar agent={selectedAgent} size="md" glow />
                      <div className="glass-dark px-10 py-8 rounded-[2.5rem] rounded-tl-none border-white/5 flex flex-col gap-6 min-w-[350px] shadow-2xl">
                        <div className="flex items-center gap-4">
                          <div className="relative">
                            <Loader2 className="animate-spin text-cyber-blue" size={24} />
                            <div className="absolute inset-0 animate-ping bg-cyber-blue/20 rounded-full" />
                          </div>
                          <div>
                            <span className="text-xs font-black text-cyber-blue uppercase tracking-[0.3em] glow-text-blue block">
                              Synthesizing Response
                            </span>
                            <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-1 block">
                              Analyzing contextual weights...
                            </span>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                            <motion.div 
                              animate={{ x: [-200, 400] }} 
                              transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
                              className="w-1/2 h-full bg-gradient-to-r from-transparent via-cyber-blue to-transparent" 
                            />
                          </div>
                          <div className="h-1 bg-white/5 rounded-full overflow-hidden w-[70%]">
                            <motion.div 
                              animate={{ x: [-200, 400] }} 
                              transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', delay: 0.3 }}
                              className="w-1/3 h-full bg-gradient-to-r from-transparent via-cyber-lime to-transparent" 
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>
              </motion.div>
            )}

            {activeView === 'agents' && (
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
                    <Button variant="primary" className="!py-5 !px-10 !text-[11px]" icon={Plus}>Initialize Agent</Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 pb-20">
                    {AGENTS.map(agent => (
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
                              {[1, 2, 3].map(i => (
                                <div key={i} className="w-1.5 h-1.5 rounded-full bg-cyber-lime shadow-[0_0_8px_#A3E635]" />
                              ))}
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex-1">
                          <h3 className="text-2xl font-black mb-2 group-hover:text-cyber-blue transition-colors tracking-tight">{agent.name}</h3>
                          <p className="text-[11px] text-zinc-700 uppercase font-black tracking-[0.25em] mb-4">{agent.role}</p>
                          <p className="text-sm text-zinc-500 leading-relaxed group-hover:text-zinc-400 transition-colors">
                            {agent.description}
                          </p>
                        </div>

                        <div className="pt-8 border-t border-white/5 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex -space-x-3">
                              {[1, 2, 3].map(i => (
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
            )}

            {activeView === 'workflows' && (
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
                    <Button variant="secondary" className="!py-5 !px-10 !text-[11px] border-cyber-lime/20 text-cyber-lime hover:bg-cyber-lime hover:text-void" icon={Plus}>Architect Workflow</Button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-20">
                    {BUILTIN_WORKFLOWS.map(workflow => (
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
                          <p className="text-zinc-500 leading-relaxed font-medium">
                            {workflow.description}
                          </p>
                        </div>

                        <div className="space-y-4">
                          <p className="text-[10px] font-black uppercase tracking-[0.25em] text-zinc-700">Workflow Sequence</p>
                          <div className="flex items-center gap-3">
                            {workflow.steps.map((step, idx) => {
                              const stepAgent = AGENTS.find(a => a.id === step.agentId);
                              return (
                                <React.Fragment key={idx}>
                                  <div className="group/step relative">
                                    <AgentAvatar agent={stepAgent || AGENTS[0]} size="sm" />
                                    <div className="absolute -top-10 left-1/2 -translate-x-1/2 px-3 py-1 bg-zinc-900 border border-white/10 rounded-lg text-[9px] font-black uppercase text-white opacity-0 group-hover/step:opacity-100 transition-opacity whitespace-nowrap">
                                      {stepAgent?.name}
                                    </div>
                                  </div>
                                  {idx < workflow.steps.length - 1 && (
                                    <ChevronRight size={14} className="text-zinc-800" />
                                  )}
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
            )}

            {activeView === 'toolbox' && (
              <motion.div
                key="toolbox"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="flex-1 overflow-y-auto px-10 py-12 custom-scrollbar"
              >
                <div className="max-w-6xl mx-auto space-y-16">
                   <div className="flex items-end justify-between border-b border-white/5 pb-10">
                    <div className="space-y-4">
                      <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-500/10 rounded-lg text-amber-500">
                          <Layers size={24} />
                        </div>
                        <Badge color="gold">Auxiliary System Utilities</Badge>
                      </div>
                      <h2 className="text-5xl font-serif font-black tracking-tighter italic">Enterprise Toolbox</h2>
                      <p className="text-zinc-500 font-medium text-lg max-w-xl">
                        Advanced utilities for data extraction, media processing, and system-wide knowledge management.
                      </p>
                    </div>
                  </div>

                  {/* Auxiliary Control Panel (from screenshot 2) */}
                  <div className="space-y-8">
                    <div className="flex items-center gap-4">
                       <div className="w-px h-8 bg-cyber-blue shadow-[0_0_10px_#3B82F6]" />
                       <h3 className="text-2xl font-black uppercase tracking-tighter">Auxiliary Control</h3>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      <Card className="p-10 space-y-6 border-cyber-lime/20 hover:border-cyber-lime transition-all group">
                         <div className="w-16 h-16 bg-cyber-lime/10 rounded-2xl flex items-center justify-center text-cyber-lime group-hover:glow-blue transition-all">
                            <Sparkles size={32} />
                         </div>
                         <div className="space-y-2">
                            <h4 className="text-xl font-black tracking-tight">Visualizer Engine 3.0</h4>
                            <p className="text-zinc-500 text-sm font-medium">Hybrid segmentation & photorealistic rendering.</p>
                         </div>
                         <Button variant="primary" className="w-full" onClick={() => handleLaunchTool('visualizer')}>
                            Launch Tool
                         </Button>
                      </Card>

                      <Card className="p-10 space-y-6 border-cyber-blue/20 hover:border-cyber-blue transition-all group">
                         <div className="w-16 h-16 bg-cyber-blue/10 rounded-2xl flex items-center justify-center text-cyber-blue group-hover:glow-blue transition-all">
                            <Globe size={32} />
                         </div>
                         <div className="space-y-2">
                            <h4 className="text-xl font-black tracking-tight">SEO Bridge Master</h4>
                            <p className="text-zinc-500 text-sm font-medium">Programmatic SEO automation & sitemap generation.</p>
                         </div>
                         <Button variant="primary" className="w-full" onClick={() => handleLaunchTool('seo')}>
                            Generate Sitemap
                         </Button>
                      </Card>

                      <Card className="p-10 space-y-6 border-purple-500/20 hover:border-purple-500 transition-all group">
                         <div className="w-16 h-16 bg-purple-500/10 rounded-2xl flex items-center justify-center text-purple-500 group-hover:glow-blue transition-all">
                            <Video size={32} />
                         </div>
                         <div className="space-y-2">
                            <h4 className="text-xl font-black tracking-tight">Media Producer Hub</h4>
                            <p className="text-zinc-500 text-sm font-medium">Vertical viral video generator & media studio.</p>
                         </div>
                         <Button variant="primary" className="w-full" onClick={() => handleLaunchTool('media')}>
                            Open Producer
                         </Button>
                      </Card>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                      { id: 'dashboard', name: 'Shop Dashboard', desc: 'Multi-tenant CRM & Pipeline management.', icon: LayoutDashboard, color: 'bg-cyber-blue' },
                      { id: 'analytics', name: 'Market Intelligence', desc: 'Deep data insights & trend analysis.', icon: BarChart3, color: 'bg-indigo-500' },
                      { id: 'knowledge', name: 'Brain Sync', desc: 'Centralized institutional memory & SOPs.', icon: Database, color: 'bg-stone-500' },
                      { id: 'social', name: 'Content Engine', desc: 'Cross-platform viral content generation.', icon: Share2, color: 'bg-cyber-rose' },
                      { id: 'leads', name: 'Lead Velocity', desc: 'High-conversion lead identification.', icon: Target, color: 'bg-orange-500' },
                    ].map(tool => (
                      <Card key={tool.id} className="group hover:border-white/20 transition-all duration-500 p-8 space-y-6 glass-dark flex flex-col items-center text-center">
                        <div className={cn("w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-2 shadow-2xl group-hover:scale-110 transition-transform", tool.color)}>
                          <tool.icon size={32} />
                        </div>
                        <div className="flex-1 space-y-2">
                          <h3 className="text-lg font-black tracking-tight group-hover:text-white transition-colors">{tool.name}</h3>
                          <p className="text-[11px] text-zinc-600 leading-relaxed font-medium">
                            {tool.desc}
                          </p>
                        </div>
                        <button 
                          onClick={() => handleLaunchTool(tool.id)}
                          className="w-full py-3 bg-white/5 rounded-xl text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:bg-cyber-blue hover:text-white transition-all border border-white/5 shadow-inner"
                        >
                          Launch Module
                        </button>
                      </Card>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Persistent Chat Input Bar */}
          {activeView === 'chat' && (
            <div className="absolute bottom-0 left-0 right-0 p-10 pt-0 z-40">
              <div className="max-w-4xl mx-auto">
                {attachedFiles.length > 0 && (
                  <div className="flex flex-wrap gap-4 mb-5">
                    {attachedFiles.map((file, i) => (
                      <motion.div 
                        initial={{ scale: 0.8, opacity: 0, y: 10 }}
                        animate={{ scale: 1, opacity: 1, y: 0 }}
                        key={i} 
                        className="relative w-24 h-24 rounded-3xl overflow-hidden border border-cyber-blue/40 ring-4 ring-cyber-blue/5 p-1.5 glass-dark shadow-2xl"
                      >
                        {file.preview ? (
                          <img src={file.preview} className="w-full h-full object-cover rounded-2xl" alt="" />
                        ) : (
                          <div className="w-full h-full bg-zinc-900/50 flex flex-col items-center justify-center text-zinc-600 font-black text-[9px] uppercase tracking-tighter">
                            <FileText size={28} className="mb-1 text-zinc-700" />
                            <span className="truncate w-full px-3 text-center">{file.name}</span>
                          </div>
                        )}
                        <button 
                          onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1.5 right-1.5 w-7 h-7 bg-black/80 backdrop-blur-md rounded-xl flex items-center justify-center text-white border border-white/10 hover:bg-cyber-rose/80 transition-all shadow-lg"
                        >
                          <X size={14} />
                        </button>
                      </motion.div>
                    ))}
                  </div>
                )}

                <div className="relative group perspective-1000">
                  <div className="absolute inset-0 bg-cyber-blue/10 rounded-[3rem] blur-3xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
                  <div className="relative glass border-white/10 focus-within:border-cyber-blue/50 rounded-[3rem] transition-all flex items-end p-3 pr-5 shadow-[0_30px_100px_rgba(0,0,0,0.6)]">
                    <button 
                      onClick={() => fileInputRef.current?.click()}
                      className="p-6 text-zinc-500 hover:text-cyber-blue transition-all group/file"
                    >
                      <Paperclip size={26} className="group-hover/file:rotate-12 transition-transform" />
                    </button>
                    <input 
                      ref={fileInputRef}
                      type="file" 
                      multiple 
                      className="hidden" 
                      onChange={handleFileSelect}
                    />
                    <textarea
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleSendMessage();
                        }
                      }}
                      placeholder={`Direct ${selectedAgent.name}...`}
                      className="flex-1 bg-transparent border-none outline-none resize-none py-6 px-3 text-lg max-h-48 custom-scrollbar font-medium placeholder:text-zinc-700"
                      rows={1}
                    />
                    <div className="flex items-center gap-2 pb-3">
                      <button 
                        onClick={toggleListening}
                        className={cn(
                          "w-12 h-12 rounded-full flex items-center justify-center transition-all",
                          isListening 
                            ? "bg-cyber-rose text-white animate-pulse shadow-[0_0_20px_rgba(244,63,94,0.5)]" 
                            : "bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-cyber-blue"
                        )}
                      >
                        {isListening ? <MicOff size={20} /> : <Mic size={20} />}
                      </button>
                      <button 
                        onClick={() => handleSendMessage()}
                        disabled={isLoading || (!input.trim() && attachedFiles.length === 0)}
                        className="w-16 h-16 bg-cyber-blue hover:bg-blue-500 disabled:bg-zinc-900 disabled:text-zinc-800 rounded-full flex items-center justify-center text-white shadow-[0_0_25px_rgba(59,130,246,0.5)] disabled:shadow-none transition-all group/send relative overflow-hidden"
                      >
                        <div className="absolute inset-0 bg-white/20 opacity-0 group-hover/send:opacity-100 transition-opacity" />
                        <Send size={24} className="group-hover/send:translate-x-0.5 group-hover/send:-translate-y-0.5 transition-transform" />
                      </button>
                    </div>
                  </div>
                </div>
                
                <div className="mt-6 flex items-center justify-between px-10 text-[10px] font-black uppercase tracking-[0.4em] text-zinc-700">
                  <div className="flex items-center gap-8">
                    <div className="flex items-center gap-2 group cursor-help">
                      <div className="w-1.5 h-1.5 rounded-full bg-cyber-lime shadow-[0_0_8px_#A3E635] animate-pulse" />
                      Neural Link Active
                    </div>
                    <div className="flex items-center gap-2 group cursor-help">
                      <Database size={12} className="text-zinc-800" />
                      Long-Term Context Memory
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-zinc-800 hover:text-cyber-blue transition-colors cursor-help group">
                    Engine: Gemini 3.1 Pro <AlertCircle size={10} className="group-hover:rotate-12 transition-transform" />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// --- Specialized Helper Components ---

const Card = ({ children, className = '' }: any) => (
  <div className={cn("glass-dark border border-white/5 rounded-[2.5rem] overflow-hidden", className)}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', className = '', icon: Icon, disabled = false, loading = false }: any) => {
  const variants: any = {
    primary: 'bg-cyber-blue text-white shadow-[0_0_30px_rgba(59,130,246,0.3)] hover:bg-blue-500 hover:shadow-[0_0_40px_rgba(59,130,246,0.5)]',
    secondary: 'bg-white/5 text-white border border-white/10 hover:bg-white/10 hover:border-white/20',
    ghost: 'text-zinc-500 hover:text-white hover:bg-white/5',
    danger: 'bg-cyber-rose/10 text-cyber-rose border border-cyber-rose/20 hover:bg-cyber-rose hover:text-white',
  };

  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'flex items-center justify-center gap-3 px-8 py-4 rounded-2xl font-black uppercase tracking-[0.2em] text-[10px] transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed border border-transparent',
        variants[variant],
        className
      )}
    >
      {loading ? <Loader2 className="animate-spin" size={16} /> : Icon && <Icon size={16} />}
      {children}
    </motion.button>
  );
};
