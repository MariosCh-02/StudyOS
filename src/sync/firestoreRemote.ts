import {
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  startAfter,
  Timestamp,
  where,
  writeBatch,
  getFirestore,
  type QueryDocumentSnapshot,
  type QuerySnapshot,
} from "firebase/firestore";
import { getApp } from "@/lib/firebase";
import type { RemoteRow, RemoteStore, RowData } from "./engine";

const PAGE = 500;

/**
 * Firestore treats "/" in a document id as a path separator, so ids such as
 * "tag:ci/cd" are stored with "/" encoded. Nothing else is encoded, so the ids
 * of rows already in the cloud are unchanged.
 */
export const toDocId = (id: string) => id.replaceAll("/", "%2F");
export const fromDocId = (docId: string) => docId.replace(/%2F/g, "/");

/**
 * Cloud layout: users/{uid}/{table}/{rowId}
 * Each document holds the row's columns plus `syncedAt` (server timestamp).
 * Security rules restrict users/{uid}/** to the signed-in owner.
 */
export function createFirestoreRemote(uid: string): RemoteStore {
  const db = getFirestore(getApp());
  const tableRef = (table: string) => collection(db, "users", uid, table);

  return {
    async pull(table, sinceMs) {
      const out: RemoteRow[] = [];
      let last: QueryDocumentSnapshot | null = null;
      for (;;) {
        const base = query(tableRef(table), where("syncedAt", ">", Timestamp.fromMillis(sinceMs)), orderBy("syncedAt"), limit(PAGE));
        const snap: QuerySnapshot = await getDocs(last ? query(base, startAfter(last)) : base);
        for (const d of snap.docs) {
          const { syncedAt, ...data } = d.data() as RowData & { syncedAt: Timestamp | null };
          if (!syncedAt) continue; // pending local write; picked up next time
          out.push({ id: fromDocId(d.id), data, syncedAtMs: syncedAt.toMillis() });
        }
        if (snap.docs.length < PAGE) return out;
        last = snap.docs[snap.docs.length - 1]!;
      }
    },

    async push(table, rows) {
      const batch = writeBatch(db);
      for (const r of rows) batch.set(doc(tableRef(table), toDocId(r.id)), { ...r.data, syncedAt: serverTimestamp() });
      await batch.commit();
    },
  };
}
