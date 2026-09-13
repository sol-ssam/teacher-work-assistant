// "~까지 끝냈어"(완료)와 "~의 일부까지 했어"(진행 중) 처리를 위한 순수 함수 모음이다.
// AI(toolExecutors.js)와 화면(MonthlyProgressPage.jsx)이 이 파일을 똑같이 재사용해야
// "AI에게 말한 진도 = 화면에 표시되는 진도"가 보장된다. Gemini는 이 계산을 하지 않는다 -
// 항상 이 함수들의 결과를 그대로 쓴다.

// planItems를 order 순으로 정렬한 뒤, targetPlanItemId까지(포함) 의 id 목록을 반환한다.
// "~까지 끝냈어"에 쓴다. target을 찾지 못하면 null.
export function computeCompletedIdsThrough(planItems, targetPlanItemId) {
  const sorted = [...planItems].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((p) => p.id === targetPlanItemId);
  if (idx === -1) return null;
  return sorted.slice(0, idx + 1).map((p) => p.id);
}

// target 이전까지(target 자체는 제외)의 id 목록을 반환한다. "~을 진행 중이다/~의 일부까지
// 했다"에 쓴다 - target 자체는 미완료로 남기고 그 이전 항목만 완료 처리한다.
export function computeCompletedIdsBefore(planItems, targetPlanItemId) {
  const sorted = [...planItems].sort((a, b) => a.order - b.order);
  const idx = sorted.findIndex((p) => p.id === targetPlanItemId);
  if (idx === -1) return null;
  return sorted.slice(0, idx).map((p) => p.id);
}

function normalizeTitleForMatch(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

// 제목으로 진도 항목을 찾는다. 정확히 일치 → 안전한 정규화 후 단일 일치까지만 허용하고,
// 그 이상은 fuzzy matching을 하지 않는다. 여러 개로 겹치면 item:null과 candidates를
// 함께 돌려줘서 호출부가 사용자에게 확인을 요청하게 한다.
export function findPlanItemByTitle(planItems, rawTitle) {
  const title = String(rawTitle || "").trim();
  if (!title) return { item: null, candidates: [] };

  const exact = planItems.filter((p) => p.title === title);
  if (exact.length === 1) return { item: exact[0], candidates: [] };
  if (exact.length > 1) return { item: null, candidates: exact };

  const norm = normalizeTitleForMatch(title);
  const normMatches = planItems.filter((p) => normalizeTitleForMatch(p.title) === norm);
  if (normMatches.length === 1) return { item: normMatches[0], candidates: [] };
  if (normMatches.length > 1) return { item: null, candidates: normMatches };

  return { item: null, candidates: [] };
}

// 직전 history 항목과 내용이 완전히 같으면(완료 목록·진행 항목·세부진도 전부 동일) 새
// history를 만들 필요가 없다 - 같은 저장을 반복 클릭해도 중복 기록이 쌓이지 않게 한다.
export function historyEntriesEqual(a, b) {
  if (!a || !b) return false;
  const idsA = [...(a.completedPlanItemIds || [])].sort().join(",");
  const idsB = [...(b.completedPlanItemIds || [])].sort().join(",");
  return idsA === idsB && (a.planItemId || null) === (b.planItemId || null) && (a.detail || "") === (b.detail || "");
}
