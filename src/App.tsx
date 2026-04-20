import React, { lazy, Suspense, useState, useRef, useEffect, useCallback } from 'react';
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
  handoffPlanToWorkflow,
  parseHandoffPlanFromMessage, 
  type WorkflowShape,
} from './services/handoffPlan';
import { uploadFileToGeminiViaServer } from './services/upload';
import { motion, AnimatePresence } from 'motion/react';
import { auth } from './lib/firebase';
import { PersistenceService } from './services/persistence';
import { ChatView } from './components/app/ChatView';
import { Sidebar } from './components/app/Sidebar';
import type { AppView, Message, SystemLog, WorkflowState } from './components/app/types';
import { AgentAvatar, Badge } from './components/app/ui';

// --- Constants ---
const INLINE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024; // 10MB
const MAX_AUTONOMOUS_TURNS = 10;
const MAX_AGENT_HANDOFFS = 4;
const MAX_REPEAT_ROUTE_SIGNATURES = 2;

type RelayFunctionCall = {
  name: 'bash' | 'read_file' | 'write_file' | 'edit_file' | 'route_to_agent';
  args: Record<string, string>;
};

type RelayFunctionResult = {
  functionResponse: {
    name: string;
    response: unknown;
  };
};

type ErrorPresentation = {
  title: string;
  summary: string;
  steps: string[];
  logMessage: string;
};

const AgentsView = lazy(async () => {
  const module = await import('./components/app/AgentsView');
  return { default: module.AgentsView };
});

const WorkflowsView = lazy(async () => {
  const module = await import('./components/app/WorkflowsView');
  return { default: module.WorkflowsView };
});

const ToolboxView = lazy(async () => {
  const module = await import('./components/app/ToolboxView');
  return { default: module.ToolboxView };
});

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

function normalizeErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unknown communication error.';
}

