const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

// 마감일 지남/오늘 마감/다가오는 마감 순서 다음, 같은 그룹 안에서는 priority(높음 우선) → 마감일 순으로 정렬한다.
export function sortByPriorityThenDate(tasks) {
  return [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 1;
    const pb = PRIORITY_ORDER[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    return (a.dueDate ?? "").localeCompare(b.dueDate ?? "");
  });
}
