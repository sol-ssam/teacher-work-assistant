import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import {
  getClassProgress,
  getTodayBaseTimetable,
  getTodayTimetableOverrides,
  getImportantNotices,
} from "../firebase/collections";
import { todayDateString, todayWeekdayKorean, endOfMonthDateString } from "../utils/date";
import { createCalendarEvent, deleteCalendarEvent, listCalendarEvents, MissingEndTimeError } from "../calendar/calendarApi";
import { isCalendarEligible } from "../utils/calendarEligibility";
import { ATTENDANCE_BASED_EVENT_TYPES } from "../utils/constants";
import {
  analyzeClassProgress,
  compareClassesInGrade,
  gradeOfClassName,
  isSameClass,
  formatClassName,
  resolveClassInput,
} from "../utils/progressComparison";
import { calculateRemainingLessons } from "../utils/remainingLessons";
import { getEffectiveDayTimetable } from "../utils/effectiveTimetable";
import { buildSwapPayloads, buildMovePayloads } from "../utils/timetableChangeService";
import {
  computeCompletedIdsThrough,
  computeCompletedIdsBefore,
  findPlanItemByTitle,
  historyEntriesEqual,
} from "../utils/progressStatusUpdate";

const MAX_RESULTS = 15;

// Gemini에게 돌려주는 검색 결과는 항상 "필요한 최소 필드"만 남긴다.
// memo, ownerId, createdAt/updatedAt 같은 부가 정보는 전달하지 않는다.
function trimEvent(e) {
  return {
    id: e.id,
    title: e.title,
    date: e.date,
    startTime: e.startTime,
    endTime: e.endTime,
    type: e.type,
    customType: e.customType || undefined,
    attending: e.attending ?? undefined,
    status: e.status,
    calendarSync: !!e.calendarSync,
  };
}
function trimTask(t) {
  return { id: t.id, title: t.title, dueDate: t.dueDate, priority: t.priority, completed: t.completed };
}
function trimClassProgress(cp) {
  return { id: cp.id, className: cp.className, unit: cp.unit, lesson: cp.lesson, topic: cp.topic, lastClassDate: cp.lastClassDate };
}
function trimTimetable(t) {
  return { dayOfWeek: t.dayOfWeek, period: t.period, className: t.className, subject: t.subject };
}
function trimOverride(o) {
  return { date: o.date, period: o.period, className: o.className, subject: o.subject };
}
function trimNotice(n) {
  return { id: n.id, content: n.content, important: !!n.important, expiresAt: n.expiresAt ?? null };
}

// calendarHelpers: { getValidAccessToken, connect } - AssistantPage에서 useGoogleCalendar()로
// 얻은 것을 그대로 전달받는다. Gemini에게는 이 객체나 access token 값 자체를 절대 넘기지
// 않는다 - Gemini는 addToCalendar/attending 같은 "의도"만 함수 인자로 전달할 뿐이고,
// 실제 Google Calendar API 호출은 여기(클라이언트 코드)에서 수행한다.
async function execAddEvent(args, uid, calendarHelpers) {
  const now = new Date().toISOString();
  const attending = ATTENDANCE_BASED_EVENT_TYPES.includes(args.type) ? (typeof args.attending === "boolean" ? args.attending : null) : null;
  const eligible = isCalendarEligible({ type: args.type, attending });

  let calendarSync = false;
  let googleCalendarId = null;
  let calendarNote;

  if (args.addToCalendar && eligible && calendarHelpers) {
    try {
      let token = await calendarHelpers.getValidAccessToken();
      if (!token && calendarHelpers.connect) {
        await calendarHelpers.connect();
        token = await calendarHelpers.getValidAccessToken();
      }
      if (token) {
        googleCalendarId = await createCalendarEvent(token, {
          title: args.title,
          date: args.date,
          startTime: args.startTime,
          endTime: args.endTime,
          memo: args.memo,
        });
        calendarSync = true;
      } else {
        calendarNote = "Google Calendar가 연결되어 있지 않아 동기화하지 못했습니다.";
      }
    } catch (err) {
      calendarNote =
        err instanceof MissingEndTimeError
          ? err.message
          : "Google Calendar 동기화에 실패했습니다.";
    }
  } else if (args.addToCalendar && !eligible) {
    calendarNote =
      args.type === "meeting" || args.type === "council"
        ? "참석 여부가 확정되지 않아 Google Calendar에는 추가하지 않았습니다."
        : undefined;
  }

  const id = await createDoc("events", uid, {
    title: args.title,
    date: args.date,
    startTime: args.startTime ?? "",
    endTime: args.endTime ?? "",
    type: args.type,
    customType: args.type === "other" ? args.customType ?? "" : "",
    status: "예정",
    memo: args.memo ?? "",
    attending,
    source: "ai",
    calendarSync,
    googleCalendarId,
    createdAt: now,
    updatedAt: now,
  });

  return {
    success: true,
    id,
    title: args.title,
    date: args.date,
    calendarSync,
    ...(calendarNote ? { calendarNote } : {}),
  };
}

