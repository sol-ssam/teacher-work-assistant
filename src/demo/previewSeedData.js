// '미리보기로 체험하기'(Firebase Anonymous 사용자) 전용 샘플 데이터 빌더.
//
// - Firestore를 전혀 건드리지 않는 순수 함수다. AI(Gemini)로 생성하지 않고, 항상 같은
//   입력(uid, today)에 같은 결과를 돌려주는 고정(deterministic) seed다.
// - 문서 형식은 실제 앱이 쓰는 schema와 정확히 같다(timetable, progress_plans,
//   progress_checks, progress_current, progress_history, progress_class_notes, school_day_schedules,
//   lesson_adjustments, events, tasks). 구형 lesson_plan/class_progress는 쓰지 않는다.
// - 예상 시수 같은 계산 결과는 저장하지 않는다. 시간표 + 학사일정 + 수업 보정만 넣고,
//   실제 남은 수업 횟수는 앱의 기존 deterministic 계산(remainingLessons.js)이 읽어서 계산한다.
// - 날짜는 특정 연도에 고정하지 않는다. today(Asia/Seoul 기준 YYYY-MM-DD)를 기준으로
//   today ± N일로 만든다. 시간표만 월~금 고정 주간 구조다.
import { addDaysToDateString, weekdayKoreanOf } from "../utils/date";
import { computeCompletedIdsThrough, computeCompletedIdsBefore } from "../utils/progressStatusUpdate";

export const PREVIEW_SEED_VERSION = 2;

const GRADE = "3";
const SUBJECT = "가정";

// 가상의 3학년 가정 교사 - 3학년 1~8반, 반마다 주 2시수(총 16시수). className은 앱의 기존
// 표기(101/301처럼 학년+반 3자리 코드)를 그대로 쓴다. 화면에는 formatClassName이 "3학년 1반"으로 바꿔 보여준다.
const TIMETABLE_ROWS = [
  ["월", 1, "301"],
  ["월", 2, "302"],
  ["월", 4, "303"],
  ["화", 1, "304"],
  ["화", 3, "305"],
  ["화", 5, "306"],
  ["수", 2, "307"],
  ["수", 3, "308"],
  ["수", 5, "301"],
  ["목", 1, "302"],
  ["목", 2, "303"],
  ["목", 4, "304"],
  ["금", 1, "305"],
  ["금", 2, "306"],
  ["금", 4, "307"],
  ["금", 5, "308"],
];

export const PREVIEW_CLASS_NAMES = ["301", "302", "303", "304", "305", "306", "307", "308"];

// 3학년 가정 '주거' 단원. estimatedLessons는 계획 항목 하나의 차시 수다. 이전 달 계획은
// 월 경계(이월) 사례를 보여주기 위한 것이고, 현재 달 계획이 오늘 기준의 메인 진도다.
const PREV_PLAN_ITEMS = [
  { title: "주거의 의미와 기능", estimatedLessons: 1 },
  { title: "주거 환경과 건강", estimatedLessons: 2 },
  { title: "주거 안전과 사고 예방", estimatedLessons: 2 },
];
const PLAN_ITEMS = [
  { title: "주거 가치관", estimatedLessons: 1 },
  { title: "조닝", estimatedLessons: 1 },
  { title: "효율적인 주거 공간 구성", estimatedLessons: 2 },
  { title: "주거 설계 프로그램 학습", estimatedLessons: 3 },
];

