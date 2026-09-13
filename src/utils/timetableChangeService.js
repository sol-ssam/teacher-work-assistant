import { formatClassName } from "./progressComparison";
import { formatDateDisplay, weekdayKoreanOf } from "./date";

// 시간표 일시 변경(맞교환/이동)의 "검증 + 저장할 override payload 생성"만 담당하는 순수
// 함수 모음이다. Firestore 쓰기는 전혀 하지 않는다 - TimetablePage.jsx(UI)와
// toolExecutors.js(AI)가 이 함수들을 똑같이 호출해서, 사람이 화면에서 등록하든 AI에게
// 말해서 등록하든 정확히 같은 규칙과 정확히 같은 timetable_overrides 구조가 나오게 한다.
//
// source/destination 인자는 getEffectiveDayTimetable().periods의 항목(또는 최소
// { period, className, subject } 모양)을 그대로 받는다 - 학사일정 요일대체가 이미 반영된
// "그날 실제 시간표"에서 호출부가 먼저 찾아 넘겨준다는 전제다. 이 함수 자체는 어떤 날짜가
// 무슨 요일인지, scheduleDayOverride가 있는지 전혀 알지 못한다 - 그건 항상 호출부
// (getEffectiveDayTimetable)의 책임이다.

function makeChangeGroupId() {
  return `chg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 같은 날짜의 두 교시를 맞교환한다.
// 반환: { ok: true, payloads: [override, override] } | { ok: false, reason }
export function buildSwapPayloads(date, periodA, periodB) {
  if (!periodA || !periodB || !periodA.className || !periodB.className) {
    return { ok: false, reason: "맞교환할 두 교시를 모두 선택해 주세요." };
  }
  if (String(periodA.period) === String(periodB.period)) {
    return { ok: false, reason: "서로 다른 두 교시를 선택해 주세요." };
  }

  const changeGroupId = makeChangeGroupId();
  return {
    ok: true,
    payloads: [
      {
        date,
        period: periodA.period,
        className: periodB.className,
        subject: periodB.subject || "",
        changeType: "swap",
        changeGroupId,
      },
      {
        date,
        period: periodB.period,
        className: periodA.className,
        subject: periodA.subject || "",
        changeType: "swap",
        changeGroupId,
      },
    ],
  };
}

// 특정 날짜/교시의 수업을 다른 날짜/교시로 옮긴다(같은 날짜 안이든 다른 날짜든 동일하게
// 처리한다 - "같은 날짜 이동"과 "날짜 간 이동"은 이 함수 안에서 구조적으로 구분하지
// 않는다). destination에 이미 수업이 있으면 절대 덮어쓰지 않고 실패를 돌려준다 - 자동으로
// swap으로 바꾸는 것도 하지 않는다(그건 사용자가 명시적으로 다시 요청했을 때 호출부가
// buildSwapPayloads를 별도로 호출해서 처리할 일이다).
// 반환: { ok: true, payloads: [override, override] } | { ok: false, reason, conflict? }
export function buildMovePayloads({ sourceDate, sourcePeriod, source, destinationDate, destinationPeriod, destination }) {
  if (!source || !source.className) {
    return {
      ok: false,
      reason: `${formatDateDisplay(sourceDate)}(${weekdayKoreanOf(sourceDate)}) ${sourcePeriod}교시에는 등록된 수업이 없습니다.`,
    };
  }

  if (sourceDate === destinationDate && String(sourcePeriod) === String(destinationPeriod)) {
    return { ok: false, reason: "원래 위치와 다른 교시(또는 다른 날짜)를 선택해 주세요." };
  }

  if (destination && destination.className) {
    return {
      ok: false,
      reason: `${formatDateDisplay(destinationDate)}(${weekdayKoreanOf(destinationDate)}) ${destinationPeriod}교시에는 이미 ${formatClassName(destination.className)} 수업이 있습니다.`,
      conflict: destination,
    };
  }

  const changeGroupId = makeChangeGroupId();
  return {
    ok: true,
    payloads: [
      { date: sourceDate, period: sourcePeriod, className: "", changeType: "move", changeGroupId },
      {
        date: destinationDate,
        period: destinationPeriod,
        className: source.className,
        subject: source.subject || "",
        changeType: "move",
        changeGroupId,
      },
    ],
  };
}
