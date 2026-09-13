import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "./config";
import { todayDateString } from "../utils/date";

const DEFAULT_SETTINGS = {
  briefingTime: "08:20",
  lastBriefingDate: null,
  isHomeroomTeacher: false,
  homeroomClass: "",
};

export async function getSettings(uid) {
  const ref = doc(db, "settings", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? { ...DEFAULT_SETTINGS, ...snap.data() } : DEFAULT_SETTINGS;
}

export async function markBriefingShownToday(uid) {
  const ref = doc(db, "settings", uid);
  await setDoc(ref, { lastBriefingDate: todayDateString() }, { merge: true });
}

// 사용자가 SettingsPage에서 직접 바꾸는 브리핑 기준 시간. 08:20은 기본값일 뿐이며
// 여기서 언제든 다른 시간으로 바꿀 수 있다. lastBriefingDate/자동 브리핑 로직은 그대로다.
export async function updateBriefingTime(uid, briefingTime) {
  const ref = doc(db, "settings", uid);
  await setDoc(ref, { briefingTime }, { merge: true });
}

// 담임 여부/학급. 새 필드가 없는 기존 사용자는 getSettings의 DEFAULT_SETTINGS로
// isHomeroomTeacher: false, homeroomClass: ""를 받게 되어 비담임으로 정상 동작한다.
// 담임을 해제해도 이 함수는 homeroomClass 값 자체를 지우지 않는다 - 나중에 다시 담임으로
// 설정했을 때 기존 학급 값과 담임 학급 시간표 데이터를 그대로 쓸 수 있게 하기 위해서다.
export async function updateHomeroomSettings(uid, { isHomeroomTeacher, homeroomClass }) {
  const ref = doc(db, "settings", uid);
  await setDoc(ref, { isHomeroomTeacher, homeroomClass }, { merge: true });
}