// 학급별 현재 진도. 앱의 실제 규칙을 그대로 따른다:
// - through: "그 항목까지 완료" (computeCompletedIdsThrough, progress_current 없음)
// - current: "그 항목을 진행 중" (그 이전 항목까지만 완료 - computeCompletedIdsBefore - 하고
//   항목 자체는 progress_current로 기록). lessons는 lessonsCompletedInItem(estimatedLessons보다 작아야 함).
// - scope "prev"는 이전 달 계획의 항목을 가리킨다(월 경계 이월 사례). 그 반의 현재 달 progress_checks는 없다.
// - 이전 달 계획은 이월 반을 뺀 모든 반이 이미 끝낸 것으로 progress_checks를 둔다.
// - earlier는 한 번 전 수업의 history 한 건(최근 기록 목록에 2건이 보이도록)이다.
const CLASS_PROGRESS = [
  { className: "301", state: { kind: "through", index: 1 } },
  {
    className: "302",
    state: { kind: "current", index: 2, lessons: 1, detail: "주거 공간 구성 사례 살펴보기까지" },
    earlier: { kind: "through", index: 1 },
    note: "다음 시간 공간 구성 사례 활동지 배부 필요",
  },
  { className: "303", state: { kind: "through", index: 1 } },
  {
    className: "304",
    state: { kind: "through", index: 2 },
    note: "설계 프로그램 실습 전 학생 계정 로그인 확인",
  },
  { className: "305", state: { kind: "through", index: 1 } },
  { className: "306", state: { kind: "current", index: 2, detail: "주거 공간 구성 원리까지" } },
  {
    className: "307",
    state: { kind: "current", index: 3, lessons: 2, detail: "평면도 배치 완성하기 해야함" },
    earlier: { kind: "through", index: 2 },
    note: "결석한 학생 학습지 보충 확인",
  },
  {
    className: "308",
    state: { kind: "current", scope: "prev", index: 2, lessons: 1, detail: "화재·낙상 사고 예방까지" },
    earlier: { kind: "through", scope: "prev", index: 1 },
  },
];

function isWeekend(date) {
  const w = weekdayKoreanOf(date);
  return w === "토" || w === "일";
}

// 주말이면 direction(+1: 미래로, -1: 과거로) 방향으로 가장 가까운 평일로 옮긴다. 옮겨도
// 오늘 기준의 "지난/다가오는" 구분은 바뀌지 않는다(방향이 항상 오늘에서 멀어지는 쪽이다).
function toWeekday(date, direction) {
  let d = date;
  for (let i = 0; i < 3 && isWeekend(d); i++) d = addDaysToDateString(d, direction);
  return d;
}

function nextWeekdayOnOrAfter(date, weekday) {
  let d = date;
  for (let i = 0; i < 7; i++) {
    if (weekdayKoreanOf(d) === weekday) return d;
    d = addDaysToDateString(d, 1);
  }
  return d;
}

// 그 학급이 실제로 수업하는 요일 중, 오늘 이전에서 가장 최근 날짜(진도를 마지막으로 나간 날).
function previousLessonDate(today, className) {
  const days = new Set(TIMETABLE_ROWS.filter((r) => r[2] === className).map((r) => r[0]));
  for (let i = 1; i <= 7; i++) {
    const d = addDaysToDateString(today, -i);
    if (days.has(weekdayKoreanOf(d))) return d;
  }
  return addDaysToDateString(today, -1);
}

