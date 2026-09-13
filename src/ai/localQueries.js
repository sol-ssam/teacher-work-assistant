import {
  getTodayBaseTimetable,
  getTodayTimetableOverrides,
  getTodayEvents,
  getTodayDueTasks,
} from "../firebase/collections";
import { todayDisplayString } from "../utils/date";

// 아주 흔한 정형 질문은 자연어 이해가 사실상 필요 없으므로, Gemini를 호출하지 않고
// 기존 브리핑용 조회 함수만으로 바로 답을 만든다. 여기 없는 표현은 전부 Gemini로 넘어간다.
const TODAY_SUMMARY_PHRASES = new Set([
  "오늘 뭐 있어",
  "오늘 뭐있어",
  "오늘 뭐야",
  "오늘 일정 뭐있어",
  "오늘 일정 알려줘",
  "오늘 일정이 뭐야",
  "오늘 뭐 해야 해",
  "오늘 뭐해야해",
  "오늘 할 일",
  "오늘 할일",
  "오늘 할일 알려줘",
]);

function normalize(text) {
  return text.trim().replace(/[?!.]+$/g, "").replace(/\s+/g, " ");
}

export async function tryLocalQuery(rawText, uid) {
  const text = normalize(rawText);
  if (!TODAY_SUMMARY_PHRASES.has(text)) return null;

  const [timetable, overrides, events, dueTasks] = await Promise.all([
    getTodayBaseTimetable(uid),
    getTodayTimetableOverrides(uid),
    getTodayEvents(uid),
    getTodayDueTasks(uid),
  ]);

  const lines = [`${todayDisplayString()} 기준으로 알려드릴게요.`];

  lines.push(
    timetable.length > 0
      ? `시간표: ${timetable.map((t) => `${t.period}교시 ${t.className}(${t.subject})`).join(", ")}`
      : "시간표: 등록된 수업이 없습니다."
  );

  if (overrides.length > 0) {
    lines.push(
      `시간표 변경: ${overrides.map((o) => `${o.period}교시 ${o.className}${o.memo ? ` — ${o.memo}` : ""}`).join(", ")}`
    );
  }

  lines.push(
    events.length > 0
      ? `일정: ${events.map((e) => `${e.startTime ?? ""} ${e.title}`.trim()).join(", ")}`
      : "일정: 등록된 일정이 없습니다."
  );

  lines.push(
    dueTasks.length > 0
      ? `오늘 마감 업무: ${dueTasks.map((t) => t.title).join(", ")}`
      : "오늘 마감인 업무는 없습니다."
  );

  return lines.join("\n");
}
