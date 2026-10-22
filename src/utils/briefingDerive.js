import { addDaysToDateString } from "./date";
import { effectiveEventEndDate } from "./constants";

// events/tasks 컬렉션을 각각 한 번만 읽은 뒤, 브리핑에 필요한 여러 조각(오늘/기한초과/
// 다가오는 항목 등)을 전부 클라이언트에서 걸러낸다. Firestore 쪽에서는 ownerId 하나로만
// 조회하고, 날짜 비교나 정렬 같은 부가 조건은 여기서 처리해 불필요한 복합 색인을 만들지 않는다.

// 기간 일정(endDate 있음)은 그 기간 안에 오늘이 들어가면 "오늘 일정"이다 - 시작일만
// today와 같은지 보던 기존 방식은 오늘이 기간 중간/마지막 날인 경우를 놓친다. endDate가
// 없는 기존 일정은 effectiveEventEndDate가 date와 같으므로 기존 동작과 완전히 같다.
export function deriveTodayEvents(allEvents, today) {
  return allEvents
    .filter((e) => e.date <= today && effectiveEventEndDate(e) >= today)
    .sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
}

export function deriveUpcomingEvents(allEvents, today, withinDays = 7) {
  const limit = addDaysToDateString(today, withinDays);
  return allEvents.filter((e) => e.date > today && e.date <= limit);
}

export function deriveOverdueTasks(allTasks, today) {
  return allTasks.filter((t) => !t.completed && t.dueDate < today);
}

export function deriveTodayDueTasks(allTasks, today) {
  return allTasks.filter((t) => !t.completed && t.dueDate === today);
}

export function deriveUpcomingTasks(allTasks, today, withinDays = 7) {
  const limit = addDaysToDateString(today, withinDays);
  return allTasks.filter((t) => !t.completed && t.dueDate > today && t.dueDate <= limit);
}