async function execUpdateEvent(args, uid) {
  const { eventId, ...fields } = args;
  const events = await listDocsByOwner("events", uid);
  const target = events.find((e) => e.id === eventId);
  if (!target) return { success: false, reason: "해당 id의 일정을 찾을 수 없습니다." };

  await updateDocById("events", eventId, { ...fields, updatedAt: new Date().toISOString() });
  return { success: true, id: eventId };
}

// "취소"(updateEvent status="취소")와는 완전히 다른 동작이다 - 이 함수는 Firestore 문서를
// 실제로 지워서 기록을 남기지 않는다. alsoDeleteFromCalendar는 사용자가 명확히 요청했을
// 때만 Gemini가 true로 채우며(tools.js 설명 참고), 여기서도 그 값을 그대로 신뢰한다.
async function execDeleteEvent(args, uid, calendarHelpers) {
  const events = await listDocsByOwner("events", uid);
  const target = events.find((e) => e.id === args.eventId);
  if (!target) return { success: false, reason: "해당 id의 일정을 찾을 수 없습니다." };

  let calendarDeleted = false;
  let calendarNote;

  if (args.alsoDeleteFromCalendar && target.calendarSync && target.googleCalendarId) {
    if (!calendarHelpers) {
      calendarNote = "Google Calendar가 연결되어 있지 않아 Calendar에서는 삭제하지 못했습니다.";
    } else {
      try {
        const token = await calendarHelpers.getValidAccessToken();
        if (token) {
          await deleteCalendarEvent(token, target.googleCalendarId);
          calendarDeleted = true;
        } else {
          calendarNote = "Google Calendar가 연결되어 있지 않아 Calendar에서는 삭제하지 못했습니다.";
        }
      } catch (err) {
        console.error("[AI deleteEvent] calendar delete failed:", err);
        calendarNote = "Google Calendar에서는 삭제하지 못했습니다.";
      }
    }
  }

  await deleteDocById("events", args.eventId);

  return {
    success: true,
    id: args.eventId,
    title: target.title,
    calendarDeleted,
    ...(calendarNote ? { calendarNote } : {}),
  };
}

// 이미 Firestore에 존재하는 일정을 Google Calendar에 "연결"만 한다. addEvent와 달리
// 새 Firestore 문서를 만들지 않는다 - 후속 대화("이것도 캘린더에 추가해줘")에서 같은
// 일정이 중복 생성되는 것을 막기 위한 전용 도구다.
async function execSyncEventToCalendar(args, uid, calendarHelpers) {
  const events = await listDocsByOwner("events", uid);
  const target = events.find((e) => e.id === args.eventId);
  if (!target) return { success: false, reason: "해당 id의 일정을 찾을 수 없습니다." };

  if (target.calendarSync && target.googleCalendarId) {
    return { success: true, id: target.id, alreadySynced: true };
  }

  const eligible = isCalendarEligible({ type: target.type, attending: target.attending });
  if (!eligible) {
    return {
      success: false,
      reason:
        target.type === "meeting" || target.type === "council"
          ? "참석 여부가 확정되지 않아 Calendar에 추가할 수 없습니다."
          : "이 일정은 현재 Calendar 동기화 대상이 아닙니다.",
    };
  }

  if (!calendarHelpers) {
    return { success: false, reason: "Google Calendar 연결이 필요합니다." };
  }

  try {
    let token = await calendarHelpers.getValidAccessToken();
    if (!token && calendarHelpers.connect) {
      await calendarHelpers.connect();
      token = await calendarHelpers.getValidAccessToken();
    }
    if (!token) return { success: false, reason: "Google Calendar 연결이 필요합니다." };

    const googleCalendarId = await createCalendarEvent(token, {
      title: target.title,
      date: target.date,
      startTime: target.startTime,
      endTime: target.endTime,
      memo: target.memo,
    });

    await updateDocById("events", target.id, {
      calendarSync: true,
      googleCalendarId,
      updatedAt: new Date().toISOString(),
    });

    return { success: true, id: target.id, calendarSync: true };
  } catch (err) {
    const reason =
      err instanceof MissingEndTimeError ? err.message : "Google Calendar 동기화에 실패했습니다.";
    return { success: false, reason };
  }
}

async function execSearchEvents(args, uid) {
  const dateFrom = args.dateFrom || todayDateString();
  const dateTo = args.dateTo || dateFrom;
  const all = await listDocsByOwner("events", uid);
  const filtered = all
    .filter((e) => e.date >= dateFrom && e.date <= dateTo)
    .filter((e) => !args.type || e.type === args.type)
    .sort((a, b) => `${a.date}${a.startTime ?? ""}`.localeCompare(`${b.date}${b.startTime ?? ""}`))
    .slice(0, MAX_RESULTS);
  return { results: filtered.map(trimEvent) };
}

