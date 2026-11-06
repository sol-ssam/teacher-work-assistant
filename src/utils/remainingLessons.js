import { enumerateDateRange, weekdayKoreanOf, isDateInRange } from "./date";
import {
  getEffectiveDayOfWeek,
  isClassExcludedForDate,
  isPeriodRegularForDate,
  findExcludingClassActivity,
} from "./schoolScheduleUtils";
import { isSameClass } from "./progressComparison";

// 날짜 범위 안에서 특정 학급의 실제 남은 수업 횟수를 계산한다. Gemini를 전혀 사용하지
// 않으며, 같은 입력에는 항상 같은 결과가 나온다.
//
// 계산 순서(기획서 27장과 동일):
// 1~2. 날짜 순회, school_day_schedules 조회
// 3~7. 완전휴업/학년제외/scheduleDayOverride/regularPeriods/affected 조건 적용
// 8~9. timetable + timetable_overrides로 그날 실제 어느 학급 수업인지 결정
// 10. lesson_adjustments 반영
// 11~12. 최종 횟수와 근거(basis) 반환
//
// status가 "confirmed"가 아닌 school_day_schedules(예: needs_review)의 날짜 단위
// 해석(noRegularClasses/scheduleDayOverride/regularPeriods/affectedGrades/
// affectedPeriods)은 계산에 반영하지 않고, 대신 unresolvedSchedules로 따로 돌려준다 -
// 확정되지 않은 영향을 임의로 차감하지 않기 위해서다. 다만 그 문서 안의
// classActivities는 개별 활동 자체의 status로 독립 판정되므로(schoolScheduleUtils.js
// 참고), 날짜 전체가 needs_review여도 confirmed인 활동은 그대로 반영된다.
export function calculateRemainingLessons({
  className,
  grade,
  dateFrom,
  dateTo,
  timetable,
  timetableOverrides,
  schoolDaySchedules,
  lessonAdjustments,
}) {
  const dates = enumerateDateRange(dateFrom, dateTo);
  const basis = [];
  const dayOverrideBasis = []; // 설명 전용 - total에는 절대 합산하지 않는다(아래 참고)
  const unresolvedSchedules = [];
  let baseCount = 0;

  for (const date of dates) {
    const actualDayOfWeek = weekdayKoreanOf(date);
    const rawSchedule = schoolDaySchedules.find((s) => s.date === date) || null;

    if (rawSchedule && rawSchedule.status === "needs_review") {
      unresolvedSchedules.push(rawSchedule);
    }

    const schedule = rawSchedule && rawSchedule.status === "confirmed" ? rawSchedule : null;
    const effectiveDay = getEffectiveDayOfWeek(schedule, actualDayOfWeek);

    const overridesForDate = timetableOverrides.filter((o) => o.date === date);
    const basePeriodsForDay = timetable.filter((t) => t.dayOfWeek === effectiveDay);
    const periodsSet = new Set([
      ...basePeriodsForDay.map((t) => t.period),
      ...overridesForDate.map((o) => o.period),
    ]);

    let normalCountThatDay = 0;
    let actualCountThatDay = 0;
    let dateLevelExcludedCount = 0;
    const activityExclusionPeriods = new Map(); // activityName -> number[] (이 날짜에 이 학급에 실제로 영향을 준 교시만)

    for (const period of periodsSet) {
      const override = overridesForDate.find((o) => o.period === period);
      const effectiveClassName = override
        ? override.className
        : basePeriodsForDay.find((t) => t.period === period)?.className;

      if (!isSameClass(effectiveClassName, className)) continue;

      normalCountThatDay += 1;

      // 날짜 단위 학사일정(noRegularClasses/noClassGrades/regularPeriods/affectedGrades/
      // affectedPeriods)은 schedule(=confirmed일 때만 값이 있음)에 그대로 묶여 있다.
      // classActivities는 rawSchedule에서 직접 꺼내 전달한다 - 그 날짜 문서 전체가 아직
      // confirmed가 아니어도(schedule이 null이어도), 교사가 개별적으로 confirmed한
      // 활동은 반영되어야 하기 때문이다(isPeriodRegularForDate/isExcludedByClassActivity가
      // 활동 하나하나의 status를 다시 확인한다).
      //
      // 아래 excludedByDateLevel/matchedActivity 분리는 계산 결과(excluded)를 바꾸지
      // 않고, "실제로 이 교시를 제외시킨 원인이 날짜 단위 학사일정인지 classActivity
      // 하나인지"만 계산 근거(basis) 표시용으로 구분한다 - 최종 excluded 판정 자체는
      // 기존 isPeriodRegularForDate/isClassExcludedForDate 호출 결과 그대로다.
      const excludedByDateLevel =
        (!!schedule && isClassExcludedForDate(schedule, grade)) ||
        !isPeriodRegularForDate(schedule, { grade, period, className: effectiveClassName });
      const matchedActivity = excludedByDateLevel
        ? null
        : findExcludingClassActivity(rawSchedule?.classActivities, { grade, period, className: effectiveClassName });
      const excluded = excludedByDateLevel || !!matchedActivity;

      if (!excluded) {
        actualCountThatDay += 1;
      } else if (excludedByDateLevel) {
        dateLevelExcludedCount += 1;
      } else {
        const key = matchedActivity.activityName || "수업 제외 일정";
        if (!activityExclusionPeriods.has(key)) activityExclusionPeriods.set(key, []);
        activityExclusionPeriods.get(key).push(period);
      }
    }

    baseCount += normalCountThatDay;

    // schedule(confirmed 날짜 해석)이 없어도(null) classActivities만으로 줄어들 수
    // 있으므로, 더 이상 schedule 존재 여부로 이 근거를 걸러내지 않는다 - 실제로 줄어든
    // 차시가 있었는지(dateLevelExcludedCount > 0)만 본다. label은 날짜 단위 해석이
    // 있을 때만 그 원문을 쓰고, 없으면 일반적인 문구로 대체한다.
    if (dateLevelExcludedCount > 0) {
      basis.push({
        date,
        label: schedule?.originalText || "학교 활동",
        delta: -dateLevelExcludedCount,
        source: "academic_schedule",
      });
    }

    // classActivities(수업 제외 일정)로 실제 제외된 교시를 활동별로 묶어 근거에 추가한다.
    // periods는 activity.periods 전체가 아니라 "이 학급의 실제 교과 수업과 겹쳐 실제로
    // 제외된 교시"만 담는다(위 루프에서 normalCountThatDay에 집계된 교시만 후보가 됨).
    for (const [activityName, periods] of activityExclusionPeriods) {
      const sortedPeriods = [...periods].sort((a, b) => a - b);
      basis.push({
        date,
        label: `${activityName} · ${sortedPeriods.join(", ")}교시 수업 제외`,
        delta: -sortedPeriods.length,
        source: "class_activity",
        activityName,
        periods: sortedPeriods,
      });
    }

    // 요일 대체(scheduleDayOverride) 자체가 이 학급에 만든 변화를 "설명용"으로 계산한다.
    // 실제 요일 기준(개인 override 미반영)과 대체요일 기준(마찬가지로 개인 override
    // 미반영)의 순수 기본 시간표 횟수를 비교한다 - 개인 override(timetable_overrides)
    // 효과는 이미 최종 계산(위 normalCountThatDay/actualCountThatDay)에 별도로 반영되고
    // 있으므로 여기서는 절대 섞지 않는다. total에는 영향을 주지 않는 순수 설명 데이터다.
    if (schedule && schedule.scheduleDayOverride) {
      const actualWeekdayBaseCount = timetable.filter(
        (t) => t.dayOfWeek === actualDayOfWeek && isSameClass(t.className, className)
      ).length;
      const effectiveWeekdayBaseCount = timetable.filter(
        (t) => t.dayOfWeek === effectiveDay && isSameClass(t.className, className)
      ).length;
      const dayOverrideDelta = effectiveWeekdayBaseCount - actualWeekdayBaseCount;

      if (dayOverrideDelta !== 0) {
        dayOverrideBasis.push({
          date,
          label: `${effectiveDay}요일 수업 적용`,
          delta: dayOverrideDelta,
          source: "schedule_day_override",
        });
      }
    }
  }

  let total = baseCount;
  for (const b of basis) total += b.delta;

  const relevantAdjustments = lessonAdjustments.filter(
    (a) => isSameClass(a.className, className) && isDateInRange(a.date, dateFrom, dateTo)
  );
  for (const adj of relevantAdjustments) {
    total += adj.delta;
    basis.push({
      id: adj.id,
      date: adj.date,
      label: adj.reason || "수동 보정",
      delta: adj.delta,
      source: adj.source || "manual",
    });
  }

  // 요일 대체 설명 근거는 total 합산이 전부 끝난 뒤에 추가한다 - 위 두 합산 루프
  // (academic_schedule, lesson_adjustments)에 섞여 다시 더해지는 일이 없도록 하기 위해서다.
  basis.push(...dayOverrideBasis);

  basis.sort((a, b) => (a.date || "").localeCompare(b.date || ""));

  return {
    className,
    grade,
    dateFrom,
    dateTo,
    baseCount,
    total,
    basis,
    unresolvedSchedules,
  };
}
