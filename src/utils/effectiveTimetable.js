import { weekdayKoreanOf } from "./date";
import { getEffectiveDayOfWeek, isClassExcludedForDate, isPeriodRegularForDate } from "./schoolScheduleUtils";
import { gradeOfClassName } from "./progressComparison";

// 특정 날짜의 "최종 실제 시간표"를 계산한다. remainingLessons.js가 남은 수업 횟수를 셀 때
// 쓰는 것과 정확히 같은 우선순위를 따른다 - 여기서는 그 순서를 "시간표 한 장"으로
// 보여주기 위해 별도 함수로 추출했을 뿐, remainingLessons.js 자체는 한 줄도 바꾸지
// 않았다(회귀 위험을 피하기 위해 의도적으로 각자 독립적으로 유지한다).
//
// 계산 순서:
// 1. 그 날짜의 실제 요일 확인
// 2. school_day_schedules 확인 (status가 confirmed인 것만)
// 3. confirmed이고 scheduleDayOverride가 있으면 그 요일의 기본 timetable을 기준으로 삼는다
// 4. 없으면 실제 요일의 기본 timetable을 기준으로 삼는다
// 5. 그 날짜의 timetable_overrides를 교시별로 덮어씌운다(빈 className=취소로 처리)
// 6. 학사일정에 의해 그 교시/학년 수업이 제외되는지(시험/일부교시 등) 표시한다
//
// AI는 이 계산을 하지 않는다 - 항상 이 함수의 결과를 그대로 쓴다.
export function getEffectiveDayTimetable(date, { timetable, timetableOverrides, schoolDaySchedules }) {
  const actualDayOfWeek = weekdayKoreanOf(date);
  const rawSchedule = schoolDaySchedules.find((s) => s.date === date) || null;
  const schedule = rawSchedule && rawSchedule.status === "confirmed" ? rawSchedule : null;
  const effectiveDayOfWeek = getEffectiveDayOfWeek(schedule, actualDayOfWeek);

  const overridesForDate = timetableOverrides.filter((o) => o.date === date);
  const basePeriodsForDay = timetable.filter((t) => t.dayOfWeek === effectiveDayOfWeek);

  const periodsSet = new Set([
    ...basePeriodsForDay.map((t) => t.period),
    ...overridesForDate.map((o) => o.period),
  ]);

  const periods = [...periodsSet]
    .sort((a, b) => a - b)
    .map((period) => {
      const override = overridesForDate.find((o) => o.period === period);
      const base = basePeriodsForDay.find((t) => t.period === period);

      const className = override ? override.className || null : base?.className || null;
      const subject = override ? override.subject || null : base?.subject || null;
      const periodGrade = className ? gradeOfClassName(className) : null;

      const excludedByGrade = !!schedule && periodGrade && isClassExcludedForDate(schedule, periodGrade);
      const excludedByPeriod =
        !!schedule && periodGrade && !isPeriodRegularForDate(schedule, { grade: periodGrade, period });
      const excluded = !!className && (excludedByGrade || excludedByPeriod);

      return {
        period,
        className: override && !override.className ? null : className,
        subject,
        isOverride: !!override,
        changeType: override?.changeType || null,
        changeGroupId: override?.changeGroupId || null,
        overrideId: override?.id || null,
        cancelled: !!override && !override.className,
        excludedByAcademicSchedule: excluded,
      };
    });

  return {
    date,
    actualDayOfWeek,
    effectiveDayOfWeek,
    scheduleDayOverride: schedule?.scheduleDayOverride || null,
    scheduleOriginalText: schedule?.originalText || null,
    periods,
  };
}

// 그 날짜를 "변동 시간표"에 표시할지 판단한다. 학사일정으로 요일 자체가 바뀐 날(confirmed +
// scheduleDayOverride) 또는 개인 override가 있는 날만 대상이다. 시험/휴업 같은 다른 특수일은
// 여기 포함하지 않는다 - 이 탭의 목적은 "시간표 배치 자체가 달라지는 날"이기 때문이다.
export function isTimetableChangedDay(date, { timetableOverrides, schoolDaySchedules }) {
  const hasPersonalOverride = timetableOverrides.some((o) => o.date === date);
  const rawSchedule = schoolDaySchedules.find((s) => s.date === date) || null;
  const hasConfirmedDayOverride = !!(
    rawSchedule &&
    rawSchedule.status === "confirmed" &&
    rawSchedule.scheduleDayOverride
  );
  return hasPersonalOverride || hasConfirmedDayOverride;
}
