import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "./config";

// Phase 1의 firestore.rules가 허용하는 컬렉션들 — ownerId 필드로 소유자를 구분한다.
// 정렬은 클라이언트에서 처리해 별도 복합 색인(composite index) 없이 동작하도록 한다.

export async function createDoc(collectionName, uid, data) {
  const ref = await addDoc(collection(db, collectionName), {
    ...data,
    ownerId: uid,
  });
  return ref.id;
}

export async function updateDocById(collectionName, id, data) {
  await updateDoc(doc(db, collectionName, id), data);
}

export async function deleteDocById(collectionName, id) {
  await deleteDoc(doc(db, collectionName, id));
}

export async function listDocsByOwner(collectionName, uid) {
  const q = query(collection(db, collectionName), where("ownerId", "==", uid));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
