// school_day_schedules 문서 하나를 특정 학급/교시에 적용했을 때의 영향을 판단하는
// 순수 함수 모음이다. AI를 사용하지 않는다.
// - 날짜 단위 해석(noRegularClasses/noClassGrades/scheduleDayOverride/regularPeriods/
//   affectedGrades/affectedPeriods)은 문서 전체의 status가 "confirmed"일 때만 반영한다.
//   "needs_review"는 계산에 반영하지 않고 별도로 표시만 한다 - 이 판단은
//   remainingLessons.js/effectiveTimetable.js에서 이 모듈의 함수를 호출하기 전에 먼저
//   걸러낸다(schedule을 null로 넘긴다).
// - classActivities는 그 날짜 문서 전체의 status와 완전히 독립적으로, 활동 하나하나의
//   status만 본다 - 부모 날짜 해석이 아직 needs_review여도 교사가 개별적으로 confirmed한
//   활동은 적용된다. isPeriodRegularForDate()에 classActivities를 별도 인자로 넘기는
//   것은 이 분리를 위해서다.
import { addDaysToDateString } from "./date";
import { isSameClass } from "./progressComparison";

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
// className(선택) - classActivities(반 단위로 범위가 좁을 수 있는 교시별 학교 자체
// 교육활동)를 판정하려면 필요하다.
// classActivities(선택) - 호출부가 "날짜 단위 학사일정(schedule)이 confirmed일 때만
// 쓰는" 기존 regularPeriods/affectedGrades/affectedPeriods와, "개별 활동 자체의
// status로 독립 판정하는" classActivities를 분리해서 넘길 수 있게 한 별도 인자다.
// schedule은 호출부에서 이미 confirmed일 때만 넘기므로(아니면 null) 이 함수 안에서는
// 그대로 신뢰하지만, classActivities는 그 schedule의 confirmed 여부와 무관하게
// "그 날짜 문서에 실제로 있는 값"을 그대로 받는다 - 부모 날짜 해석이 아직 needs_review여도
// 교사가 개별적으로 confirmed한 활동은 계산에 반영되어야 하기 때문이다(아래
// isExcludedByClassActivity가 활동 하나하나의 status를 다시 확인한다). 둘 다 생략하면
// (기존 호출부) 전부 건너뛰어 기존 동작과 100% 동일하다.
export function isPeriodRegularForDate(schedule, { grade, period, className, classActivities } = {}) {
  if (schedule) {
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
  }

  if (isExcludedByClassActivity(classActivities, { grade, period, className })) return false;

  return true;
}

// school_day_schedules.classActivities(선택, 배열) - "같은 날짜에 교시별로 서로 다른
// 학교 자체 교육활동이 여러 개 있고, 반 단위로 대상이 다를 수 있는" 경우를 위한 필드다.
// 기존 affectedGrades/affectedPeriods(학년+교시까지만, 하루 1건)로는 표현할 수 없는
// "반 단위 타겟팅"/"같은 날 여러 활동"만 이 필드가 추가로 담당하며, 기존 필드들을
// 대체하지 않는다(OR 관계로 더해진다).
//
// 제외 조건(전부 만족해야 함) - 활동 하나하나의 status만 본다. 이 함수는 날짜 문서
// 전체(school_day_schedules.status)의 confirmed 여부와 완전히 독립적으로 동작한다 -
// 부모 날짜 해석이 needs_review여도, 교사가 개별적으로 confirmed한 활동은 그대로
// 적용된다(반대로 활동 자체가 needs_review면 부모가 confirmed여도 적용되지 않는다):
// - activity.status === "confirmed"
// - activity.excluded === true
// - periods에 이 교시가 포함됨(숫자/문자열 혼용 방어를 위해 양쪽 다 Number로 정규화)
// - grades가 없거나 비어 있으면(=학년 제한 없음) 통과, 있으면 이 grade를 포함해야 함
// - classNames가 없거나 비어 있으면(=학년 전체) 통과, 있으면 이 className과 일치하는
//   항목이 있어야 함(isSameClass로 "301"/"3-1" 등 기존 표기 차이를 동일하게 처리)
function isExcludedByClassActivity(classActivities, { grade, period, className }) {
  return findExcludingClassActivity(classActivities, { grade, period, className }) !== null;
}

// 위 isExcludedByClassActivity와 완전히 같은 판정 조건을 쓰되, "제외되었는지 여부"가
// 아니라 "실제로 제외시킨 activity 자체"를 돌려준다. remainingLessons.js가 계산 근거
// 설명(날짜/활동명/제외된 교시)을 만들 때, 계산에 쓰는 판정과 다른 기준으로 어긋나지
// 않도록 이 함수를 그대로 재사용한다 - 조건을 두 번 따로 구현하지 않는다.
export function findExcludingClassActivity(classActivities, { grade, period, className }) {
  const activities = Array.isArray(classActivities) ? classActivities : [];

  return (
    activities.find((activity) => {
      if (activity.status !== "confirmed" || activity.excluded !== true) return false;
      if (!Array.isArray(activity.periods) || !activity.periods.map(Number).includes(Number(period))) return false;

      const hasGrades = Array.isArray(activity.grades) && activity.grades.length > 0;
      if (hasGrades && !activity.grades.map(Number).includes(Number(grade))) return false;

      const hasClassNames = Array.isArray(activity.classNames) && activity.classNames.length > 0;
      if (hasClassNames && !activity.classNames.some((c) => isSameClass(c, className))) return false;

      return true;
    }) || null
  );
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
