import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGoogleCalendar } from "../contexts/GoogleCalendarContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent, MissingEndTimeError } from "../calendar/calendarApi";
import {
  isCalendarEligible,
  ATTENDING_OPTIONS,
  parseAttendingValue,
  attendingToSelectValue,
} from "../utils/calendarEligibility";
import { EVENT_TYPES, ATTENDANCE_BASED_EVENT_TYPES, eventTypeDisplayLabel } from "../utils/constants";
import { formatDateDisplay, weekdayKoreanOf, todayDateString } from "../utils/date";
import { useFieldErrors, isBlank, isTimeBefore } from "../utils/formValidation";
import Modal from "../components/Modal";
import FieldError from "../components/FieldError";
import "./crud-shared.css";
import "./EventsPage.css";

const emptyForm = {
  title: "",
  date: "",
  startTime: "",
  endTime: "",
  type: "personal",
  customType: "",
  status: "예정",
  memo: "",
  attending: "unknown",
  addToCalendar: false,
};

// 일정 저장 전 확인하는 조건: 제목/날짜 필수, 종료 시간은 시작 시간 이후, "기타" 구분은
// 직접 입력 필수. Firestore에 실제로 어떤 값이 저장되는지는 그대로 두고, 저장을 시도하기
// 전에 이 조건을 만족하는지만 화면에서 먼저 확인한다.
function validateEventForm(values) {
  const errors = {};
  if (isBlank(values.title)) errors.title = "제목을 입력해 주세요.";
  if (isBlank(values.date)) errors.date = "날짜를 선택해 주세요.";
  if (isTimeBefore(values.startTime, values.endTime)) {
    errors.endTime = "종료 시간은 시작 시간 이후로 설정해 주세요.";
  }
  if (values.type === "other" && isBlank(values.customType)) {
    errors.customType = "구분을 직접 입력해 주세요.";
  }
  return errors;
}

