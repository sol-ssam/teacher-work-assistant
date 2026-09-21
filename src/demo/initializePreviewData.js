import { doc, setDoc, writeBatch } from "firebase/firestore";
import { db } from "../firebase/config";
import { getSettings } from "../firebase/settingsService";
import { todayDateString } from "../utils/date";
import { buildPreviewSeed, assertPreviewSeedIntegrity, PREVIEW_SEED_VERSION } from "./previewSeedData";

// 같은 uid에 대해 동시에 두 번 호출돼도(React StrictMode 등) seed 작업이 한 번만 진행되게 한다.
const inflight = new Map();

// writeBatch가 permission-denied로 실패하면 "어느 문서가" 규칙을 통과하지 못했는지는 batch
// 오류만으로는 알 수 없다. 이 경우에만(정상 경로에는 영향 없음) 같은 문서를 하나씩 써 보고,
// 거부된 문서를 collection/docId/ownerId 일치 여부와 함께 console에 남긴다. Rules를 우회하지
// 않는다 - 각 문서는 그대로 같은 규칙을 통과해야만 써진다.
// - 하나라도 거부되면 원래 오류를 그대로 던진다(초기화 완료 marker는 쓰지 않는다).
// - 모두 통과했다면(= batch 자체의 문제였다면) 문서 ID가 고정이라 중복 없이 이미 다 써졌으므로,
//   그 뒤에 marker를 마지막으로 써서 초기화를 마무리한다.
async function diagnoseDeniedBatch(user, seed, marker, batchError) {
  const results = await Promise.allSettled(
    seed.docs.map(({ collection, id, data }) => setDoc(doc(db, collection, id), data))
  );
  const denied = seed.docs
    .filter((_, i) => results[i].status === "rejected")
    .map(({ collection, id, data }) => ({ path: `${collection}/${id}`, ownerIdMatchesUid: data.ownerId === user.uid }));

  let signInProvider = null;
  try {
    signInProvider = (await user.getIdTokenResult()).signInProvider;
  } catch {
    // 진단용 정보일 뿐이므로 실패해도 무시한다.
  }

  console.error("[Preview seed] batch permission-denied 진단:", {
    uid: user.uid,
    signInProvider,
    total: seed.docs.length,
    deniedCount: denied.length,
    denied: denied.slice(0, 20),
  });

  if (denied.length > 0) throw batchError;

  console.warn("[Preview seed] 문서를 하나씩 쓰면 모두 통과했습니다. 마지막으로 marker를 기록합니다.");
  await setDoc(doc(db, "settings", user.uid), marker, { merge: true });
  return { seeded: true, count: seed.docs.length, recovered: true };
}

// Anonymous(미리보기) 사용자의 샘플 데이터를 한 번만 만든다.
//
// - user.isAnonymous === true인 경우에만 동작한다. Google 사용자는 어떤 경우에도 여기서
//   아무것도 쓰지 않고 바로 돌아간다.
// - 모든 seed 문서와 완료 marker(settings/{uid}.previewInitialized)를 "하나의 writeBatch"로
//   커밋한다. 배치는 전부 성공하거나 전부 실패하므로, 중간에 실패한 채로 "초기화 완료"가
//   기록되는 일이 없다.
// - 문서 ID가 고정(deterministic)이라 혹시 재시도되더라도 같은 문서를 덮어쓸 뿐 중복 생성되지 않는다.
// - 모든 문서의 ownerId는 현재 익명 사용자의 UID다(기존 Firestore Rules 그대로 통과).
export function ensurePreviewData(user) {
  if (!user || user.isAnonymous !== true) {
    return Promise.resolve({ seeded: false, reason: "not-anonymous" });
  }

  const existing = inflight.get(user.uid);
  if (existing) return existing;

  const task = (async () => {
    const settings = await getSettings(user.uid);
    if (settings.previewInitialized === true) {
      return { seeded: false, reason: "already-initialized" };
    }

    const today = todayDateString();
    const nowIso = new Date().toISOString();
    const seed = buildPreviewSeed({ uid: user.uid, today, nowIso });
    assertPreviewSeedIntegrity(seed, user.uid);

    const marker = {
      previewInitialized: true,
      previewSeedVersion: PREVIEW_SEED_VERSION,
      previewSeededAt: nowIso,
      previewSeedDate: today,
    };

    const batch = writeBatch(db);
    for (const { collection, id, data } of seed.docs) {
      batch.set(doc(db, collection, id), data);
    }
    batch.set(doc(db, "settings", user.uid), marker, { merge: true });

    try {
      await batch.commit();
    } catch (error) {
      if (error?.code !== "permission-denied") throw error;
      return diagnoseDeniedBatch(user, seed, marker, error);
    }

    return { seeded: true, count: seed.docs.length };
  })().finally(() => {
    inflight.delete(user.uid);
  });

  inflight.set(user.uid, task);
  return task;
}
