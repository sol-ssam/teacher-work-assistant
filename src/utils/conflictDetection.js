// AI가 추출한 후보 항목을 실제로 저장하기 전에, 같은 날짜에 이미 등록된 데이터와
// 겹치지 않는지 순수 코드로 확인한다. 충돌이 있으면 사용자 확인 없이 덮어쓰지 않는다.

function normalize(text) {
  return (text || "").trim().toLowerCase();
}

// existingEvents: events 컬렉션 전체 배열
export function findEventConflict(candidate, existingEvents) {
  if (!candidate.date) return null;
  return (
    existingEvents.find(
      (e) => e.date === candidate.date && normalize(e.title) === normalize(candidate.title)
    ) || null
  );
}

export function findTaskConflict(candidate, existingTasks) {
  if (!candidate.date) return null;
  return (
    existingTasks.find(
      (t) => t.dueDate === candidate.date && normalize(t.title) === normalize(candidate.title)
    ) || null
  );
}

// 시간표 변경은 같은 날짜에 이미 등록된 항목이 있으면 그 자체가 충돌 후보다 (교시까지는
// 문서에서 특정하기 어려우므로 날짜만으로 비교한다).
export function findTimetableOverrideConflict(candidate, existingOverrides) {
  if (!candidate.date) return null;
  return existingOverrides.find((o) => o.date === candidate.date) || null;
}