// 등록 form과 인라인 수정 form이 완전히 동일한 필드 UI를 공유한다(중복 방지). 각 form은
// 자기 자신의 state(신규 등록용 form, 또는 그 항목만의 editForm)와 오류 state를 따로 갖고
// 이 컴포넌트에 넘겨줄 뿐이다.
function EventFormFields({
  values,
  onChange,
  calendarConfigured,
  connected,
  connecting,
  errors = {},
  registerField,
  idPrefix,
}) {
  const isAttendanceBasedType = ATTENDANCE_BASED_EVENT_TYPES.includes(values.type);
  const eligibleNow = isCalendarEligible({
    type: values.type,
    attending: isAttendanceBasedType ? parseAttendingValue(values.attending) : null,
  });
  const id = (name) => `${idPrefix}-${name}`;

  return (
    <>
      <div className={"field field--grow" + (errors.title ? " field--invalid" : "")}>
        <label htmlFor={id("title")}>제목</label>
        <input
          id={id("title")}
          ref={registerField("title")}
          aria-invalid={!!errors.title}
          aria-describedby={errors.title ? id("title-error") : undefined}
          value={values.title}
          onChange={(e) => onChange({ ...values, title: e.target.value })}
        />
        <FieldError id={id("title-error")} message={errors.title} />
      </div>
      <div className={"field" + (errors.date ? " field--invalid" : "")}>
        <label htmlFor={id("date")}>날짜</label>
        <input
          id={id("date")}
          ref={registerField("date")}
          type="date"
          aria-invalid={!!errors.date}
          aria-describedby={errors.date ? id("date-error") : undefined}
          value={values.date}
          onChange={(e) => onChange({ ...values, date: e.target.value })}
        />
        <FieldError id={id("date-error")} message={errors.date} />
      </div>
      <div className="field">
        <label htmlFor={id("startTime")}>시작</label>
        <input
          id={id("startTime")}
          type="time"
          value={values.startTime}
          onChange={(e) => onChange({ ...values, startTime: e.target.value })}
        />
      </div>
      <div className={"field" + (errors.endTime ? " field--invalid" : "")}>
        <label htmlFor={id("endTime")}>종료</label>
        <input
          id={id("endTime")}
          ref={registerField("endTime")}
          type="time"
          aria-invalid={!!errors.endTime}
          aria-describedby={errors.endTime ? id("endTime-error") : undefined}
          value={values.endTime}
          onChange={(e) => onChange({ ...values, endTime: e.target.value })}
        />
        <FieldError id={id("endTime-error")} message={errors.endTime} />
      </div>
      <div className="field">
        <label htmlFor={id("type")}>구분</label>
        <select id={id("type")} value={values.type} onChange={(e) => onChange({ ...values, type: e.target.value })}>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {isAttendanceBasedType && (
        <div className="field">
          <label htmlFor={id("attending")}>참석 여부</label>
          <select
            id={id("attending")}
            value={values.attending}
            onChange={(e) => onChange({ ...values, attending: e.target.value })}
          >
            {ATTENDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {values.type === "other" && (
        <div className={"field" + (errors.customType ? " field--invalid" : "")}>
          <label htmlFor={id("customType")}>직접 입력</label>
          <input
            id={id("customType")}
            ref={registerField("customType")}
            aria-invalid={!!errors.customType}
            aria-describedby={errors.customType ? id("customType-error") : undefined}
            value={values.customType}
            onChange={(e) => onChange({ ...values, customType: e.target.value })}
            placeholder="예: 웨딩 준비"
          />
          <FieldError id={id("customType-error")} message={errors.customType} />
        </div>
      )}
      <div className="field">
        <label>상태</label>
        <select value={values.status} onChange={(e) => onChange({ ...values, status: e.target.value })}>
          <option value="예정">예정</option>
          <option value="완료">완료</option>
          <option value="취소">취소</option>
        </select>
      </div>
      <div className="field field--grow">
        <label>메모</label>
        <input value={values.memo} onChange={(e) => onChange({ ...values, memo: e.target.value })} />
      </div>

      {calendarConfigured && eligibleNow && (
        <div className="field field--checkbox">
          <input
            type="checkbox"
            checked={values.addToCalendar}
            onChange={(e) => onChange({ ...values, addToCalendar: e.target.checked })}
          />
          <label>Google Calendar에 추가</label>
          {values.addToCalendar && !connected && (
            <span className="list__meta">{connecting ? " 연결하는 중…" : " (저장 시 Google 연결 창이 뜹니다)"}</span>
          )}
        </div>
      )}
      {calendarConfigured && isAttendanceBasedType && !eligibleNow && (
        <p className="ep-form__helper">참석으로 표시해야 Google Calendar에 추가할 수 있습니다.</p>
      )}
    </>
  );
}

export default function EventsPage() {
  const { user } = useAuth();
  const { configured: calendarConfigured, connected, connecting, connect, getValidAccessToken } =
    useGoogleCalendar();

  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filterType, setFilterType] = useState("all");

  // "다가오는 일정" | "지난 일정". 오늘 날짜(Asia/Seoul, todayDateString)를 기준으로
  // date >= today는 다가오는 일정, date < today는 지난 일정으로 나눈다.
  const [scopeTab, setScopeTab] = useState("upcoming");
  // 월별 accordion 펼침 상태 - 다가오는/지난 일정이 서로 다른 월 집합을 펼쳐 둘 수 있어야
  // 하므로 각자 별도 Set으로 관리한다. 순수 로컬 UI state이고 저장하지 않는다.
  const [expandedUpcomingMonths, setExpandedUpcomingMonths] = useState(() => new Set());
  const [expandedPastMonths, setExpandedPastMonths] = useState(() => new Set());

  // 신규 등록 전용 state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [createCalendarWarning, setCreateCalendarWarning] = useState(null);
  const createErrors = useFieldErrors();
  const onCreateChange = createErrors.withErrorClearing(setCreateForm);

  // 인라인 수정 전용 state - 항목이 원래 있던 자리에서 그대로 수정한다.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSaving, setEditSaving] = useState(false);
  const [editCalendarWarning, setEditCalendarWarning] = useState(null);
  const editErrors = useFieldErrors();
  const onEditChange = editErrors.withErrorClearing(setEditForm);

  const [deleteTarget, setDeleteTarget] = useState(null); // Google Calendar와 동기화된 일정을 지울 때 확인용
  const [deleting, setDeleting] = useState(false);

  async function load() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listDocsByOwner("events", user.uid);
      setEvents(
        list.sort((a, b) => {
          const da = `${a.date ?? ""}${a.startTime ?? ""}`;
          const db_ = `${b.date ?? ""}${b.startTime ?? ""}`;
          return da.localeCompare(db_);
        })
      );
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  function openCreateForm() {
    setEditingId(null); // 한 번에 하나의 form만 - 수정 중이던 항목이 있으면 닫는다.
    setShowCreateForm(true);
  }

  function closeCreateForm() {
    setShowCreateForm(false);
    setCreateForm(emptyForm);
    setCreateCalendarWarning(null);
    createErrors.clearAll();
  }

  function startEdit(ev) {
    setShowCreateForm(false); // 한 번에 하나의 form만 - 신규 등록 form이 열려 있으면 닫는다.
    setEditingId(ev.id);
    setEditCalendarWarning(null);
    editErrors.clearAll();
    setEditForm({
      title: ev.title ?? "",
      date: ev.date ?? "",
      startTime: ev.startTime ?? "",
      endTime: ev.endTime ?? "",
      type: ev.type ?? "personal",
      customType: ev.customType ?? "",
      status: ev.status ?? "예정",
      memo: ev.memo ?? "",
      attending: attendingToSelectValue(ev.attending),
      addToCalendar: !!ev.calendarSync,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm);
    setEditCalendarWarning(null);
    editErrors.clearAll();
  }

  // "다가오는 일정"에서 수정 중이던 카드가 "지난 일정" 탭으로 넘어가면 화면에서 사라지는데도
  // editingId/editForm은 그대로 남아 있어, 탭을 오가면 예전 수정 폼이 다시 나타났다 - 기존
  // cancelEdit()을 그대로 재사용해 탭을 바꿀 때 정리한다. 새로 작성 중인 등록 폼
  // (showCreateForm/createForm)은 건드리지 않는다.
  function handleSetScopeTab(tab) {
    cancelEdit();
    setScopeTab(tab);
  }

  // 신규 등록/기존 수정이 공유하는 저장 로직. existingEvent가 있으면 그 document를
  // update하고(Firestore ID 유지, 새 document 생성 안 함), 없으면 새로 생성한다.
  // Google Calendar 연동(생성/PATCH) 로직은 기존 그대로다.
  async function saveEvent(formState, existingEvent, { setSaving, setWarning, onDone }) {
    if (!formState.title || !formState.date) return;
    setSaving(true);
    setWarning(null);
    const now = new Date().toISOString();
    const isAttendanceBasedType = ATTENDANCE_BASED_EVENT_TYPES.includes(formState.type);
    const attending = isAttendanceBasedType ? parseAttendingValue(formState.attending) : null;
    const eligibleNow = isCalendarEligible({ type: formState.type, attending });

    const basePayload = {
      title: formState.title,
      date: formState.date,
      startTime: formState.startTime || "",
      endTime: formState.endTime || "",
      type: formState.type,
      customType: formState.type === "other" ? formState.customType || "" : "",
      status: formState.status,
      memo: formState.memo || "",
      attending,
      updatedAt: now,
    };

    let calendarSync = existingEvent?.calendarSync ?? false;
    let googleCalendarId = existingEvent?.googleCalendarId ?? null;

    try {
      if (formState.addToCalendar && eligibleNow) {
        let token = await getValidAccessToken();
        if (!token) {
          await connect();
          token = await getValidAccessToken();
        }

        if (token) {
          try {
            if (googleCalendarId) {
              await updateCalendarEvent(token, googleCalendarId, basePayload);
            } else {
              googleCalendarId = await createCalendarEvent(token, basePayload);
            }
            calendarSync = true;
          } catch (err) {
            calendarSync = false;
            if (err instanceof MissingEndTimeError) {
              setWarning(err.message);
            } else {
              console.error("[Calendar] sync failed:", err);
              setWarning("일정은 저장되었지만 Google Calendar 동기화에 실패했습니다.");
            }
          }
        } else {
          setWarning("Google Calendar 연결이 필요합니다. 연결 후 다시 저장해 주세요.");
        }
      }

      if (existingEvent) {
        await updateDocById("events", existingEvent.id, { ...basePayload, calendarSync, googleCalendarId });
      } else {
        await createDoc("events", user.uid, {
          ...basePayload,
          source: "manual",
          calendarSync,
          googleCalendarId,
          createdAt: now,
        });
      }

      onDone();
      load();
    } finally {
      setSaving(false);
    }
  }

  function submitCreate(e) {
    e.preventDefault();
    if (!createErrors.runValidation(validateEventForm(createForm))) return;
    saveEvent(createForm, null, { setSaving: setCreating, setWarning: setCreateCalendarWarning, onDone: closeCreateForm });
  }

  function submitEdit(e) {
    e.preventDefault();
    if (!editErrors.runValidation(validateEventForm(editForm))) return;
    const existing = events.find((ev) => ev.id === editingId);
    saveEvent(editForm, existing, { setSaving: setEditSaving, setWarning: setEditCalendarWarning, onDone: cancelEdit });
  }

  function requestRemove(ev) {
    if (ev.calendarSync && ev.googleCalendarId) {
      setDeleteTarget(ev);
    } else {
      performRemove(ev, false);
    }
  }

  async function performRemove(ev, alsoDeleteFromCalendar) {
    setDeleting(true);
    try {
      if (alsoDeleteFromCalendar && ev.googleCalendarId) {
        const token = await getValidAccessToken();
        if (token) {
          try {
            await deleteCalendarEvent(token, ev.googleCalendarId);
          } catch (err) {
            console.error("[Calendar] delete failed:", err);
          }
        }
      }
      await deleteDocById("events", ev.id);
      if (editingId === ev.id) cancelEdit();
      setDeleteTarget(null);
      load();
    } finally {
      setDeleting(false);
    }
  }

  const visible = filterType === "all" ? events : events.filter((e) => e.type === filterType);
  const today = todayDateString();
  // Asia/Seoul 기준 오늘 날짜(todayDateString)로만 비교한다 - 브라우저 UTC 때문에 날짜가
  // 하루씩 밀리는 문제를 피하려고 이 프로젝트 전역에서 이미 쓰는 helper를 그대로 쓴다.
  const upcomingVisible = visible.filter((e) => (e.date || "") >= today);
  // events는 load()에서 이미 날짜+시간 오름차순으로 정렬되어 있다 - 지난 일정은 그 배열을
  // 뒤집기만 하면 가장 최근 날짜가 먼저 오는 순서가 된다.
  const pastVisible = visible.filter((e) => (e.date || "") < today).reverse();

  function formatGroupDate(dateStr) {
    if (!dateStr) return "";
    const isThisYear = dateStr.slice(0, 4) === today.slice(0, 4);
    const display = formatDateDisplay(dateStr);
    const withWeekday = `${display}(${weekdayKoreanOf(dateStr)})`;
    return isThisYear ? withWeekday : `${dateStr.slice(0, 4)}년 ${withWeekday}`;
  }

  // 날짜 기준 grouping (다가오는 일정 카드 - 기존 UI 그대로) - Firestore 구조는 그대로 두고
  // 표시할 때만 묶는다.
  function groupByDate(items) {
    const dateGroups = [];
    for (const ev of items) {
      const last = dateGroups[dateGroups.length - 1];
      if (last && last.date === ev.date) {
        last.items.push(ev);
      } else {
        dateGroups.push({ date: ev.date, items: [ev] });
      }
    }
    return dateGroups;
  }

  function monthKeyOf(dateStr) {
    return (dateStr || "").slice(0, 7); // "YYYY-MM"
  }

  function monthLabelOf(dateStr) {
    const [y, m] = (dateStr || "").split("-");
    return y && m ? `${y}년 ${Number(m)}월` : "";
  }

  // 월별 grouping. Map의 삽입 순서 = 입력 배열의 순서이므로, 다가오는 일정(오름차순 입력)은
  // 가장 가까운 달이, 지난 일정(내림차순 입력)은 가장 최근 달이 자연스럽게 먼저 온다 -
  // 별도로 다시 정렬하지 않는다.
  function groupByMonth(items) {
    const map = new Map();
    for (const ev of items) {
      const key = monthKeyOf(ev.date);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(ev);
    }
    return [...map.entries()].map(([key, monthItems]) => ({
      key,
      label: monthLabelOf(monthItems[0].date),
      items: monthItems,
    }));
  }

  const upcomingMonthGroups = groupByMonth(upcomingVisible);
  const pastMonthGroups = groupByMonth(pastVisible);

  // 기본적으로 가장 가까운(다가오는) / 가장 최근(지난) 월만 펼쳐 둔다. 데이터가 로드된
  // 뒤 이 월 집합이 비어 있을 때만 기본값을 채우고, 그 이후 사용자가 직접 접고 펼치는
  // 조작은 다시 덮어쓰지 않는다.
  useEffect(() => {
    if (upcomingMonthGroups.length > 0 && expandedUpcomingMonths.size === 0) {
      setExpandedUpcomingMonths(new Set([upcomingMonthGroups[0].key]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcomingMonthGroups.map((g) => g.key).join(",")]);

  useEffect(() => {
    if (pastMonthGroups.length > 0 && expandedPastMonths.size === 0) {
      setExpandedPastMonths(new Set([pastMonthGroups[0].key]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pastMonthGroups.map((g) => g.key).join(",")]);

  function toggleUpcomingMonth(key) {
    setExpandedUpcomingMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function togglePastMonth(key) {
    setExpandedPastMonths((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // 지난 일정 compact row용 짧은 날짜 표기("9.18") - 연도는 월 accordion 제목에 이미
  // 표시되므로 행 안에서는 반복하지 않는다.
  function shortDate(dateStr) {
    const [, m, d] = (dateStr || "").split("-");
    return m && d ? `${Number(m)}.${Number(d)}` : dateStr || "";
  }

  // 인라인 수정 form - "다가오는 일정"의 큰 카드에서도, "지난 일정"의 compact row에서도
  // 이 항목이 원래 있던 자리에서 똑같이 열린다(두 곳이 완전히 같은 form을 공유한다).
  function renderEditForm(ev) {
    return (
      <form className="form ep-form ep-form--inline" key={ev.id} onSubmit={submitEdit} noValidate>
        <EventFormFields
          values={editForm}
          onChange={onEditChange}
          calendarConfigured={calendarConfigured}
          connected={connected}
          connecting={connecting}
          errors={editErrors.errors}
          registerField={editErrors.registerField}
          idPrefix="event-edit"
        />
        {editCalendarWarning && <p className="status status--error">{editCalendarWarning}</p>}
        <div className="form__actions">
          <button type="submit" className="btn" disabled={editSaving}>
            {editSaving ? "저장 중…" : "저장"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={cancelEdit}>
            취소
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="page events-page">
      <header className="page__head">
        <h1 className="page__title">일정</h1>
        <p className="page__desc">학교와 개인 일정을 한곳에서 관리해요.</p>
      </header>

      <div className="tt-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={scopeTab === "upcoming"}
          className={"tt-tabs__btn" + (scopeTab === "upcoming" ? " tt-tabs__btn--active" : "")}
          onClick={() => handleSetScopeTab("upcoming")}
        >
          다가오는 일정
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={scopeTab === "past"}
          className={"tt-tabs__btn" + (scopeTab === "past" ? " tt-tabs__btn--active" : "")}
          onClick={() => handleSetScopeTab("past")}
        >
          지난 일정
        </button>
      </div>

      <div className="ep-toolbar">
        <div className="field">
          <label>구분 필터</label>
          <select
            value={filterType}
            onChange={(e) => {
              // 구분 필터를 바꿔 수정 중이던 일정이 목록에서 사라지면, 다시 그 구분으로
              // 돌아왔을 때 예전 수정 폼이 남아 있지 않도록 정리한다(탭 전환과 같은 원칙).
              cancelEdit();
              setFilterType(e.target.value);
            }}
          >
            <option value="all">전체</option>
            {EVENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {!showCreateForm && (
          <button type="button" className="btn" onClick={openCreateForm}>
            + 일정 추가
          </button>
        )}
      </div>

      {loading && <p className="status">불러오는 중…</p>}
      {error && <p className="status status--error">일정을 불러오지 못했습니다.</p>}

      {!loading && !error && (
        <>
          {showCreateForm && (
            <form className="form ep-form" onSubmit={submitCreate} noValidate>
              <EventFormFields
                values={createForm}
                onChange={onCreateChange}
                calendarConfigured={calendarConfigured}
                connected={connected}
                connecting={connecting}
                errors={createErrors.errors}
                registerField={createErrors.registerField}
                idPrefix="event-create"
              />
              {!calendarConfigured && (
                <p className="ep-form__helper">
                  Google Calendar 연동은 설정에서 연결 정보를 등록한 뒤 사용할 수 있습니다.
                </p>
              )}
              <div className="form__actions">
                <button type="submit" className="btn" disabled={creating}>
                  {creating ? "저장 중…" : "추가"}
                </button>
                <button type="button" className="btn btn--ghost" onClick={closeCreateForm}>
                  취소
                </button>
              </div>
            </form>
          )}
          {createCalendarWarning && <p className="status status--error">{createCalendarWarning}</p>}

          {scopeTab === "upcoming" ? (
            <div className="pp-month-accordion ep-month-accordion">
              {upcomingMonthGroups.length === 0 && <p className="list--empty">다가오는 일정이 없습니다.</p>}
              {upcomingMonthGroups.map((mg) => {
                const monthExpanded = expandedUpcomingMonths.has(mg.key);
                return (
                  <div className="pp-month-accordion__item" key={mg.key}>
                    <button
                      type="button"
                      className="pp-month-accordion__summary"
                      onClick={() => toggleUpcomingMonth(mg.key)}
                      aria-expanded={monthExpanded}
                    >
                      <span>{mg.label}</span>
                      <span className="pp-month-accordion__count">{mg.items.length}개</span>
                      <span aria-hidden="true">{monthExpanded ? "∧" : "∨"}</span>
                    </button>
                    {monthExpanded && (
                      <div className="ep-groups">
                        {groupByDate(mg.items).map((group) => (
                          <section className="ep-group" key={group.date}>
                            <h2 className="ep-group__date">{formatGroupDate(group.date)}</h2>
                            <div className="ep-list">
                              {group.items.map((ev) =>
                                editingId === ev.id ? (
                                  renderEditForm(ev)
                                ) : (
                                  <div className="ep-row" key={ev.id}>
                                    <div className="ep-row__main">
                                      <span className={`badge badge--${ev.type}`}>{eventTypeDisplayLabel(ev)}</span>
                                      <div className="ep-row__text">
                                        <p className="ep-row__title">{ev.title}</p>
                                        <p className="ep-row__meta">
                                          {ev.startTime && `${ev.startTime}${ev.endTime ? ` – ${ev.endTime}` : ""}`}
                                          {ATTENDANCE_BASED_EVENT_TYPES.includes(ev.type) &&
                                            `${ev.startTime ? " · " : ""}${
                                              ev.attending === true
                                                ? "참석"
                                                : ev.attending === false
                                                ? "불참"
                                                : "참석 여부 미정"
                                            }`}
                                          {ev.memo ? ` · ${ev.memo}` : ""}
                                          {ev.status && ev.status !== "예정" ? ` · ${ev.status}` : ""}
                                        </p>
                                        {ev.calendarSync && (
                                          <span className="ep-row__calendar">📅 Calendar 연동됨</span>
                                        )}
                                      </div>
                                    </div>
                                    <div className="list__actions">
                                      <button className="btn-text" onClick={() => startEdit(ev)}>
                                        수정
                                      </button>
                                      <button className="btn-text btn-text--danger" onClick={() => requestRemove(ev)}>
                                        삭제
                                      </button>
                                    </div>
                                  </div>
                                )
                              )}
                            </div>
                          </section>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="pp-month-accordion ep-month-accordion">
              {pastMonthGroups.length === 0 && <p className="list--empty">지난 일정이 없습니다.</p>}
              {pastMonthGroups.map((mg) => {
                const monthExpanded = expandedPastMonths.has(mg.key);
                return (
                  <div className="pp-month-accordion__item" key={mg.key}>
                    <button
                      type="button"
                      className="pp-month-accordion__summary"
                      onClick={() => togglePastMonth(mg.key)}
                      aria-expanded={monthExpanded}
                    >
                      <span>{mg.label}</span>
                      <span className="pp-month-accordion__count">{mg.items.length}개</span>
                      <span aria-hidden="true">{monthExpanded ? "∧" : "∨"}</span>
                    </button>
                    {monthExpanded && (
                      <div className="ep-history-list">
                        {mg.items.map((ev) =>
                          editingId === ev.id ? (
                            renderEditForm(ev)
                          ) : (
                            <div className="ep-history-row" key={ev.id}>
                              <span className="ep-history-row__date">{shortDate(ev.date)}</span>
                              <span className={`badge badge--${ev.type}`}>{eventTypeDisplayLabel(ev)}</span>
                              {ev.status && ev.status !== "예정" && (
                                <span className="ep-history-row__status">{ev.status}</span>
                              )}
                              <span className="ep-history-row__title">{ev.title}</span>
                              <span className="ep-history-row__time">
                                {ev.startTime && `${ev.startTime}${ev.endTime ? ` – ${ev.endTime}` : ""}`}
                              </span>
                              <span className="ep-history-row__actions">
                                <button className="btn-text" onClick={() => startEdit(ev)}>
                                  수정
                                </button>
                                <button className="btn-text btn-text--danger" onClick={() => requestRemove(ev)}>
                                  삭제
                                </button>
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      <Modal open={!!deleteTarget} title="Google Calendar에도 등록된 일정입니다" onClose={() => setDeleteTarget(null)}>
        <p style={{ marginTop: 0 }}>&lsquo;{deleteTarget?.title}&rsquo; 일정을 어떻게 삭제할까요?</p>
        <div className="form__actions" style={{ flexWrap: "wrap" }}>
          <button className="btn" disabled={deleting} onClick={() => performRemove(deleteTarget, true)}>
            앱과 Google Calendar에서 모두 삭제
          </button>
          <button className="btn btn--ghost" disabled={deleting} onClick={() => performRemove(deleteTarget, false)}>
            앱에서만 삭제
          </button>
          <button className="btn btn--ghost" disabled={deleting} onClick={() => setDeleteTarget(null)}>
            취소
          </button>
        </div>
      </Modal>
    </div>
  );
}