async function execAddTask(args, uid) {
  const now = new Date().toISOString();
  const id = await createDoc("tasks", uid, {
    title: args.title,
    dueDate: args.dueDate,
    priority: args.priority ?? "medium",
    memo: args.memo ?? "",
    completed: false,
    source: "ai",
    createdAt: now,
    updatedAt: now,
  });
  return { success: true, id, title: args.title, dueDate: args.dueDate };
}

async function execUpdateTask(args, uid) {
  const { taskId, ...fields } = args;
  const tasks = await listDocsByOwner("tasks", uid);
  const target = tasks.find((t) => t.id === taskId);
  if (!target) return { success: false, reason: "해당 id의 업무를 찾을 수 없습니다." };

  await updateDocById("tasks", taskId, { ...fields, updatedAt: new Date().toISOString() });
  return { success: true, id: taskId };
}

async function execCompleteTask(args, uid) {
  const tasks = await listDocsByOwner("tasks", uid);
  const target = tasks.find((t) => t.id === args.taskId);
  if (!target) return { success: false, reason: "해당 id의 업무를 찾을 수 없습니다." };

  await updateDocById("tasks", args.taskId, { completed: true, updatedAt: new Date().toISOString() });
  return { success: true, id: args.taskId, title: target.title };
}

async function execSearchTasks(args, uid) {
  const all = await listDocsByOwner("tasks", uid);
  const filtered = all
    .filter((t) => (args.dueFrom ? t.dueDate >= args.dueFrom : true))
    .filter((t) => (args.dueTo ? t.dueDate <= args.dueTo : true))
    .filter((t) => (typeof args.completed === "boolean" ? t.completed === args.completed : true))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""))
    .slice(0, MAX_RESULTS);
  return { results: filtered.map(trimTask) };
}

async function execUpdateClassProgress(args, uid) {
  const existing = await getClassProgress(uid);
  const target = existing.find((cp) => cp.className === args.className);
  const payload = {
    className: args.className,
    ...(args.unit !== undefined ? { unit: args.unit } : {}),
    ...(args.lesson !== undefined ? { lesson: args.lesson } : {}),
    ...(args.topic !== undefined ? { topic: args.topic } : {}),
    lastClassDate: args.lastClassDate || todayDateString(),
  };

  if (target) {
    await updateDocById("class_progress", target.id, payload);
    return { success: true, id: target.id, action: "updated", className: args.className };
  }
  const id = await createDoc("class_progress", uid, { memo: "", ...payload });
  return { success: true, id, action: "created", className: args.className };
}

async function execSearchClassProgress(args, uid) {
  const all = await getClassProgress(uid);
  const filtered = all.filter((cp) => !args.className || cp.className === args.className).slice(0, MAX_RESULTS);
  return { results: filtered.map(trimClassProgress) };
}

async function execSearchTimetable(args, uid) {
  const day = args.dayOfWeek || todayWeekdayKorean();
  const all = day === todayWeekdayKorean() ? await getTodayBaseTimetable(uid) : await listDocsByOwner("timetable", uid);
  const filtered = all.filter((t) => t.dayOfWeek === day).sort((a, b) => (a.period ?? 0) - (b.period ?? 0));
  return { dayOfWeek: day, results: filtered.map(trimTimetable) };
}

async function execSearchTimetableOverrides(args, uid) {
  const date = args.date || todayDateString();
  const all =
    date === todayDateString() ? await getTodayTimetableOverrides(uid) : await listDocsByOwner("timetable_overrides", uid);
  const filtered = all.filter((o) => o.date === date);
  return { date, results: filtered.map(trimOverride) };
}

async function execSearchNotices(args, uid) {
  const importantOnly = args.importantOnly !== false;
  const today = todayDateString();
  let all;
  if (importantOnly) {
    all = await getImportantNotices(uid);
  } else {
    all = (await listDocsByOwner("notices", uid)).filter((n) => !n.expiresAt || n.expiresAt >= today);
  }
  return { results: all.slice(0, MAX_RESULTS).map(trimNotice) };
}

// ---- 월별 수업 진도 관리 실행기 ----
// 실제 계산(진도 비교, 남은 수업 횟수, confirmed/needs_review 판정)은 전부
// progressComparison.js / remainingLessons.js의 결정론적 코드가 수행한다. 여기서는
// Firestore 조회/CRUD와 그 결과를 Gemini에게 넘길 수 있는 형태로 다듬는 것만 한다.

// 사용자가 "101"/"101반"/"1-1"/"1-1반"/"1학년 1반" 등 어떤 식으로 말했든, 실제 timetable에
// 있는 담당 학급 중 정확히 하나로 특정될 때만 그 내부 className을 돌려준다. 특정할 수
// 없으면(담당 학급 아님, 또는 "1반"처럼 학년 없는 표현이 여러 학년에 걸침) 실패와 후보를
// 그대로 돌려준다 - Gemini가 임의로 학급을 만들어내거나 고르지 않게 하기 위해서다.
async function resolveOwnedClass(rawClassInput, uid) {
  const timetable = await listDocsByOwner("timetable", uid);
  const owned = [...new Set(timetable.map((t) => t.className))];
  const resolved = resolveClassInput(rawClassInput, owned);

  if (resolved.className) return { className: resolved.className, timetable };

  if (resolved.candidates.length > 0) {
    return {
      className: null,
      timetable,
      failure: { success: false, reason: "학년을 확인해야 합니다.", candidates: resolved.candidates },
    };
  }

  return {
    className: null,
    timetable,
    failure: { success: false, reason: "현재 시간표에서 담당 학급을 찾을 수 없습니다." },
  };
}

