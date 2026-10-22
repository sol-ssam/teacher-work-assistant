export const WEEKDAYS = ["월", "화", "수", "목", "금"];
export const PERIODS = [1, 2, 3, 4, 5, 6, 7];

export const EVENT_TYPES = [
  { value: "academic", label: "학사일정" },
  { value: "school", label: "학교 행사" },
  { value: "meeting", label: "회의" },
  { value: "council", label: "협의회" },
  { value: "training", label: "연수" },
  { value: "personal", label: "개인 일정" },
  { value: "other", label: "기타" },
];

// 참석 여부가 의미 있는 일정 구분(참석이 확정된 경우에만 Google Calendar 추가 가능) -
// 회의와 협의회 둘 다 여기 속한다. 새 구분을 추가할 때 이 배열에도 추가하면 된다.
export const ATTENDANCE_BASED_EVENT_TYPES = ["meeting", "council"];

export const EVENT_TYPE_LABEL = Object.fromEntries(
  EVENT_TYPES.map((t) => [t.value, t.label])
);

// 목록/브리핑에 실제로 표시할 구분명. type이 "기타"이고 사용자가 customType을
// 입력했으면 "기타" 대신 그 값을 그대로 보여준다.
export function eventTypeDisplayLabel(event) {
  if (event?.type === "other" && event?.customType) return event.customType;
  return EVENT_TYPE_LABEL[event?.type] ?? event?.type ?? "";
}

// 일정의 "시간 표현 방식". 기존 type(학사일정/회의/...)과는 완전히 다른 축이라 혼동하지
// 않는다 - type은 분류, timeType은 그 일정에 시작/종료/마감 시간이 어떻게 적용되는지다.
export const EVENT_TIME_TYPES = [
  { value: "all_day", label: "하루 종일" },
  { value: "deadline", label: "마감 시간" },
  { value: "start_only", label: "시작 시간만" },
  { value: "range", label: "시작~종료 시간" },
];

// 기존(구버전) 일정에는 timeType 필드 자체가 없다. 이 함수는 그런 일정도 오류 없이
// 정상 동작하도록, 있던 startTime/endTime 조합만으로 같은 의미를 추론한다. timeType이
// 명시돼 있으면 그 값을 그대로 쓴다(사용자가 명시적으로 고른 값이 항상 우선한다) -
// 추론은 오직 그 필드가 아예 없는 기존 데이터를 위한 fallback일 뿐이다.
export function resolveEventTimeType(event) {
  if (event?.timeType) return event.timeType;
  if (event?.deadlineTime) return "deadline";
  if (event?.startTime && event?.endTime) return "range";
  if (event?.startTime) return "start_only";
  return "all_day";
}

// 일정이 실제로 "끝나는" 날짜. endDate가 없으면(기존 단일 날짜 일정 포함) date와 같다 -
// 모든 날짜 판정(오늘/다가오는/지난/검색)이 이 함수 하나만 거치면 기간 일정과 기존
// 단일 날짜 일정을 똑같은 규칙으로 다룰 수 있다.
export function effectiveEventEndDate(event) {
  return event?.endDate || event?.date || "";
}

export const TASK_PRIORITIES = [
  { value: "high", label: "높음" },
  { value: "medium", label: "보통" },
  { value: "low", label: "낮음" },
];

export const TASK_PRIORITY_LABEL = Object.fromEntries(
  TASK_PRIORITIES.map((p) => [p.value, p.label])
);
