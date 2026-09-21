import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { deleteAllInCollection } from "../firebase/resetData";
import { analyzeTimetableDocument, analyzeHomeroomTimetableDocument } from "../ai/timetableAnalysis";
import { getSettings } from "../firebase/settingsService";
import { fileToBase64 } from "../utils/fileToBase64";
import { detectFileFormat, FILE_FORMAT_LABEL } from "../utils/fileFormat";
import { excelToText } from "../utils/excelToText";
import { wordToText } from "../utils/wordToText";
import { WEEKDAYS, PERIODS } from "../utils/constants";
import { formatClassName } from "../utils/progressComparison";
import { getEffectiveDayTimetable } from "../utils/effectiveTimetable";
import { buildSwapPayloads, buildMovePayloads } from "../utils/timetableChangeService";
import { todayDateString, formatDateDisplay, weekdayKoreanOf } from "../utils/date";
import { useFieldErrors, isBlank } from "../utils/formValidation";
import Modal from "../components/Modal";
import FieldError from "../components/FieldError";
import "./crud-shared.css";
import "./TimetablePage.css";

const emptyCellForm = { className: "", subject: "" };
const emptyOverrideForm = { date: "", period: PERIODS[0], className: "", subject: "", memo: "" };
const emptyHrCellForm = { subject: "", teacher: "" };

function validateCellForm(values) {
  const errors = {};
  if (isBlank(values.className)) errors.className = "학급을 입력해 주세요.";
  return errors;
}

function validateHrCellForm(values) {
  const errors = {};
  if (isBlank(values.subject)) errors.subject = "과목을 입력해 주세요.";
  return errors;
}

function validateOverrideForm(values) {
  const errors = {};
  if (isBlank(values.date)) errors.date = "날짜를 선택해 주세요.";
  if (isBlank(values.className)) errors.className = "학급을 입력해 주세요.";
  return errors;
}

