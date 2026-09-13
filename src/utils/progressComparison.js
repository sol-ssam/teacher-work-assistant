// 진도 항목(planItems)과 반별 체크 상태로 "현재/다음 항목", "완료 개수", "학급 간 차이"를
// 계산한다. 순수 함수이며 AI를 사용하지 않는다.
//
// 핵심 구분:
// - consecutivePosition: 1번 항목부터 순서대로 빠짐없이 체크된 마지막 위치. "현재/다음
//   진도"를 정할 때 쓴다. 중간을 건너뛰고 뒤를 체크해도 이 값은 그 이전 연속 구간까지만
//   센다 - 계산이 깨지지 않는다.
// - totalCompletedCount: 순서와 무관하게 체크된 항목의 총 개수. "남은 항목 수"를 정할 때
//   쓴다.

// className을 "비교할 때만" 정규화한다. Firestore에 저장된 값 자체는 절대 바꾸지 않는다 -
// timetable에는 숫자 301로, progress_checks/lesson_adjustments/timetable_overrides에는
// 문자열 "301"로 들어 있는 등 컬렉션마다 타입이 다를 수 있으므로, 서로 다른 컬렉션의
// className을 비교하는 모든 곳에서 이 함수를 거친다.
export function normalizeClassName(value) {
  return String(value ?? "").trim();
}

export function isSameClass(a, b) {
  return normalizeClassName(a) === normalizeClassName(b);
}

// className에서 학년/반을 결정론적으로 분리한다. 두 가지 표기를 모두 지원한다.
// - "3-2"처럼 학년-반이 구분자로 나뉜 표기 (수동 입력 시간표 등에서 흔히 쓰는 형식)
// - "301", "105"처럼 학년+반이 붙어 있는 순수 숫자 코드: 첫 자리가 학년, 나머지가 반 번호
//   (예: 101→1학년 1반, 105→1학년 5반, 307→3학년 7반)
// Firestore의 className은 문자열일 수도, 숫자일 수도 있으므로 항상 String(...).trim()으로
// 정규화한 뒤 분석한다. AI에게 맡기지 않고 이 함수 하나로만 결정론적으로 처리한다.
export function parseClassCode(className) {
  const raw = normalizeClassName(className);
  if (!raw) return { grade: null, classNumber: null };

  const hyphenMatch = raw.match(/^(\d+)\s*-\s*(\d+)$/);
  if (hyphenMatch) {
    return { grade: hyphenMatch[1], classNumber: String(Number(hyphenMatch[2])) };
  }

  // 순수 숫자 코드: 첫 자리 = 학년, 나머지 자리 = 반 번호(앞자리 0은 반 번호에서 제거).
  const numericMatch = raw.match(/^(\d)(\d+)$/);
  if (numericMatch) {
    return { grade: numericMatch[1], classNumber: String(Number(numericMatch[2])) };
  }

  return { grade: null, classNumber: null };
}

// className(예: "3-2" 또는 "301")에서 학년만 뽑아낸다. 진도 비교, 남은 수업 계산, AI 조회에서
// 공통으로 쓰는 규칙이라 여기 한 곳에만 둔다.
export function gradeOfClassName(className) {
  return parseClassCode(className).grade;
}

// ===== 표시 전용 formatter =====
// 아래 두 함수는 절대 Firestore 비교/조회에 쓰지 않는다 - 오직 사용자에게 보여줄 문자열을
// 만드는 용도다. 내부 저장/비교는 여전히 parseClassCode/isSameClass/normalizeClassName을
// 그대로 쓴다. "저장/비교용 className"과 "화면 표시 문자열"은 완전히 분리된 개념이다.

// 전체 학급명. 101/103/301 같은 내부 코드, "1-1"/"3-7반" 같은 하이픈 표기, 이미
// "1학년 1반" 형태인 입력까지 전부 안전하게 "N학년 M반"으로 통일한다. 무엇으로도 해석할
// 수 없으면(형식을 모르면) 임의로 추측하지 않고 원본 문자열을 그대로 돌려준다.
export function formatClassName(className) {
  const raw = normalizeClassName(className);
  if (!raw) return raw;

  const alreadyFull = raw.match(/^(\d+)\s*학년\s*(\d+)\s*반$/);
  if (alreadyFull) return `${alreadyFull[1]}학년 ${Number(alreadyFull[2])}반`;

  const hyphenMatch = raw.match(/^(\d+)\s*-\s*(\d+)\s*반?$/);
  if (hyphenMatch) return `${hyphenMatch[1]}학년 ${Number(hyphenMatch[2])}반`;

  const numericMatch = raw.match(/^(\d)(\d+)\s*반?$/);
  if (numericMatch) return `${numericMatch[1]}학년 ${Number(numericMatch[2])}반`;

  return raw;
}

