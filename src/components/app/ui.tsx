import React from 'react';
import { Bot } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion } from 'motion/react';
import type { Agent } from '../../services/gemini';
import {
  Compass,
  TrendingUp,
  ClipboardList,
  DollarSign,
  Target,
  Headset,
  Share2,
  Video,
  Youtube,
  Search,
  Layers,
  Code,
  Cpu,
  PieChart,
  BarChart3,
  ShieldCheck,
  Database,
  Utensils,
  Terminal,
  Globe,
  Loader2,
} from 'lucide-react';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const ICON_MAP: Record<string, React.ComponentType<{ size?: number | string; className?: string }>> = {
  Compass,
  TrendingUp,
  ClipboardList,
  DollarSign,
  Target,
  Headset,
  Share2,
  Video,
  Youtube,
  Search,
  Layers,
  Code,
  Cpu,
  LineChart: TrendingUp,
  PieChart,
  BarChart3,
  ShieldCheck,
  Database,
  Utensils,
  Terminal,
  Globe,
};

export const AgentAvatar = ({
  agent,
  size = 'md',
  glow = false,
}: {
  agent: Agent;
  size?: 'sm' | 'md' | 'lg';
  glow?: boolean;
}) => {
  const Icon = ICON_MAP[agent.icon] || Bot;
  const sizeClasses = {
    sm: 'w-8 h-8 rounded-lg',
    md: 'w-10 h-10 rounded-xl',
    lg: 'w-14 h-14 rounded-2xl',
  };

  return (
    <div
      className={cn(
        'relative group flex-shrink-0',
        sizeClasses[size],
        agent.color,
        'flex items-center justify-center text-white border border-white/20',
        glow && 'shadow-[0_0_20px_rgba(255,255,255,0.2)]'
      )}
    >
      <Icon size={size === 'lg' ? 28 : size === 'md' ? 20 : 16} />
      <div className="absolute inset-0 bg-white/20 rounded-[inherit] opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
};

export const GlassButton = ({
  children,
  onClick,
  active = false,
  className = '',
  icon: Icon,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
}) => (
  <motion.button
    whileHover={{ scale: 1.02 }}
    whileTap={{ scale: 0.98 }}
    onClick={onClick}
    className={cn(
      'flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 border',
      active
        ? 'bg-cyber-blue/10 border-cyber-blue/30 text-cyber-blue shadow-[0_0_15px_rgba(59,130,246,0.1)]'
        : 'bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:border-white/10 hover:text-white',
      className
    )}
  >
    {Icon && <Icon size={18} />}
    <span className="text-sm font-semibold truncate">{children}</span>
  </motion.button>
);

export const Badge = ({
  children,
  color = 'blue',
  className = '',
}: {
  children: React.ReactNode;
  color?: string;
  className?: string;
}) => {
  const colors: Record<string, string> = {
    blue: 'bg-cyber-blue/10 text-cyber-blue border-cyber-blue/20',
    lime: 'bg-cyber-lime/10 text-cyber-lime border-cyber-lime/20',
    rose: 'bg-cyber-rose/10 text-cyber-rose border-cyber-rose/20',
    gold: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  };

  return (
    <span
      className={cn(
        'px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest border shrink-0',
        colors[color],
        className
      )}
    >
      {children}
    </span>
  );
};

export const Card = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={cn('glass-dark border border-white/5 rounded-[2.5rem] overflow-hidden', className)}>{children}</div>;

export const Button = ({
  children,
  onClick,
  variant = 'primary',
  className = '',
  icon: Icon,
  disabled = false,
  loading = false,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  icon?: React.ComponentType<{ size?: number | string; className?: string }>;
  disabled?: boolean;
  loading?: boolean;
}) => {
  const variants: Record<string, string> = {
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
