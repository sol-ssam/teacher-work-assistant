import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { todayDateString, endOfMonthDateString, formatDateDisplay } from "../utils/date";
import { WEEKDAYS } from "../utils/constants";
import { fileToBase64 } from "../utils/fileToBase64";
import { detectFileFormat, FILE_FORMAT_LABEL } from "../utils/fileFormat";
import { excelToText } from "../utils/excelToText";
import { wordToText } from "../utils/wordToText";
import { analyzeAcademicSchedule } from "../ai/academicScheduleAnalysis";
import { getUpcomingNeedsReviewSchedules } from "../utils/schoolScheduleUtils";
import {
  analyzeClassProgress,
  compareClassesInGrade,
  computeLessonBalance,
  gradeOfClassName,
  parseClassCode,
  isSameClass,
  formatClassName,
  formatClassShortName,
} from "../utils/progressComparison";
import { calculateRemainingLessons } from "../utils/remainingLessons";
import { computeCompletedIdsBefore, historyEntriesEqual } from "../utils/progressStatusUpdate";
import "./crud-shared.css";
import "./MonthlyProgressPage.css";

const STATUS_OPTIONS = [
  { value: "confirmed", label: "확정" },
  { value: "needs_review", label: "추후 확인 필요" },
  { value: "no_impact", label: "영향 없음" },
];
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]));

function omitUndefined(obj) {
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) result[k] = v;
  }
  return result;
}

function parseNumberList(text) {
  const nums = String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !Number.isNaN(n));
  return nums.length > 0 ? nums : undefined;
}

const emptyScheduleForm = {
  date: "",
  originalText: "",
  status: "confirmed",
  noRegularClasses: false,
  noClassGrades: "",
  scheduleDayOverride: "",
  regularPeriods: "",
  affectedGrades: "",
  affectedPeriods: "",
  memo: "",
};

const emptyAdjustmentForm = { date: "", className: "", delta: "", reason: "" };

// "진행 중" 상태를 나타내던 "◐" 문자가 폰트/브라우저에 따라 원 안에서 좌우 중심이
// 어긋나 보이는 문제가 있어, 정확히 중앙 정렬되는 반원 아이콘을 직접 그려서 대체한다.
// currentColor를 쓰므로 버튼/범례에서 기존에 쓰던 rose 계열 색을 그대로 물려받는다.
function ProgressIcon({ className }) {
  return (
    <svg
      className={"progress-icon" + (className ? ` ${className}` : "")}
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M8 1.5a6.5 6.5 0 0 0 0 13z" fill="currentColor" />
    </svg>
  );
}

