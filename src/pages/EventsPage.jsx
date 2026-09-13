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
import Modal from "../components/Modal";
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

// 등록 form과 인라인 수정 form이 완전히 동일한 필드 UI를 공유한다(중복 방지). 각 form은
// 자기 자신의 state(신규 등록용 form, 또는 그 항목만의 editForm)를 따로 갖고 이 컴포넌트에
// 넘겨줄 뿐이다.
function EventFormFields({ values, onChange, calendarConfigured, connected, connecting }) {
  const isAttendanceBasedType = ATTENDANCE_BASED_EVENT_TYPES.includes(values.type);
  const eligibleNow = isCalendarEligible({
    type: values.type,
    attending: isAttendanceBasedType ? parseAttendingValue(values.attending) : null,
  });

  return (
    <>
      <div className="field field--grow">
        <label>제목</label>
        <input value={values.title} onChange={(e) => onChange({ ...values, title: e.target.value })} required />
      </div>
      <div className="field">
        <label>날짜</label>
        <input
          type="date"
          value={values.date}
          onChange={(e) => onChange({ ...values, date: e.target.value })}
          required
        />
      </div>
      <div className="field">
        <label>시작</label>
        <input
          type="time"
          value={values.startTime}
          onChange={(e) => onChange({ ...values, startTime: e.target.value })}
        />
      </div>
      <div className="field">
        <label>종료</label>
        <input
          type="time"
          value={values.endTime}
          onChange={(e) => onChange({ ...values, endTime: e.target.value })}
        />
      </div>
      <div className="field">
        <label>구분</label>
        <select value={values.type} onChange={(e) => onChange({ ...values, type: e.target.value })}>
          {EVENT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      {isAttendanceBasedType && (
        <div className="field">
          <label>참석 여부</label>
          <select value={values.attending} onChange={(e) => onChange({ ...values, attending: e.target.value })}>
            {ATTENDING_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {values.type === "other" && (
        <div className="field">
          <label>직접 입력</label>
          <input
            value={values.customType}
            onChange={(e) => onChange({ ...values, customType: e.target.value })}
            placeholder="예: 웨딩 준비"
          />
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

  // 신규 등록 전용 state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);
  const [creating, setCreating] = useState(false);
  const [createCalendarWarning, setCreateCalendarWarning] = useState(null);

  // 인라인 수정 전용 state - 항목이 원래 있던 자리에서 그대로 수정한다.
  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const [editSaving, setEditSaving] = useState(false);
  const [editCalendarWarning, setEditCalendarWarning] = useState(null);

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
  }

  function startEdit(ev) {
    setShowCreateForm(false); // 한 번에 하나의 form만 - 신규 등록 form이 열려 있으면 닫는다.
    setEditingId(ev.id);
    setEditCalendarWarning(null);
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
    saveEvent(createForm, null, { setSaving: setCreating, setWarning: setCreateCalendarWarning, onDone: closeCreateForm });
  }

  function submitEdit(e) {
    e.preventDefault();
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

  // 날짜 기준 grouping - Firestore 구조는 그대로 두고 표시할 때만 묶는다.
  const groups = [];
  for (const ev of visible) {
    const last = groups[groups.length - 1];
    if (last && last.date === ev.date) {
      last.items.push(ev);
    } else {
      groups.push({ date: ev.date, items: [ev] });
    }
  }

  function formatGroupDate(dateStr) {
    if (!dateStr) return "";
    const isThisYear = dateStr.slice(0, 4) === todayDateString().slice(0, 4);
    const display = formatDateDisplay(dateStr);
    const withWeekday = `${display}(${weekdayKoreanOf(dateStr)})`;
    return isThisYear ? withWeekday : `${dateStr.slice(0, 4)}년 ${withWeekday}`;
  }

  return (
    <div className="page events-page">
      <header className="page__head">
        <h1 className="page__title">일정</h1>
        <p className="page__desc">학교와 개인 일정을 한곳에서 관리해요.</p>
      </header>

      <div className="ep-toolbar">
        <div className="field">
          <label>구분 필터</label>
          <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
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
            <form className="form ep-form" onSubmit={submitCreate}>
              <EventFormFields
                values={createForm}
                onChange={setCreateForm}
                calendarConfigured={calendarConfigured}
                connected={connected}
                connecting={connecting}
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

          <div className="ep-groups">
            {groups.length === 0 && <p className="list--empty">등록된 일정이 없습니다.</p>}
            {groups.map((group) => (
              <section className="ep-group" key={group.date}>
                <h2 className="ep-group__date">{formatGroupDate(group.date)}</h2>
                <div className="ep-list">
                  {group.items.map((ev) =>
                    editingId === ev.id ? (
                      // 이 일정이 원래 있던 바로 그 자리에서 수정 form으로 전환된다 -
                      // 페이지 상단으로 이동하지 않는다.
                      <form className="form ep-form ep-form--inline" key={ev.id} onSubmit={submitEdit}>
                        <EventFormFields
                          values={editForm}
                          onChange={setEditForm}
                          calendarConfigured={calendarConfigured}
                          connected={connected}
                          connecting={connecting}
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
                                  ev.attending === true ? "참석" : ev.attending === false ? "불참" : "참석 여부 미정"
                                }`}
                              {ev.memo ? ` · ${ev.memo}` : ""}
                              {ev.status && ev.status !== "예정" ? ` · ${ev.status}` : ""}
                            </p>
                            {ev.calendarSync && <span className="ep-row__calendar">📅 Calendar 연동됨</span>}
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