export function buildPreviewSeed({ uid, today, nowIso }) {
  if (!uid) throw new Error("buildPreviewSeed: uid가 필요합니다.");

  const [year, monthRaw] = today.split("-");
  const month = String(Number(monthRaw));
  const docs = [];
  // 문서 ID에는 반드시 현재 익명 사용자의 UID를 넣는다. ID가 모든 Preview 사용자에게 같으면
  // 이전 Preview 사용자가 만든 문서와 충돌해서, 새 사용자의 쓰기가 create가 아니라 "남의 문서
  // update"로 판정되어 Rules에서 거부된다. 문서끼리 서로 참조하는 ID(planItemId 등)도 모두 이
  // 함수로 만든 ID에서 파생되므로 항상 같은 UID namespace 안의 문서를 가리킨다.
  const docId = (suffix) => `preview_${uid}_${suffix}`;
  const add = (collection, id, data) => docs.push({ collection, id, data: { ...data, ownerId: uid } });
  const stamps = { createdAt: nowIso, updatedAt: nowIso };

  // ---- 시간표 ----
  TIMETABLE_ROWS.forEach(([dayOfWeek, period, className], i) => {
    add("timetable", docId(`timetable_${String(i + 1).padStart(2, "0")}`), {
      dayOfWeek,
      period,
      className,
      subject: SUBJECT,
    });
  });

  // ---- 진도 계획(progress_plans) ----
  // 이전 달 = 현재 달의 바로 앞 달(1월이면 작년 12월). 날짜는 today에서 계산한다.
  const prevYear = month === "1" ? String(Number(year) - 1) : year;
  const prevMonth = month === "1" ? "12" : String(Number(month) - 1);
  const buildPlanDocs = (items, idPrefix, planYear, planMonth) =>
    items.map((p, i) => {
      const planDoc = { id: docId(`${idPrefix}_${i + 1}`), order: i, title: p.title, estimatedLessons: p.estimatedLessons };
      add("progress_plans", planDoc.id, {
        grade: GRADE,
        year: planYear,
        month: planMonth,
        title: p.title,
        order: i,
        estimatedLessons: p.estimatedLessons,
        ...stamps,
      });
      return planDoc;
    });
  const prevPlanDocs = buildPlanDocs(PREV_PLAN_ITEMS, "plan_prev", prevYear, prevMonth);
  const planDocs = buildPlanDocs(PLAN_ITEMS, "plan", year, month);

  // ---- 학급별 진도(progress_checks / progress_current / progress_history) + 수업 메모 ----
  const scopeDocs = (scope) => (scope === "prev" ? prevPlanDocs : planDocs);
  // 상태(through/current) -> 대상 항목과 (그 달 계획 안에서) 완료된 항목 id 목록
  const resolve = (st) => {
    const docsInScope = scopeDocs(st.scope);
    const target = docsInScope[st.index];
    const completedIds =
      st.kind === "current"
        ? computeCompletedIdsBefore(docsInScope, target.id)
        : computeCompletedIdsThrough(docsInScope, target.id);
    return { target, completedIds };
  };
  const historyDoc = (className, st, date) => {
    const { target, completedIds } = resolve(st);
    const isCurrent = st.kind === "current";
    return {
      className,
      grade: GRADE,
      date,
      planItemId: target.id,
      planItemTitle: target.title,
      detail: isCurrent ? st.detail || "" : null,
      completedPlanItemIds: completedIds,
      ...(isCurrent ? { lessonsCompletedInItem: st.lessons ?? null } : {}),
      source: "manual",
      createdAt: nowIso,
    };
  };

  for (const cp of CLASS_PROGRESS) {
    const lastClassDate = previousLessonDate(today, cp.className);
    const { target, completedIds } = resolve(cp.state);
    const scope = cp.state.scope === "prev" ? "prev" : "current";

    if (cp.state.kind === "current") {
      add("progress_current", docId(`current_${cp.className}`), {
        className: cp.className,
        grade: GRADE,
        planItemId: target.id,
        planItemTitle: target.title,
        detail: cp.state.detail || "",
        lessonsCompletedInItem: cp.state.lessons ?? null,
        updatedAt: nowIso,
        lastClassDate,
        createdAt: nowIso,
      });
    }
    add("progress_history", docId(`history_${cp.className}`), historyDoc(cp.className, cp.state, lastClassDate));
    if (cp.earlier) {
      add(
        "progress_history",
        docId(`history_${cp.className}_prev`),
        historyDoc(cp.className, cp.earlier, addDaysToDateString(lastClassDate, -7))
      );
    }

    // 체크: 이전 달 계획은 이월 반(scope prev)만 일부, 나머지는 전부 완료. 현재 달 체크는 현재 달 반만.
    const checkIds = scope === "prev" ? completedIds : [...prevPlanDocs.map((p) => p.id), ...completedIds];
    const labelOf = (id) => {
      const prevIdx = prevPlanDocs.findIndex((p) => p.id === id);
      return prevIdx >= 0 ? `p${prevIdx + 1}` : String(planDocs.findIndex((p) => p.id === id) + 1);
    };
    for (const planItemId of checkIds) {
      add("progress_checks", docId(`check_${cp.className}_${labelOf(planItemId)}`), {
        planItemId,
        className: cp.className,
        completed: true,
        completedAt: nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }

    if (cp.note) {
      add("progress_class_notes", docId(`note_${cp.className}`), {
        className: cp.className,
        grade: GRADE,
        note: cp.note,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }

  // ---- 학사일정(school_day_schedules) ----
  // 한 날짜에는 학사일정 하나만 적용되므로(effectiveTimetable/remainingLessons가 date로 첫
  // 항목만 찾는다) 날짜가 겹치지 않게 배치한다. 요일별로 다른 학급이 걸리도록 요일을 정했다:
  // 화(1~3교시, 3학년: 3-4,3-5) / 월(3~4교시: 3-3) / 금(5~7교시: 3-8) /
  // 진로체험의 날(events와 같은 날, 3학년 1~4교시). 1학년 현장체험학습은 1학년만 해당하는
  // 전일 일정이라 3학년 가정 수업 시수에는 영향이 없다(학사일정에 있다고 모두 영향을 주는 것은 아니다).
  const used = new Set();
  const minDate = addDaysToDateString(today, 1);
  const place = (weekday, weekOffset) => {
    let d = addDaysToDateString(nextWeekdayOnOrAfter(minDate, weekday), 7 * weekOffset);
    while (used.has(d)) d = addDaysToDateString(d, 7);
    used.add(d);
    return d;
  };

  const careerDate = toWeekday(addDaysToDateString(today, 7), 1);
  used.add(careerDate);

  const scheduleBase = {
    status: "confirmed",
    noRegularClasses: false,
    noClassGrades: [],
    regularPeriods: [],
    affectedGrades: [],
    affectedPeriods: [],
    source: "manual",
    ...stamps,
  };

  const schedules = [
    {
      key: "grade_activity",
      date: place("화", 0),
      originalText: "학년별 체험활동",
      memo: "3학년 해당 · 1~3교시 수업 조정",
      affectedGrades: [3],
      affectedPeriods: [1, 2, 3],
    },
    {
      key: "student_council",
      date: place("월", 0),
      originalText: "학생자치활동",
      memo: "3~4교시 수업 조정",
      affectedPeriods: [3, 4],
    },
    {
      key: "career_day",
      date: careerDate,
      originalText: "3학년 진로체험의 날",
      memo: "3학년 해당 · 1~4교시 수업 조정",
      affectedGrades: [3],
      affectedPeriods: [1, 2, 3, 4],
    },
    {
      key: "sports_day",
      date: place("금", 1),
      originalText: "교내 스포츠데이",
      memo: "5~7교시 수업 조정",
      affectedPeriods: [5, 6, 7],
    },
    {
      key: "field_trip_g1",
      date: place("수", 1),
      originalText: "1학년 현장체험학습",
      memo: "1학년 해당 · 전일 · 3학년 가정 수업에는 직접 영향 없음",
      noClassGrades: [1],
    },
  ];
  for (const s of schedules) {
    const { key, ...fields } = s;
    add("school_day_schedules", docId(`schedule_${key}`), { ...scheduleBase, ...fields });
  }

  // ---- 수업 횟수 수동 보정(lesson_adjustments) - 학사일정에 없던 학급 자체 사정 1건 ----
  // 특정 학사일정과 연결되지 않은 독립 사례이므로, 학사일정이 있는 날과 겹치지 않는 금요일
  // (3-6은 금요일 2교시 수업이 있다)에 둔다.
  let adjustmentDate = nextWeekdayOnOrAfter(minDate, "금");
  while (used.has(adjustmentDate)) adjustmentDate = addDaysToDateString(adjustmentDate, 7);
  add("lesson_adjustments", docId("adjustment_306"), {
    date: adjustmentDate,
    className: "306",
    delta: -1,
    reason: "학급 자율활동으로 수업 1회 조정",
    source: "manual",
    ...stamps,
  });

  // ---- 개인/업무 일정(events) ----
  // 학교 일정이 주말에 잡히지 않도록, 주말에 걸린 날짜만 오늘에서 멀어지는 방향의 가까운 평일로
  // 옮긴다(오늘 일정은 그대로). "오늘 - N일 / + N일" 원칙과 지난/다가오는 구분은 유지된다.
  const eventDate = (offset) => {
    if (offset === 0) return today;
    const raw = addDaysToDateString(today, offset);
    return toWeekday(raw, offset > 0 ? 1 : -1);
  };
  const eventBase = { status: "예정", customType: "", endTime: "", memo: "", attending: null };
  const events = [
    { key: "past_1", offset: -8, type: "council", title: "2학기 가정과 평가 계획 협의", attending: true, status: "완료" },
    { key: "past_2", offset: -5, type: "training", title: "생성형 AI 활용 연수", status: "완료" },
    { key: "past_3", offset: -2, type: "meeting", title: "3학년 학년회의", attending: true, status: "완료" },
    {
      key: "today_1",
      offset: 0,
      type: "council",
      title: "가정과 수업 및 평가 운영 협의",
      startTime: "15:30",
      endTime: "16:30",
      attending: true,
    },
    {
      key: "next_1",
      offset: 2,
      type: "meeting",
      title: "3학년 생활지도 및 학사일정 협의",
      startTime: "15:40",
      attending: true,
    },
    { key: "next_2", offset: 4, type: "training", title: "디지털 기반 수업 혁신 연수", startTime: "14:30" },
    { key: "next_3", offset: 7, type: "school", title: "진로체험의 날", date: careerDate },
    { key: "next_4", offset: 10, type: "other", customType: "평가", title: "가정과 수행평가 실시" },
    {
      key: "next_5",
      offset: 14,
      type: "council",
      title: "수행평가 결과 및 수업 운영 협의",
      startTime: "15:30",
      attending: true,
    },
  ];
  for (const e of events) {
    const { key, offset, date, ...fields } = e;
    add("events", docId(`event_${key}`), {
      ...eventBase,
      startTime: "",
      ...fields,
      date: date || eventDate(offset),
      source: "manual",
      calendarSync: false,
      googleCalendarId: null,
      ...stamps,
    });
  }

  // ---- 업무(tasks) ----
  const tasks = [
    // 일정과 연결: 오늘 15:30 교과협의회 ← 자료 준비, 수행평가 실시(+10) ← 활동지 인쇄/채점/결과 입력,
    // 현재 진행 중인 '주거' 단원 ← 주거 수업 자료 준비/실습 환경 점검
    { key: "today_1", offset: 0, title: "교과협의회 자료 준비", priority: "high", completed: false },
    { key: "today_2", offset: 0, title: "3학년 주거 수업 자료 준비", priority: "high", completed: false },
    { key: "next_1", offset: 2, title: "수행평가 활동지 인쇄", priority: "high", completed: false },
    { key: "next_2", offset: 4, title: "주거 설계 프로그램 실습 환경 점검", priority: "medium", completed: false },
    { key: "next_3", offset: 7, title: "수행평가 채점", priority: "high", completed: false },
    { key: "next_4", offset: 10, title: "평가 결과 입력", priority: "low", completed: false },
    { key: "done_1", offset: -2, title: "3학년 주거 학습지 수정", priority: "medium", completed: true },
    { key: "done_2", offset: -5, title: "수행평가 계획서 제출", priority: "high", completed: true },
    { key: "done_3", offset: -7, title: "교과협의회 회의록 확인", priority: "low", completed: true },
  ];
  for (const t of tasks) {
    add("tasks", docId(`task_${t.key}`), {
      title: t.title,
      dueDate: addDaysToDateString(today, t.offset),
      priority: t.priority,
      memo: "",
      completed: t.completed,
      source: "manual",
      ...stamps,
    });
  }

  return { docs, generatedFor: today };
}

// seed를 Firestore에 쓰기 전에 마지막으로 확인하는 안전장치. 나중에 누가 seed 상수를
// 고치다 시간표/진도 구조를 깨뜨리면, 잘못된 데이터를 쓰지 않고 여기서 실패시킨다.
export function assertPreviewSeedIntegrity(seed, uid) {
  const fail = (msg) => {
    throw new Error(`Preview seed 검증 실패: ${msg}`);
  };
  const byCollection = (name) => seed.docs.filter((d) => d.collection === name);

  if (seed.docs.some((d) => d.data.ownerId !== uid)) fail("ownerId가 현재 사용자 UID가 아닌 문서가 있습니다.");
  if (new Set(seed.docs.map((d) => `${d.collection}/${d.id}`)).size !== seed.docs.length) fail("문서 ID가 중복됩니다.");
  // 다른 Preview 사용자의 문서와 ID가 충돌하지 않도록, 모든 문서 ID가 자기 UID namespace여야 한다.
  const idPrefix = `preview_${uid}_`;
  if (seed.docs.some((d) => !d.id.startsWith(idPrefix))) fail("UID namespace가 없는 문서 ID가 있습니다.");

  const timetable = byCollection("timetable");
  if (timetable.length !== 16) fail(`주당 수업이 16시수가 아닙니다(${timetable.length}).`);
  const slots = new Set(timetable.map((d) => `${d.data.dayOfWeek}-${d.data.period}`));
  if (slots.size !== timetable.length) fail("같은 요일/교시에 수업이 겹칩니다.");
  for (const className of PREVIEW_CLASS_NAMES) {
    const count = timetable.filter((d) => d.data.className === className).length;
    if (count !== 2) fail(`${className}반이 주 2시수가 아닙니다(${count}).`);
  }
  if (timetable.some((d) => !PREVIEW_CLASS_NAMES.includes(d.data.className))) fail("예상 밖의 학급이 있습니다.");

  const plans = byCollection("progress_plans");
  const planById = new Map(plans.map((d) => [d.id, d.data]));
  if (plans.length !== PLAN_ITEMS.length + PREV_PLAN_ITEMS.length) fail("진도 계획 항목 수가 다릅니다.");
  for (const c of byCollection("progress_checks")) {
    if (!planById.has(c.data.planItemId)) fail("존재하지 않는 계획 항목을 가리키는 progress_checks가 있습니다.");
  }
  for (const h of byCollection("progress_history")) {
    const refs = [h.data.planItemId, ...(h.data.completedPlanItemIds || [])];
    if (refs.some((ref) => !planById.has(ref))) fail("존재하지 않는 계획 항목을 가리키는 progress_history가 있습니다.");
  }
  for (const c of byCollection("progress_current")) {
    const plan = planById.get(c.data.planItemId);
    if (!plan) fail("존재하지 않는 계획 항목을 가리키는 progress_current가 있습니다.");
    const n = c.data.lessonsCompletedInItem;
    if (n !== null && !(Number.isInteger(n) && n >= 1 && n < plan.estimatedLessons)) {
      fail("lessonsCompletedInItem은 1 이상이고 계획 차시(estimatedLessons)보다 작아야 합니다.");
    }
  }

  for (const n of byCollection("progress_class_notes")) {
    if (!PREVIEW_CLASS_NAMES.includes(n.data.className) || !n.data.note) fail("progress_class_notes 내용이 올바르지 않습니다.");
  }
  const carried = byCollection("progress_current").filter((c) => planById.get(c.data.planItemId).month !== planById.get(`preview_${uid}_plan_1`).month);
  if (carried.length === 0) fail("이전 달에서 이어지는 진행 중 항목이 없습니다.");

  const schedules = byCollection("school_day_schedules");
  const dates = schedules.map((d) => d.data.date);
  if (new Set(dates).size !== dates.length) fail("학사일정 날짜가 겹칩니다.");
  if (dates.some(isWeekend)) fail("주말에 학사일정이 있습니다.");
}