export default function MonthlyProgressPage() {
  const { user } = useAuth();
  const today = todayDateString();
  const [todayYear, todayMonth] = today.split("-");

  const [grade, setGrade] = useState("");
  const [year, setYear] = useState(todayYear);
  const [month, setMonth] = useState(String(Number(todayMonth)));

  const [timetable, setTimetable] = useState([]);
  const [timetableOverrides, setTimetableOverrides] = useState([]);
  const [allPlanItems, setAllPlanItems] = useState([]);
  const [allChecks, setAllChecks] = useState([]);
  const [schedules, setSchedules] = useState([]);
  const [adjustments, setAdjustments] = useState([]);
  const [currents, setCurrents] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadAll() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [tt, ov, plans, checks, sch, adj, cur] = await Promise.all([
        listDocsByOwner("timetable", user.uid),
        listDocsByOwner("timetable_overrides", user.uid),
        listDocsByOwner("progress_plans", user.uid),
        listDocsByOwner("progress_checks", user.uid),
        listDocsByOwner("school_day_schedules", user.uid),
        listDocsByOwner("lesson_adjustments", user.uid),
        listDocsByOwner("progress_current", user.uid),
      ]);
      setTimetable(tt);
      setTimetableOverrides(ov);
      setAllPlanItems(plans);
      setAllChecks(checks);
      setSchedules(sch.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")));
      setAdjustments(adj.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")));
      setCurrents(cur);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 담당 학년 목록도 담당 학급 목록과 마찬가지로 timetable에서 그대로 추출한다 - 특정
  // 학년을 전제하지 않는다. 여러 학년을 담당하는 교사를 위해 학년 자체를 선택할 수 있게
  // 한다.
  const availableGrades = useMemo(() => {
    const set = new Set(timetable.map((t) => gradeOfClassName(t.className)).filter(Boolean));
    return [...set].sort((a, b) => Number(a) - Number(b));
  }, [timetable]);

  useEffect(() => {
    if (availableGrades.length > 0 && !availableGrades.includes(grade)) {
      setGrade(availableGrades[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableGrades.join(",")]);

  // 이 학년의 학급 목록도 담당 교사 본인의 timetable에서 그대로 가져온다(직접 입력 안 함).
  const classesInGrade = useMemo(() => {
    const set = new Set(
      timetable.filter((t) => gradeOfClassName(t.className) === grade).map((t) => t.className)
    );
    // 반 번호 기준 숫자 정렬. classNumber를 못 뽑아내는 형식이 섞여 있어도 안전하게
    // 문자열 비교로 대체한다.
    return [...set].sort((a, b) => {
      const numA = Number(parseClassCode(a).classNumber);
      const numB = Number(parseClassCode(b).classNumber);
      if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) return numA - numB;
      return String(a).localeCompare(String(b));
    });
  }, [timetable, grade]);

  // 학년 선택과 무관하게, 사용자가 실제로 담당하는 학급 전체 목록. 수동 시수 보정처럼
  // 특정 학년에 매여 있지 않은 곳에서 쓴다 - 정렬 기준은 classesInGrade와 동일(학년 ->
  // 반 번호 순).
  const allOwnedClasses = useMemo(() => {
    const set = new Set(timetable.map((t) => t.className));
    return [...set].sort((a, b) => {
      const gradeA = Number(gradeOfClassName(a));
      const gradeB = Number(gradeOfClassName(b));
      if (!Number.isNaN(gradeA) && !Number.isNaN(gradeB) && gradeA !== gradeB) return gradeA - gradeB;
      const numA = Number(parseClassCode(a).classNumber);
      const numB = Number(parseClassCode(b).classNumber);
      if (!Number.isNaN(numA) && !Number.isNaN(numB) && numA !== numB) return numA - numB;
      return String(a).localeCompare(String(b));
    });
  }, [timetable]);

  const planItems = useMemo(
    () =>
      allPlanItems
        .filter((p) => p.grade === grade && String(p.year) === String(year) && String(p.month) === String(month))
        .sort((a, b) => a.order - b.order),
    [allPlanItems, grade, year, month]
  );

  const planItemIds = useMemo(() => new Set(planItems.map((p) => p.id)), [planItems]);
  const checksForPlan = useMemo(
    () => allChecks.filter((c) => planItemIds.has(c.planItemId)),
    [allChecks, planItemIds]
  );

  // ===== 월별 진도계획 빠른 입력 =====
  const [draftItems, setDraftItems] = useState([]);
  const [savingPlan, setSavingPlan] = useState(false);

  useEffect(() => {
    setDraftItems(
      planItems.map((p) => ({
        id: p.id,
        title: p.title,
        estimatedLessons: p.estimatedLessons ?? "",
        _key: p.id,
      }))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planItems.length, grade, year, month]);

  function addDraftRow() {
    setDraftItems((prev) => [
      ...prev,
      { id: null, title: "", estimatedLessons: "", _key: `new-${Date.now()}-${prev.length}` },
    ]);
  }

  function updateDraftRow(key, patch) {
    setDraftItems((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)));
  }

  function removeDraftRow(key) {
    setDraftItems((prev) => prev.filter((r) => r._key !== key));
  }

  function moveDraftRow(key, direction) {
    setDraftItems((prev) => {
      const idx = prev.findIndex((r) => r._key === key);
      const swapWith = idx + direction;
      if (idx < 0 || swapWith < 0 || swapWith >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      return next;
    });
  }

  async function savePlanItems() {
    if (!user) return;
    setSavingPlan(true);
    try {
      const now = new Date().toISOString();
      const keptIds = new Set(draftItems.filter((r) => r.id).map((r) => r.id));
      const removed = planItems.filter((p) => !keptIds.has(p.id));

      for (const p of removed) {
        // eslint-disable-next-line no-await-in-loop
        await deleteDocById("progress_plans", p.id);
      }

      for (let i = 0; i < draftItems.length; i++) {
        const row = draftItems[i];
        if (!row.title.trim()) continue;
        const payload = omitUndefined({
          grade,
          year: String(year),
          month: String(month),
          title: row.title.trim(),
          order: i,
          estimatedLessons: row.estimatedLessons === "" ? undefined : Number(row.estimatedLessons),
          updatedAt: now,
        });
        if (row.id) {
          // eslint-disable-next-line no-await-in-loop
          await updateDocById("progress_plans", row.id, payload);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await createDoc("progress_plans", user.uid, { ...payload, createdAt: now });
        }
      }
      reloadPlanItems();
      setIsEditingPlan(false);
    } finally {
      setSavingPlan(false);
    }
  }

  // 편집 취소 - 아직 저장하지 않은 draftItems 변경을 버리고 planItems 기준으로 되돌린다.
  // Firestore에는 아무 변화도 없다(애초에 저장 함수를 호출하지 않았으므로).
  function cancelEditPlan() {
    setDraftItems(
      planItems.map((p) => ({
        id: p.id,
        title: p.title,
        estimatedLessons: p.estimatedLessons ?? "",
        _key: p.id,
      }))
    );
    setIsEditingPlan(false);
  }

  // ===== 반별 진도 체크 =====
  function isChecked(planItemId, className) {
    const doc = checksForPlan.find((c) => c.planItemId === planItemId && isSameClass(c.className, className));
    return !!doc?.completed;
  }

  function inProgressDetail(planItemId, className) {
    const c = currents.find((cur) => isSameClass(cur.className, className) && cur.planItemId === planItemId);
    return c ? c.detail || "" : null;
  }

  // 체크 하나 때문에 화면 전체(loadAll의 loading 플래그)를 다시 불러오면, 그동안 탭
  // 콘텐츠 전체가 잠깐 사라졌다가 다시 나타나면서 페이지 높이가 줄었다 늘어나 스크롤
  // 위치가 위로 튀는 문제가 있었다. 각 저장/삭제 동작 후에는 그 동작이 실제로 바꾼
  // 컬렉션 하나만 다시 조회해서 그 state만 갱신한다 - loading을 건드리지 않으므로 탭
  // 콘텐츠가 언마운트되지 않고, 화면 위치도 그대로 유지된다.
  async function reloadChecks() {
    if (!user) return;
    try {
      const checks = await listDocsByOwner("progress_checks", user.uid);
      setAllChecks(checks);
    } catch (e) {
      console.error("[MonthlyProgress] progress_checks 재조회 실패:", e);
    }
  }

  async function reloadPlanItems() {
    if (!user) return;
    try {
      const plans = await listDocsByOwner("progress_plans", user.uid);
      setAllPlanItems(plans);
    } catch (e) {
      console.error("[MonthlyProgress] progress_plans 재조회 실패:", e);
    }
  }

  async function reloadSchedules() {
    if (!user) return;
    try {
      const sch = await listDocsByOwner("school_day_schedules", user.uid);
      setSchedules(sch.sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "")));
    } catch (e) {
      console.error("[MonthlyProgress] school_day_schedules 재조회 실패:", e);
    }
  }

  async function reloadAdjustments() {
    if (!user) return;
    try {
      const adj = await listDocsByOwner("lesson_adjustments", user.uid);
      setAdjustments(adj.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")));
    } catch (e) {
      console.error("[MonthlyProgress] lesson_adjustments 재조회 실패:", e);
    }
  }

  async function toggleCheck(planItemId, className) {
    if (!user) return;
    const existing = checksForPlan.find(
      (c) => c.planItemId === planItemId && isSameClass(c.className, className)
    );
    const now = new Date().toISOString();
    const willBeCompleted = !existing?.completed;
    if (existing) {
      await updateDocById("progress_checks", existing.id, {
        completed: willBeCompleted,
        completedAt: willBeCompleted ? now : null,
        updatedAt: now,
      });
    } else {
      await createDoc("progress_checks", user.uid, {
        planItemId,
        className,
        completed: true,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });
    }

    // 방금 완료로 체크한 항목이 마침 "진행 중"(progress_current) 상태였다면, 이제 끝났으니
    // 진행 중 표시를 지운다 - 완료된 항목이 진행 중으로 남아 모순되지 않게 한다.
    if (willBeCompleted) {
      const current = currents.find((c) => isSameClass(c.className, className) && c.planItemId === planItemId);
      if (current) {
        await deleteDocById("progress_current", current.id);
        reloadCurrents();
      }
    }

    reloadChecks();
  }

  async function reloadCurrents() {
    if (!user) return;
    try {
      const cur = await listDocsByOwner("progress_current", user.uid);
      setCurrents(cur);
    } catch (e) {
      console.error("[MonthlyProgress] progress_current 재조회 실패:", e);
    }
  }

  // ===== 학급별 "진행 중" 세부 진도 직접 입력 (AI의 updateProgressStatus와 동일한 규칙을
  // 재사용한다 - computeCompletedIdsBefore로 이전 항목까지 완료 처리하고, 선택한 항목
  // 자체는 진행 중으로 progress_current에 기록한다. UI와 AI가 같은 결과를 내도록 한다.) =====
  const [currentEditFor, setCurrentEditFor] = useState(null); // 편집 중인 className
  const [currentEditForm, setCurrentEditForm] = useState({ planItemId: "", detail: "" });
  const [savingCurrent, setSavingCurrent] = useState(false);

  function openCurrentEditor(className) {
    const existing = currents.find((c) => isSameClass(c.className, className));
    setCurrentEditFor(className);
    setCurrentEditForm({ planItemId: existing?.planItemId || "", detail: existing?.detail || "" });
  }

  function closeCurrentEditor() {
    setCurrentEditFor(null);
    setCurrentEditForm({ planItemId: "", detail: "" });
  }

  async function saveCurrentProgress(className) {
    if (!user || !currentEditForm.planItemId) return;
    const targetItem = planItems.find((p) => p.id === currentEditForm.planItemId);
    if (!targetItem) return;

    setSavingCurrent(true);
    try {
      const completedIds = computeCompletedIdsBefore(planItems, targetItem.id) || [];
      const now = new Date().toISOString();
      const lastClassDate = todayDateString();
      const detail = currentEditForm.detail || "";

      for (const p of planItems) {
        const shouldBeCompleted = completedIds.includes(p.id);
        const existingCheck = checksForPlan.find(
          (c) => c.planItemId === p.id && isSameClass(c.className, className)
        );
        if (existingCheck) {
          if (!!existingCheck.completed !== shouldBeCompleted) {
            // eslint-disable-next-line no-await-in-loop
            await updateDocById("progress_checks", existingCheck.id, {
              completed: shouldBeCompleted,
              completedAt: shouldBeCompleted ? now : null,
              updatedAt: now,
            });
          }
        } else if (shouldBeCompleted) {
          // eslint-disable-next-line no-await-in-loop
          await createDoc("progress_checks", user.uid, {
            planItemId: p.id,
            className,
            completed: true,
            completedAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
      }

      const existingCurrent = currents.find((c) => isSameClass(c.className, className));
      if (existingCurrent) {
        await updateDocById("progress_current", existingCurrent.id, {
          planItemId: targetItem.id,
          planItemTitle: targetItem.title,
          detail,
          updatedAt: now,
          lastClassDate,
        });
      } else {
        await createDoc("progress_current", user.uid, {
          className,
          grade,
          planItemId: targetItem.id,
          planItemTitle: targetItem.title,
          detail,
          updatedAt: now,
          lastClassDate,
          createdAt: now,
        });
      }

      const latestHistory = (historyByClass[className] || [])[0] || null;
      const newHistory = { planItemId: targetItem.id, detail, completedPlanItemIds: completedIds };
      if (!historyEntriesEqual(latestHistory, newHistory)) {
        await createDoc("progress_history", user.uid, {
          className,
          grade,
          date: lastClassDate,
          planItemId: targetItem.id,
          planItemTitle: targetItem.title,
          detail,
          completedPlanItemIds: completedIds,
          source: "manual",
          createdAt: now,
        });
        // 방금 새 기록을 만들었으니, 열려 있던 "최근 기록" 캐시가 있다면 지워서 다음에
        // 다시 열 때 새로 조회하게 한다.
        setHistoryByClass((prev) => {
          const next = { ...prev };
          delete next[className];
          return next;
        });
      }

      closeCurrentEditor();
      reloadChecks();
      reloadCurrents();
    } finally {
      setSavingCurrent(false);
    }
  }

  // 진행 중 표시를 그냥 지운다(잘못 입력했거나 더 이상 진행 중이 아닐 때). 이미 완료로
  // 체크된 항목들은 그대로 유지되고, progress_current 문서만 삭제한다.
  async function deleteCurrentProgress(className) {
    if (!user) return;
    const existing = currents.find((c) => isSameClass(c.className, className));
    if (!existing) return;
    setSavingCurrent(true);
    try {
      await deleteDocById("progress_current", existing.id);
      if (currentEditFor === className) closeCurrentEditor();
      reloadCurrents();
    } finally {
      setSavingCurrent(false);
    }
  }

  // ===== 학급별 "최근 기록"(progress_history) - 접혀 있다가 눌렀을 때만 조회한다 =====
  const [historyOpenFor, setHistoryOpenFor] = useState(null);
  const [historyByClass, setHistoryByClass] = useState({});
  const [historyLoading, setHistoryLoading] = useState(false);

  async function toggleHistory(className) {
    if (historyOpenFor === className) {
      setHistoryOpenFor(null);
      return;
    }
    setHistoryOpenFor(className);
    if (!historyByClass[className]) {
      setHistoryLoading(true);
      try {
        const all = await listDocsByOwner("progress_history", user.uid);
        const entries = all
          .filter((h) => isSameClass(h.className, className))
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
          .slice(0, 10);
        setHistoryByClass((prev) => ({ ...prev, [className]: entries }));
      } catch (e) {
        console.error("[MonthlyProgress] progress_history 조회 실패:", e);
      } finally {
        setHistoryLoading(false);
      }
    }
  }

  // 최근 기록 항목 하나를 삭제한다. progress_checks/progress_current는 전혀 건드리지
  // 않는다 - 이건 순전히 "지난 기록 목록"에서 잘못 남은 항목을 지우는 용도다.
  async function deleteHistoryEntry(className, historyId) {
    await deleteDocById("progress_history", historyId);
    setHistoryByClass((prev) => ({
      ...prev,
      [className]: (prev[className] || []).filter((h) => h.id !== historyId),
    }));
    setConfirmDeleteHistoryId(null);
  }

  // 삭제는 실수로 누르지 않도록 한 번 더 확인한다 - "삭제"를 누르면 그 항목만
  // "정말 삭제할까요?" 상태로 바뀌고, 다른 항목은 그대로다.
  const [confirmDeleteHistoryId, setConfirmDeleteHistoryId] = useState(null);

  // 과거 기록의 실제 수업일/진도명을 고친다. completedPlanItemIds나 현재 진도
  // (progress_current/progress_checks)는 절대 건드리지 않는다 - 그 기록 자체만 수정한다.
  const [editingHistoryId, setEditingHistoryId] = useState(null);
  const [historyEditForm, setHistoryEditForm] = useState({ date: "", planItemTitle: "", detail: "" });

  function startEditHistory(entry) {
    setEditingHistoryId(entry.id);
    setHistoryEditForm({ date: entry.date || "", planItemTitle: entry.planItemTitle || "", detail: entry.detail || "" });
    setConfirmDeleteHistoryId(null);
  }

  function cancelEditHistory() {
    setEditingHistoryId(null);
    setHistoryEditForm({ date: "", planItemTitle: "", detail: "" });
  }

  async function saveHistoryEdit(className, historyId) {
    if (!historyEditForm.date || !historyEditForm.planItemTitle.trim()) return;
    const payload = {
      date: historyEditForm.date,
      planItemTitle: historyEditForm.planItemTitle.trim(),
      detail: historyEditForm.detail.trim(),
      updatedAt: new Date().toISOString(),
    };
    await updateDocById("progress_history", historyId, payload);
    setHistoryByClass((prev) => ({
      ...prev,
      [className]: (prev[className] || [])
        .map((h) => (h.id === historyId ? { ...h, ...payload } : h))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")),
    }));
    cancelEditHistory();
  }

  // ===== 반별 진도 요약 및 비교 (순수 계산, AI 미사용) =====
  const progressByClass = useMemo(() => {
    return classesInGrade.map((className) => {
      const checkedIds = checksForPlan
        .filter((c) => isSameClass(c.className, className) && c.completed)
        .map((c) => c.planItemId);
      const stats = analyzeClassProgress(planItems, checkedIds);
      return { className, stats };
    });
  }, [classesInGrade, checksForPlan, planItems]);

  const comparison = useMemo(
    () =>
      compareClassesInGrade(
        progressByClass.map((c) => ({ className: c.className, consecutivePosition: c.stats.consecutivePosition }))
      ),
    [progressByClass]
  );

  // ===== 실제 남은 수업 횟수 - 담당 학년의 실제 담당 반 전체를 한 번에 비교 =====
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(endOfMonthDateString(year, month));
  const [showBasisFor, setShowBasisFor] = useState(null);

  useEffect(() => {
    setDateTo(endOfMonthDateString(year, month));
  }, [year, month]);

  // 기존 calculateRemainingLessons()를 그대로, classesInGrade(실제 담당 반)의 각 반에
  // 반복 적용한다 - 계산 로직 자체는 전혀 새로 만들지 않는다.
  const remainingResults = useMemo(() => {
    if (!dateFrom || !dateTo) return [];
    return classesInGrade.map((className) => ({
      className,
      result: calculateRemainingLessons({
        className,
        grade,
        dateFrom,
        dateTo,
        timetable,
        timetableOverrides,
        schoolDaySchedules: schedules,
        lessonAdjustments: adjustments,
      }),
    }));
  }, [classesInGrade, grade, dateFrom, dateTo, timetable, timetableOverrides, schedules, adjustments]);

  // ===== 학사일정 해석(school_day_schedules) 수동 관리 =====
  const [scheduleForm, setScheduleForm] = useState(emptyScheduleForm);
  const [editingScheduleId, setEditingScheduleId] = useState(null);

  function startEditSchedule(s) {
    setEditingScheduleId(s.id);
    setScheduleForm({
      date: s.date ?? "",
      originalText: s.originalText ?? "",
      status: s.status ?? "needs_review",
      noRegularClasses: !!s.noRegularClasses,
      noClassGrades: (s.noClassGrades || []).join(","),
      scheduleDayOverride: s.scheduleDayOverride ?? "",
      regularPeriods: (s.regularPeriods || []).join(","),
      affectedGrades: (s.affectedGrades || []).join(","),
      affectedPeriods: (s.affectedPeriods || []).join(","),
      memo: s.memo ?? "",
    });
  }

  function resetScheduleForm() {
    setEditingScheduleId(null);
    setScheduleForm(emptyScheduleForm);
  }

  async function submitSchedule(e) {
    e.preventDefault();
    if (!user || !scheduleForm.date || !scheduleForm.originalText) return;
    const now = new Date().toISOString();
    const payload = omitUndefined({
      date: scheduleForm.date,
      originalText: scheduleForm.originalText,
      status: scheduleForm.status,
      noRegularClasses: scheduleForm.noRegularClasses || undefined,
      noClassGrades: parseNumberList(scheduleForm.noClassGrades),
      scheduleDayOverride: scheduleForm.scheduleDayOverride || undefined,
      regularPeriods: parseNumberList(scheduleForm.regularPeriods),
      affectedGrades: parseNumberList(scheduleForm.affectedGrades),
      affectedPeriods: parseNumberList(scheduleForm.affectedPeriods),
      memo: scheduleForm.memo || undefined,
      source: "manual",
      updatedAt: now,
    });

    if (editingScheduleId) {
      await updateDocById("school_day_schedules", editingScheduleId, payload);
    } else {
      await createDoc("school_day_schedules", user.uid, { ...payload, createdAt: now });
    }
    resetScheduleForm();
    reloadSchedules();
  }

  async function removeSchedule(id) {
    await deleteDocById("school_day_schedules", id);
    if (editingScheduleId === id) resetScheduleForm();
    reloadSchedules();
  }

  // ===== 학사일정 파일 업로드 → AI 분석 → 검토 → confirmed만 저장 =====
  // AI 분석 결과는 절대 곧바로 Firestore에 쓰지 않는다. candidates 상태에 담아두고,
  // 사용자가 각 항목을 직접 수정/제외/확정한 뒤 "선택한 항목 저장"을 눌러야만
  // school_day_schedules에 반영된다.
  const [scheduleFile, setScheduleFile] = useState(null);
  const [analyzingSchedule, setAnalyzingSchedule] = useState(false);
  const [scheduleAnalyzeError, setScheduleAnalyzeError] = useState(null);
  const [candidates, setCandidates] = useState(null); // null = 검토할 후보 없음
  const [savingCandidates, setSavingCandidates] = useState(false);

  async function analyzeScheduleFile() {
    if (!scheduleFile) return;
    const format = detectFileFormat(scheduleFile);
    if (format === "unsupported") {
      setScheduleAnalyzeError(
        "현재 지원하지 않는 파일 형식입니다. PDF, Excel(.xlsx/.xls), 이미지(.png/.jpg/.jpeg), Word(.docx) 파일만 선택할 수 있습니다."
      );
      return;
    }

    setAnalyzingSchedule(true);
    setScheduleAnalyzeError(null);
    try {
      let content;
      if (format === "pdf") {
        content = { kind: "inline", base64: await fileToBase64(scheduleFile), mimeType: "application/pdf" };
      } else if (format === "image") {
        content = {
          kind: "inline",
          base64: await fileToBase64(scheduleFile),
          mimeType: scheduleFile.type || "image/png",
        };
      } else if (format === "excel") {
        content = { kind: "text", text: await excelToText(scheduleFile) };
      } else {
        content = { kind: "text", text: await wordToText(scheduleFile) };
      }

      const result = await analyzeAcademicSchedule({ content });
      if (result.length === 0) {
        setScheduleAnalyzeError("문서에서 평소와 다른 특별 일정을 찾지 못했습니다.");
        return;
      }
      setCandidates(result);
    } catch (error) {
      // 개발 진단용 로그. 파일 원문/base64/개인정보/인증정보는 절대 출력하지 않고,
      // 오류 객체 자체의 구조적 정보(이름/메시지/코드/상태/원인 등)만 남긴다.
      // 화면에 보이는 안내 문구는 기존과 동일하게 유지한다.
      console.error("[Academic Schedule Analysis Error]", error);
      console.error("[Academic Schedule Analysis Error Details]", {
        name: error?.name,
        message: error?.message,
        code: error?.code,
        status: error?.status,
        statusCode: error?.statusCode,
        cause: error?.cause,
        customData: error?.customData,
        // Firebase AI SDK 오류의 response 필드는 status/statusText 정도만 뽑아서 남긴다 -
        // 응답 본문 전체를 그대로 찍으면 원문 텍스트가 섞여 나올 수 있어서다.
        response: error?.response
          ? { status: error.response.status, statusText: error.response.statusText }
          : undefined,
        stack: error?.stack,
      });
      setScheduleAnalyzeError("학사일정 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setAnalyzingSchedule(false);
    }
  }

  function cancelCandidates() {
    setScheduleFile(null);
    setScheduleAnalyzeError(null);
    setCandidates(null);
  }

  function updateCandidate(key, patch) {
    setCandidates((prev) => prev.map((c) => (c._key === key ? { ...c, ...patch } : c)));
  }

  function updateCandidateNumberList(key, field, text) {
    const nums = String(text || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter((n) => !Number.isNaN(n));
    updateCandidate(key, { [field]: nums });
  }

  // date + originalText가 기존 school_day_schedules와 같으면 중복 후보로 표시만 하고,
  // 저장 시 무조건 덮어쓰지 않는다 - 사용자가 직접 보고 판단하게 한다.
  function findExistingSchedule(candidate) {
    return schedules.find((s) => s.date === candidate.date && s.originalText === candidate.originalText);
  }

  async function saveConfirmedCandidates() {
    if (!user || !candidates) return;
    setSavingCandidates(true);
    try {
      const now = new Date().toISOString();
      const toSave = candidates.filter((c) => !c.excluded && c.status !== "no_impact");

      for (const c of toSave) {
        const payload = omitUndefined({
          date: c.date,
          originalText: c.originalText,
          status: c.status,
          noRegularClasses: c.noRegularClasses || false,
          noClassGrades: c.noClassGrades || [],
          scheduleDayOverride: c.scheduleDayOverride || undefined,
          regularPeriods: c.regularPeriods || [],
          affectedGrades: c.affectedGrades || [],
          affectedPeriods: c.affectedPeriods || [],
          memo: c.memo || "",
          source: "ai",
          updatedAt: now,
        });
        const existing = findExistingSchedule(c);
        if (existing) {
          // eslint-disable-next-line no-await-in-loop
          await updateDocById("school_day_schedules", existing.id, payload);
        } else {
          // eslint-disable-next-line no-await-in-loop
          await createDoc("school_day_schedules", user.uid, { ...payload, createdAt: now });
        }
      }
      cancelCandidates();
      reloadSchedules();
    } finally {
      setSavingCandidates(false);
    }
  }

  const upcomingNeedsReview = useMemo(
    () => getUpcomingNeedsReviewSchedules(schedules, today, 14),
    [schedules, today]
  );
  const allNeedsReview = useMemo(() => schedules.filter((s) => s.status === "needs_review"), [schedules]);

  // ===== 수동 시수 보정(lesson_adjustments) =====
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustmentForm);
  const [editingAdjustmentId, setEditingAdjustmentId] = useState(null);
  const [editAdjustmentForm, setEditAdjustmentForm] = useState(emptyAdjustmentForm);

  function startEditAdjustment(a) {
    setShowAdjustmentForm(false); // 한 번에 하나의 form만 - 신규 등록 form이 열려 있으면 닫는다.
    setEditingAdjustmentId(a.id);
    setEditAdjustmentForm({
      date: a.date ?? "",
      className: a.className ?? "",
      delta: String(a.delta ?? ""),
      reason: a.reason ?? "",
    });
  }

  function cancelEditAdjustment() {
    setEditingAdjustmentId(null);
    setEditAdjustmentForm(emptyAdjustmentForm);
  }

  function buildAdjustmentPayload(values) {
    return {
      date: values.date,
      className: values.className,
      delta: Number(values.delta),
      reason: values.reason || "",
      updatedAt: new Date().toISOString(),
    };
  }

  async function submitAdjustment(e) {
    e.preventDefault();
    if (!user || !adjustmentForm.date || !adjustmentForm.className || adjustmentForm.delta === "") return;
    const payload = buildAdjustmentPayload(adjustmentForm);
    await createDoc("lesson_adjustments", user.uid, { ...payload, source: "manual", createdAt: payload.updatedAt });
    setAdjustmentForm(emptyAdjustmentForm);
    reloadAdjustments();
  }

  async function submitEditAdjustment(e) {
    e.preventDefault();
    if (!editAdjustmentForm.date || !editAdjustmentForm.className || editAdjustmentForm.delta === "") return;
    // 기존 update 로직 그대로 - Firestore document ID(editingAdjustmentId) 유지.
    await updateDocById("lesson_adjustments", editingAdjustmentId, buildAdjustmentPayload(editAdjustmentForm));
    cancelEditAdjustment();
    reloadAdjustments();
  }

  async function removeAdjustment(id) {
    await deleteDocById("lesson_adjustments", id);
    if (editingAdjustmentId === id) cancelEditAdjustment();
    reloadAdjustments();
  }

  // ===== 탭 UI =====
  // "manage" = 진도 관리, "remaining" = 남은 수업, "schedule" = 학사일정.
  // 탭 전환은 activeTab만 바꾸는 순수 화면 상태다. Firestore 재조회나 기존 state 초기화를
  // 하지 않고(학년/연도/월 선택, 입력 중인 폼 상태 등 그대로 유지), 자동 스크롤도 하지
  // 않는다 - 사용자가 보던 스크롤 위치를 그대로 둔다.
  const [activeTab, setActiveTab] = useState("manage");
  // 큰 탭: "progress"(진도 관리) | "schedule"(학사일정). 기존 activeTab("manage"/"remaining"/
  // "schedule")은 그대로 두고, "progress" 안에서 activeTab이 "manage"/"remaining"을 작은
  // 탭으로 계속 쓴다 - "schedule"일 때는 mainTab이 그 화면을 직접 담당한다.
  const [mainTab, setMainTab] = useState("progress");
  // 반별 진도 현황 accordion - 펼쳐진 학급 집합. 순수 로컬 UI state이고 저장하지 않는다.
  const [expandedProgressClasses, setExpandedProgressClasses] = useState(() => new Set());
  function toggleProgressClassExpanded(className) {
    setExpandedProgressClasses((prev) => {
      const next = new Set(prev);
      if (next.has(className)) next.delete(className);
      else next.add(className);
      return next;
    });
  }
  // 진도계획 보기/편집 모드 - 기본은 보기 모드. 취소 시 draftItems를 planItems 기준으로
  // 다시 계산해서 되돌린다(기존 동기화 useEffect와 같은 매핑을 그대로 재사용).
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  // 수동 보정 / 직접 일정 입력 - 기본은 접힘(compact). 예외적으로 쓰는 기능이라 항상 펼쳐
  // 두지 않는다.
  const [showAdjustmentForm, setShowAdjustmentForm] = useState(false);
  const [showDirectScheduleForm, setShowDirectScheduleForm] = useState(false);
  // 확정된 학사일정 월별 accordion - 펼쳐진 "YYYY-MM" 집합.
  const [expandedScheduleMonths, setExpandedScheduleMonths] = useState(() => new Set());
  function toggleScheduleMonthExpanded(monthKey) {
    setExpandedScheduleMonths((prev) => {
      const next = new Set(prev);
      if (next.has(monthKey)) next.delete(monthKey);
      else next.add(monthKey);
      return next;
    });
  }

  // "확인 필요" 카드에서 바로 누르는 빠른 확정/제외. 내용 자체는 그대로 두고 status만
  // 바꾼다 - 새 상태를 만들지 않고 기존 confirmed/no_impact를 그대로 재사용한다.
  async function quickConfirmSchedule(s) {
    await updateDocById("school_day_schedules", s.id, { status: "confirmed", updatedAt: new Date().toISOString() });
    if (editingScheduleId === s.id) resetScheduleForm();
    reloadSchedules();
  }

  async function quickExcludeSchedule(s) {
    await updateDocById("school_day_schedules", s.id, { status: "no_impact", updatedAt: new Date().toISOString() });
    if (editingScheduleId === s.id) resetScheduleForm();
    reloadSchedules();
  }

  // 학사일정 하나를 등록/수정하는 폼. "직접 입력"(새로 추가)과, 기존 항목을 그 자리에서
  // 바로 고치는 인라인 편집(확인 필요/확정된 일정 목록 둘 다) 양쪽에서 그대로 재사용한다.
  function renderScheduleForm() {
    return (
      <form className="form" onSubmit={submitSchedule}>
        <div className="field">
          <label>날짜</label>
          <input
            type="date"
            value={scheduleForm.date}
            onChange={(e) => setScheduleForm({ ...scheduleForm, date: e.target.value })}
            required
          />
        </div>
        <div className="field field--grow">
          <label>원문</label>
          <input
            placeholder="예: 2,3학년 중간고사"
            value={scheduleForm.originalText}
            onChange={(e) => setScheduleForm({ ...scheduleForm, originalText: e.target.value })}
            required
          />
        </div>
        <div className="field">
          <label>상태</label>
          <select
            value={scheduleForm.status}
            onChange={(e) => setScheduleForm({ ...scheduleForm, status: e.target.value })}
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field field--checkbox">
          <input
            type="checkbox"
            id={`no-regular-${editingScheduleId ?? "new"}`}
            checked={scheduleForm.noRegularClasses}
            onChange={(e) => setScheduleForm({ ...scheduleForm, noRegularClasses: e.target.checked })}
          />
          <label htmlFor={`no-regular-${editingScheduleId ?? "new"}`}>전교 완전 휴업</label>
        </div>
        <div className="field">
          <label>수업 없는 학년(쉼표)</label>
          <input
            placeholder="예: 2,3"
            value={scheduleForm.noClassGrades}
            onChange={(e) => setScheduleForm({ ...scheduleForm, noClassGrades: e.target.value })}
          />
        </div>
        <div className="field">
          <label>다른 요일 시간표 운영</label>
          <select
            value={scheduleForm.scheduleDayOverride}
            onChange={(e) => setScheduleForm({ ...scheduleForm, scheduleDayOverride: e.target.value })}
          >
            <option value="">해당 없음</option>
            {WEEKDAYS.map((d) => (
              <option key={d} value={d}>
                {d}요일 시간표
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>정규수업 인정 교시(쉼표)</label>
          <input
            placeholder="예: 1,2"
            value={scheduleForm.regularPeriods}
            onChange={(e) => setScheduleForm({ ...scheduleForm, regularPeriods: e.target.value })}
          />
        </div>
        <div className="field">
          <label>영향 받는 학년(쉼표, 선택)</label>
          <input
            placeholder="예: 3"
            value={scheduleForm.affectedGrades}
            onChange={(e) => setScheduleForm({ ...scheduleForm, affectedGrades: e.target.value })}
          />
        </div>
        <div className="field">
          <label>영향 받는 교시(쉼표, 선택)</label>
          <input
            placeholder="예: 3,4"
            value={scheduleForm.affectedPeriods}
            onChange={(e) => setScheduleForm({ ...scheduleForm, affectedPeriods: e.target.value })}
          />
        </div>
        <div className="field field--grow">
          <label>메모</label>
          <input value={scheduleForm.memo} onChange={(e) => setScheduleForm({ ...scheduleForm, memo: e.target.value })} />
        </div>
        <div className="form__actions">
          <button type="submit" className="btn">
            {editingScheduleId ? "수정 저장" : "추가"}
          </button>
          {editingScheduleId && (
            <button type="button" className="btn btn--ghost" onClick={resetScheduleForm}>
              취소
            </button>
          )}
        </div>
      </form>
    );
  }

  // 학사일정 카드 하나. 이 항목이 지금 편집 중이면(editingScheduleId === s.id) 그 자리에
  // 바로 편집 폼을 보여준다(인라인 편집) - 페이지 위쪽으로 스크롤할 필요가 없다.
  function renderScheduleCard(s) {
    if (editingScheduleId === s.id) {
      return (
        <div className="list__row" key={s.id} style={{ flexDirection: "column", alignItems: "stretch" }}>
          {renderScheduleForm()}
        </div>
      );
    }

    return (
      <div className="list__row" key={s.id}>
        <div className="list__main">
          <p className="list__title">
            <span
              className={`badge badge--${s.status === "confirmed" ? "done" : s.status === "needs_review" ? "high" : "personal"}`}
            >
              {STATUS_LABEL[s.status] ?? s.status}
            </span>
            {s.date} — {s.originalText}
          </p>
          {s.memo && <p className="list__meta">{s.memo}</p>}
        </div>
        <div className="list__actions">
          {s.status === "needs_review" && (
            <>
              <button className="btn btn--small" onClick={() => quickConfirmSchedule(s)}>
                확정
              </button>
              <button className="btn btn--ghost btn--small" onClick={() => quickExcludeSchedule(s)}>
                제외
              </button>
            </>
          )}
          <button className="btn btn--ghost btn--small" onClick={() => startEditSchedule(s)}>
            수정
          </button>
          <button className="btn btn--danger btn--small" onClick={() => removeSchedule(s.id)}>
            삭제
          </button>
        </div>
      </div>
    );
  }

  const confirmedSchedules = schedules.filter((s) => s.status !== "needs_review");

  return (
    <div className="page progress-page">
      <header className="page__head">
        <h1 className="page__title">수업 진도</h1>
        <p className="page__desc">
          학급별 수업 진도와 남은 수업을 관리하고, 학사일정을 반영해 수업 계획을 확인해요.
        </p>
      </header>

      <div className="pp-main-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "progress"}
          className={"pp-main-tabs__btn" + (mainTab === "progress" ? " pp-main-tabs__btn--active" : "")}
          onClick={() => setMainTab("progress")}
        >
          진도 관리
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mainTab === "schedule"}
          className={"pp-main-tabs__btn" + (mainTab === "schedule" ? " pp-main-tabs__btn--active" : "")}
          onClick={() => setMainTab("schedule")}
        >
          학사일정
          {allNeedsReview.length > 0 && <span className="tt-tabs__badge">{allNeedsReview.length}</span>}
        </button>
      </div>

      {mainTab === "progress" && (
        <>
          <div className="pp-context-bar">
            <span className="pp-context-bar__prefix">조회 기준</span>
            <div className="pp-context-bar__field">
              <label>담당 학년</label>
              <select value={grade} onChange={(e) => setGrade(e.target.value)} disabled={availableGrades.length === 0}>
                {availableGrades.length === 0 ? (
                  <option value="">시간표에 등록된 학급 없음</option>
                ) : (
                  availableGrades.map((g) => (
                    <option key={g} value={g}>
                      {g}학년
                    </option>
                  ))
                )}
              </select>
            </div>
            <div className="pp-context-bar__field">
              <label>연도</label>
              <input value={year} onChange={(e) => setYear(e.target.value)} style={{ width: 72 }} />
            </div>
            <div className="pp-context-bar__field">
              <label>월</label>
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}월
                  </option>
                ))}
              </select>
            </div>
            <span className="pp-context-bar__helper">{year}년 {month}월 계획 기준</span>
          </div>

          <div className="tt-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "manage"}
              className={"tt-tabs__btn" + (activeTab === "manage" ? " tt-tabs__btn--active" : "")}
              onClick={() => setActiveTab("manage")}
            >
              진도 현황
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "remaining"}
              className={"tt-tabs__btn" + (activeTab === "remaining" ? " tt-tabs__btn--active" : "")}
              onClick={() => setActiveTab("remaining")}
            >
              남은 수업
            </button>
          </div>
        </>
      )}

      {loading && <p className="status">불러오는 중…</p>}
      {error && <p className="status status--error">진도 데이터를 불러오지 못했습니다.</p>}

      {!loading && !error && (
        <div className="progress-tab-content">
      {mainTab === "progress" && activeTab === "manage" && (
            <>
          <section className="page__section">
            <div className="progress-plan__head">
              <h2 className="section__title">{year}년 {month}월 진도계획 ({grade}학년)</h2>
              {!isEditingPlan && (
                <button type="button" className="btn-text" onClick={() => setIsEditingPlan(true)}>
                  편집
                </button>
              )}
            </div>

            {!isEditingPlan ? (
              <ul className="progress-plan__view-list">
                {draftItems.length === 0 && <p className="list--empty">등록된 진도 항목이 없습니다.</p>}
                {draftItems.map((row, i) => (
                  <li key={row._key} className="progress-plan__view-item">
                    <span className="progress-plan__view-index">{i + 1}</span>
                    <span className="progress-plan__view-title">{row.title || "(제목 없음)"}</span>
                    {row.estimatedLessons !== "" && (
                      <span className="progress-plan__view-lessons">{row.estimatedLessons}차시</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <>
                <div className="pp-plan-edit">
                  <div className="pp-plan-edit__head">
                    <span className="pp-plan-edit__head-title">차시명</span>
                    <span className="pp-plan-edit__head-lessons">차시</span>
                  </div>
                  {draftItems.map((row, i) => (
                    <div className="pp-plan-edit__row" key={row._key}>
                      <input
                        className="pp-plan-edit__title"
                        value={row.title}
                        onChange={(e) => updateDraftRow(row._key, { title: e.target.value })}
                        placeholder="예: 영양소"
                        aria-label="차시명"
                      />
                      <span className="pp-plan-edit__lessons">
                        <input
                          type="number"
                          min="0"
                          value={row.estimatedLessons}
                          onChange={(e) => updateDraftRow(row._key, { estimatedLessons: e.target.value })}
                          aria-label="차시"
                        />
                        <span className="pp-plan-edit__lessons-suffix">차시</span>
                      </span>
                      <div className="pp-plan-edit__actions">
                        <button
                          type="button"
                          className="pp-plan-edit__btn"
                          disabled={i === 0}
                          onClick={() => moveDraftRow(row._key, -1)}
                          aria-label="위로 이동"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="pp-plan-edit__btn"
                          disabled={i === draftItems.length - 1}
                          onClick={() => moveDraftRow(row._key, 1)}
                          aria-label="아래로 이동"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="pp-plan-edit__btn pp-plan-edit__btn--danger"
                          onClick={() => removeDraftRow(row._key)}
                        >
                          삭제
                        </button>
                      </div>
                    </div>
                  ))}
                  {draftItems.length === 0 && <p className="list--empty">등록된 진도 항목이 없습니다.</p>}
                </div>
                <div className="form__actions" style={{ marginTop: 12 }}>
                  <button className="btn btn--ghost" type="button" onClick={addDraftRow}>
                    + 항목 추가
                  </button>
                  <button className="btn" type="button" onClick={savePlanItems} disabled={savingPlan}>
                    {savingPlan ? "저장 중…" : "저장"}
                  </button>
                  <button className="btn btn--ghost" type="button" onClick={cancelEditPlan} disabled={savingPlan}>
                    취소
                  </button>
                </div>
              </>
            )}
          </section>
          <section className="page__section">
            <h2 className="section__title">반별 진도 체크표</h2>
            {classesInGrade.length === 0 && (
              <p className="list--empty">이 학년의 학급이 시간표에 없습니다. 먼저 시간표를 등록해 주세요.</p>
            )}
            {planItems.length === 0 && classesInGrade.length > 0 && (
              <p className="list--empty">먼저 위에서 진도계획을 저장해 주세요.</p>
            )}
            {classesInGrade.length > 0 && planItems.length > 0 && (
              <div className="progress-matrix__wrap">
                <table className="progress-matrix">
                  <thead>
                    <tr>
                      <th className="progress-matrix__corner">학급</th>
                      {planItems.map((p) => (
                        <th key={p.id}>{p.title}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {classesInGrade.map((className) => (
                      <tr key={className}>
                        <th className="progress-matrix__rowhead">{formatClassShortName(className)}</th>
                        {planItems.map((p) => {
                          const detail = inProgressDetail(p.id, className);
                          const done = isChecked(p.id, className);
                          return (
                            <td key={p.id}>
                              <button
                                type="button"
                                className={`progress-matrix__check${done ? " progress-matrix__check--done" : ""}${
                                  !done && detail !== null ? " progress-matrix__check--progress" : ""
                                }`}
                                onClick={() => toggleCheck(p.id, className)}
                                title={!done && detail ? `진행 중: ${detail}` : undefined}
                              >
                                {done ? "✓" : detail !== null ? <ProgressIcon /> : ""}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {classesInGrade.length > 0 && planItems.length > 0 && (
              <div className="pp-legend">
                <span className="pp-legend__item">
                  <span className="progress-matrix__check progress-matrix__check--done pp-legend__swatch">✓</span>
                  완료
                </span>
                <span className="pp-legend__item">
                  <span className="progress-matrix__check progress-matrix__check--progress pp-legend__swatch">
                    <ProgressIcon />
                  </span>
                  진행 중
                </span>
                <span className="pp-legend__item">
                  <span className="progress-matrix__check pp-legend__swatch" />
                  예정
                </span>
              </div>
            )}
          </section>
          {classesInGrade.length > 0 && planItems.length > 0 && (
            <section className="page__section">
              <h2 className="section__title">반별 진도 현황</h2>
              <div className="progress-accordion">
                {progressByClass.map(({ className, stats }) => {
                  const gapMsg = comparison.messages.find((m) => isSameClass(m.className, className));
                  const current = currents.find((c) => isSameClass(c.className, className));
                  const isEditingCurrent = currentEditFor === className;
                  const remainingItemsForClass = planItems.filter((p) => !isChecked(p.id, className));
                  const expanded = expandedProgressClasses.has(className);
                  const statusLabel = current
                    ? `${current.planItemTitle} 진행 중`
                    : stats.currentItem
                    ? `${stats.currentItem.title} 완료`
                    : "시작 전";
                  return (
                    <div className="progress-accordion__item" key={className}>
                      <button
                        type="button"
                        className="progress-accordion__summary"
                        onClick={() => toggleProgressClassExpanded(className)}
                        aria-expanded={expanded}
                      >
                        <span className="progress-accordion__name">{formatClassShortName(className)}</span>
                        <span className="progress-accordion__status">
                          {statusLabel}
                          {current?.detail && <span className="progress-accordion__detail"> · {current.detail}</span>}
                          {!current && stats.nextItem && (
                            <span className="progress-accordion__next"> · 다음 {stats.nextItem.title}</span>
                          )}
                        </span>
                        <span className="progress-accordion__remaining">{stats.remainingPlanItems}개 남음</span>
                        <span className="progress-accordion__chevron" aria-hidden="true">
                          {expanded ? "∧" : "∨"}
                        </span>
                      </button>

                      {expanded && (
                        <div className="progress-accordion__panel">
                          <p className="list__title">{formatClassName(className)}</p>
                          <p className="list__meta">
                            현재: {stats.currentItem?.title ?? "시작 전"} · 다음: {stats.nextItem?.title ?? "없음"} ·{" "}
                            {month}월 계획 {stats.remainingPlanItems}개 항목 남음
                            {stats.estimatedRemainingLessons != null &&
                              ` · 예상 필요 차시 ${stats.estimatedRemainingLessons}차시`}
                          </p>
                          {current && (
                            <p className="list__meta" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                              <span>
                                <ProgressIcon /> 진행 중: {current.planItemTitle}
                                {current.detail && ` — "${current.detail}"`}
                              </span>
                              <button
                                type="button"
                                className="btn btn--ghost btn--small"
                                onClick={() => deleteCurrentProgress(className)}
                                disabled={savingCurrent}
                              >
                                진행 중 삭제
                              </button>
                            </p>
                          )}
                          {gapMsg && <p className="list__meta">{gapMsg.text}</p>}

                          <div className="form__actions" style={{ marginTop: 6 }}>
                            {!isEditingCurrent && (
                              <button
                                className="btn btn--ghost btn--small"
                                onClick={() => openCurrentEditor(className)}
                                disabled={remainingItemsForClass.length === 0}
                              >
                                진행 중 설정
                              </button>
                            )}
                            <button className="btn btn--ghost btn--small" onClick={() => toggleHistory(className)}>
                              {historyOpenFor === className ? "최근 기록 닫기" : "최근 기록"}
                            </button>
                          </div>

                          {isEditingCurrent && (
                            <div className="form" style={{ marginTop: 8 }}>
                              <div className="field">
                                <label>진행 중인 항목</label>
                                <select
                                  value={currentEditForm.planItemId}
                                  onChange={(e) => setCurrentEditForm({ ...currentEditForm, planItemId: e.target.value })}
                                >
                                  <option value="">선택</option>
                                  {remainingItemsForClass.map((p) => (
                                    <option key={p.id} value={p.id}>
                                      {p.title}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div className="field field--grow">
                                <label>세부 진도</label>
                                <input
                                  placeholder="예: 지방의 기능까지"
                                  value={currentEditForm.detail}
                                  onChange={(e) => setCurrentEditForm({ ...currentEditForm, detail: e.target.value })}
                                />
                              </div>
                              <div className="form__actions">
                                <button
                                  className="btn btn--small"
                                  disabled={!currentEditForm.planItemId || savingCurrent}
                                  onClick={() => saveCurrentProgress(className)}
                                >
                                  {savingCurrent ? "저장 중…" : "저장"}
                                </button>
                                {current && (
                                  <button
                                    type="button"
                                    className="btn btn--danger btn--small"
                                    onClick={() => deleteCurrentProgress(className)}
                                    disabled={savingCurrent}
                                  >
                                    진행 중 삭제
                                  </button>
                                )}
                                <button className="btn btn--ghost btn--small" onClick={closeCurrentEditor} disabled={savingCurrent}>
                                  취소
                                </button>
                              </div>
                              <p className="list__meta">
                                선택한 항목 이전까지는 완료로 처리되고, 선택한 항목은 진행 중으로 기록됩니다.
                              </p>
                            </div>
                          )}

                          {historyOpenFor === className && (
                            <div className="progress-history" style={{ marginTop: 8 }}>
                              {historyLoading && !historyByClass[className] && (
                                <p className="list__meta">불러오는 중…</p>
                              )}
                              {historyByClass[className]?.length === 0 && (
                                <p className="list__meta">기록이 없습니다.</p>
                              )}
                              {historyByClass[className]?.map((h) => {
                                if (editingHistoryId === h.id) {
                                  return (
                                    <div key={h.id} className="form" style={{ marginBottom: 8 }}>
                                      <div className="field">
                                        <label>수업일</label>
                                        <input
                                          type="date"
                                          value={historyEditForm.date}
                                          onChange={(e) => setHistoryEditForm({ ...historyEditForm, date: e.target.value })}
                                        />
                                      </div>
                                      <div className="field field--grow">
                                        <label>진도 항목</label>
                                        <select
                                          value={historyEditForm.planItemTitle}
                                          onChange={(e) =>
                                            setHistoryEditForm({ ...historyEditForm, planItemTitle: e.target.value })
                                          }
                                        >
                                          {historyEditForm.planItemTitle &&
                                            !planItems.some((p) => p.title === historyEditForm.planItemTitle) && (
                                              <option value={historyEditForm.planItemTitle}>
                                                {historyEditForm.planItemTitle} (현재 값)
                                              </option>
                                            )}
                                          {planItems.map((p) => (
                                            <option key={p.id} value={p.title}>
                                              {p.title}
                                            </option>
                                          ))}
                                        </select>
                                      </div>
                                      <div className="field field--grow">
                                        <label>세부 진도</label>
                                        <input
                                          placeholder="예: 필수 지방산까지"
                                          value={historyEditForm.detail}
                                          onChange={(e) =>
                                            setHistoryEditForm({ ...historyEditForm, detail: e.target.value })
                                          }
                                        />
                                      </div>
                                      <div className="form__actions">
                                        <button
                                          type="button"
                                          className="btn btn--small"
                                          disabled={!historyEditForm.date || !historyEditForm.planItemTitle.trim()}
                                          onClick={() => saveHistoryEdit(className, h.id)}
                                        >
                                          저장
                                        </button>
                                        <button type="button" className="btn btn--ghost btn--small" onClick={cancelEditHistory}>
                                          취소
                                        </button>
                                      </div>
                                    </div>
                                  );
                                }

                                if (confirmDeleteHistoryId === h.id) {
                                  return (
                                    <p
                                      className="list__meta"
                                      key={h.id}
                                      style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                                    >
                                      <span>
                                        "{formatDateDisplay(h.date)} · {h.planItemTitle}" 기록을 정말 삭제할까요?
                                      </span>
                                      <span style={{ display: "flex", gap: 6 }}>
                                        <button
                                          type="button"
                                          className="btn btn--danger btn--small"
                                          onClick={() => deleteHistoryEntry(className, h.id)}
                                        >
                                          삭제
                                        </button>
                                        <button
                                          type="button"
                                          className="btn btn--ghost btn--small"
                                          onClick={() => setConfirmDeleteHistoryId(null)}
                                        >
                                          취소
                                        </button>
                                      </span>
                                    </p>
                                  );
                                }

                                return (
                                  <p
                                    className="list__meta"
                                    key={h.id}
                                    style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                                  >
                                    <span>
                                      {formatDateDisplay(h.date)} · {h.planItemTitle}
                                      {h.detail ? ` — "${h.detail}"` : " 완료"}
                                    </span>
                                    <span style={{ display: "flex", gap: 6 }}>
                                      <button
                                        type="button"
                                        className="btn btn--ghost btn--small"
                                        onClick={() => startEditHistory(h)}
                                      >
                                        수정
                                      </button>
                                      <button
                                        type="button"
                                        className="btn btn--ghost btn--small"
                                        onClick={() => setConfirmDeleteHistoryId(h.id)}
                                      >
                                        삭제
                                      </button>
                                    </span>
                                  </p>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {comparison.messages.length === 0 && classesInGrade.length > 1 && (
                <p className="list--empty">학급 간 진도 차이가 확인되지 않습니다.</p>
              )}
            </section>
          )}
            </>
          )}

      {mainTab === "progress" && activeTab === "remaining" && (
            <>
          <section className="page__section">
            <h2 className="section__title">실제 남은 수업 횟수</h2>
            <div className="pp-remaining-range">
              <span className="pp-remaining-range__label">기간</span>
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <span aria-hidden="true">→</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            {classesInGrade.length === 0 && (
              <p className="list--empty">이 학년에 담당하는 학급이 없습니다.</p>
            )}

            <div className="remaining-grid">
              {remainingResults.map(({ className, result }) => {
                const estimated =
                  progressByClass.find((c) => isSameClass(c.className, className))?.stats
                    .estimatedRemainingLessons ?? null;
                const balance = estimated == null ? null : computeLessonBalance(result.total, estimated);
                const basisOpen = showBasisFor === className;

                return (
                  <div className="remaining-card" key={className}>
                    <p className="remaining-card__title">{formatClassName(className)}</p>

                    <div className="remaining-card__rows">
                      <div className="remaining-card__row">
                        <span className="remaining-card__label">남은 실제 수업</span>
                        <span className="remaining-card__value remaining-card__value--main">{result.total}회</span>
                      </div>
                      {estimated != null && (
                        <div className="remaining-card__row">
                          <span className="remaining-card__label">계획상 필요</span>
                          <span className="remaining-card__value">{estimated}차시</span>
                        </div>
                      )}
                      {balance != null && (
                        <div className="remaining-card__row">
                          <span className="remaining-card__label">예상 결과</span>
                          <span className={"remaining-card__value" + (balance < 0 ? " remaining-card__value--short" : "")}>
                            {balance > 0 ? `${balance}차시 여유` : balance < 0 ? `${Math.abs(balance)}차시 부족` : "적정"}
                          </span>
                        </div>
                      )}
                    </div>

                    {result.unresolvedSchedules.length > 0 && (
                      <p className="status status--error">
                        ⚠ 수업 영향 미확정 일정 {result.unresolvedSchedules.length}건
                      </p>
                    )}

                    <button
                      type="button"
                      className="remaining-card__basis-toggle"
                      onClick={() => setShowBasisFor(basisOpen ? null : className)}
                      aria-expanded={basisOpen}
                    >
                      계산 근거 {basisOpen ? "숨기기 ⌃" : "보기 〉"}
                    </button>

                    {basisOpen && (
                      <div className="progress-basis">
                        <p className="progress-basis__row">
                          <span>기본 시간표 기준</span>
                          <span>{result.baseCount}회</span>
                        </p>
                        {result.basis.map((b, i) => (
                          <p className="progress-basis__row" key={i}>
                            <span>
                              {b.date} {b.label}
                            </span>
                            <span>{b.delta >= 0 ? `+${b.delta}` : b.delta}</span>
                          </p>
                        ))}
                        <p className="progress-basis__row progress-basis__row--total">
                          <span>최종</span>
                          <span>{result.total}회</span>
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
          <section className="page__section">
            <div className="progress-plan__head">
              <h2 className="section__title">수업 횟수 수동 보정</h2>
              {!showAdjustmentForm && (
                <button
                  type="button"
                  className="btn-text"
                  onClick={() => {
                    cancelEditAdjustment();
                    setShowAdjustmentForm(true);
                  }}
                >
                  + 보정 추가
                </button>
              )}
            </div>
            <p className="section__helper">학사일정에 없던 갑작스러운 수업 증감을 직접 기록해요. 시간표 자체는 바뀌지 않습니다.</p>

            {showAdjustmentForm && (
              <form className="form" onSubmit={(e) => { submitAdjustment(e); setShowAdjustmentForm(false); }}>
                <div className="field">
                  <label>날짜</label>
                  <input
                    type="date"
                    value={adjustmentForm.date}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, date: e.target.value })}
                    required
                  />
                </div>
                <div className="field">
                  <label>학급</label>
                  <select
                    value={adjustmentForm.className}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, className: e.target.value })}
                    required
                  >
                    <option value="">선택</option>
                    {allOwnedClasses.map((c) => (
                      <option key={c} value={c}>
                        {formatClassName(c)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>변화량</label>
                  <input
                    type="number"
                    placeholder="예: -1 또는 1"
                    value={adjustmentForm.delta}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, delta: e.target.value })}
                    required
                  />
                </div>
                <div className="field field--grow">
                  <label>이유</label>
                  <input
                    placeholder="예: 학교행사"
                    value={adjustmentForm.reason}
                    onChange={(e) => setAdjustmentForm({ ...adjustmentForm, reason: e.target.value })}
                  />
                </div>
                <div className="form__actions">
                  <button type="submit" className="btn">
                    추가
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setAdjustmentForm(emptyAdjustmentForm);
                      setShowAdjustmentForm(false);
                    }}
                  >
                    취소
                  </button>
                </div>
              </form>
            )}

            <div className="compact-list">
              {adjustments.length === 0 && <p className="list--empty">등록된 수동 보정이 없습니다.</p>}
              {adjustments.map((a) =>
                editingAdjustmentId === a.id ? (
                  // 이 보정 기록이 원래 있던 바로 그 행 자리에서 수정 form으로 전환된다.
                  <form className="form compact-list__edit-form" key={a.id} onSubmit={submitEditAdjustment}>
                    <div className="field">
                      <label>날짜</label>
                      <input
                        type="date"
                        value={editAdjustmentForm.date}
                        onChange={(e) => setEditAdjustmentForm({ ...editAdjustmentForm, date: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field">
                      <label>학급</label>
                      <select
                        value={editAdjustmentForm.className}
                        onChange={(e) => setEditAdjustmentForm({ ...editAdjustmentForm, className: e.target.value })}
                        required
                      >
                        <option value="">선택</option>
                        {allOwnedClasses.map((c) => (
                          <option key={c} value={c}>
                            {formatClassName(c)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>변화량</label>
                      <input
                        type="number"
                        value={editAdjustmentForm.delta}
                        onChange={(e) => setEditAdjustmentForm({ ...editAdjustmentForm, delta: e.target.value })}
                        required
                      />
                    </div>
                    <div className="field field--grow">
                      <label>이유</label>
                      <input
                        value={editAdjustmentForm.reason}
                        onChange={(e) => setEditAdjustmentForm({ ...editAdjustmentForm, reason: e.target.value })}
                      />
                    </div>
                    <div className="form__actions">
                      <button type="submit" className="btn">
                        저장
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={cancelEditAdjustment}>
                        취소
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="compact-list__row" key={a.id}>
                    <div className="compact-list__main">
                      <p className="compact-list__title">
                        {a.date} · {formatClassName(a.className)} · {a.delta >= 0 ? `+${a.delta}` : a.delta}차시
                      </p>
                      {a.reason && <p className="compact-list__meta">{a.reason}</p>}
                    </div>
                    <div className="compact-list__actions">
                      <button className="btn-text" onClick={() => startEditAdjustment(a)}>
                        수정
                      </button>
                      <button className="btn-text btn-text--danger" onClick={() => removeAdjustment(a.id)}>
                        삭제
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>
            </>
          )}

      {mainTab === "schedule" && (
            <>
          <section className="page__section">
            <h2 className="section__title">학사일정 관리</h2>
            <p className="page__desc" style={{ marginBottom: 12 }}>
              평소와 다르게 수업이 운영되는 날짜만 등록합니다. 확실하지 않은 일정은 "추후 확인
              필요"로 남겨두세요.
            </p>

            {allNeedsReview.length > 0 && (
              <div className="pp-notice">
                <h3 className="section__title" style={{ fontSize: 14 }}>
                  확인이 필요한 일정 {allNeedsReview.length}건
                  {upcomingNeedsReview.length > 0 && ` · 14일 이내 ${upcomingNeedsReview.length}건`}
                </h3>
                <div className="list">{allNeedsReview.map((s) => renderScheduleCard(s))}</div>
              </div>
            )}

            <h3 className="section__title" style={{ fontSize: 14 }}>연간 학사일정 분석</h3>
            <div className="form" style={{ marginBottom: 16 }}>
              <div className="field field--grow">
                <label>연간 학사일정 파일 (원본 그대로)</label>
                <input
                  type="file"
                  accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.docx"
                  onChange={(e) => {
                    setScheduleFile(e.target.files?.[0] ?? null);
                    setScheduleAnalyzeError(null);
                  }}
                />
                {scheduleFile && (
                  <p className="list__meta">
                    {scheduleFile.name} · {FILE_FORMAT_LABEL[detectFileFormat(scheduleFile)]}
                  </p>
                )}
              </div>
              <div className="form__actions">
                <button
                  type="button"
                  className="btn"
                  disabled={!scheduleFile || analyzingSchedule || !!candidates}
                  onClick={analyzeScheduleFile}
                >
                  {analyzingSchedule ? "분석 중…" : "분석하기"}
                </button>
              </div>
            </div>
            {scheduleAnalyzeError && <p className="status status--error">{scheduleAnalyzeError}</p>}

            {candidates && (
              <div style={{ marginBottom: 20 }}>
                <p className="list__meta" style={{ marginBottom: 8 }}>
                  AI가 찾은 특별 일정 후보입니다. 아직 저장되지 않았습니다 - 항목별로 확인/수정하고
                  "선택한 항목 저장"을 눌러야 반영됩니다.
                </p>
                <div className="list">
                  {candidates.map((c) => {
                    const dup = findExistingSchedule(c);
                    return (
                      <div
                        className="list__row"
                        key={c._key}
                        style={{ flexDirection: "column", alignItems: "stretch", opacity: c.excluded ? 0.5 : 1 }}
                      >
                        <p className="list__title">
                          {c.date} — 원문: &ldquo;{c.originalText}&rdquo;
                          {dup && <span className="list__meta"> (기존 항목과 동일한 날짜·원문 — 저장 시 그 항목을 덮어씁니다)</span>}
                        </p>
                        <div className="form" style={{ marginBottom: 4 }}>
                          <div className="field">
                            <label>상태</label>
                            <select value={c.status} onChange={(e) => updateCandidate(c._key, { status: e.target.value })}>
                              {STATUS_OPTIONS.map((s) => (
                                <option key={s.value} value={s.value}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field field--checkbox">
                            <input
                              type="checkbox"
                              id={`cand-noreg-${c._key}`}
                              checked={c.noRegularClasses}
                              onChange={(e) => updateCandidate(c._key, { noRegularClasses: e.target.checked })}
                            />
                            <label htmlFor={`cand-noreg-${c._key}`}>전교 완전 휴업</label>
                          </div>
                          <div className="field">
                            <label>수업 없는 학년</label>
                            <input
                              defaultValue={c.noClassGrades.join(",")}
                              onBlur={(e) => updateCandidateNumberList(c._key, "noClassGrades", e.target.value)}
                              placeholder="예: 2,3"
                            />
                          </div>
                          <div className="field">
                            <label>요일 대체</label>
                            <select
                              value={c.scheduleDayOverride}
                              onChange={(e) => updateCandidate(c._key, { scheduleDayOverride: e.target.value })}
                            >
                              <option value="">해당 없음</option>
                              {WEEKDAYS.map((d) => (
                                <option key={d} value={d}>
                                  {d}요일 시간표
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="field">
                            <label>정규수업 교시</label>
                            <input
                              defaultValue={c.regularPeriods.join(",")}
                              onBlur={(e) => updateCandidateNumberList(c._key, "regularPeriods", e.target.value)}
                              placeholder="예: 1,2"
                            />
                          </div>
                          <div className="field">
                            <label>영향 학년</label>
                            <input
                              defaultValue={c.affectedGrades.join(",")}
                              onBlur={(e) => updateCandidateNumberList(c._key, "affectedGrades", e.target.value)}
                              placeholder="예: 3"
                            />
                          </div>
                          <div className="field">
                            <label>영향 교시</label>
                            <input
                              defaultValue={c.affectedPeriods.join(",")}
                              onBlur={(e) => updateCandidateNumberList(c._key, "affectedPeriods", e.target.value)}
                              placeholder="예: 3,4"
                            />
                          </div>
                          <div className="field field--grow">
                            <label>메모</label>
                            <input
                              value={c.memo}
                              onChange={(e) => updateCandidate(c._key, { memo: e.target.value })}
                            />
                          </div>
                        </div>
                        <div className="form__actions">
                          <button
                            type="button"
                            className="btn btn--ghost btn--small"
                            onClick={() => updateCandidate(c._key, { excluded: !c.excluded })}
                          >
                            {c.excluded ? "제외 취소" : "이 항목 제외"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="form__actions" style={{ marginTop: 12 }}>
                  <button className="btn" onClick={saveConfirmedCandidates} disabled={savingCandidates}>
                    {savingCandidates ? "저장 중…" : "선택한 항목 저장"}
                  </button>
                  <button className="btn btn--ghost" onClick={cancelCandidates} disabled={savingCandidates}>
                    취소
                  </button>
                </div>
              </div>
            )}

            <div className="progress-plan__head">
              <h3 className="section__title" style={{ fontSize: 14, marginBottom: 0 }}>직접 일정 추가</h3>
              {editingScheduleId === null && !showDirectScheduleForm && (
                <button type="button" className="btn-text" onClick={() => setShowDirectScheduleForm(true)}>
                  + 일정 추가
                </button>
              )}
            </div>
            {editingScheduleId === null ? (
              showDirectScheduleForm && renderScheduleForm()
            ) : (
              <p className="list__meta">
                다른 일정을 수정하는 중입니다. 수정을 취소하면 새 일정을 추가할 수 있습니다.
              </p>
            )}

            <h3 className="section__title" style={{ fontSize: 14, marginTop: 20 }}>확정된 학사일정</h3>
            {confirmedSchedules.length === 0 && <p className="list--empty">등록된 학사일정이 없습니다.</p>}
            {confirmedSchedules.length > 0 && (
              <div className="pp-month-accordion">
                {Object.entries(
                  confirmedSchedules.reduce((groups, s) => {
                    const key = s.date.slice(0, 7); // "YYYY-MM"
                    (groups[key] ??= []).push(s);
                    return groups;
                  }, {})
                )
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([monthKey, items]) => {
                    const monthExpanded = expandedScheduleMonths.has(monthKey);
                    const [, m] = monthKey.split("-");
                    return (
                      <div className="pp-month-accordion__item" key={monthKey}>
                        <button
                          type="button"
                          className="pp-month-accordion__summary"
                          onClick={() => toggleScheduleMonthExpanded(monthKey)}
                          aria-expanded={monthExpanded}
                        >
                          <span>{Number(m)}월</span>
                          <span className="pp-month-accordion__count">{items.length}건</span>
                          <span aria-hidden="true">{monthExpanded ? "∧" : "∨"}</span>
                        </button>
                        {monthExpanded && (
                          <div className="list">{items.map((s) => renderScheduleCard(s))}</div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
