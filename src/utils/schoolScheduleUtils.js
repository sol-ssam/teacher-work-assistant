// school_day_schedules 문서 하나를 특정 학급/교시에 적용했을 때의 영향을 판단하는
// 순수 함수 모음이다. AI를 사용하지 않으며, status가 "confirmed"인 항목만 실제 계산에
// 반영한다. "needs_review"는 계산에 반영하지 않고 별도로 표시만 한다 - 이 판단은
// remainingLessons.js에서 이 모듈의 함수를 호출하기 전에 먼저 걸러낸다.
import { addDaysToDateString } from "./date";

// 그날 실제로 적용할 시간표 요일. scheduleDayOverride가 있으면 그 요일을,
// 없으면 실제 날짜의 요일을 그대로 쓴다.
export function getEffectiveDayOfWeek(schedule, actualDayOfWeek) {
  return schedule?.scheduleDayOverride || actualDayOfWeek;
}

// 그 학급이 그날 완전히 수업이 없는지(학년 지정 시험, 전교 휴업 등).
// grade는 호출부에 따라 문자열("3")일 수도, 숫자(3)일 수도 있고 noClassGrades는 항상
// 숫자 배열이므로, 비교 전에 양쪽을 Number로 정규화한다 - 타입이 달라 항상 거짓으로
// 평가되는 걸 막기 위해서다.
export function isClassExcludedForDate(schedule, grade) {
  if (!schedule) return false;
  if (schedule.noRegularClasses) return true;
  if (
    Array.isArray(schedule.noClassGrades) &&
    schedule.noClassGrades.map(Number).includes(Number(grade))
  ) {
    return true;
  }
  return false;
}

// 그 교시가 그날 정규 교과수업 대상 교시인지. regularPeriods가 "값이 있는" 배열로
// 지정되어 있으면 그 목록에 있는 교시만 인정하고(예: "1-2 수업" → [1,2]), 빈 배열이거나
// 아예 없으면(=제한 없음) 모든 교시를 인정한다. affectedGrades/affectedPeriods(창체/동아리
// 등 특정 학년·교시 영향)도 같은 원칙으로 함께 확인한다.
//
// 주의: regularPeriods가 빈 배열([])로 저장된 경우와 아예 없는(undefined) 경우를 반드시
// 똑같이 "제한 없음"으로 취급해야 한다. 저장 경로(AI 후보 저장)는 지정되지 않은 필드를
// 항상 빈 배열로 저장하므로, 배열의 존재 여부만 보고 판단하면(길이를 보지 않으면) 제한이
// 없는 날에도 모든 교시가 잘못 제외되는 심각한 오류가 생긴다.
export function isPeriodRegularForDate(schedule, { grade, period }) {
  if (!schedule) return true;

  if (
    Array.isArray(schedule.regularPeriods) &&
    schedule.regularPeriods.length > 0 &&
    !schedule.regularPeriods.includes(period)
  ) {
    return false;
  }

  const hasAffectedGrades = Array.isArray(schedule.affectedGrades) && schedule.affectedGrades.length > 0;
  const hasAffectedPeriods = Array.isArray(schedule.affectedPeriods) && schedule.affectedPeriods.length > 0;

  if (hasAffectedGrades || hasAffectedPeriods) {
    const gradeAffected = !hasAffectedGrades || schedule.affectedGrades.map(Number).includes(Number(grade));
    const periodAffected = !hasAffectedPeriods || schedule.affectedPeriods.includes(period);
    if (gradeAffected && periodAffected) return false;
  }

  return true;
}

// 아직 수업 영향이 확정되지 않은(needs_review) 학사일정 중, 오늘부터 withinDays일 이내로
// 다가오는 것만 골라 날짜순으로 반환한다. 이번 단계에서는 홈 브리핑에 직접 연결하지
// 않지만, 이후 브리핑 개편에서 그대로 가져다 쓸 수 있도록 독립적인 함수로 둔다.
export function getUpcomingNeedsReviewSchedules(schedules, today, withinDays = 7) {
  const limit = addDaysToDateString(today, withinDays);
  return schedules
    .filter((s) => s.status === "needs_review" && s.date >= today && s.date <= limit)
    .sort((a, b) => a.date.localeCompare(b.date));
}
