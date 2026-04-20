import {
  addDoc,
  collection,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { AttachedFile } from './gemini';
import type { HandoffPlan } from './handoffPlan';
import type { RunSummary, RunTemplate } from '../components/app/types';

export interface PersistedMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  files?: AttachedFile[];
  timestamp: Date;
  handoffPlan?: HandoffPlan;
}

export interface ChatSession {
  id: string;
  userId: string;
  agentId: string;
  lastMessage: string;
  updatedAt: unknown;
}

const RUN_SUMMARIES_STORAGE_KEY = 'bizbot-run-summaries';
const RUN_TEMPLATES_STORAGE_KEY = 'bizbot-run-templates';

function readLocalRunSummaries(): RunSummary[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(RUN_SUMMARIES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<RunSummary, 'startedAt' | 'completedAt'> & {
      startedAt: string;
      completedAt: string;
    }>;
    return parsed.map((summary) => ({
      ...summary,
      startedAt: new Date(summary.startedAt),
      completedAt: new Date(summary.completedAt),
    }));
  } catch (error) {
    console.error('Error reading local run summaries:', error);
    return [];
  }
}

function writeLocalRunSummaries(runSummaries: RunSummary[]) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(RUN_SUMMARIES_STORAGE_KEY, JSON.stringify(runSummaries));
  } catch (error) {
    console.error('Error writing local run summaries:', error);
  }
}

function readLocalRunTemplates(): RunTemplate[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(RUN_TEMPLATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Omit<RunTemplate, 'createdAt'> & { createdAt: string }>;
    return parsed.map((template) => ({
      ...template,
      createdAt: new Date(template.createdAt),
    }));
  } catch (error) {
    console.error('Error reading local run templates:', error);
    return [];
  }
}

function writeLocalRunTemplates(runTemplates: RunTemplate[]) {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(RUN_TEMPLATES_STORAGE_KEY, JSON.stringify(runTemplates));
  } catch (error) {
    console.error('Error writing local run templates:', error);
  }
}

export const PersistenceService = {
  async saveMessage(agentId: string, message: PersistedMessage) {
    if (!db || !auth?.currentUser) return;

    try {
      const messagesRef = collection(db, 'chats', auth.currentUser.uid, 'messages');
      await addDoc(messagesRef, {
        ...message,
        agentId,
        timestamp: serverTimestamp(),
      });
    } catch (error) {
      console.error('Error saving message:', error);
    }
  },

  async getMessages(agentId: string): Promise<PersistedMessage[]> {
    if (!db || !auth?.currentUser) return [];

    try {
      const messagesRef = collection(db, 'chats', auth.currentUser.uid, 'messages');
      const q = query(
        messagesRef,
        where('agentId', '==', agentId),
        orderBy('timestamp', 'asc')
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.timestamp?.toDate() || new Date(),
        } as PersistedMessage;
      });
    } catch (error) {
      console.error('Error getting messages:', error);
      return [];
    }
  },

  subscribeToMessages(agentId: string, callback: (messages: PersistedMessage[]) => void) {
    if (!db || !auth?.currentUser) return () => {};

    const messagesRef = collection(db, 'chats', auth.currentUser.uid, 'messages');
    const q = query(
      messagesRef,
      where('agentId', '==', agentId),
      orderBy('timestamp', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map((doc) => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.timestamp?.toDate() || new Date(),
        } as PersistedMessage;
      });
      callback(messages);
    });
  },

  async getRunSummaries(): Promise<RunSummary[]> {
    return readLocalRunSummaries();
  },

  async saveRunSummary(runSummary: RunSummary) {
    const existing = readLocalRunSummaries();
    const next = [runSummary, ...existing].slice(0, 12);
    writeLocalRunSummaries(next);
  },

  async getRunTemplates(): Promise<RunTemplate[]> {
    return readLocalRunTemplates();
  },

  async saveRunTemplate(runTemplate: RunTemplate) {
    const existing = readLocalRunTemplates().filter((template) => template.id !== runTemplate.id);
    const next = [runTemplate, ...existing].slice(0, 20);
    writeLocalRunTemplates(next);
  },
};