export default function TimetablePage() {
  const { user } = useAuth();
  const [timetable, setTimetable] = useState([]);
  const [overrides, setOverrides] = useState([]);
  const [schoolDaySchedules, setSchoolDaySchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [selectedCell, setSelectedCell] = useState(null); // { dayOfWeek, period }
  const [cellForm, setCellForm] = useState(emptyCellForm);
  const cellErrors = useFieldErrors();
  const onCellFormChange = cellErrors.withErrorClearing(setCellForm);

  const [overrideForm, setOverrideForm] = useState(emptyOverrideForm);
  const [editingOverrideId, setEditingOverrideId] = useState(null);
  const overrideErrors = useFieldErrors();
  const onOverrideFormChange = overrideErrors.withErrorClearing(setOverrideForm);

  // 시간표 가져오기(PDF/이미지/엑셀/워드) - 분석 결과는 미리보기 상태로만 두고,
  // 사용자가 "시간표 등록"을 눌러야 실제로 Firestore에 반영된다.
  const [importFile, setImportFile] = useState(null);
  const [importAnalyzing, setImportAnalyzing] = useState(false);
  const [importError, setImportError] = useState(null);
  const [previewEntries, setPreviewEntries] = useState(null); // null = 미리보기 없음

  const [selectedPreviewCell, setSelectedPreviewCell] = useState(null);
  const [previewCellForm, setPreviewCellForm] = useState(emptyCellForm);
  const previewCellErrors = useFieldErrors();
  const onPreviewCellFormChange = previewCellErrors.withErrorClearing(setPreviewCellForm);

  const [showOverwriteConfirm, setShowOverwriteConfirm] = useState(false);
  const [registering, setRegistering] = useState(false);

  async function analyzeImport() {
    if (!importFile) return;
    const format = detectFileFormat(importFile);
    if (format === "unsupported") {
      setImportError(
        "현재 지원하지 않는 파일 형식입니다. PDF, Excel(.xlsx/.xls), 이미지(.png/.jpg/.jpeg), Word(.docx) 파일만 선택할 수 있습니다."
      );
      return;
    }

    setImportAnalyzing(true);
    setImportError(null);
    try {
      let content;
      if (format === "pdf") {
        content = { kind: "inline", base64: await fileToBase64(importFile), mimeType: "application/pdf" };
      } else if (format === "image") {
        content = {
          kind: "inline",
          base64: await fileToBase64(importFile),
          mimeType: importFile.type || "image/png",
        };
      } else if (format === "excel") {
        content = { kind: "text", text: await excelToText(importFile) };
      } else {
        content = { kind: "text", text: await wordToText(importFile) };
      }

      const entries = await analyzeTimetableDocument({ content });
      setPreviewEntries(entries.map((e, i) => ({ ...e, _key: `preview-${i}` })));
    } catch {
      setImportError("시간표 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setImportAnalyzing(false);
    }
  }

  function cancelImport() {
    setImportFile(null);
    setImportError(null);
    setPreviewEntries(null);
    setSelectedPreviewCell(null);
  }

  function previewCellEntry(dayOfWeek, period) {
    return previewEntries?.find((e) => e.dayOfWeek === dayOfWeek && e.period === period);
  }

  function openPreviewCell(dayOfWeek, period) {
    const entry = previewCellEntry(dayOfWeek, period);
    setSelectedPreviewCell({ dayOfWeek, period });
    previewCellErrors.clearAll();
    setPreviewCellForm(
      entry ? { className: entry.className ?? "", subject: entry.subject ?? "" } : emptyCellForm
    );
  }

  function savePreviewCell(e) {
    e.preventDefault();
    if (!selectedPreviewCell) return;
    const { dayOfWeek, period } = selectedPreviewCell;
    const existing = previewCellEntry(dayOfWeek, period);

    // 아무것도 입력하지 않고 저장을 누르면 "이 칸은 비워둔다"는 뜻으로 받아들인다 -
    // 학급만 입력하고 저장하려는 경우와 구분하기 위해, 완전히 빈 경우에만 조용히 닫는다.
    if (isBlank(previewCellForm.className) && isBlank(previewCellForm.subject)) {
      setSelectedPreviewCell(null);
      return;
    }
    if (!previewCellErrors.runValidation(validateCellForm(previewCellForm))) return;

    setPreviewEntries((prev) => {
      const rest = prev.filter((en) => !(en.dayOfWeek === dayOfWeek && en.period === period));
      return [
        ...rest,
        {
          dayOfWeek,
          period,
          className: previewCellForm.className,
          subject: previewCellForm.subject,
          _key: existing?._key ?? `preview-new-${dayOfWeek}-${period}`,
        },
      ];
    });
    setSelectedPreviewCell(null);
  }

  function clearPreviewCell() {
    if (!selectedPreviewCell) return;
    const { dayOfWeek, period } = selectedPreviewCell;
    setPreviewEntries((prev) => prev.filter((en) => !(en.dayOfWeek === dayOfWeek && en.period === period)));
    setSelectedPreviewCell(null);
    previewCellErrors.clearAll();
  }

  function requestRegister() {
    if (timetable.length > 0) {
      setShowOverwriteConfirm(true);
    } else {
      performRegister();
    }
  }

  async function performRegister() {
    setRegistering(true);
    try {
      if (timetable.length > 0) {
        await deleteAllInCollection("timetable", user.uid);
      }
      for (const entry of previewEntries) {
        // eslint-disable-next-line no-await-in-loop
        await createDoc("timetable", user.uid, {
          dayOfWeek: entry.dayOfWeek,
          period: entry.period,
          className: entry.className,
          subject: entry.subject,
        });
      }
      setShowOverwriteConfirm(false);
      cancelImport();
      loadAll();
    } finally {
      setRegistering(false);
    }
  }

  async function loadAll() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [tt, ov, sch] = await Promise.all([
        listDocsByOwner("timetable", user.uid),
        listDocsByOwner("timetable_overrides", user.uid),
        listDocsByOwner("school_day_schedules", user.uid),
      ]);
      setTimetable(tt);
      setOverrides(ov.sort((a, b) => (a.date > b.date ? 1 : -1)));
      setSchoolDaySchedules(sch);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  // override 추가/수정/삭제(맞교환/이동/취소/추가) 후에는 전체 loadAll() 대신 이것만
  // 다시 불러온다 - 진도 기능에서 이미 겪은 "저장할 때마다 화면이 통째로 언마운트되며
  // 스크롤이 튀는" 문제를 시간표에서도 반복하지 않기 위해서다.
  async function reloadOverrides() {
    if (!user) return;
    try {
      const ov = await listDocsByOwner("timetable_overrides", user.uid);
      setOverrides(ov.sort((a, b) => (a.date > b.date ? 1 : -1)));
    } catch (e) {
      console.error("[Timetable] timetable_overrides 재조회 실패:", e);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // 담임 학급 시간표 - "내 수업 시간표"와 완전히 분리된 별도 상태/컬렉션(homeroom_timetable).
  // 담임으로 설정된 사용자에게만 탭이 나타난다.
  const [view, setView] = useState("mine"); // "mine" | "homeroom"
  const [mineSubTab, setMineSubTab] = useState("basic"); // "basic" | "changes" ("mine" 안에서만 쓰는 상위 탭)

  // "기본 시간표" 탭에서 셀을 선택해 편집하던 중 다른 내부 탭으로 넘어가면, 그 셀은 더 이상
  // 화면에 보이지 않는데도 selectedCell/cellForm state는 그대로 남아 있었다 - 다시 "기본
  // 시간표"로 돌아오면 예전에 열려 있던 편집 폼이 그대로 다시 나타나는 문제가 있었다.
  // 탭을 옮길 때 "편집 대상과 강하게 연결된" state만 정리한다 - 새로 등록 중인 일시
  // 변경(overrideForm)이나 미리보기(previewEntries) draft는 건드리지 않는다.
  function resetMineEditState() {
    setSelectedCell(null);
    setCellForm(emptyCellForm);
    cellErrors.clearAll();
    cancelEditOverride();
  }

  function resetHomeroomEditState() {
    setHrSelectedCell(null);
    setHrCellForm(emptyHrCellForm);
    hrCellErrors.clearAll();
  }

  function handleSetMineSubTab(tab) {
    resetMineEditState();
    setMineSubTab(tab);
  }

  function handleSetView(nextView) {
    resetMineEditState();
    resetHomeroomEditState();
    setView(nextView);
  }
  const [isHomeroomTeacher, setIsHomeroomTeacher] = useState(false);
  const [homeroomClass, setHomeroomClass] = useState("");

  const [hrEntries, setHrEntries] = useState([]);
  const [hrLoading, setHrLoading] = useState(false);
  const [hrError, setHrError] = useState(null);

  const [hrSelectedCell, setHrSelectedCell] = useState(null);
  const [hrCellForm, setHrCellForm] = useState(emptyHrCellForm);
  const hrCellErrors = useFieldErrors();
  const onHrCellFormChange = hrCellErrors.withErrorClearing(setHrCellForm);

  const [hrImportFile, setHrImportFile] = useState(null);
  const [hrImportAnalyzing, setHrImportAnalyzing] = useState(false);
  const [hrImportError, setHrImportError] = useState(null);
  const [hrPreviewEntries, setHrPreviewEntries] = useState(null);
  const [hrSelectedPreviewCell, setHrSelectedPreviewCell] = useState(null);
  const [hrPreviewCellForm, setHrPreviewCellForm] = useState(emptyHrCellForm);
  const hrPreviewCellErrors = useFieldErrors();
  const onHrPreviewCellFormChange = hrPreviewCellErrors.withErrorClearing(setHrPreviewCellForm);
  const [hrShowOverwriteConfirm, setHrShowOverwriteConfirm] = useState(false);
  const [hrRegistering, setHrRegistering] = useState(false);

  async function loadHomeroom() {
    if (!user) return;
    setHrLoading(true);
    setHrError(null);
    try {
      const docs = await listDocsByOwner("homeroom_timetable", user.uid);
      setHrEntries(docs);
    } catch (e) {
      setHrError(e);
    } finally {
      setHrLoading(false);
    }
  }

  useEffect(() => {
    if (!user) return;
    getSettings(user.uid)
      .then((s) => {
        setIsHomeroomTeacher(!!s.isHomeroomTeacher);
        setHomeroomClass(s.homeroomClass || "");
        if (s.isHomeroomTeacher) loadHomeroom();
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function hrCellEntry(dayOfWeek, period) {
    return hrEntries.find((t) => t.dayOfWeek === dayOfWeek && t.period === period);
  }

  function openHrCell(dayOfWeek, period) {
    const entry = hrCellEntry(dayOfWeek, period);
    setHrSelectedCell({ dayOfWeek, period });
    hrCellErrors.clearAll();
    setHrCellForm(entry ? { subject: entry.subject ?? "", teacher: entry.teacher ?? "" } : emptyHrCellForm);
  }

  async function saveHrCell(e) {
    e.preventDefault();
    if (!hrSelectedCell) return;
    if (!hrCellErrors.runValidation(validateHrCellForm(hrCellForm))) return;
    const { dayOfWeek, period } = hrSelectedCell;
    const entry = hrCellEntry(dayOfWeek, period);

    if (entry) {
      await updateDocById("homeroom_timetable", entry.id, { ...hrCellForm });
    } else {
      await createDoc("homeroom_timetable", user.uid, { dayOfWeek, period, ...hrCellForm });
    }
    setHrSelectedCell(null);
    setHrCellForm(emptyHrCellForm);
    loadHomeroom();
  }

  async function clearHrCell() {
    if (!hrSelectedCell) return;
    const entry = hrCellEntry(hrSelectedCell.dayOfWeek, hrSelectedCell.period);
    if (entry) await deleteDocById("homeroom_timetable", entry.id);
    setHrSelectedCell(null);
    setHrCellForm(emptyHrCellForm);
    hrCellErrors.clearAll();
    loadHomeroom();
  }

  async function analyzeHrImport() {
    if (!hrImportFile) return;
    const format = detectFileFormat(hrImportFile);
    if (format === "unsupported") {
      setHrImportError(
        "현재 지원하지 않는 파일 형식입니다. PDF, Excel(.xlsx/.xls), 이미지(.png/.jpg/.jpeg), Word(.docx) 파일만 선택할 수 있습니다."
      );
      return;
    }

    setHrImportAnalyzing(true);
    setHrImportError(null);
    try {
      let content;
      if (format === "pdf") {
        content = { kind: "inline", base64: await fileToBase64(hrImportFile), mimeType: "application/pdf" };
      } else if (format === "image") {
        content = {
          kind: "inline",
          base64: await fileToBase64(hrImportFile),
          mimeType: hrImportFile.type || "image/png",
        };
      } else if (format === "excel") {
        content = { kind: "text", text: await excelToText(hrImportFile) };
      } else {
        content = { kind: "text", text: await wordToText(hrImportFile) };
      }

      const entries = await analyzeHomeroomTimetableDocument({ content, homeroomClass });
      if (entries.length === 0) {
        setHrImportError(
          `문서에서 ${homeroomClass} 학급의 시간표를 찾지 못했습니다. 학급 표기가 정확한지, 파일에 이 학급의 시간표가 포함되어 있는지 확인해 주세요.`
        );
        return;
      }
      setHrPreviewEntries(entries.map((e, i) => ({ ...e, _key: `hr-preview-${i}` })));
    } catch {
      setHrImportError("시간표 분석에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setHrImportAnalyzing(false);
    }
  }

  function cancelHrImport() {
    setHrImportFile(null);
    setHrImportError(null);
    setHrPreviewEntries(null);
    setHrSelectedPreviewCell(null);
  }

  function hrPreviewCellEntry(dayOfWeek, period) {
    return hrPreviewEntries?.find((e) => e.dayOfWeek === dayOfWeek && e.period === period);
  }

  function openHrPreviewCell(dayOfWeek, period) {
    const entry = hrPreviewCellEntry(dayOfWeek, period);
    setHrSelectedPreviewCell({ dayOfWeek, period });
    hrPreviewCellErrors.clearAll();
    setHrPreviewCellForm(
      entry ? { subject: entry.subject ?? "", teacher: entry.teacher ?? "" } : emptyHrCellForm
    );
  }

  function saveHrPreviewCell(e) {
    e.preventDefault();
    if (!hrSelectedPreviewCell) return;
    const { dayOfWeek, period } = hrSelectedPreviewCell;
    const existing = hrPreviewCellEntry(dayOfWeek, period);

    // 아무것도 입력하지 않고 저장을 누르면 "이 칸은 비워둔다"는 뜻으로 받아들인다.
    if (isBlank(hrPreviewCellForm.subject) && isBlank(hrPreviewCellForm.teacher)) {
      setHrSelectedPreviewCell(null);
      return;
    }
    if (!hrPreviewCellErrors.runValidation(validateHrCellForm(hrPreviewCellForm))) return;

    setHrPreviewEntries((prev) => {
      const rest = prev.filter((en) => !(en.dayOfWeek === dayOfWeek && en.period === period));
      return [
        ...rest,
        {
          dayOfWeek,
          period,
          subject: hrPreviewCellForm.subject,
          teacher: hrPreviewCellForm.teacher,
          _key: existing?._key ?? `hr-preview-new-${dayOfWeek}-${period}`,
        },
      ];
    });
    setHrSelectedPreviewCell(null);
  }

  function clearHrPreviewCell() {
    if (!hrSelectedPreviewCell) return;
    const { dayOfWeek, period } = hrSelectedPreviewCell;
    setHrPreviewEntries((prev) => prev.filter((en) => !(en.dayOfWeek === dayOfWeek && en.period === period)));
    setHrSelectedPreviewCell(null);
    hrPreviewCellErrors.clearAll();
  }

  function requestHrRegister() {
    if (hrEntries.length > 0) {
      setHrShowOverwriteConfirm(true);
    } else {
      performHrRegister();
    }
  }

  async function performHrRegister() {
    setHrRegistering(true);
    try {
      if (hrEntries.length > 0) {
        await deleteAllInCollection("homeroom_timetable", user.uid);
      }
      for (const entry of hrPreviewEntries) {
        // eslint-disable-next-line no-await-in-loop
        await createDoc("homeroom_timetable", user.uid, {
          dayOfWeek: entry.dayOfWeek,
          period: entry.period,
          subject: entry.subject,
          teacher: entry.teacher,
        });
      }
      setHrShowOverwriteConfirm(false);
      cancelHrImport();
      loadHomeroom();
    } finally {
      setHrRegistering(false);
    }
  }

  function cellEntry(dayOfWeek, period) {
    return timetable.find((t) => t.dayOfWeek === dayOfWeek && t.period === period);
  }

  function openCell(dayOfWeek, period) {
    const entry = cellEntry(dayOfWeek, period);
    setSelectedCell({ dayOfWeek, period });
    cellErrors.clearAll();
    setCellForm(entry ? { className: entry.className ?? "", subject: entry.subject ?? "" } : emptyCellForm);
  }

  async function saveCell(e) {
    e.preventDefault();
    if (!selectedCell) return;
    if (!cellErrors.runValidation(validateCellForm(cellForm))) return;
    const { dayOfWeek, period } = selectedCell;
    const entry = cellEntry(dayOfWeek, period);

    if (entry) {
      await updateDocById("timetable", entry.id, { ...cellForm });
    } else {
      await createDoc("timetable", user.uid, { dayOfWeek, period, ...cellForm });
    }
    setSelectedCell(null);
    setCellForm(emptyCellForm);
    loadAll();
  }

  async function clearCell() {
    if (!selectedCell) return;
    const entry = cellEntry(selectedCell.dayOfWeek, selectedCell.period);
    if (entry) await deleteDocById("timetable", entry.id);
    setSelectedCell(null);
    setCellForm(emptyCellForm);
    cellErrors.clearAll();
    loadAll();
  }

  const [editOverrideForm, setEditOverrideForm] = useState(emptyOverrideForm);
  const editOverrideErrors = useFieldErrors();
  const onEditOverrideFormChange = editOverrideErrors.withErrorClearing(setEditOverrideForm);

  function startEditOverride(o) {
    setEditingOverrideId(o.id);
    editOverrideErrors.clearAll();
    setEditOverrideForm({
      date: o.date ?? "",
      period: o.period ?? PERIODS[0],
      className: o.className ?? "",
      subject: o.subject ?? "",
      memo: o.memo ?? "",
    });
  }

  function cancelEditOverride() {
    setEditingOverrideId(null);
    setEditOverrideForm(emptyOverrideForm);
    editOverrideErrors.clearAll();
  }

  async function submitOverride(e) {
    e.preventDefault();
    if (!overrideErrors.runValidation(validateOverrideForm(overrideForm))) return;
    const payload = { ...overrideForm, period: Number(overrideForm.period) };
    await createDoc("timetable_overrides", user.uid, payload);
    setOverrideForm(emptyOverrideForm);
    loadAll();
  }

  async function submitEditOverride(e) {
    e.preventDefault();
    if (!editOverrideErrors.runValidation(validateOverrideForm(editOverrideForm))) return;
    // 기존 update 로직 그대로 - Firestore document ID(editingOverrideId) 유지.
    const payload = { ...editOverrideForm, period: Number(editOverrideForm.period) };
    await updateDocById("timetable_overrides", editingOverrideId, payload);
    cancelEditOverride();
    loadAll();
  }

  async function removeOverride(id) {
    await deleteDocById("timetable_overrides", id);
    if (editingOverrideId === id) cancelEditOverride();
    reloadOverrides();
  }

  // ===== 빠른 변경(맞교환/이동/취소/추가) =====
  // 학사일정 요일대체까지 반영한 "그날 기준 시간표"(getEffectiveDayTimetable)를 먼저
  // 계산한 뒤, 그 위에서 교시를 선택하게 한다 - 기획서 9장의 "학사일정 적용 후 맞교환"
  // 순서를 그대로 지킨다.
  const [quickDate, setQuickDate] = useState(todayDateString());
  const [quickChangeType, setQuickChangeType] = useState("swap"); // swap | move | cancel | add
  const [swapPeriodA, setSwapPeriodA] = useState("");
  const [swapPeriodB, setSwapPeriodB] = useState("");
  const [moveFromPeriod, setMoveFromPeriod] = useState("");
  const [moveToDate, setMoveToDate] = useState("");
  const [moveToPeriod, setMoveToPeriod] = useState("");
  const [moveConflict, setMoveConflict] = useState(null);
  const [cancelPeriod, setCancelPeriod] = useState("");
  const [addPeriod, setAddPeriod] = useState("");
  const [addClassName, setAddClassName] = useState("");
  const [addSubject, setAddSubject] = useState("");
  const [quickChangeError, setQuickChangeError] = useState(null);
  const [applyingQuickChange, setApplyingQuickChange] = useState(false);

  const quickDayTimetable = getEffectiveDayTimetable(quickDate, {
    timetable,
    timetableOverrides: overrides,
    schoolDaySchedules,
  });
  const quickDayOccupiedPeriods = quickDayTimetable.periods.filter((p) => p.className);

  // "수업 이동"의 이동 대상 날짜. 비워두면(아직 고르지 않았으면) 원래 날짜와 같은 날로
  // 본다 - 같은 날짜 안에서 교시만 옮기는 기존 동작과 자연스럽게 이어진다. 대상 날짜도
  // 반드시 getEffectiveDayTimetable()로 계산해야 한다 - 그 날짜에 학사일정 요일대체나
  // 이미 있는 개인 변경이 반영된 실제 시간표를 기준으로 충돌을 판단해야 하기 때문이다.
  const effectiveMoveToDate = moveToDate || quickDate;
  const moveTargetDayTimetable = getEffectiveDayTimetable(effectiveMoveToDate, {
    timetable,
    timetableOverrides: overrides,
    schoolDaySchedules,
  });


  async function applySwap() {
    setQuickChangeError(null);
    const a = quickDayTimetable.periods.find((p) => String(p.period) === String(swapPeriodA));
    const b = quickDayTimetable.periods.find((p) => String(p.period) === String(swapPeriodB));

    const result = buildSwapPayloads(quickDate, a, b);
    if (!result.ok) {
      setQuickChangeError(result.reason);
      return;
    }

    setApplyingQuickChange(true);
    try {
      await Promise.all(result.payloads.map((payload) => createDoc("timetable_overrides", user.uid, payload)));
      setSwapPeriodA("");
      setSwapPeriodB("");
      reloadOverrides();
    } finally {
      setApplyingQuickChange(false);
    }
  }

  function checkMoveConflict() {
    setMoveConflict(null);
    setQuickChangeError(null);
    const from = quickDayTimetable.periods.find((p) => String(p.period) === String(moveFromPeriod));
    if (!from || !from.className) {
      setQuickChangeError("이동할 수업을 선택해 주세요.");
      return;
    }
    if (!moveToPeriod) {
      setQuickChangeError("이동할 교시를 선택해 주세요.");
      return;
    }
    const target = moveTargetDayTimetable.periods.find((p) => String(p.period) === String(moveToPeriod));

    const result = buildMovePayloads({
      sourceDate: quickDate,
      sourcePeriod: from.period,
      source: from,
      destinationDate: effectiveMoveToDate,
      destinationPeriod: Number(moveToPeriod),
      destination: target,
    });

    if (!result.ok) {
      if (result.conflict) {
        setMoveConflict(result.conflict);
      } else {
        setQuickChangeError(result.reason);
      }
      return;
    }

    applyMove(result.payloads);
  }

  async function applyMove(payloads) {
    setApplyingQuickChange(true);
    try {
      await Promise.all(payloads.map((payload) => createDoc("timetable_overrides", user.uid, payload)));
      setMoveFromPeriod("");
      setMoveToDate("");
      setMoveToPeriod("");
      setMoveConflict(null);
      reloadOverrides();
    } finally {
      setApplyingQuickChange(false);
    }
  }

  async function applyMoveAsSwap() {
    // 이동하려던 교시에 이미 수업이 있을 때, 같은 날짜 안에서는 "맞교환으로 변경"을
    // 제안한다. 날짜가 다르면 맞교환 개념 자체가 아직 없으므로 이 선택지를 주지 않는다
    // (호출하는 쪽에서 같은 날짜일 때만 버튼을 보여준다).
    setSwapPeriodA(moveFromPeriod);
    setSwapPeriodB(moveToPeriod);
    setQuickChangeType("swap");
    setMoveFromPeriod("");
    setMoveToDate("");
    setMoveToPeriod("");
    setMoveConflict(null);
  }

  async function applyCancel() {
    setQuickChangeError(null);
    const target = quickDayTimetable.periods.find((p) => String(p.period) === String(cancelPeriod));
    if (!target || !target.className) {
      setQuickChangeError("취소할 교시를 선택해 주세요.");
      return;
    }
    setApplyingQuickChange(true);
    try {
      await createDoc("timetable_overrides", user.uid, {
        date: quickDate,
        period: target.period,
        className: "",
        changeType: "cancel",
      });
      setCancelPeriod("");
      reloadOverrides();
    } finally {
      setApplyingQuickChange(false);
    }
  }

  async function applyAdd() {
    setQuickChangeError(null);
    if (!addPeriod || !addClassName.trim()) {
      setQuickChangeError("교시와 학급을 모두 입력해 주세요.");
      return;
    }
    const existing = quickDayTimetable.periods.find((p) => String(p.period) === String(addPeriod));
    if (existing && existing.className) {
      setQuickChangeError(`${addPeriod}교시에는 이미 ${formatClassName(existing.className)} 수업이 있습니다.`);
      return;
    }
    setApplyingQuickChange(true);
    try {
      await createDoc("timetable_overrides", user.uid, {
        date: quickDate,
        period: Number(addPeriod),
        className: addClassName.trim(),
        subject: addSubject.trim(),
        changeType: "add",
      });
      setAddPeriod("");
      setAddClassName("");
      setAddSubject("");
      reloadOverrides();
    } finally {
      setApplyingQuickChange(false);
    }
  }

  // ===== 일시 변경 목록 (changeGroupId 기준으로 하나의 사용자 작업으로 묶는다) =====
  // 맞교환/날짜 간 이동처럼 override 2건이 한 changeGroupId를 공유하면 하나의 카드로,
  // 취소/추가처럼 changeGroupId가 없는 단일 override는 그 자체로 하나의 카드로 다룬다.
  // 학사일정만으로 요일이 바뀐(개인 override는 없는) 날짜도 별도 카드로 함께 보여준다.
  const [showPastChanges, setShowPastChanges] = useState(false);
  const [expandedChangeKeys, setExpandedChangeKeys] = useState(() => new Set());
  const today = todayDateString();

  function toggleChangeExpanded(key) {
    setExpandedChangeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const overrideChangeGroups = (() => {
    const seen = new Set();
    const groups = [];
    for (const o of overrides) {
      const key = o.changeGroupId || `single-${o.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const members = o.changeGroupId ? overrides.filter((x) => x.changeGroupId === o.changeGroupId) : [o];
      const dates = [...new Set(members.map((m) => m.date))].sort();
      groups.push({ kind: "override", key, changeType: o.changeType || null, members, dates, sortDate: dates[0] });
    }
    return groups;
  })();

  const scheduleOnlyDates = [
    ...new Set(
      schoolDaySchedules.filter((s) => s.status === "confirmed" && s.scheduleDayOverride).map((s) => s.date)
    ),
  ].filter((d) => !overrides.some((o) => o.date === d));

  const allChangeItems = [
    ...overrideChangeGroups,
    ...scheduleOnlyDates.map((d) => ({ kind: "schedule", key: `sch-${d}`, dates: [d], sortDate: d })),
  ];

  const upcomingChangeItems = allChangeItems
    .filter((c) => c.dates.some((d) => d >= today))
    .sort((a, b) => a.sortDate.localeCompare(b.sortDate));
  const pastChangeItems = allChangeItems
    .filter((c) => !c.dates.some((d) => d >= today))
    .sort((a, b) => b.sortDate.localeCompare(a.sortDate));

  // 취소(cancel)처럼 override의 className이 비어 있는 경우, "원래 무슨 수업이었는지"는
  // 그 override 하나만 뺀 상태로 다시 계산해서 알아낸다 - 별도 저장 없이 항상 최신 기준
  // 시간표에서 구한다.
  function classNameBeforeOverride(date, period, excludeOverrideId) {
    const filtered = overrides.filter((o) => o.id !== excludeOverrideId);
    const day = getEffectiveDayTimetable(date, { timetable, timetableOverrides: filtered, schoolDaySchedules });
    return day.periods.find((p) => p.period === period)?.className || null;
  }

  async function removeChangeGroup(group) {
    await Promise.all(group.members.map((m) => deleteDocById("timetable_overrides", m.id)));
    reloadOverrides();
  }

  return (
    <div className="page timetable-page">
      <header className="page__head">
        <h1 className="page__title">시간표</h1>
        <p className="page__desc">수업 시간표를 확인하고 필요한 날짜의 변경 사항을 관리해보세요.</p>
      </header>

      {isHomeroomTeacher && (
        <div className="tt-view-switch">
          <button
            type="button"
            className={"tt-view-switch__btn" + (view === "mine" ? " tt-view-switch__btn--active" : "")}
            onClick={() => handleSetView("mine")}
          >
            내 수업 시간표
          </button>
          <button
            type="button"
            className={"tt-view-switch__btn" + (view === "homeroom" ? " tt-view-switch__btn--active" : "")}
            onClick={() => handleSetView("homeroom")}
          >
            {homeroomClass ? `${homeroomClass} 학급 시간표` : "담임 학급 시간표"}
          </button>
        </div>
      )}

      {loading && <p className="status">불러오는 중…</p>}
      {error && <p className="status status--error">시간표를 불러오지 못했습니다.</p>}

      {!loading && !error && view === "mine" && (
        <>
          <div className="tt-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mineSubTab === "basic"}
              className={"tt-tabs__btn" + (mineSubTab === "basic" ? " tt-tabs__btn--active" : "")}
              onClick={() => handleSetMineSubTab("basic")}
            >
              기본 시간표
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mineSubTab === "changes"}
              className={"tt-tabs__btn" + (mineSubTab === "changes" ? " tt-tabs__btn--active" : "")}
              onClick={() => handleSetMineSubTab("changes")}
            >
              일시 변경
              {upcomingChangeItems.length > 0 && (
                <span className="tt-tabs__badge">{upcomingChangeItems.length}</span>
              )}
            </button>
          </div>

          {mineSubTab === "basic" && (
            <>
              <section className="page__section">
                <h2 className="section__title">기본 시간표</h2>

            <table className="timetable-grid">
              <thead>
                <tr>
                  <th className="timetable-grid__corner">교시</th>
                  {WEEKDAYS.map((day) => (
                    <th key={day}>{day}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {PERIODS.map((period) => (
                  <tr key={period}>
                    <th className="timetable-grid__period">{period}</th>
                    {WEEKDAYS.map((day) => {
                      const entry = cellEntry(day, period);
                      const isSelected =
                        selectedCell?.dayOfWeek === day && selectedCell?.period === period;
                      return (
                        <td key={day} data-day={day}>
                          <button
                            type="button"
                            className={
                              "timetable-grid__cell" +
                              (entry ? " timetable-grid__cell--filled" : "") +
                              (isSelected ? " timetable-grid__cell--selected" : "")
                            }
                            onClick={() => openCell(day, period)}
                          >
                            {entry ? (
                              <>
                                <span className="timetable-grid__class">{formatClassName(entry.className)}</span>
                                <span className="timetable-grid__subject">{entry.subject}</span>
                              </>
                            ) : (
                              <span className="timetable-grid__empty">＋</span>
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>

            {selectedCell && (
              <form className="form" onSubmit={saveCell} style={{ marginTop: 16 }} noValidate>
                <div className="field">
                  <label>{selectedCell.dayOfWeek}요일 · {selectedCell.period}교시</label>
                </div>
                <div className={"field" + (cellErrors.errors.className ? " field--invalid" : "")}>
                  <label htmlFor="tt-cell-className">학급</label>
                  <input
                    id="tt-cell-className"
                    ref={cellErrors.registerField("className")}
                    autoFocus
                    aria-invalid={!!cellErrors.errors.className}
                    aria-describedby={cellErrors.errors.className ? "tt-cell-className-error" : undefined}
                    placeholder="예: 3-2"
                    value={cellForm.className}
                    onChange={(e) => onCellFormChange({ ...cellForm, className: e.target.value })}
                  />
                  <FieldError id="tt-cell-className-error" message={cellErrors.errors.className} />
                </div>
                <div className="field field--grow">
                  <label htmlFor="tt-cell-subject">과목</label>
                  <input
                    id="tt-cell-subject"
                    placeholder="예: 기술·가정"
                    value={cellForm.subject}
                    onChange={(e) => onCellFormChange({ ...cellForm, subject: e.target.value })}
                  />
                </div>
                <div className="form__actions">
                  <button type="submit" className="btn">저장</button>
                  {cellEntry(selectedCell.dayOfWeek, selectedCell.period) && (
                    <button type="button" className="btn btn--danger" onClick={clearCell}>
                      삭제
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => {
                      setSelectedCell(null);
                      setCellForm(emptyCellForm);
                      cellErrors.clearAll();
                    }}
                  >
                    취소
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="page__section">
            <h2 className="section__title">시간표 가져오기</h2>
            <p className="page__desc" style={{ marginBottom: 12 }}>
              학교 시간표 파일(PDF, Excel, 이미지, Word)을 선택하면 AI가 요일·교시별 학급/과목을
              읽어 미리보기로 보여줍니다. 확인하고 수정한 뒤 "시간표 등록"을 눌러야 실제로
              저장됩니다.
            </p>

            {!previewEntries && (
              <div className="form">
                <div className="field field--grow">
                  <label>시간표 파일</label>
                  <input
                    type="file"
                    accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.docx"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] ?? null);
                      setImportError(null);
                    }}
                  />
                  {importFile && (
                    <p className="list__meta">
                      {importFile.name} · {FILE_FORMAT_LABEL[detectFileFormat(importFile)]}
                    </p>
                  )}
                </div>
                <div className="form__actions">
                  <button
                    type="button"
                    className="btn"
                    disabled={!importFile || importAnalyzing}
                    onClick={analyzeImport}
                  >
                    {importAnalyzing ? "분석 중…" : "분석하기"}
                  </button>
                </div>
              </div>
            )}

            {importError && (
              <p className="status status--error" role="alert">
                {importError}
              </p>
            )}

            {previewEntries && (
              <>
                <p className="list__meta" style={{ marginBottom: 8 }}>
                  미리보기입니다. 잘못 인식된 칸은 눌러서 수정하거나 비워두세요. 아직 저장되지
                  않았습니다.
                </p>

                <table className="timetable-grid">
                  <thead>
                    <tr>
                      <th className="timetable-grid__corner">교시</th>
                      {WEEKDAYS.map((day) => (
                        <th key={day}>{day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERIODS.map((period) => (
                      <tr key={period}>
                        <th className="timetable-grid__period">{period}</th>
                        {WEEKDAYS.map((day) => {
                          const entry = previewCellEntry(day, period);
                          const isSelected =
                            selectedPreviewCell?.dayOfWeek === day &&
                            selectedPreviewCell?.period === period;
                          return (
                            <td key={day} data-day={day}>
                              <button
                                type="button"
                                className={
                                  "timetable-grid__cell" +
                                  (entry ? " timetable-grid__cell--filled" : "") +
                                  (isSelected ? " timetable-grid__cell--selected" : "")
                                }
                                onClick={() => openPreviewCell(day, period)}
                              >
                                {entry ? (
                                  <>
                                    <span className="timetable-grid__class">{formatClassName(entry.className)}</span>
                                    <span className="timetable-grid__subject">{entry.subject}</span>
                                  </>
                                ) : (
                                  <span className="timetable-grid__empty">＋</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {selectedPreviewCell && (
                  <form className="form" onSubmit={savePreviewCell} style={{ marginTop: 16 }} noValidate>
                    <div className="field">
                      <label>
                        {selectedPreviewCell.dayOfWeek}요일 · {selectedPreviewCell.period}교시
                      </label>
                    </div>
                    <div className={"field" + (previewCellErrors.errors.className ? " field--invalid" : "")}>
                      <label htmlFor="tt-preview-className">학급</label>
                      <input
                        id="tt-preview-className"
                        ref={previewCellErrors.registerField("className")}
                        autoFocus
                        aria-invalid={!!previewCellErrors.errors.className}
                        aria-describedby={previewCellErrors.errors.className ? "tt-preview-className-error" : undefined}
                        placeholder="예: 3-2"
                        value={previewCellForm.className}
                        onChange={(e) =>
                          onPreviewCellFormChange({ ...previewCellForm, className: e.target.value })
                        }
                      />
                      <FieldError id="tt-preview-className-error" message={previewCellErrors.errors.className} />
                    </div>
                    <div className="field field--grow">
                      <label htmlFor="tt-preview-subject">과목</label>
                      <input
                        id="tt-preview-subject"
                        placeholder="예: 기술·가정"
                        value={previewCellForm.subject}
                        onChange={(e) =>
                          onPreviewCellFormChange({ ...previewCellForm, subject: e.target.value })
                        }
                      />
                    </div>
                    <div className="form__actions">
                      <button type="submit" className="btn">
                        적용
                      </button>
                      {previewCellEntry(selectedPreviewCell.dayOfWeek, selectedPreviewCell.period) && (
                        <button type="button" className="btn btn--danger" onClick={clearPreviewCell}>
                          비우기
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => {
                          setSelectedPreviewCell(null);
                          previewCellErrors.clearAll();
                        }}
                      >
                        취소
                      </button>
                    </div>
                  </form>
                )}

                <div className="form__actions" style={{ marginTop: 16 }}>
                  <button className="btn" disabled={registering} onClick={requestRegister}>
                    {registering ? "등록하는 중…" : "시간표 등록"}
                  </button>
                  <button className="btn btn--ghost" disabled={registering} onClick={cancelImport}>
                    취소
                  </button>
                </div>
              </>
            )}
          </section>
            </>
          )}

          {mineSubTab === "changes" && (
            <>
          <section className="page__section">
            <h2 className="section__title">일시적 변경</h2>

            <form className="form" onSubmit={submitOverride} noValidate>
              <div className={"field" + (overrideErrors.errors.date ? " field--invalid" : "")}>
                <label htmlFor="tt-override-date">날짜</label>
                <input
                  id="tt-override-date"
                  ref={overrideErrors.registerField("date")}
                  type="date"
                  aria-invalid={!!overrideErrors.errors.date}
                  aria-describedby={overrideErrors.errors.date ? "tt-override-date-error" : undefined}
                  value={overrideForm.date}
                  onChange={(e) => onOverrideFormChange({ ...overrideForm, date: e.target.value })}
                />
                <FieldError id="tt-override-date-error" message={overrideErrors.errors.date} />
              </div>
              <div className="field">
                <label htmlFor="tt-override-period">교시</label>
                <select
                  id="tt-override-period"
                  value={overrideForm.period}
                  onChange={(e) => onOverrideFormChange({ ...overrideForm, period: e.target.value })}
                >
                  {PERIODS.map((p) => (
                    <option key={p} value={p}>
                      {p}교시
                    </option>
                  ))}
                </select>
              </div>
              <div className={"field" + (overrideErrors.errors.className ? " field--invalid" : "")}>
                <label htmlFor="tt-override-className">학급</label>
                <input
                  id="tt-override-className"
                  ref={overrideErrors.registerField("className")}
                  aria-invalid={!!overrideErrors.errors.className}
                  aria-describedby={overrideErrors.errors.className ? "tt-override-className-error" : undefined}
                  placeholder="예: 3-2"
                  value={overrideForm.className}
                  onChange={(e) => onOverrideFormChange({ ...overrideForm, className: e.target.value })}
                />
                <FieldError id="tt-override-className-error" message={overrideErrors.errors.className} />
              </div>
              <div className="field">
                <label htmlFor="tt-override-subject">변경 과목(선택)</label>
                <input
                  id="tt-override-subject"
                  placeholder="비워두면 기존 과목 유지"
                  value={overrideForm.subject}
                  onChange={(e) => onOverrideFormChange({ ...overrideForm, subject: e.target.value })}
                />
              </div>
              <div className="field field--grow">
                <label htmlFor="tt-override-memo">메모</label>
                <input
                  id="tt-override-memo"
                  placeholder="예: 체육대회로 5교시 휴강"
                  value={overrideForm.memo}
                  onChange={(e) => onOverrideFormChange({ ...overrideForm, memo: e.target.value })}
                />
              </div>
              <div className="form__actions">
                <button type="submit" className="btn">
                  추가
                </button>
              </div>
            </form>

            <div className="list">
              {overrides.length === 0 && <p className="list--empty">등록된 일시적 변경이 없습니다.</p>}
              {overrides.map((o) =>
                editingOverrideId === o.id ? (
                  // 이 항목이 원래 있던 바로 그 행 자리에서 수정 form으로 전환된다.
                  <form className="form" key={o.id} onSubmit={submitEditOverride} noValidate>
                    <div className={"field" + (editOverrideErrors.errors.date ? " field--invalid" : "")}>
                      <label htmlFor="tt-edit-override-date">날짜</label>
                      <input
                        id="tt-edit-override-date"
                        ref={editOverrideErrors.registerField("date")}
                        type="date"
                        aria-invalid={!!editOverrideErrors.errors.date}
                        aria-describedby={editOverrideErrors.errors.date ? "tt-edit-override-date-error" : undefined}
                        value={editOverrideForm.date}
                        onChange={(e) => onEditOverrideFormChange({ ...editOverrideForm, date: e.target.value })}
                      />
                      <FieldError id="tt-edit-override-date-error" message={editOverrideErrors.errors.date} />
                    </div>
                    <div className="field">
                      <label htmlFor="tt-edit-override-period">교시</label>
                      <select
                        id="tt-edit-override-period"
                        value={editOverrideForm.period}
                        onChange={(e) => onEditOverrideFormChange({ ...editOverrideForm, period: e.target.value })}
                      >
                        {PERIODS.map((p) => (
                          <option key={p} value={p}>
                            {p}교시
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className={"field" + (editOverrideErrors.errors.className ? " field--invalid" : "")}>
                      <label htmlFor="tt-edit-override-className">학급</label>
                      <input
                        id="tt-edit-override-className"
                        ref={editOverrideErrors.registerField("className")}
                        aria-invalid={!!editOverrideErrors.errors.className}
                        aria-describedby={
                          editOverrideErrors.errors.className ? "tt-edit-override-className-error" : undefined
                        }
                        value={editOverrideForm.className}
                        onChange={(e) => onEditOverrideFormChange({ ...editOverrideForm, className: e.target.value })}
                      />
                      <FieldError
                        id="tt-edit-override-className-error"
                        message={editOverrideErrors.errors.className}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="tt-edit-override-subject">변경 과목(선택)</label>
                      <input
                        id="tt-edit-override-subject"
                        value={editOverrideForm.subject}
                        onChange={(e) => onEditOverrideFormChange({ ...editOverrideForm, subject: e.target.value })}
                      />
                    </div>
                    <div className="field field--grow">
                      <label htmlFor="tt-edit-override-memo">메모</label>
                      <input
                        id="tt-edit-override-memo"
                        value={editOverrideForm.memo}
                        onChange={(e) => onEditOverrideFormChange({ ...editOverrideForm, memo: e.target.value })}
                      />
                    </div>
                    <div className="form__actions">
                      <button type="submit" className="btn">
                        저장
                      </button>
                      <button type="button" className="btn btn--ghost" onClick={cancelEditOverride}>
                        취소
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="list__row" key={o.id}>
                    <div className="list__main">
                      <p className="list__title">
                        {o.date} · {o.period}교시 · {formatClassName(o.className)}
                        {o.subject ? ` — ${o.subject}` : ""}
                      </p>
                      {o.memo && <p className="list__meta">{o.memo}</p>}
                    </div>
                    <div className="list__actions">
                      <button className="btn btn--ghost btn--small" onClick={() => startEditOverride(o)}>
                        수정
                      </button>
                      <button className="btn btn--danger btn--small" onClick={() => removeOverride(o.id)}>
                        삭제
                      </button>
                    </div>
                  </div>
                )
              )}
            </div>
          </section>

          <section className="page__section">
            <h2 className="section__title">빠른 변경 (맞교환 · 이동 · 취소 · 추가)</h2>
            <p className="page__desc" style={{ marginBottom: 12 }}>
              날짜를 고르면 학사일정까지 반영된 그날의 기준 시간표를 먼저 보여줍니다. 그 위에서
              교시를 선택해 바꾸면 기본 시간표는 그대로 두고 그 날짜에만 적용됩니다.
            </p>

            <div className="form">
              <div className="field">
                <label>날짜</label>
                <input type="date" value={quickDate} onChange={(e) => setQuickDate(e.target.value)} />
              </div>
              <div className="field">
                <label>변경 유형</label>
                <select value={quickChangeType} onChange={(e) => { setQuickChangeType(e.target.value); setQuickChangeError(null); setMoveConflict(null); }}>
                  <option value="swap">수업 맞교환</option>
                  <option value="move">수업 이동</option>
                  <option value="cancel">수업 취소</option>
                  <option value="add">임시 수업 추가</option>
                </select>
              </div>
            </div>

            <p className="section__helper">
              {quickDate}({quickDayTimetable.actualDayOfWeek}) 기준 시간표
              {quickDayTimetable.scheduleDayOverride && (
                <span className="badge badge--weekday-change" style={{ marginLeft: 8 }}>
                  요일 변동 · {quickDayTimetable.scheduleDayOverride}요일 시간표 적용
                </span>
              )}
            </p>
            <MiniTimetable day={quickDayTimetable} />

            {quickChangeError && (
              <p className="status status--error" role="alert">
                {quickChangeError}
              </p>
            )}

            {quickChangeType === "swap" && (
              <div className="form">
                <div className="field">
                  <label>첫 번째 수업</label>
                  <select value={swapPeriodA} onChange={(e) => setSwapPeriodA(e.target.value)}>
                    <option value="">선택</option>
                    {quickDayOccupiedPeriods.map((p) => (
                      <option key={p.period} value={p.period}>
                        {p.period}교시 · {formatClassName(p.className)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>두 번째 수업</label>
                  <select value={swapPeriodB} onChange={(e) => setSwapPeriodB(e.target.value)}>
                    <option value="">선택</option>
                    {quickDayOccupiedPeriods.map((p) => (
                      <option key={p.period} value={p.period}>
                        {p.period}교시 · {formatClassName(p.className)}
                      </option>
                    ))}
                  </select>
                </div>
                {swapPeriodA && swapPeriodB && swapPeriodA !== swapPeriodB && (
                  <p className="list__meta" style={{ width: "100%" }}>
                    변경 후: {swapPeriodA}교시 →{" "}
                    {formatClassName(quickDayTimetable.periods.find((p) => String(p.period) === swapPeriodB)?.className)}
                    , {swapPeriodB}교시 →{" "}
                    {formatClassName(quickDayTimetable.periods.find((p) => String(p.period) === swapPeriodA)?.className)}
                  </p>
                )}
                <div className="form__actions">
                  <button type="button" className="btn" disabled={applyingQuickChange} onClick={applySwap}>
                    맞교환 적용
                  </button>
                </div>
              </div>
            )}

            {quickChangeType === "move" && (
              <div className="form">
                <div className="field">
                  <label>이동할 수업</label>
                  <select value={moveFromPeriod} onChange={(e) => { setMoveFromPeriod(e.target.value); setMoveConflict(null); }}>
                    <option value="">선택</option>
                    {quickDayOccupiedPeriods.map((p) => (
                      <option key={p.period} value={p.period}>
                        {p.period}교시 · {formatClassName(p.className)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>이동할 날짜</label>
                  <input
                    type="date"
                    value={moveToDate || quickDate}
                    onChange={(e) => { setMoveToDate(e.target.value); setMoveConflict(null); }}
                  />
                </div>
                <div className="field">
                  <label>이동할 교시</label>
                  <select value={moveToPeriod} onChange={(e) => { setMoveToPeriod(e.target.value); setMoveConflict(null); }}>
                    <option value="">선택</option>
                    {PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {p}교시
                      </option>
                    ))}
                  </select>
                </div>
                {moveFromPeriod && moveToPeriod && (
                  <p className="list__meta" style={{ width: "100%" }}>
                    {quickDate}({quickDayTimetable.actualDayOfWeek}) {moveFromPeriod}교시 ·{" "}
                    {formatClassName(quickDayTimetable.periods.find((p) => String(p.period) === moveFromPeriod)?.className)}
                    {" → "}
                    {effectiveMoveToDate}({moveTargetDayTimetable.actualDayOfWeek}) {moveToPeriod}교시
                  </p>
                )}
                <div className="form__actions">
                  <button type="button" className="btn" disabled={applyingQuickChange} onClick={checkMoveConflict}>
                    수업 이동 적용
                  </button>
                </div>
                {moveConflict && (
                  <div className="status status--error" style={{ width: "100%" }} role="alert">
                    <p style={{ margin: "0 0 8px" }}>
                      {effectiveMoveToDate}({moveTargetDayTimetable.actualDayOfWeek}) {moveToPeriod}교시에는 이미{" "}
                      {formatClassName(moveConflict.className)} 수업이 있습니다.
                    </p>
                    <div className="form__actions">
                      {effectiveMoveToDate === quickDate && (
                        <button type="button" className="btn btn--small" onClick={applyMoveAsSwap}>
                          맞교환으로 변경
                        </button>
                      )}
                      <button type="button" className="btn btn--ghost btn--small" onClick={() => setMoveConflict(null)}>
                        다른 교시/날짜 선택
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {quickChangeType === "cancel" && (
              <div className="form">
                <div className="field">
                  <label>취소할 수업</label>
                  <select value={cancelPeriod} onChange={(e) => setCancelPeriod(e.target.value)}>
                    <option value="">선택</option>
                    {quickDayOccupiedPeriods.map((p) => (
                      <option key={p.period} value={p.period}>
                        {p.period}교시 · {formatClassName(p.className)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form__actions">
                  <button type="button" className="btn btn--danger" disabled={applyingQuickChange} onClick={applyCancel}>
                    이 수업 취소
                  </button>
                </div>
              </div>
            )}

            {quickChangeType === "add" && (
              <div className="form">
                <div className="field">
                  <label>교시</label>
                  <select value={addPeriod} onChange={(e) => setAddPeriod(e.target.value)}>
                    <option value="">선택</option>
                    {PERIODS.map((p) => (
                      <option key={p} value={p}>
                        {p}교시
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>학급</label>
                  <input
                    placeholder="예: 3-2"
                    value={addClassName}
                    onChange={(e) => setAddClassName(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label>과목(선택)</label>
                  <input value={addSubject} onChange={(e) => setAddSubject(e.target.value)} />
                </div>
                <div className="form__actions">
                  <button type="button" className="btn" disabled={applyingQuickChange} onClick={applyAdd}>
                    추가
                  </button>
                </div>
              </div>
            )}
          </section>

          <section className="page__section">
            <h2 className="section__title">예정된 변경</h2>
            {upcomingChangeItems.length === 0 && <p className="list--empty">예정된 시간표 변동이 없습니다.</p>}
            <div className="tt-change-list">
              {upcomingChangeItems.map((item) => (
                <ChangeItemCard
                  key={item.key}
                  item={item}
                  timetable={timetable}
                  overrides={overrides}
                  schoolDaySchedules={schoolDaySchedules}
                  classNameBeforeOverride={classNameBeforeOverride}
                  expanded={expandedChangeKeys.has(item.key)}
                  onToggleExpand={() => toggleChangeExpanded(item.key)}
                  onRemove={item.kind === "override" ? () => removeChangeGroup(item) : null}
                />
              ))}
            </div>
          </section>

          <section className="page__section">
            <h2 className="section__title">지난 변경</h2>
            {pastChangeItems.length === 0 && <p className="list--empty">지난 시간표 변동이 없습니다.</p>}
            {pastChangeItems.length > 0 && (
              <>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setShowPastChanges((v) => !v)}>
                  {showPastChanges ? "지난 변경 접기" : `지난 변경 ${pastChangeItems.length}건 [펼쳐보기]`}
                </button>
                {showPastChanges && (
                  <div className="tt-change-list">
                    {pastChangeItems.map((item) => (
                      <ChangeItemCard
                        key={item.key}
                        item={item}
                        timetable={timetable}
                        overrides={overrides}
                        schoolDaySchedules={schoolDaySchedules}
                        classNameBeforeOverride={classNameBeforeOverride}
                        expanded={expandedChangeKeys.has(item.key)}
                        onToggleExpand={() => toggleChangeExpanded(item.key)}
                        onRemove={item.kind === "override" ? () => removeChangeGroup(item) : null}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </section>
            </>
          )}
        </>
      )}

      {!loading && !error && view === "homeroom" && (
        <>
          {hrLoading && <p className="status">불러오는 중…</p>}
          {hrError && <p className="status status--error">담임 학급 시간표를 불러오지 못했습니다.</p>}

          {!hrLoading && !hrError && (
            <>
              <section className="page__section">
                <h2 className="section__title">
                  {homeroomClass ? `${homeroomClass} 학급 시간표` : "담임 학급 시간표"}
                </h2>
                <p className="page__desc" style={{ marginBottom: 12 }}>
                  칸을 눌러 과목과(아는 경우) 담당 선생님을 등록·수정합니다.
                </p>

                <table className="timetable-grid">
                  <thead>
                    <tr>
                      <th className="timetable-grid__corner">교시</th>
                      {WEEKDAYS.map((day) => (
                        <th key={day}>{day}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {PERIODS.map((period) => (
                      <tr key={period}>
                        <th className="timetable-grid__period">{period}</th>
                        {WEEKDAYS.map((day) => {
                          const entry = hrCellEntry(day, period);
                          const isSelected =
                            hrSelectedCell?.dayOfWeek === day && hrSelectedCell?.period === period;
                          return (
                            <td key={day} data-day={day}>
                              <button
                                type="button"
                                className={
                                  "timetable-grid__cell" +
                                  (entry ? " timetable-grid__cell--filled" : "") +
                                  (isSelected ? " timetable-grid__cell--selected" : "")
                                }
                                onClick={() => openHrCell(day, period)}
                              >
                                {entry ? (
                                  <>
                                    <span className="timetable-grid__class">{entry.subject}</span>
                                    {entry.teacher && (
                                      <span className="timetable-grid__subject">{entry.teacher}</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="timetable-grid__empty">＋</span>
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {hrSelectedCell && (
                  <form className="form" onSubmit={saveHrCell} style={{ marginTop: 16 }} noValidate>
                    <div className="field">
                      <label>
                        {hrSelectedCell.dayOfWeek}요일 · {hrSelectedCell.period}교시
                      </label>
                    </div>
                    <div className={"field field--grow" + (hrCellErrors.errors.subject ? " field--invalid" : "")}>
                      <label htmlFor="tt-hr-subject">과목</label>
                      <input
                        id="tt-hr-subject"
                        ref={hrCellErrors.registerField("subject")}
                        autoFocus
                        aria-invalid={!!hrCellErrors.errors.subject}
                        aria-describedby={hrCellErrors.errors.subject ? "tt-hr-subject-error" : undefined}
                        placeholder="예: 국어"
                        value={hrCellForm.subject}
                        onChange={(e) => onHrCellFormChange({ ...hrCellForm, subject: e.target.value })}
                      />
                      <FieldError id="tt-hr-subject-error" message={hrCellErrors.errors.subject} />
                    </div>
                    <div className="field">
                      <label htmlFor="tt-hr-teacher">담당 선생님(선택)</label>
                      <input
                        id="tt-hr-teacher"
                        placeholder="예: 홍길동"
                        value={hrCellForm.teacher}
                        onChange={(e) => onHrCellFormChange({ ...hrCellForm, teacher: e.target.value })}
                      />
                    </div>
                    <div className="form__actions">
                      <button type="submit" className="btn">
                        저장
                      </button>
                      {hrCellEntry(hrSelectedCell.dayOfWeek, hrSelectedCell.period) && (
                        <button type="button" className="btn btn--danger" onClick={clearHrCell}>
                          삭제
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn--ghost"
                        onClick={() => {
                          setHrSelectedCell(null);
                          setHrCellForm(emptyHrCellForm);
                          hrCellErrors.clearAll();
                        }}
                      >
                        취소
                      </button>
                    </div>
                  </form>
                )}
              </section>

              <section className="page__section">
                <h2 className="section__title">학급 시간표 가져오기</h2>
                <p className="page__desc" style={{ marginBottom: 12 }}>
                  학교 시간표 파일을 선택하면 AI가 그 안에서{" "}
                  {homeroomClass ? `${homeroomClass} 학급` : "담임 학급"}의 시간표만 찾아 미리보기로
                  보여줍니다. 확인하고 수정한 뒤 "시간표 등록"을 눌러야 실제로 저장됩니다.
                </p>

                {!hrPreviewEntries && (
                  <div className="form">
                    <div className="field field--grow">
                      <label>시간표 파일</label>
                      <input
                        type="file"
                        accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.docx"
                        onChange={(e) => {
                          setHrImportFile(e.target.files?.[0] ?? null);
                          setHrImportError(null);
                        }}
                      />
                      {hrImportFile && (
                        <p className="list__meta">
                          {hrImportFile.name} · {FILE_FORMAT_LABEL[detectFileFormat(hrImportFile)]}
                        </p>
                      )}
                    </div>
                    <div className="form__actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={!hrImportFile || hrImportAnalyzing || !homeroomClass}
                        onClick={analyzeHrImport}
                      >
                        {hrImportAnalyzing ? "분석 중…" : "분석하기"}
                      </button>
                    </div>
                    {!homeroomClass && (
                      <p className="list__meta">설정에서 담임 학급을 먼저 등록해 주세요.</p>
                    )}
                  </div>
                )}

                {hrImportError && (
                  <p className="status status--error" role="alert">
                    {hrImportError}
                  </p>
                )}

                {hrPreviewEntries && (
                  <>
                    <p className="list__meta" style={{ marginBottom: 8 }}>
                      미리보기입니다. 잘못 인식된 칸은 눌러서 수정하거나 비워두세요. 아직 저장되지
                      않았습니다.
                    </p>

                    <table className="timetable-grid">
                      <thead>
                        <tr>
                          <th className="timetable-grid__corner">교시</th>
                          {WEEKDAYS.map((day) => (
                            <th key={day}>{day}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {PERIODS.map((period) => (
                          <tr key={period}>
                            <th className="timetable-grid__period">{period}</th>
                            {WEEKDAYS.map((day) => {
                              const entry = hrPreviewCellEntry(day, period);
                              const isSelected =
                                hrSelectedPreviewCell?.dayOfWeek === day &&
                                hrSelectedPreviewCell?.period === period;
                              return (
                                <td key={day} data-day={day}>
                                  <button
                                    type="button"
                                    className={
                                      "timetable-grid__cell" +
                                      (entry ? " timetable-grid__cell--filled" : "") +
                                      (isSelected ? " timetable-grid__cell--selected" : "")
                                    }
                                    onClick={() => openHrPreviewCell(day, period)}
                                  >
                                    {entry ? (
                                      <>
                                        <span className="timetable-grid__class">{entry.subject}</span>
                                        {entry.teacher && (
                                          <span className="timetable-grid__subject">{entry.teacher}</span>
                                        )}
                                      </>
                                    ) : (
                                      <span className="timetable-grid__empty">＋</span>
                                    )}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    {hrSelectedPreviewCell && (
                      <form className="form" onSubmit={saveHrPreviewCell} style={{ marginTop: 16 }} noValidate>
                        <div className="field">
                          <label>
                            {hrSelectedPreviewCell.dayOfWeek}요일 · {hrSelectedPreviewCell.period}교시
                          </label>
                        </div>
                        <div
                          className={
                            "field field--grow" + (hrPreviewCellErrors.errors.subject ? " field--invalid" : "")
                          }
                        >
                          <label htmlFor="tt-hr-preview-subject">과목</label>
                          <input
                            id="tt-hr-preview-subject"
                            ref={hrPreviewCellErrors.registerField("subject")}
                            autoFocus
                            aria-invalid={!!hrPreviewCellErrors.errors.subject}
                            aria-describedby={
                              hrPreviewCellErrors.errors.subject ? "tt-hr-preview-subject-error" : undefined
                            }
                            placeholder="예: 국어"
                            value={hrPreviewCellForm.subject}
                            onChange={(e) =>
                              onHrPreviewCellFormChange({ ...hrPreviewCellForm, subject: e.target.value })
                            }
                          />
                          <FieldError
                            id="tt-hr-preview-subject-error"
                            message={hrPreviewCellErrors.errors.subject}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor="tt-hr-preview-teacher">담당 선생님(선택)</label>
                          <input
                            id="tt-hr-preview-teacher"
                            placeholder="예: 홍길동"
                            value={hrPreviewCellForm.teacher}
                            onChange={(e) =>
                              onHrPreviewCellFormChange({ ...hrPreviewCellForm, teacher: e.target.value })
                            }
                          />
                        </div>
                        <div className="form__actions">
                          <button type="submit" className="btn">
                            적용
                          </button>
                          {hrPreviewCellEntry(
                            hrSelectedPreviewCell.dayOfWeek,
                            hrSelectedPreviewCell.period
                          ) && (
                            <button type="button" className="btn btn--danger" onClick={clearHrPreviewCell}>
                              비우기
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => {
                              setHrSelectedPreviewCell(null);
                              hrPreviewCellErrors.clearAll();
                            }}
                          >
                            취소
                          </button>
                        </div>
                      </form>
                    )}

                    <div className="form__actions" style={{ marginTop: 16 }}>
                      <button className="btn" disabled={hrRegistering} onClick={requestHrRegister}>
                        {hrRegistering ? "등록하는 중…" : "시간표 등록"}
                      </button>
                      <button className="btn btn--ghost" disabled={hrRegistering} onClick={cancelHrImport}>
                        취소
                      </button>
                    </div>
                  </>
                )}
              </section>
            </>
          )}
        </>
      )}

      <Modal open={showOverwriteConfirm} title="기존 시간표가 있습니다" onClose={() => setShowOverwriteConfirm(false)}>
        <p style={{ marginTop: 0 }}>새 시간표로 교체할까요? 기존 기본 시간표는 대체되며 되돌릴 수 없습니다.</p>
        <p className="list__meta">일시적 변경(override)은 그대로 유지됩니다.</p>
        <div className="form__actions">
          <button className="btn btn--danger" disabled={registering} onClick={performRegister}>
            {registering ? "교체하는 중…" : "새 시간표로 교체"}
          </button>
          <button className="btn btn--ghost" disabled={registering} onClick={() => setShowOverwriteConfirm(false)}>
            취소
          </button>
        </div>
      </Modal>

      <Modal
        open={hrShowOverwriteConfirm}
        title="기존 학급 시간표가 있습니다"
        onClose={() => setHrShowOverwriteConfirm(false)}
      >
        <p style={{ marginTop: 0 }}>
          {homeroomClass ? `기존 ${homeroomClass} 학급 시간표가 있습니다. ` : ""}
          새 시간표로 교체할까요? 되돌릴 수 없습니다.
        </p>
        <div className="form__actions">
          <button className="btn btn--danger" disabled={hrRegistering} onClick={performHrRegister}>
            {hrRegistering ? "교체하는 중…" : "새 시간표로 교체"}
          </button>
          <button
            className="btn btn--ghost"
            disabled={hrRegistering}
            onClick={() => setHrShowOverwriteConfirm(false)}
          >
            취소
          </button>
        </div>
      </Modal>
    </div>
  );
}

// changeGroupId로 묶인 override(1~2건)와, 학사일정만으로 요일이 바뀐 날짜를 "하나의 변경
// 작업" 카드로 요약해 보여준다. 기본적으로 요약 한두 줄만 보여주고, "변경 시간표 보기"를
//눌렀을 때만 관련 날짜의 최종 실제 시간표(getEffectiveDayTimetable)를 펼친다 - 페이지가
// 변동 날짜마다 전체 시간표를 항상 펼쳐 보여주던 문제를 없앤다.
// getEffectiveDayTimetable() 결과(day)를 공강까지 포함한 전체 교시 미니 시간표로
// 보여준다. 새 계산을 전혀 하지 않는다 - day.periods에서 교시별로 찾아 표시만 한다.
// 학교의 실제 교시 범위는 하드코딩하지 않고 기존 PERIODS 상수(이 파일 상단에서 이미
// 기본 시간표 grid에도 쓰이고 있음)를 그대로 재사용한다.
function MiniTimetable({ day }) {
  return (
    <table className="mini-timetable">
      <tbody>
        {PERIODS.map((period) => {
          const p = day.periods.find((x) => x.period === period);
          const hasClass = p && p.className;
          return (
            <tr key={period} className={p?.isOverride ? "mini-timetable__row--changed" : undefined}>
              <td className="mini-timetable__period">{period}교시</td>
              <td className="mini-timetable__content">
                {p?.cancelled ? (
                  <span className="mini-timetable__empty">수업 없음</span>
                ) : hasClass ? (
                  <>
                    <span className="mini-timetable__class">{formatClassName(p.className)}</span>
                    {p.subject && <span className="mini-timetable__subject"> · {p.subject}</span>}
                  </>
                ) : (
                  <span className="mini-timetable__empty">공강</span>
                )}
                {p?.isOverride && <span className="badge badge--personal mini-timetable__badge">변경</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ChangeItemCard({
  item,
  timetable,
  overrides,
  schoolDaySchedules,
  classNameBeforeOverride,
  expanded,
  onToggleExpand,
  onRemove,
}) {
  let title = "";
  let summaryLines = [];
  let changeBadgeLabel = "";

  if (item.kind === "schedule") {
    const date = item.dates[0];
    const sch = schoolDaySchedules.find((s) => s.date === date && s.status === "confirmed");
    title = `${formatDateDisplay(date)}(${weekdayKoreanOf(date)})`;
    changeBadgeLabel = "요일 변동";
    summaryLines = [
      `${sch?.scheduleDayOverride ?? ""}요일 시간표 적용${sch?.originalText ? ` (${sch.originalText})` : ""}`,
    ];
  } else if (item.changeType === "swap") {
    const [m0, m1] = item.members;
    title = `${formatDateDisplay(item.dates[0])}(${weekdayKoreanOf(item.dates[0])})`;
    changeBadgeLabel = "맞교환";
    summaryLines = [`${m0.period}교시 · ${formatClassName(m0.className)}`, "↕", `${m1.period}교시 · ${formatClassName(m1.className)}`];
  } else if (item.changeType === "move") {
    const fromMember = item.members.find((m) => !m.className) || item.members[0];
    const toMember = item.members.find((m) => m.className) || item.members[1];
    const sameDate = fromMember.date === toMember.date;
    title = sameDate
      ? `${formatDateDisplay(fromMember.date)}(${weekdayKoreanOf(fromMember.date)})`
      : "수업 이동";
    changeBadgeLabel = "이동";
    summaryLines = sameDate
      ? [`${fromMember.period}교시 → ${toMember.period}교시 · ${formatClassName(toMember.className)}`]
      : [
          `${formatDateDisplay(fromMember.date)}(${weekdayKoreanOf(fromMember.date)}) ${fromMember.period}교시 · ${formatClassName(toMember.className)}`,
          "↓",
          `${formatDateDisplay(toMember.date)}(${weekdayKoreanOf(toMember.date)}) ${toMember.period}교시 · ${formatClassName(toMember.className)}`,
        ];
  } else if (item.changeType === "cancel") {
    const m = item.members[0];
    const before = classNameBeforeOverride(m.date, m.period, m.id);
    title = `${formatDateDisplay(m.date)}(${weekdayKoreanOf(m.date)})`;
    changeBadgeLabel = "취소";
    summaryLines = [`${m.period}교시 · ${before ? formatClassName(before) : "수업"} 취소`];
  } else if (item.changeType === "add") {
    const m = item.members[0];
    title = `${formatDateDisplay(m.date)}(${weekdayKoreanOf(m.date)})`;
    changeBadgeLabel = "추가";
    summaryLines = [`${m.period}교시 · ${formatClassName(m.className)} 임시 수업 추가`];
  } else {
    // changeType이 없는 예전 방식 override(하위 호환) - 있는 그대로 보여준다.
    const m = item.members[0];
    title = `${formatDateDisplay(m.date)}(${weekdayKoreanOf(m.date)})`;
    summaryLines = [`${m.period}교시 · ${m.className ? formatClassName(m.className) : "수업 없음"}`];
  }

  return (
    <div className="change-card">
      <div className="change-card__head">
        <span className="change-card__date">{title}</span>
        {changeBadgeLabel && (
          <span className={item.kind === "schedule" ? "badge badge--weekday-change" : "badge badge--personal"}>
            {changeBadgeLabel}
          </span>
        )}
      </div>
      {summaryLines.map((line, i) => (
        <p className="change-card__summary" key={i}>
          {line}
        </p>
      ))}
      <div className="change-card__actions">
        <button type="button" className="btn-text" onClick={onToggleExpand}>
          {expanded ? "시간표 접기 ∧" : "시간표 보기 ∨"}
        </button>
        {onRemove && (
          <button type="button" className="btn-text btn-text--danger" onClick={onRemove}>
            변경 삭제
          </button>
        )}
      </div>
      {expanded && (
        <div className="mini-timetable-list">
          {item.dates.map((date) => {
            const day = getEffectiveDayTimetable(date, { timetable, timetableOverrides: overrides, schoolDaySchedules });
            return (
              <div key={date} className="mini-timetable-block">
                <div className="mini-timetable-block__head">
                  <span className="mini-timetable-block__date">
                    {formatDateDisplay(date)}({day.actualDayOfWeek}) 최종 시간표
                  </span>
                  {day.scheduleDayOverride && (
                    <span className="badge badge--weekday-change">
                      요일 변동 · {day.scheduleDayOverride}요일 시간표 적용
                    </span>
                  )}
                </div>
                <MiniTimetable day={day} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
