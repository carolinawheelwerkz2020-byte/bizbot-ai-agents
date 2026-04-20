import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Bot, 
  ChevronRight, 
  LayoutDashboard,
  Sparkles,
  Loader2,
  Layers,
  Target,
  Share2,
  ShieldCheck,
  Database,
  Menu,
  Plus,
  Settings2,
  Video,
  BarChart3,
  Play,
  Globe,
  Terminal,
  Maximize2,
  ArrowRight,
  GitBranch,
  Workflow as WorkflowIcon,
} from 'lucide-react';
import { AGENTS, chatWithAgent, Agent, AttachedFile, type ChatHistoryEntry, RelayBridge } from './services/gemini';
import { 
  parseHandoffPlanFromMessage, 
  BUILTIN_WORKFLOWS, 
  type WorkflowShape,
} from './services/handoffPlan';
import { uploadFileToGeminiViaServer } from './services/upload';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from './lib/firebase';
import { PersistenceService } from './services/persistence';
import { ChatView } from './components/app/ChatView';
import { Sidebar } from './components/app/Sidebar';
import type { AppView, Message, SystemLog, WorkflowState } from './components/app/types';
import { AgentAvatar, Badge, Button, Card, cn } from './components/app/ui';

// --- Constants ---
const INLINE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

type RelayFunctionCall = {
  name: 'bash' | 'read_file' | 'write_file' | 'edit_file';
  args: Record<string, string>;
};

type RelayFunctionResult = {
  functionResponse: {
    name: string;
    response: unknown;
  };
};

function messageToHistoryParts(message: Message): ChatHistoryEntry | null {
  if (message.role === 'system') return null;

  if (message.role === 'assistant') {
    return {
      role: 'model',
      parts: [{ text: message.content }],
    };
  }

  const parts: Array<Record<string, unknown>> = [];
  if (message.content) {
    parts.push({ text: message.content });
  }

  for (const file of message.files || []) {
    if (file.geminiFile?.uri) {
      parts.push({
        fileData: {
          fileUri: file.geminiFile.uri,
          mimeType: file.geminiFile.mimeType || file.mimeType,
        },
      });
    } else if (file.data) {
      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data,
        },
      });
    }
  }

  return {
    role: 'user',
    parts,
  };
}

function buildHistoryFromMessages(messages: Message[]): ChatHistoryEntry[] {
  return messages
    .map(messageToHistoryParts)
    .filter((entry): entry is ChatHistoryEntry => Boolean(entry));
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('chat');
  const [selectedAgent, setSelectedAgent] = useState<Agent>(AGENTS.find(a => a.id === 'router') || AGENTS[0]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [systemLogs, setSystemLogs] = useState<SystemLog[]>([
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
      let currentHistory: ChatHistoryEntry[] = buildHistoryFromMessages(messages);
      let isRunning = true;
      let lastText = text;
      let lastFiles = newMsg.files;
      let nextToolResults: RelayFunctionResult[] | undefined = undefined;

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
          const toolResults: RelayFunctionResult[] = [];
          
          for (const call of response.functionCalls as RelayFunctionCall[]) {
            addLog(`RELAY ACTIVE: Executing ${call.name}...`, 'info');
            let result: unknown;
            
            try {
              if (call.name === 'bash') {
                result = await RelayBridge.exec(call.args.command, call.args.workdir);
                const execResult = result as { exitCode?: number };
                addLog(`Relay: Command executed (Exit: ${execResult.exitCode ?? 'unknown'})`, execResult.exitCode === 0 ? 'success' : 'warn');
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
            } catch (toolErr: unknown) {
              const errorMessage = toolErr instanceof Error ? toolErr.message : 'Unknown relay error.';
              addLog(`Relay Error: ${errorMessage}`, 'warn');
              toolResults.push({
                functionResponse: {
                  name: call.name,
                  response: { error: errorMessage }
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
      const prompt = step.prompt
        .replace('{{input}}', baseInput)
        .replace('{{previous}}', allOutputs[i - 1] || "No previous output.")
        .replace('{{all_previous}}', allOutputs.join('\n\n---\n\n'));

      try {
        const response = await chatWithAgent(agent, prompt, [], []);
        const responseText = response.text || 'No response generated.';
        allOutputs.push(responseText);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `## ⚡ Workflow Step ${i + 1}: ${agent.name}\n\n${responseText}`, 
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
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : 'Unknown upload error.';
          addLog(`Failed to upload ${file.name}: ${errorMessage}`, 'warn');
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

  const removeAttachedFile = (index: number) => {
    setAttachedFiles((prev) => prev.filter((_, fileIndex) => fileIndex !== index));
  };

  return (
    <div className="flex h-screen bg-deep-space text-zinc-100 overflow-hidden font-sans selection:bg-cyber-blue/40 selection:text-white">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyber-blue/5 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-cyber-lime/5 blur-[120px] rounded-full animate-pulse" style={{ animationDelay: '2s' }} />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-[0.04] mix-blend-overlay" />
      </div>

      <Sidebar
        activeView={activeView}
        isMobileMenuOpen={isMobileMenuOpen}
        isSidebarOpen={isSidebarOpen}
        selectedAgent={selectedAgent}
        setActiveView={setActiveView}
        setIsMobileMenuOpen={setIsMobileMenuOpen}
        setIsSidebarOpen={setIsSidebarOpen}
        setSelectedAgent={setSelectedAgent}
        systemLogs={systemLogs}
      />

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
              <ChatView
                attachedFiles={attachedFiles}
                executeWorkflow={executeWorkflow}
                fileInputRef={fileInputRef}
                handleFileSelect={handleFileSelect}
                handleSendMessage={handleSendMessage}
                input={input}
                isListening={isListening}
                isLoading={isLoading}
                messages={messages}
                messagesEndRef={messagesEndRef}
                removeAttachedFile={removeAttachedFile}
                selectedAgent={selectedAgent}
                setInput={setInput}
                toggleListening={toggleListening}
                workflowState={workflowState}
              />
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

        </div>
      </main>
    </div>
  );
}
