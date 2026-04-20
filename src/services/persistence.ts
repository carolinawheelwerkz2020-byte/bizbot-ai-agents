import { 
  collection, 
  addDoc, 
  query, 
  where, 
  orderBy, 
  getDocs, 
  onSnapshot,
  Timestamp,
  serverTimestamp,
  type DocumentData
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { Message } from '../App';

export interface ChatSession {
  id: string;
  userId: string;
  agentId: string;
  lastMessage: string;
  updatedAt: any;
}

export const PersistenceService = {
  async saveMessage(agentId: string, message: Message) {
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

  async getMessages(agentId: string): Promise<Message[]> {
    if (!db || !auth?.currentUser) return [];

    try {
      const messagesRef = collection(db, 'chats', auth.currentUser.uid, 'messages');
      const q = query(
        messagesRef, 
        where('agentId', '==', agentId),
        orderBy('timestamp', 'asc')
      );
      
      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.timestamp?.toDate() || new Date()
        } as Message;
      });
    } catch (error) {
      console.error('Error getting messages:', error);
      return [];
    }
  },

  subscribeToMessages(agentId: string, callback: (messages: Message[]) => void) {
    if (!db || !auth?.currentUser) return () => {};

    const messagesRef = collection(db, 'chats', auth.currentUser.uid, 'messages');
    const q = query(
      messagesRef, 
      where('agentId', '==', agentId),
      orderBy('timestamp', 'asc')
    );

    return onSnapshot(q, (snapshot) => {
      const messages = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          ...data,
          timestamp: data.timestamp?.toDate() || new Date()
        } as Message;
      });
      callback(messages);
    });
  }
};