function currentYearMonth() {
  const today = todayDateString();
  return { year: today.slice(0, 4), month: String(Number(today.slice(5, 7))) };
}

async function execAddProgressPlanItems(args, uid) {
  const now = new Date().toISOString();
  const { year: defaultYear, month: defaultMonth } = currentYearMonth();
  const year = args.year || defaultYear;
  const month = args.month || defaultMonth;

  const existing = await listDocsByOwner("progress_plans", uid);
  const already = existing.filter(
    (p) => p.grade === args.grade && String(p.year) === String(year) && String(p.month) === String(month)
  );
  let order = already.length;
  let count = 0;

  for (const item of args.items || []) {
    if (!item.title) continue;
    const payload = {
      grade: args.grade,
      year: String(year),
      month: String(month),
      title: item.title,
      order,
      createdAt: now,
      updatedAt: now,
    };
    if (typeof item.estimatedLessons === "number") payload.estimatedLessons = item.estimatedLessons;
    // eslint-disable-next-line no-await-in-loop
    await createDoc("progress_plans", uid, payload);
    order += 1;
    count += 1;
  }

  return { success: true, count, grade: args.grade, year: String(year), month: String(month) };
}

async function execGetProgressStatus(args, uid) {
  const { year: defaultYear, month: defaultMonth } = currentYearMonth();
  const year = args.year || defaultYear;
  const month = args.month || defaultMonth;

  const [timetable, plans, checks, currents] = await Promise.all([
    listDocsByOwner("timetable", uid),
    listDocsByOwner("progress_plans", uid),
    listDocsByOwner("progress_checks", uid),
    listDocsByOwner("progress_current", uid),
  ]);

  const planItems = plans
    .filter((p) => p.grade === args.grade && String(p.year) === String(year) && String(p.month) === String(month))
    .sort((a, b) => a.order - b.order);

  if (planItems.length === 0) {
    return {
      success: false,
      reason: `${year}년 ${month}월 ${args.grade}학년 진도계획이 아직 등록되어 있지 않습니다.`,
    };
  }

  const planItemIds = new Set(planItems.map((p) => p.id));
  const classesInGrade = [
    ...new Set(timetable.filter((t) => gradeOfClassName(t.className) === args.grade).map((t) => t.className)),
  ].sort();

  let targetClasses = classesInGrade;
  if (args.className) {
    const resolved = resolveClassInput(args.className, classesInGrade);
    if (resolved.className) {
      targetClasses = [resolved.className];
    } else if (resolved.candidates.length > 0) {
      return { success: false, reason: "학년을 확인해야 합니다.", candidates: resolved.candidates };
    } else {
      return { success: false, reason: "현재 시간표에서 담당 학급을 찾을 수 없습니다." };
    }
  }

  const results = targetClasses.map((className) => {
    const checkedIds = checks
      .filter((c) => isSameClass(c.className, className) && planItemIds.has(c.planItemId) && c.completed)
      .map((c) => c.planItemId);
    const stats = analyzeClassProgress(planItems, checkedIds);
    const current = currents.find((c) => isSameClass(c.className, className) && planItemIds.has(c.planItemId));
    return {
      className,
      displayClassName: formatClassName(className),
      completedThrough: stats.currentItem?.title ?? null,
      nextPlanItem: stats.nextItem?.title ?? null,
      inProgress: current ? { planItemTitle: current.planItemTitle, detail: current.detail || null } : null,
      remainingPlanItems: stats.remainingPlanItems,
      totalItems: stats.totalItems,
      consecutivePosition: stats.consecutivePosition,
    };
  });

  const comparison = compareClassesInGrade(
    results.map((r) => ({ className: r.className, consecutivePosition: r.consecutivePosition }))
  );

  return {
    success: true,
    year: String(year),
    month: String(month),
    grade: args.grade,
    classes: results.map(({ consecutivePosition: _consecutivePosition, ...rest }) => rest),
    comparisonMessages: comparison.messages.map((m) => m.text),
  };
}

