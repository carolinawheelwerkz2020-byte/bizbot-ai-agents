import type admin from "firebase-admin";

export type FirestoreCollectionOptions = {
  firestore: admin.firestore.Firestore;
  collectionName: string;
  orderBy?: string;
  limit?: number;
};

export class FirestoreCollection<T extends { id: string }> {
  constructor(private readonly options: FirestoreCollectionOptions) {}

  async list() {
    let query: admin.firestore.Query = this.options.firestore.collection(this.options.collectionName);
    if (this.options.orderBy) {
      query = query.orderBy(this.options.orderBy, "desc");
    }
    if (this.options.limit) {
      query = query.limit(this.options.limit);
    }
    const snapshot = await query.get();
    return snapshot.docs.map((doc) => doc.data() as T);
  }

  async upsert(entry: T) {
    await this.options.firestore.collection(this.options.collectionName).doc(entry.id).set(entry, { merge: true });
    return entry;
  }
}