// 짧은 학급명("1반"). 학년이 이미 화면에서 명확한 좁은 표(진도 매트릭스 등)에서만 쓴다 -
// 학년 정보가 없는 독립적인 문장/카드에는 절대 쓰지 않는다(formatClassName을 쓴다).
export function formatClassShortName(className) {
  const raw = normalizeClassName(className);
  if (!raw) return raw;

  const alreadyFull = raw.match(/^\d+\s*학년\s*(\d+)\s*반$/);
  if (alreadyFull) return `${Number(alreadyFull[1])}반`;

  const hyphenMatch = raw.match(/^\d+\s*-\s*(\d+)\s*반?$/);
  if (hyphenMatch) return `${Number(hyphenMatch[1])}반`;

  const numericMatch = raw.match(/^\d(\d+)\s*반?$/);
  if (numericMatch) return `${Number(numericMatch[1])}반`;

  return raw;
}

// ===== 사용자의 자연어 학급 표현을 실제 담당 학급(className)으로 결정론적으로 resolve =====
// "101", "101반", "1-1", "1-1반", "1학년 1반"처럼 사용자가 어떤 식으로 말하든, 실제
// timetable에 있는 담당 학급 목록(ownedClassNames)과 대조해서 정확히 하나로 좁혀지는
// 경우에만 그 className을 돌려준다. Gemini가 스스로 className을 만들어내는 일은 없다 -
// 이 함수가 항상 실제 담당 학급 목록 안에서만 답을 찾는다.
//
// 반환: { className, candidates }
// - 정확히 하나로 특정되면 { className: "<내부 값>", candidates: [] }
// - "1반"처럼 학년이 없어 여러 학년에 걸쳐 후보가 여럿이면
//   { className: null, candidates: [{ className, displayClassName }, ...] } - 호출부가
//   사용자에게 "어느 반인가요?"라고 확인하게 한다.
// - 어떤 담당 학급과도 맞지 않으면 { className: null, candidates: [] } - 담당하지 않는
//   학급을 임의로 만들어내지 않는다.
export function resolveClassInput(rawInput, ownedClassNames) {
  const raw = normalizeClassName(rawInput);
  if (!raw) return { className: null, candidates: [] };

  let grade = null;
  let classNumber = null;

  const fullTextMatch = raw.match(/^(\d+)\s*학년\s*(\d+)\s*반$/);
  if (fullTextMatch) {
    grade = fullTextMatch[1];
    classNumber = String(Number(fullTextMatch[2]));
  } else {
    // "101반"처럼 끝에 "반"이 붙어 있으면 parseClassCode가 이해하지 못하므로 떼어내고
    // 시도한다("101", "1-1"은 parseClassCode가 이미 정확히 처리한다).
    const stripped = raw.replace(/반$/, "").trim();
    const parsed = parseClassCode(stripped);
    if (parsed.grade && parsed.classNumber) {
      grade = parsed.grade;
      classNumber = parsed.classNumber;
    }
  }

  if (grade && classNumber) {
    const match = ownedClassNames.find((c) => {
      const pc = parseClassCode(c);
      return pc.grade === grade && pc.classNumber === classNumber;
    });
    return match ? { className: match, candidates: [] } : { className: null, candidates: [] };
  }

  // 학년 없이 반 번호만 말한 경우("1반") - 실제 담당 학급 중 그 반 번호를 가진 것을 전부
  // 찾아서, 하나면 확정하고 여럿이면 후보로 돌려준다(임의 선택 금지).
  const shortMatch = raw.match(/^(\d+)\s*반$/);
  if (shortMatch) {
    const targetClassNumber = String(Number(shortMatch[1]));
    const matches = ownedClassNames.filter((c) => parseClassCode(c).classNumber === targetClassNumber);
    if (matches.length === 1) return { className: matches[0], candidates: [] };
    if (matches.length > 1) {
      return {
        className: null,
        candidates: matches.map((c) => ({ className: c, displayClassName: formatClassName(c) })),
      };
    }
    return { className: null, candidates: [] };
  }

  return { className: null, candidates: [] };
}