// 완료 체크(progress_checks)를 planItems 순서에 맞춰 정확히 completedIds 집합과
// 일치시킨다 - 그 집합에 있으면 completed:true, 없으면 completed:false로 맞춘다(기존
// 문서가 있으면 update, completed:true인데 문서가 없으면만 새로 만든다). UI의 수동
// 저장과 AI 업데이트가 동일한 이 함수를 거치므로 두 경로의 결과가 항상 같다.
async function syncChecksToCompletedIds(uid, planItems, className, completedIds, checks, now) {
  const completedSet = new Set(completedIds);
  for (const p of planItems) {
    const shouldBeCompleted = completedSet.has(p.id);
    const existing = checks.find((c) => c.planItemId === p.id && isSameClass(c.className, className));
    if (existing) {
      if (!!existing.completed !== shouldBeCompleted) {
        // eslint-disable-next-line no-await-in-loop
        await updateDocById("progress_checks", existing.id, {
          completed: shouldBeCompleted,
          completedAt: shouldBeCompleted ? now : null,
          updatedAt: now,
        });
      }
    } else if (shouldBeCompleted) {
      // eslint-disable-next-line no-await-in-loop
      await createDoc("progress_checks", uid, {
        planItemId: p.id,
        className,
        completed: true,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

async function execUpdateProgressStatus(args, uid) {
  const { year: defaultYear, month: defaultMonth } = currentYearMonth();
  const year = args.year || defaultYear;
  const month = args.month || defaultMonth;
  const now = new Date().toISOString();
  const lastClassDate = args.lastClassDate || todayDateString();

  const { className, failure } = await resolveOwnedClass(args.className, uid);
  if (!className) return failure;

  const grade = gradeOfClassName(className);
  const [plans, checks, currents, historyDocs] = await Promise.all([
    listDocsByOwner("progress_plans", uid),
    listDocsByOwner("progress_checks", uid),
    listDocsByOwner("progress_current", uid),
    listDocsByOwner("progress_history", uid),
  ]);

  const planItems = plans
    .filter((p) => p.grade === grade && String(p.year) === String(year) && String(p.month) === String(month))
    .sort((a, b) => a.order - b.order);

  if (planItems.length === 0) {
    return { success: false, reason: `${year}년 ${month}월 ${grade}학년 진도계획이 아직 등록되어 있지 않습니다.` };
  }

  if (!args.completedThroughTitle && !args.currentPlanItemTitle) {
    return { success: false, reason: "completedThroughTitle 또는 currentPlanItemTitle 중 하나가 필요합니다." };
  }

  const existingCurrent = currents.find((c) => isSameClass(c.className, className));
  const classHistory = historyDocs
    .filter((h) => isSameClass(h.className, className))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  const latestHistory = classHistory[0] || null;

  // "~까지 끝냈어" - 계획 순서상 그 항목까지 전부 완료 처리하고, 진행 중 상태는 지운다.
  if (args.completedThroughTitle) {
    const { item, candidates } = findPlanItemByTitle(planItems, args.completedThroughTitle);
    if (!item) {
      return {
        success: false,
        reason: "진도 항목을 하나로 특정할 수 없습니다.",
        candidates: candidates.map((c) => ({ id: c.id, title: c.title })),
      };
    }

    const completedIds = computeCompletedIdsThrough(planItems, item.id);
    await syncChecksToCompletedIds(uid, planItems, className, completedIds, checks, now);

    if (existingCurrent) {
      await deleteDocById("progress_current", existingCurrent.id);
    }

    const newHistory = { planItemId: item.id, detail: null, completedPlanItemIds: completedIds };
    if (!historyEntriesEqual(latestHistory, newHistory)) {
      await createDoc("progress_history", uid, {
        className,
        grade,
        date: lastClassDate,
        planItemId: item.id,
        planItemTitle: item.title,
        detail: null,
        completedPlanItemIds: completedIds,
        source: "ai",
        createdAt: now,
      });
    }

    return { success: true, className, displayClassName: formatClassName(className), completedThrough: item.title };
  }

  // "~의 일부까지 했어" - 그 이전 항목까지만 완료 처리하고, 이 항목은 진행 중으로 기록한다.
  const { item, candidates } = findPlanItemByTitle(planItems, args.currentPlanItemTitle);
  if (!item) {
    return {
      success: false,
      reason: "진도 항목을 하나로 특정할 수 없습니다.",
      candidates: candidates.map((c) => ({ id: c.id, title: c.title })),
    };
  }

  const completedIds = computeCompletedIdsBefore(planItems, item.id);
  await syncChecksToCompletedIds(uid, planItems, className, completedIds, checks, now);

  const detail = args.detail || "";
  if (existingCurrent) {
    await updateDocById("progress_current", existingCurrent.id, {
      planItemId: item.id,
      planItemTitle: item.title,
      detail,
      updatedAt: now,
      lastClassDate,
    });
  } else {
    await createDoc("progress_current", uid, {
      className,
      grade,
      planItemId: item.id,
      planItemTitle: item.title,
      detail,
      updatedAt: now,
      lastClassDate,
      createdAt: now,
    });
  }

  const newHistory = { planItemId: item.id, detail, completedPlanItemIds: completedIds };
  if (!historyEntriesEqual(latestHistory, newHistory)) {
    await createDoc("progress_history", uid, {
      className,
      grade,
      date: lastClassDate,
      planItemId: item.id,
      planItemTitle: item.title,
      detail,
      completedPlanItemIds: completedIds,
      source: "ai",
      createdAt: now,
    });
  }

  return { success: true, className, displayClassName: formatClassName(className), currentItem: item.title, detail };
}

async function execGetProgressHistory(args, uid) {
  let entries = await listDocsByOwner("progress_history", uid);

  if (args.className) {
    const resolved = await resolveOwnedClass(args.className, uid);
    if (!resolved.className) return resolved.failure;
    entries = entries.filter((h) => isSameClass(h.className, resolved.className));
  }

  if (args.dateFrom) entries = entries.filter((h) => h.date >= args.dateFrom);
  if (args.dateTo) entries = entries.filter((h) => h.date <= args.dateTo);
  if (args.planItemTitle) {
    const needle = String(args.planItemTitle).trim().toLowerCase();
    entries = entries.filter((h) => String(h.planItemTitle || "").toLowerCase().includes(needle));
  }

  entries.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const limit = typeof args.limit === "number" && args.limit > 0 ? args.limit : MAX_RESULTS;

  return {
    results: entries.slice(0, limit).map((h) => ({
      id: h.id,
      className: h.className,
      displayClassName: formatClassName(h.className),
      lessonDate: h.date,
      planItemTitle: h.planItemTitle,
      detail: h.detail || null,
    })),
  };
}

// 과거 기록(progress_history) 하나를 수정한다 - 현재 진도(progress_current/
// progress_checks)에는 절대 손대지 않는다. 완료 스냅샷(completedPlanItemIds)도 그
// 기록 시점의 사실이므로 건드리지 않고, 실제 수업일/진도명만 고칠 수 있다.
async function execUpdateProgressHistory(args, uid) {
  const all = await listDocsByOwner("progress_history", uid);
  const target = all.find((h) => h.id === args.historyId);
  if (!target) return { success: false, reason: "해당 id의 기록을 찾을 수 없습니다." };

  const payload = { updatedAt: new Date().toISOString() };
  if (args.lessonDate) payload.date = args.lessonDate;
  if (args.planItemTitle) payload.planItemTitle = args.planItemTitle;

  if (Object.keys(payload).length === 1) {
    return { success: false, reason: "수정할 내용(lessonDate 또는 planItemTitle)이 없습니다." };
  }

  await updateDocById("progress_history", args.historyId, payload);
  return {
    success: true,
    id: args.historyId,
    className: target.className,
    displayClassName: formatClassName(target.className),
  };
}

// 과거 기록(progress_history) 하나를 삭제한다 - 현재 진도에는 전혀 영향을 주지 않는다.
async function execDeleteProgressHistory(args, uid) {
  const all = await listDocsByOwner("progress_history", uid);
  const target = all.find((h) => h.id === args.historyId);
  if (!target) return { success: false, reason: "해당 id의 기록을 찾을 수 없습니다." };

  await deleteDocById("progress_history", args.historyId);
  return {
    success: true,
    id: args.historyId,
    className: target.className,
    displayClassName: formatClassName(target.className),
  };
}

// 완료 처리는 전혀 하지 않고 "진행 중" 표시(progress_current)만 지운다. 화면의
// deleteCurrentProgress()와 정확히 같은 동작이다 - 이미 완료로 체크된 progress_checks는
// 손대지 않는다.
async function execClearProgressCurrent(args, uid) {
  const { className, failure } = await resolveOwnedClass(args.className, uid);
  if (!className) return failure;

  const currents = await listDocsByOwner("progress_current", uid);
  const existing = currents.find((c) => isSameClass(c.className, className));
  if (!existing) {
    return {
      success: true,
      className,
      displayClassName: formatClassName(className),
      cleared: false,
      reason: "이미 진행 중 표시가 없습니다.",
    };
  }

  await deleteDocById("progress_current", existing.id);
  return { success: true, className, displayClassName: formatClassName(className), cleared: true };
}

async function execChangeTimetable(args, uid) {
  const [timetable, timetableOverrides, schoolDaySchedules] = await Promise.all([
    listDocsByOwner("timetable", uid),
    listDocsByOwner("timetable_overrides", uid),
    listDocsByOwner("school_day_schedules", uid),
  ]);

  // 학사일정 요일대체가 이미 반영된 "그날 실제 시간표"에서 조회한다 - AI가 요일을 직접
  // 해석하지 않는다. UI(TimetablePage.jsx)의 quickDayTimetable/moveTargetDayTimetable과
  // 정확히 같은 계산이다.
  const sourceDay = getEffectiveDayTimetable(args.sourceDate, { timetable, timetableOverrides, schoolDaySchedules });
  const source = sourceDay.periods.find((p) => p.period === args.sourcePeriod);

  if (args.changeMode === "swap") {
    // swap은 UI에서도 항상 같은 날짜 안에서만 이뤄진다(맞교환은 날짜 간 개념이 없다) -
    // destinationDate를 별도로 받지 않고 sourceDay 안에서만 두 번째 교시를 찾는다.
    const other = sourceDay.periods.find((p) => p.period === args.destinationPeriod);
    const result = buildSwapPayloads(args.sourceDate, source, other);
    if (!result.ok) return { success: false, reason: result.reason };

    await Promise.all(result.payloads.map((payload) => createDoc("timetable_overrides", uid, payload)));
    return {
      success: true,
      changeMode: "swap",
      date: args.sourceDate,
      periodA: args.sourcePeriod,
      periodB: args.destinationPeriod,
    };
  }

  const destinationDate = args.destinationDate || args.sourceDate;
  const destinationDay =
    destinationDate === args.sourceDate
      ? sourceDay
      : getEffectiveDayTimetable(destinationDate, { timetable, timetableOverrides, schoolDaySchedules });
  const destination = destinationDay.periods.find((p) => p.period === args.destinationPeriod);

  const result = buildMovePayloads({
    sourceDate: args.sourceDate,
    sourcePeriod: args.sourcePeriod,
    source,
    destinationDate,
    destinationPeriod: args.destinationPeriod,
    destination,
  });

  if (!result.ok) {
    return { success: false, reason: result.reason };
  }

  await Promise.all(result.payloads.map((payload) => createDoc("timetable_overrides", uid, payload)));

  return {
    success: true,
    changeMode: "move",
    sourceDate: args.sourceDate,
    sourcePeriod: args.sourcePeriod,
    destinationDate,
    destinationPeriod: args.destinationPeriod,
  };
}


// Google Calendar에서 특정 날짜의 일정을 조회한다 - Firestore에는 절대 쓰지 않는다(순수
// 조회). 이미 이 사용자의 events에 같은 googleCalendarId로 연결된 일정은
// alreadyImported로 표시한다 - 출처가 manual/ai/google_import 무엇이든 googleCalendarId가
// 같으면 이미 업무비서에 등록된 것으로 본다.
async function execGetGoogleCalendarEvents(args, uid, calendarHelpers) {
  if (!calendarHelpers) {
    return { success: false, reason: "Google Calendar 연결 기능을 사용할 수 없습니다." };
  }
  let token = await calendarHelpers.getValidAccessToken();
  if (!token && calendarHelpers.connect) {
    await calendarHelpers.connect();
    token = await calendarHelpers.getValidAccessToken();
  }
  if (!token) {
    return { success: false, reason: "Google Calendar 연결이 필요합니다." };
  }

  const [candidates, existingEvents] = await Promise.all([
    listCalendarEvents(token, args.date),
    listDocsByOwner("events", uid),
  ]);

  const importedIds = new Set(existingEvents.filter((e) => e.googleCalendarId).map((e) => e.googleCalendarId));

  return {
    success: true,
    date: args.date,
    events: candidates.map((c) => ({ ...c, alreadyImported: importedIds.has(c.id) })),
  };
}

// 직전 조회 후보 중 사용자가 고른 것만 저장한다. Gemini가 넘긴 title/date/time은 전혀
// 받지 않는다(tool 파라미터에 없음) - googleEventIds(실제 Google event id)만 받아서,
// 그 날짜를 다시 listCalendarEvents로 조회해 실제 Google 데이터를 확인한 뒤에만
// 저장한다. Gemini가 존재하지 않는 id를 지어내도 candidates에서 찾지 못해 저장되지
// 않는다 - 저장되는 내용의 원본은 항상 이 시점에 다시 확인한 Google Calendar API
// 데이터다.
async function execImportGoogleCalendarEvents(args, uid, calendarHelpers) {
  if (!calendarHelpers) {
    return { success: false, reason: "Google Calendar 연결 기능을 사용할 수 없습니다." };
  }
  let token = await calendarHelpers.getValidAccessToken();
  if (!token && calendarHelpers.connect) {
    await calendarHelpers.connect();
    token = await calendarHelpers.getValidAccessToken();
  }
  if (!token) {
    return { success: false, reason: "Google Calendar 연결이 필요합니다." };
  }

  const requestedIds = Array.isArray(args.googleEventIds) ? args.googleEventIds : [];
  if (requestedIds.length === 0) {
    return { success: false, reason: "가져올 일정을 확인하지 못했습니다." };
  }

  const [candidates, existingEvents] = await Promise.all([
    listCalendarEvents(token, args.date),
    listDocsByOwner("events", uid),
  ]);

  const importedIds = new Set(existingEvents.filter((e) => e.googleCalendarId).map((e) => e.googleCalendarId));
  const now = new Date().toISOString();

  const imported = [];
  const skipped = [];

  for (const id of requestedIds) {
    const candidate = candidates.find((c) => c.id === id);
    if (!candidate) {
      skipped.push({ id, reason: "not_found" });
      continue;
    }
    if (importedIds.has(id)) {
      skipped.push({ id, reason: "already_imported", title: candidate.title });
      continue;
    }

    await createDoc("events", uid, {
      title: candidate.title,
      date: candidate.date,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      type: "other",
      customType: "",
      status: "예정",
      memo: "",
      attending: null,
      source: "google_import",
      calendarSync: true,
      googleCalendarId: candidate.id,
      createdAt: now,
      updatedAt: now,
    });
    imported.push({ id, title: candidate.title, date: candidate.date });
  }

  return { success: true, imported, skipped };
}

async function execGetRemainingLessons(args, uid) {
  const { className, timetable, failure } = await resolveOwnedClass(args.className, uid);
  if (!className) return failure;

  const today = todayDateString();
  const dateFrom = args.dateFrom || today;
  const grade = gradeOfClassName(className);
  const dateTo = args.dateTo || endOfMonthDateString(Number(dateFrom.slice(0, 4)), Number(dateFrom.slice(5, 7)));

  const [timetableOverrides, schedules, adjustments] = await Promise.all([
    listDocsByOwner("timetable_overrides", uid),
    listDocsByOwner("school_day_schedules", uid),
    listDocsByOwner("lesson_adjustments", uid),
  ]);

  const result = calculateRemainingLessons({
    className,
    grade,
    dateFrom,
    dateTo,
    timetable,
    timetableOverrides,
    schoolDaySchedules: schedules,
    lessonAdjustments: adjustments,
  });

  return {
    success: true,
    className,
    displayClassName: formatClassName(className),
    dateFrom,
    dateTo,
    total: result.total,
    basis: result.basis.map((b) => ({ date: b.date, label: b.label, delta: b.delta })),
    unresolvedCount: result.unresolvedSchedules.length,
    unresolvedDates: result.unresolvedSchedules.map((s) => `${s.date} ${s.originalText}`),
  };
}

async function execAddLessonAdjustment(args, uid) {
  const { className, failure } = await resolveOwnedClass(args.className, uid);
  if (!className) return failure;

  const now = new Date().toISOString();
  const id = await createDoc("lesson_adjustments", uid, {
    date: args.date,
    className,
    delta: args.delta,
    reason: args.reason || "",
    source: "ai",
    createdAt: now,
    updatedAt: now,
  });
  return { success: true, id, date: args.date, className, displayClassName: formatClassName(className), delta: args.delta };
}

async function execSearchNeedsReviewSchedules(args, uid) {
  const schedules = await listDocsByOwner("school_day_schedules", uid);
  const needsReview = schedules
    .filter((s) => s.status === "needs_review")
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  return {
    results: needsReview.slice(0, MAX_RESULTS).map((s) => ({ id: s.id, date: s.date, originalText: s.originalText })),
  };
}

async function execUpdateSchoolDaySchedule(args, uid) {
  const schedules = await listDocsByOwner("school_day_schedules", uid);
  const target = schedules.find((s) => s.id === args.scheduleId);
  if (!target) return { success: false, reason: "해당 id의 학사일정을 찾을 수 없습니다." };

  const payload = { updatedAt: new Date().toISOString() };
  if (args.status) payload.status = args.status;
  if (Array.isArray(args.affectedGrades)) payload.affectedGrades = args.affectedGrades;
  if (Array.isArray(args.affectedPeriods)) payload.affectedPeriods = args.affectedPeriods;
  if (Array.isArray(args.noClassGrades)) payload.noClassGrades = args.noClassGrades;

  await updateDocById("school_day_schedules", args.scheduleId, payload);
  return { success: true, id: args.scheduleId };
}

export const TOOL_EXECUTORS = {
  addEvent: execAddEvent,
  updateEvent: execUpdateEvent,
  deleteEvent: execDeleteEvent,
  syncEventToCalendar: execSyncEventToCalendar,
  searchEvents: execSearchEvents,
  addTask: execAddTask,
  updateTask: execUpdateTask,
  completeTask: execCompleteTask,
  searchTasks: execSearchTasks,
  updateClassProgress: execUpdateClassProgress,
  searchClassProgress: execSearchClassProgress,
  searchTimetable: execSearchTimetable,
  searchTimetableOverrides: execSearchTimetableOverrides,
  searchNotices: execSearchNotices,
  addProgressPlanItems: execAddProgressPlanItems,
  getProgressStatus: execGetProgressStatus,
  getRemainingLessons: execGetRemainingLessons,
  addLessonAdjustment: execAddLessonAdjustment,
  searchNeedsReviewSchedules: execSearchNeedsReviewSchedules,
  updateSchoolDaySchedule: execUpdateSchoolDaySchedule,
  updateProgressStatus: execUpdateProgressStatus,
  getProgressHistory: execGetProgressHistory,
  updateProgressHistory: execUpdateProgressHistory,
  deleteProgressHistory: execDeleteProgressHistory,
  clearProgressCurrent: execClearProgressCurrent,
  changeTimetable: execChangeTimetable,
  getGoogleCalendarEvents: execGetGoogleCalendarEvents,
  importGoogleCalendarEvents: execImportGoogleCalendarEvents,
};
