import React from 'react';
import { motion } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import {
  AlertCircle,
  Database,
  Download,
  FileText,
  Loader2,
  Mic,
  MicOff,
  Paperclip,
  Send,
  Sparkles,
  User,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from 'lucide-react';
import { AGENTS, type Agent, type AttachedFile } from '../../services/gemini';
import { handoffPlanToWorkflow } from '../../services/handoffPlan';
import type { Message, WorkflowState } from './types';
import type { RunSummary, RunTemplate } from './types';
import { AgentAvatar, Button, cn } from './ui';

type ChatViewProps = {
  attachedFiles: AttachedFile[];
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  handleFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleSendMessage: (textOverride?: string, agentOverride?: Agent) => Promise<void>;
  input: string;
  isListening: boolean;
  isLoading: boolean;
  messages: Message[];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  removeAttachedFile: (index: number) => void;
  selectedAgent: Agent;
  setInput: React.Dispatch<React.SetStateAction<string>>;
  toggleListening: () => void;
  workflowState: WorkflowState | null;
  executeWorkflow: (workflow: WorkflowState['workflow']) => Promise<void>;
  runSummaries: RunSummary[];
  runTemplates: RunTemplate[];
  handleReplayRun: (runSummary: RunSummary) => Promise<void>;
  handleSaveRunTemplate: (runSummary: RunSummary) => Promise<void>;
  handleLaunchTemplate: (runTemplate: RunTemplate) => Promise<void>;
};

export function ChatView({
  attachedFiles,
  fileInputRef,
  handleFileSelect,
  handleSendMessage,
  input,
  isListening,
  isLoading,
  messages,
  messagesEndRef,
  removeAttachedFile,
  selectedAgent,
  setInput,
  toggleListening,
  workflowState,
  executeWorkflow,
  runSummaries,
  runTemplates,
  handleReplayRun,
  handleSaveRunTemplate,
  handleLaunchTemplate,
}: ChatViewProps) {
  return (
    <>
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
                {selectedAgent.suggestedPrompts.map((prompt) => (
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
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="glass border-cyber-blue/30 p-8 rounded-[2.5rem] space-y-6 glow-blue">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-cyber-blue/10 rounded-2xl flex items-center justify-center text-cyber-blue">
                    <WorkflowIcon size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-black uppercase tracking-tight">{workflowState.workflow.name}</h3>
                    <p className="text-[10px] text-zinc-500 uppercase font-black tracking-[0.2em]">
                      {workflowState.isRunning ? 'Executing Multi-Agent Pipeline' : 'Autonomous Pipeline Timeline'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {workflowState.isRunning ? (
                    <>
                      <Loader2 size={16} className="animate-spin text-cyber-blue" />
                      <span className="text-xs font-black text-cyber-blue">Step {workflowState.currentStep + 1} of {workflowState.workflow.steps.length}</span>
                    </>
                  ) : (
                    <span className="text-xs font-black text-cyber-lime">
                      {workflowState.steps.some((step) => step.status === 'failed') ? 'Pipeline halted' : 'Pipeline complete'}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                {workflowState.workflow.steps.map((step, idx) => {
                  const stepAgent = AGENTS.find((agent) => agent.id === step.agentId);
                  const stepRun = workflowState.steps[idx];
                  return (
                    <div key={idx} className="flex-1 space-y-2">
                      <div
                        className={cn(
                          'h-1.5 rounded-full transition-all duration-500',
                          stepRun?.status === 'completed'
                            ? 'bg-cyber-lime'
                            : stepRun?.status === 'failed'
                              ? 'bg-cyber-rose'
                              : stepRun?.status === 'running'
                                ? 'bg-cyber-blue animate-pulse'
                                : 'bg-white/5'
                        )}
                      />
                      <div className={cn(
                        'text-[9px] font-black uppercase text-center truncate',
                        stepRun?.status === 'completed'
                          ? 'text-cyber-lime'
                          : stepRun?.status === 'failed'
                            ? 'text-cyber-rose'
                            : stepRun?.status === 'running'
                              ? 'text-cyber-blue'
                              : 'text-zinc-700'
                      )}>
                        {stepAgent?.name}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-3">
                {workflowState.steps.map((stepRun, idx) => {
                  const stepAgent = AGENTS.find((agent) => agent.id === stepRun.agentId);
                  return (
                    <div key={`${stepRun.agentId}-${idx}`} className="rounded-2xl border border-white/5 bg-black/20 px-5 py-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <AgentAvatar agent={stepAgent || selectedAgent} size="sm" />
                          <div>
                            <div className="text-sm font-black text-white">{stepAgent?.name || stepRun.agentId}</div>
                            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-600">Step {idx + 1}</div>
                          </div>
                        </div>
                        <div className={cn(
                          'text-[10px] font-black uppercase tracking-[0.2em]',
                          stepRun.status === 'completed'
                            ? 'text-cyber-lime'
                            : stepRun.status === 'failed'
                              ? 'text-cyber-rose'
                              : stepRun.status === 'running'
                                ? 'text-cyber-blue'
                                : 'text-zinc-600'
                        )}>
                          {stepRun.status}
                        </div>
                      </div>
                      {stepRun.output && (
                        <p className="mt-3 text-sm text-zinc-400 leading-relaxed line-clamp-3">
                          {stepRun.output}
                        </p>
                      )}
                      {stepRun.error && (
                        <p className="mt-3 text-sm text-rose-200 leading-relaxed">
                          {stepRun.error}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}

          {messages.map((msg, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className={cn('flex gap-8 group', msg.role === 'user' ? 'flex-row-reverse' : '')}>
              <div className="shrink-0 pt-2">
                {msg.role === 'user' ? (
                  <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center text-zinc-500 border border-white/10 shadow-2xl">
                    <User size={24} />
                  </div>
                ) : msg.role === 'system' ? (
                  <div className="w-12 h-12 rounded-2xl bg-cyber-rose/10 flex items-center justify-center text-cyber-rose border border-cyber-rose/20 shadow-2xl">
                    <AlertCircle size={24} />
                  </div>
                ) : (
                  <AgentAvatar agent={AGENTS.find((agent) => agent.id === msg.agentId) || selectedAgent} size="md" glow />
                )}
              </div>

              <div className={cn('max-w-[85%] space-y-4', msg.role === 'user' ? 'text-right' : 'text-left')}>
                <div
                  className={cn(
                    'relative inline-block px-10 py-8 rounded-[2.5rem] text-[15px] leading-relaxed shadow-[0_20px_50px_rgba(0,0,0,0.3)]',
                    msg.role === 'user'
                      ? 'bg-gradient-to-br from-cyber-blue to-blue-800 text-white rounded-tr-none border border-white/20'
                      : msg.role === 'system'
                        ? 'bg-cyber-rose/10 text-rose-100 rounded-tl-none border border-cyber-rose/20'
                      : 'glass-dark rounded-tl-none text-zinc-300 border-white/5'
                  )}
                >
                  <div className="prose prose-invert max-w-none prose-zinc">
                    <ReactMarkdown>{msg.content}</ReactMarkdown>
                  </div>

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
                          onClick={() => executeWorkflow(handoffPlanToWorkflow(msg.handoffPlan))}
                        >
                          Deploy Pipeline
                        </Button>
                      </div>
                      <h4 className="text-lg font-black text-white">{msg.handoffPlan.title}</h4>
                      <div className="flex flex-wrap gap-2">
                        {msg.handoffPlan.steps.map((step, idx) => (
                          <div key={idx} className="flex items-center gap-2 px-3 py-1.5 bg-black/40 rounded-xl border border-white/5">
                            <div className="w-4 h-4 bg-zinc-800 rounded-full flex items-center justify-center text-[8px] font-black">{idx + 1}</div>
                            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-tighter">{AGENTS.find((agent) => agent.id === step.agentId)?.name}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div
                    className={cn(
                      'absolute -bottom-7 flex items-center gap-4 text-[9px] font-black uppercase tracking-[0.3em] text-zinc-700 transition-opacity opacity-0 group-hover:opacity-100',
                      msg.role === 'user' ? 'right-6' : 'left-6'
                    )}
                  >
                    <span>{msg.timestamp.toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })}</span>
                    <div className="w-1 h-1 rounded-full bg-zinc-800" />
                    <span>{msg.role === 'user' ? 'User input' : msg.role === 'system' ? 'System notice' : 'Agent response'}</span>
                  </div>
                </div>

                {msg.files && msg.files.length > 0 && (
                  <div className={cn('flex flex-wrap gap-3 mt-4', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
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
                    <span className="text-xs font-black text-cyber-blue uppercase tracking-[0.3em] glow-text-blue block">Synthesizing Response</span>
                    <span className="text-[9px] text-zinc-600 uppercase font-black tracking-widest mt-1 block">Analyzing contextual weights...</span>
                  </div>
                </div>
                <div className="space-y-3">
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div animate={{ x: [-200, 400] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }} className="w-1/2 h-full bg-gradient-to-r from-transparent via-cyber-blue to-transparent" />
                  </div>
                  <div className="h-1 bg-white/5 rounded-full overflow-hidden w-[70%]">
                    <motion.div animate={{ x: [-200, 400] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'linear', delay: 0.3 }} className="w-1/3 h-full bg-gradient-to-r from-transparent via-cyber-lime to-transparent" />
                  </div>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </motion.div>

      <div className="absolute bottom-0 left-0 right-0 p-10 pt-0 z-40">
        <div className="max-w-4xl mx-auto">
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-4 mb-5">
              {attachedFiles.map((file, i) => (
                <motion.div initial={{ scale: 0.8, opacity: 0, y: 10 }} animate={{ scale: 1, opacity: 1, y: 0 }} key={i} className="relative w-24 h-24 rounded-3xl overflow-hidden border border-cyber-blue/40 ring-4 ring-cyber-blue/5 p-1.5 glass-dark shadow-2xl">
                  {file.preview ? (
                    <img src={file.preview} className="w-full h-full object-cover rounded-2xl" alt="" />
                  ) : (
                    <div className="w-full h-full bg-zinc-900/50 flex flex-col items-center justify-center text-zinc-600 font-black text-[9px] uppercase tracking-tighter">
                      <FileText size={28} className="mb-1 text-zinc-700" />
                      <span className="truncate w-full px-3 text-center">{file.name}</span>
                    </div>
                  )}
                  <button onClick={() => removeAttachedFile(i)} className="absolute top-1.5 right-1.5 w-7 h-7 bg-black/80 backdrop-blur-md rounded-xl flex items-center justify-center text-white border border-white/10 hover:bg-cyber-rose/80 transition-all shadow-lg">
                    <X size={14} />
                  </button>
                </motion.div>
              ))}
            </div>
          )}

          <div className="relative group perspective-1000">
            <div className="absolute inset-0 bg-cyber-blue/10 rounded-[3rem] blur-3xl opacity-0 group-focus-within:opacity-100 transition-opacity" />
            <div className="relative glass border-white/10 focus-within:border-cyber-blue/50 rounded-[3rem] transition-all flex items-end p-3 pr-5 shadow-[0_30px_100px_rgba(0,0,0,0.6)]">
              <button onClick={() => fileInputRef.current?.click()} className="p-6 text-zinc-500 hover:text-cyber-blue transition-all group/file">
                <Paperclip size={26} className="group-hover/file:rotate-12 transition-transform" />
              </button>
              <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelect} />
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
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
                    'w-12 h-12 rounded-full flex items-center justify-center transition-all',
                    isListening ? 'bg-cyber-rose text-white animate-pulse shadow-[0_0_20px_rgba(244,63,94,0.5)]' : 'bg-white/5 text-zinc-500 hover:bg-white/10 hover:text-cyber-blue'
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
    </>
  );
}