export function analyzeClassProgress(planItems, checkedIds) {
  const sorted = [...planItems].sort((a, b) => a.order - b.order);
  const checkedSet = new Set(checkedIds);

  let consecutivePosition = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (checkedSet.has(sorted[i].id)) {
      consecutivePosition = i + 1;
    } else {
      break;
    }
  }

  const totalCompletedCount = sorted.filter((item) => checkedSet.has(item.id)).length;
  const currentItem = consecutivePosition > 0 ? sorted[consecutivePosition - 1] : null;
  const nextItem = consecutivePosition < sorted.length ? sorted[consecutivePosition] : null;
  const remainingItems = sorted.filter((item) => !checkedSet.has(item.id));

  // 남은 항목 전부에 예상 차시가 입력되어 있을 때만 예상 필요 차시를 계산한다.
  // 하나라도 비어 있으면 null - "부족/여유"를 함부로 단정하지 않기 위해서다.
  const allRemainingHaveEstimate =
    remainingItems.length > 0 &&
    remainingItems.every((item) => typeof item.estimatedLessons === "number" && item.estimatedLessons > 0);

  const estimatedRemainingLessons = allRemainingHaveEstimate
    ? remainingItems.reduce((sum, item) => sum + item.estimatedLessons, 0)
    : null;

  return {
    consecutivePosition,
    totalCompletedCount,
    totalItems: sorted.length,
    currentItem,
    nextItem,
    remainingPlanItems: remainingItems.length,
    estimatedRemainingLessons,
  };
}

// remainingActualLessons(실제 남은 수업 횟수, remainingLessons.js가 계산)와
// estimatedRemainingLessons(예상 필요 차시)를 비교한다. 둘 중 하나라도 없으면(estimated가
// null이면) 비교 자체를 하지 않고 null을 반환한다 - "부족/여유"를 임의로 단정하지 않는다.
export function computeLessonBalance(remainingActualLessons, estimatedRemainingLessons) {
  if (estimatedRemainingLessons == null || remainingActualLessons == null) return null;
  return remainingActualLessons - estimatedRemainingLessons; // 양수=여유, 음수=부족
}

// 같은 학년 학급들의 consecutivePosition을 비교해 가장 빠른/느린 반과 차이를 계산한다.
// classStats: [{ className, consecutivePosition }]
export function compareClassesInGrade(classStats) {
  if (classStats.length < 2) {
    return { fastest: null, slowest: null, messages: [] };
  }

  const fastest = classStats.reduce((a, b) => (b.consecutivePosition > a.consecutivePosition ? b : a));
  const slowest = classStats.reduce((a, b) => (b.consecutivePosition < a.consecutivePosition ? b : a));

  const messages = [];
  for (const c of classStats) {
    if (c.className === fastest.className) continue;
    const diff = fastest.consecutivePosition - c.consecutivePosition;
    if (diff > 0) {
      messages.push({
        className: c.className,
        gapFromLeadingClass: diff,
        text: `${formatClassName(c.className)}이 ${formatClassName(fastest.className)}보다 ${diff}개 진도 항목 느립니다.`,
      });
    }
  }

  return { fastest, slowest, messages };
}

// 이번 단계에서 홈 브리핑 UI 자체는 바꾸지 않지만, 이후 브리핑 개편에서 그대로 쓸 수
// 있도록 학급별 진도 요약을 정해진 모양으로 조립해주는 함수다(기획서 39장 예시와 동일한
// 필드 구성). 계산은 이미 끝난 progressStats/remainingLessonsResult를 조합할 뿐이다.
export function buildClassProgressSummary({
  className,
  progressStats,
  remainingLessonsResult,
  gapFromLeadingClass,
}) {
  const lessonBalance = computeLessonBalance(
    remainingLessonsResult?.total ?? null,
    progressStats?.estimatedRemainingLessons ?? null
  );

  return {
    className,
    currentItem: progressStats?.currentItem?.title ?? null,
    nextItem: progressStats?.nextItem?.title ?? null,
    remainingPlanItems: progressStats?.remainingPlanItems ?? null,
    remainingActualLessons: remainingLessonsResult?.total ?? null,
    gapFromLeadingClass: gapFromLeadingClass ?? null,
    estimatedRemainingLessons: progressStats?.estimatedRemainingLessons ?? null,
    lessonBalance,
    unresolvedScheduleCount: remainingLessonsResult?.unresolvedSchedules?.length ?? 0,
  };
}
