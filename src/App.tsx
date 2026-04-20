import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Loader2,
  Menu,
  Settings2,
  Globe,
  Terminal,
  Maximize2,
} from 'lucide-react';
import { AGENTS, chatWithAgent, Agent, AttachedFile, type ChatHistoryEntry, RelayBridge } from './services/gemini';
import { 
  parseHandoffPlanFromMessage, 
  type WorkflowShape,
} from './services/handoffPlan';
import { uploadFileToGeminiViaServer } from './services/upload';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from './lib/firebase';
import { PersistenceService } from './services/persistence';
import { AgentsView } from './components/app/AgentsView';
import { ChatView } from './components/app/ChatView';
import { Sidebar } from './components/app/Sidebar';
import { ToolboxView } from './components/app/ToolboxView';
import { WorkflowsView } from './components/app/WorkflowsView';
import type { AppView, Message, SystemLog, WorkflowState } from './components/app/types';
import { AgentAvatar, Badge } from './components/app/ui';

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
              <AgentsView
                setActiveView={setActiveView}
                setSelectedAgent={setSelectedAgent}
              />
            )}

            {activeView === 'workflows' && (
              <WorkflowsView executeWorkflow={executeWorkflow} />
            )}

            {activeView === 'toolbox' && (
              <ToolboxView handleLaunchTool={handleLaunchTool} />
            )}
          </AnimatePresence>

        </div>
      </main>
    </div>
  );
}
