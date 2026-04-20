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
  }
};