function normalizeSupervisorText(text: string) {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

function presentError(error: unknown, context: 'chat' | 'upload' | 'relay' | 'workflow'): ErrorPresentation {
  const message = normalizeErrorMessage(error);
  const normalized = message.toLowerCase();

  if (normalized.includes('sign in required') || normalized.includes('invalid or expired session') || normalized.includes('401')) {
    return {
      title: 'Session expired',
      summary: 'Your session is no longer valid, so the request could not reach the API.',
      steps: [
        'Sign in again and retry the request.',
        'If Firebase auth is enabled locally, make sure the server can verify your token.',
      ],
      logMessage: 'Authentication required for API request.',
    };
  }

  if (normalized.includes('not authorized') || normalized.includes('403')) {
    return {
      title: 'Access blocked',
      summary: 'Your account is signed in, but it is not on the API allowlist.',
      steps: [
        'Add your email to `ALLOWED_EMAILS` on the server.',
        'Restart the local server after updating environment settings.',
      ],
      logMessage: 'API request blocked by allowlist policy.',
    };
  }

  if (normalized.includes('file type not allowed')) {
    return {
      title: 'Unsupported file type',
      summary: 'That attachment format is not allowed by the server upload policy.',
      steps: [
        'Use an image, video, PDF, text file, or JSON file.',
        'If this type should be accepted, update the server MIME allowlist.',
      ],
      logMessage: 'Upload blocked by MIME policy.',
    };
  }

  if (normalized.includes('too many files') || normalized.includes('message too long') || normalized.includes('history is too long') || normalized.includes('too many tool results')) {
    return {
      title: 'Request too large',
      summary: 'The request exceeded one of the server safety limits.',
      steps: [
        'Reduce the number of attachments or shorten the message.',
        'Break the task into smaller steps and retry.',
      ],
      logMessage: 'Request rejected by API payload guardrails.',
    };
  }

  if (normalized.includes('total inline attachment size too large')) {
    return {
      title: 'Attachment payload too large',
      summary: 'The inline attachment payload was too large for a chat request.',
      steps: [
        'Retry with fewer or smaller files.',
        'Use larger uploaded files instead of inline attachments when possible.',
      ],
      logMessage: 'Inline attachment payload exceeded limit.',
    };
  }

  if (normalized.includes('outside the allowed relay workspace')) {
    return {
      title: 'Relay path blocked',
      summary: 'The requested file path is outside the workspace the relay is allowed to touch.',
      steps: [
        'Retry using a file inside the project workspace.',
        'If this path must be reachable, expand `RELAY_ROOT` on the server.',
      ],
      logMessage: 'Relay blocked file access outside allowed workspace.',
    };
  }

  if (normalized.includes('not allowed by the relay policy') || normalized.includes('shell operators are not allowed')) {
    return {
      title: 'Relay command blocked',
      summary: 'The requested shell command was denied by the relay safety policy.',
      steps: [
        'Retry with a simpler allowed command such as `npm`, `node`, or `git`.',
        'Avoid shell chaining, redirection, and unsupported executables.',
      ],
      logMessage: 'Relay blocked an unsafe command.',
    };
  }

  if (normalized.includes('failed to fetch')) {
    return {
      title: 'Connection lost',
      summary: 'The browser could not reach the local API server.',
      steps: [
        'Make sure the local server is running with `npm run dev` or `npm run aegis`.',
        'Refresh the page after the server is back online.',
      ],
      logMessage: 'Browser could not reach the local API server.',
    };
  }

  if (normalized.includes('timed out')) {
    return {
      title: 'Request timed out',
      summary: 'The server took too long to finish the request.',
      steps: [
        'Retry the request once.',
        'For large uploads or long generations, try a smaller input first.',
      ],
      logMessage: `${context} request timed out.`,
    };
  }

  if (normalized.includes('missing gemini_api_key') || normalized.includes('google_api_key')) {
    return {
      title: 'AI API is not configured',
      summary: 'The server is missing the Gemini API key required for this action.',
      steps: [
        'Set `GEMINI_API_KEY` in `.env.local` or your deployment environment.',
        'Restart the server after updating environment variables.',
      ],
      logMessage: 'Gemini API key is missing on the server.',
    };
  }

  if (normalized.includes('handoff limit reached')) {
    return {
      title: 'Handoff limit reached',
      summary: 'The supervisor stopped the run because agents were handing work off too many times without finishing.',
      steps: [
        'Tighten the task so the first agent has a clearer target.',
        'Reduce routing behavior or increase the handoff limit only if you really need deeper chains.',
      ],
      logMessage: 'Supervisor stopped excessive agent handoffs.',
    };
  }

  if (normalized.includes('repeat routing loop detected')) {
    return {
      title: 'Routing loop stopped',
      summary: 'The supervisor detected the same handoff pattern repeating and halted the run.',
      steps: [
        'Adjust the agent instructions so the specialist produces an answer instead of re-routing.',
        'Try a more specific user prompt with a clearer desired output.',
      ],
      logMessage: 'Supervisor stopped a repeated routing loop.',
    };
  }

  if (normalized.includes('autonomous turn limit reached')) {
    return {
      title: 'Autonomous turn limit reached',
      summary: 'The run used too many autonomous turns without landing on a final answer.',
      steps: [
        'Retry with a more focused task.',
        'If the task truly needs more depth, raise the turn limit carefully.',
      ],
      logMessage: 'Supervisor stopped an overlong autonomous run.',
    };
  }

  if (normalized.includes('ended without producing a final response')) {
    return {
      title: 'No final output produced',
      summary: 'The agent chain stopped before producing a usable final answer.',
      steps: [
        'Retry the task once.',
        'If it repeats, simplify the ask or inspect the last tool/handoff step in the timeline.',
      ],
      logMessage: 'Autonomous run ended without final output.',
    };
  }

  return {
    title: context === 'upload' ? 'Upload failed' : context === 'workflow' ? 'Workflow interrupted' : 'Request failed',
    summary: message,
    steps: [
      'Retry the action once.',
      'If the problem persists, check the local server logs for more detail.',
    ],
    logMessage: message,
  };
}

function formatSystemErrorMessage(error: ErrorPresentation) {
  return [
    `### ${error.title}`,
    '',
    error.summary,
    '',
    '**What to do next**',
    ...error.steps.map((step, index) => `${index + 1}. ${step}`),
  ].join('\n');
}

function createWorkflowState(workflow: WorkflowShape): WorkflowState {
  return {
    workflow,
    currentStep: 0,
    isRunning: true,
    outputs: [],
    steps: workflow.steps.map((step) => ({
      agentId: step.agentId,
      status: 'pending',
    })),
    startedAt: new Date(),
  };
}

function ViewLoadingFallback() {
  return (
    <div className="flex-1 flex items-center justify-center px-6">
      <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm font-medium text-zinc-400">
        <Loader2 size={18} className="animate-spin text-cyber-blue" />
        Loading workspace module...
      </div>
    </div>
  );
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
      let currentAgent = agent;
      let lastText = text;
      let lastFiles = newMsg.files;
      let nextToolResults: RelayFunctionResult[] | undefined = undefined;
      let autonomousTurnCount = 0;
      let handoffCount = 0;
      const routeSignatureCounts = new Map<string, number>();

      while (isRunning) {
        autonomousTurnCount += 1;
        if (autonomousTurnCount > MAX_AUTONOMOUS_TURNS) {
          throw new Error('Autonomous turn limit reached before producing a final response.');
        }

        const response = await chatWithAgent(currentAgent, lastText, currentHistory, lastFiles, nextToolResults);
        
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
          let routed = false;
          
          for (const call of response.functionCalls as RelayFunctionCall[]) {
            addLog(`RELAY ACTIVE: Executing ${call.name}...`, 'info');
            let result: unknown;
            
            try {
              if (call.name === 'route_to_agent') {
                const targetAgent = AGENTS.find((candidate) => candidate.id === call.args.agentId);
                if (!targetAgent) {
                  throw new Error(`Unknown target agent "${call.args.agentId}".`);
                }

                handoffCount += 1;
                if (handoffCount > MAX_AGENT_HANDOFFS) {
                  throw new Error('Handoff limit reached before producing a final response.');
                }

                const routePrompt = typeof call.args.prompt === 'string' ? call.args.prompt : '';
                const routeSignature = `${targetAgent.id}::${normalizeSupervisorText(routePrompt)}`;
                const seenCount = (routeSignatureCounts.get(routeSignature) || 0) + 1;
                routeSignatureCounts.set(routeSignature, seenCount);
                if (seenCount > MAX_REPEAT_ROUTE_SIGNATURES) {
                  throw new Error(`Repeat routing loop detected for ${targetAgent.name}.`);
                }

                currentAgent = targetAgent;
                routed = true;
                setSelectedAgent(targetAgent);
                addLog(
                  `Agent handoff: ${currentAgent.name}${call.args.reason ? ` (${call.args.reason})` : ''}`,
                  'agent'
                );
                result = {
                  content: `Handoff complete. Continuing with ${targetAgent.name}.`,
                  agentId: targetAgent.id,
                  reason: call.args.reason || 'Specialist routing.',
                  prompt: routePrompt,
                };
              } else if (call.name === 'bash') {
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
              const relayError = presentError(toolErr, 'relay');
              addLog(`Relay Error: ${relayError.logMessage}`, 'warn');
              toolResults.push({
                functionResponse: {
                  name: call.name,
                  response: { error: relayError.summary }
                }
              });
            }
          }

          // Update history with the model's call
          currentHistory.push({
            role: 'model',
            parts: response.functionCalls.map(c => ({ functionCall: c }))
          });
          
          if (routed) {
            currentHistory.push({ role: 'function', parts: toolResults });
            const routeCall = response.functionCalls.find((call) => call.name === 'route_to_agent') as RelayFunctionCall | undefined;
            nextToolResults = undefined;
            lastText = routeCall?.args.prompt || lastText;
            lastFiles = [];
          } else {
            // Set tool results for the NEXT request instead of pushing to history and sending dummy text
            nextToolResults = toolResults;
            lastText = ""; // Clear text when sending tool results
          }
          continue;
        }

        if (response.text) {
          const handoffPlan = parseHandoffPlanFromMessage(response.text);
          const assistantMsg: Message = { 
            role: 'assistant', 
            content: response.text, 
            agentId: currentAgent.id,
            timestamp: new Date(),
            handoffPlan: handoffPlan || undefined
          };

          setMessages(prev => [...prev, assistantMsg]);
          PersistenceService.saveMessage(currentAgent.id, assistantMsg);

          if (handoffPlan) {
            addLog(`Handoff plan detected: "${handoffPlan.title}"`, 'success');
            const autonomousWorkflow = handoffPlanToWorkflow(handoffPlan);
            addLog(`Autonomous orchestration launched: ${autonomousWorkflow.name}`, 'agent');
            void executeWorkflow(autonomousWorkflow, text || response.text);
          } else {
            addLog(`Response generated by ${currentAgent.name}`, 'info');
          }
          isRunning = false;
        } else {
          throw new Error('Autonomous run ended without producing a final response.');
        }
      }
    } catch (err) {
      const chatError = presentError(err, 'chat');
      addLog(`Communication Failure: ${chatError.logMessage}`, 'warn');
      const systemError: Message = { 
        role: 'system', 
        content: formatSystemErrorMessage(chatError),
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

  const executeWorkflow = async (workflow: WorkflowShape, baseInputOverride?: string) => {
    setActiveView('chat');
    setWorkflowState(createWorkflowState(workflow));
    addLog(`Starting workflow: ${workflow.name}`, 'info');

    let allOutputs: string[] = [];
    const baseInput = baseInputOverride || input || "Proceed with the workflow.";

    for (let i = 0; i < workflow.steps.length; i++) {
      setWorkflowState(prev => prev ? {
        ...prev,
        currentStep: i,
        steps: prev.steps.map((stepRun, index) => ({
          ...stepRun,
          status: index < i ? stepRun.status : index === i ? 'running' : stepRun.status,
        })),
      } : null);
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
        const responseText = response.text;
        if (!responseText?.trim()) {
          throw new Error('Autonomous run ended without producing a final response.');
        }
        allOutputs.push(responseText);
        setWorkflowState(prev => prev ? {
          ...prev,
          outputs: [...allOutputs],
          steps: prev.steps.map((stepRun, index) => (
            index === i
              ? { ...stepRun, status: 'completed', output: responseText }
              : stepRun
          )),
        } : null);
        setMessages(prev => [...prev, { 
          role: 'assistant', 
          content: `## ⚡ Workflow Step ${i + 1}: ${agent.name}\n\n${responseText}`, 
          agentId: agent.id, 
          timestamp: new Date() 
        }]);
      } catch (err) {
        const workflowError = presentError(err, 'workflow');
        addLog(`Workflow failed at step ${i + 1}: ${workflowError.logMessage}`, 'warn');
        setWorkflowState(prev => prev ? {
          ...prev,
          isRunning: false,
          completedAt: new Date(),
          steps: prev.steps.map((stepRun, index) => (
            index === i
              ? { ...stepRun, status: 'failed', error: workflowError.summary }
              : stepRun
          )),
        } : null);
        setMessages(prev => [...prev, {
          role: 'system',
          content: formatSystemErrorMessage({
            ...workflowError,
            title: `Workflow step ${i + 1} failed`,
          }),
          timestamp: new Date(),
        }]);
        break;
      }
    }

    setWorkflowState(prev => prev ? {
      ...prev,
      isRunning: false,
      outputs: [...allOutputs],
      completedAt: new Date(),
    } : null);
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
          const uploadError = presentError(err, 'upload');
          addLog(`Failed to upload ${file.name}: ${uploadError.logMessage}`, 'warn');
          setMessages(prev => [...prev, {
            role: 'system',
            content: formatSystemErrorMessage({
              ...uploadError,
              title: `Upload failed for ${file.name}`,
            }),
            timestamp: new Date(),
          }]);
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
        reader.onerror = () => {
          const uploadError = presentError(new Error(`The browser could not read ${file.name}.`), 'upload');
          addLog(`Failed to read ${file.name}: ${uploadError.logMessage}`, 'warn');
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
              <Suspense fallback={<ViewLoadingFallback />}>
                <AgentsView
                  setActiveView={setActiveView}
                  setSelectedAgent={setSelectedAgent}
                />
              </Suspense>
            )}

            {activeView === 'workflows' && (
              <Suspense fallback={<ViewLoadingFallback />}>
                <WorkflowsView executeWorkflow={executeWorkflow} />
              </Suspense>
            )}

            {activeView === 'toolbox' && (
              <Suspense fallback={<ViewLoadingFallback />}>
                <ToolboxView handleLaunchTool={handleLaunchTool} onLog={addLog} />
              </Suspense>
            )}
          </AnimatePresence>

        </div>
      </main>
    </div>
  );
}
