import React from 'react';
import { motion } from 'motion/react';
import { BarChart3, Globe, Layers, LayoutDashboard, Share2, Sparkles, Target, Video } from 'lucide-react';
import { Badge, Button, Card, cn } from './ui';

type ToolboxViewProps = {
  handleLaunchTool: (toolId: string) => void;
};

const toolboxCards = [
  { id: 'dashboard', name: 'Shop Dashboard', desc: 'Multi-tenant CRM & Pipeline management.', icon: LayoutDashboard, color: 'bg-cyber-blue' },
  { id: 'analytics', name: 'Market Intelligence', desc: 'Deep data insights & trend analysis.', icon: BarChart3, color: 'bg-indigo-500' },
  { id: 'knowledge', name: 'Brain Sync', desc: 'Centralized institutional memory & SOPs.', icon: Layers, color: 'bg-stone-500' },
  { id: 'social', name: 'Content Engine', desc: 'Cross-platform viral content generation.', icon: Share2, color: 'bg-cyber-rose' },
  { id: 'leads', name: 'Lead Velocity', desc: 'High-conversion lead identification.', icon: Target, color: 'bg-orange-500' },
];

export function ToolboxView({ handleLaunchTool }: ToolboxViewProps) {
  return (
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
          {toolboxCards.map((tool) => (
            <Card key={tool.id} className="group hover:border-white/20 transition-all duration-500 p-8 space-y-6 glass-dark flex flex-col items-center text-center">
              <div className={cn('w-16 h-16 rounded-2xl flex items-center justify-center text-white mb-2 shadow-2xl group-hover:scale-110 transition-transform', tool.color)}>
                <tool.icon size={32} />
              </div>
              <div className="flex-1 space-y-2">
                <h3 className="text-lg font-black tracking-tight group-hover:text-white transition-colors">{tool.name}</h3>
                <p className="text-[11px] text-zinc-600 leading-relaxed font-medium">{tool.desc}</p>
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
  );
}
