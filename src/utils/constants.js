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

export const TASK_PRIORITIES = [
  { value: "high", label: "높음" },
  { value: "medium", label: "보통" },
  { value: "low", label: "낮음" },
];

export const TASK_PRIORITY_LABEL = Object.fromEntries(
  TASK_PRIORITIES.map((p) => [p.value, p.label])
);
