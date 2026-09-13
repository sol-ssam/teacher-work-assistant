import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGoogleCalendar } from "../contexts/GoogleCalendarContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { createCalendarEvent, updateCalendarEvent, MissingEndTimeError } from "../calendar/calendarApi";
import {
  isCalendarEligible,
  ATTENDING_OPTIONS,
  parseAttendingValue,
  attendingToSelectValue,
} from "../utils/calendarEligibility";
import { analyzeSourceDocument } from "../ai/documentAnalysis";
import { fileToBase64 } from "../utils/fileToBase64";
import { detectFileFormat, FILE_FORMAT_LABEL } from "../utils/fileFormat";
import { excelToText } from "../utils/excelToText";
import { wordToText } from "../utils/wordToText";
import {
  findEventConflict,
  findTaskConflict,
  findTimetableOverrideConflict,
} from "../utils/conflictDetection";
import { findTimeConflicts } from "../utils/timeConflictDetection";
import { todayDateString } from "../utils/date";
import { EVENT_TYPES } from "../utils/constants";
import "../pages/crud-shared.css";
import "./DocumentsPage.css";

const DOC_TYPES = [
  { value: "weekly_plan", label: "주간 교육계획" },
  { value: "monthly_plan", label: "월간 교육계획" },
  { value: "academic_calendar", label: "학교 학사일정" },
  { value: "other", label: "기타 자료" },
];

const KIND_LABEL = {
  event: "일정",
  task: "업무",
  timetable_change: "시간표 변경",
  notice: "주요 안내",
};

const emptyForm = { title: "", type: "weekly_plan", periodStart: "", periodEnd: "" };

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function DocumentsPage() {
  const { user } = useAuth();
  const { configured: calendarConfigured, connect, getValidAccessToken } = useGoogleCalendar();
  const [documents, setDocuments] = useState([]);
  const [existing, setExisting] = useState({ events: [], tasks: [], overrides: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [calendarWarnings, setCalendarWarnings] = useState({});

  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState(null);
  const fileInputRef = useRef(null);
  const [analyzing, setAnalyzing] = useState(false);

  const [edits, setEdits] = useState({});
  const [armed, setArmed] = useState({});

  async function load() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [docs, events, tasks, overrides] = await Promise.all([
        listDocsByOwner("source_documents", user.uid),
        listDocsByOwner("events", user.uid),
        listDocsByOwner("tasks", user.uid),
        listDocsByOwner("timetable_overrides", user.uid),
      ]);
      setDocuments(docs.sort((a, b) => (b.analyzedAt ?? "").localeCompare(a.analyzedAt ?? "")));
      setExisting({ events, tasks, overrides });
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

  // 파일은 어디에도 업로드하지 않는다. 형식에 따라 브라우저 메모리에서 바로 처리한다:
  // PDF/이미지는 base64로 바꿔 Gemini에 멀티모달로 직접 전달하고, 엑셀/워드는 브라우저에서
  // 먼저 텍스트로 변환한 뒤 그 텍스트만 전달한다. 어느 경우든 원본 파일은 분석이 끝나면
  // 버려지고, Firestore에는 분석 결과(승인 대기 후보)와 최소한의 메타데이터만 남는다.
  async function handleAnalyzeUpload(e) {
    e.preventDefault();
    if (!file || !form.title) return;

    const format = detectFileFormat(file);
    if (format === "unsupported") {
      setError(
        new Error(
          "현재 지원하지 않는 파일 형식입니다. PDF, Excel(.xlsx/.xls), 이미지(.png/.jpg/.jpeg), Word(.docx) 파일만 선택할 수 있습니다."
        )
      );
      return;
    }

    setAnalyzing(true);
    setError(null);
    try {
      let content;
      if (format === "pdf") {
        content = { kind: "inline", base64: await fileToBase64(file), mimeType: "application/pdf" };
      } else if (format === "image") {
        content = { kind: "inline", base64: await fileToBase64(file), mimeType: file.type || "image/png" };
      } else if (format === "excel") {
        content = { kind: "text", text: await excelToText(file) };
      } else {
        content = { kind: "text", text: await wordToText(file) };
      }

      const items = await analyzeSourceDocument({
        content,
        docType: form.type,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
      });

      await createDoc("source_documents", user.uid, {
        title: form.title,
        documentType: form.type,
        fileName: file.name,
        fileFormat: format,
        periodStart: form.periodStart || "",
        periodEnd: form.periodEnd || "",
        analyzedAt: new Date().toISOString(),
        status: "analyzed",
        extractedItems: items,
      });

      setForm(emptyForm);
      setFile(null);
      load();
    } catch {
      setError(new Error("AI 분석에 실패했습니다. 잠시 후 다시 시도해 주세요."));
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleDeleteDocument(doc) {
    await deleteDocById("source_documents", doc.id);
    load();
  }

  function getEdit(docId, item) {
    return { ...item, ...(edits[docId]?.[item.id] ?? {}) };
  }

  function setEdit(docId, itemId, patch) {
    setEdits((prev) => ({
      ...prev,
      [docId]: { ...prev[docId], [itemId]: { ...(prev[docId]?.[itemId] ?? {}), ...patch } },
    }));
  }

  function findConflict(item) {
    if (item.kind === "event") return findEventConflict(item, existing.events);
    if (item.kind === "task") return findTaskConflict(item, existing.tasks);
    if (item.kind === "timetable_change") return findTimetableOverrideConflict(item, existing.overrides);
    return null;
  }

  // 기존 데이터와 동일/유사한지 확인하는 findConflict와는 별개로, 서로 다른 일정이라도
  // 시간이 겹치는지 확인한다. event 후보에만 적용한다.
  function findTimeConflictsFor(item, dedupConflict) {
    if (item.kind !== "event") return [];
    return findTimeConflicts(item, existing.events, { excludeId: dedupConflict?.id });
  }

  async function persistItemsUpdate(doc, updatedItem) {
    const nextItems = doc.extractedItems.map((it) => (it.id === updatedItem.id ? updatedItem : it));
    await updateDocById("source_documents", doc.id, {
      extractedItems: nextItems,
      status: nextItems.every((it) => it.status !== "pending") ? "completed" : "analyzed",
    });
  }

  async function handleIgnore(doc, item) {
    await persistItemsUpdate(doc, { ...item, status: "ignored" });
    load();
  }

  async function handleSave(doc, rawItem) {
    const item = getEdit(doc.id, rawItem);
    const conflict = findConflict(item);
    const timeConflicts = findTimeConflictsFor(item, conflict);
    const armKey = `${doc.id}:${item.id}`;

    if ((conflict || timeConflicts.length > 0) && !armed[armKey]) {
      setArmed((prev) => ({ ...prev, [armKey]: true }));
      return;
    }

    const now = new Date().toISOString();

    if (item.kind === "event") {
      const payload = {
        title: item.title,
        date: item.date,
        startTime: item.startTime || "",
        endTime: item.endTime || "",
        type: item.eventType || "school",
        customType: item.eventType === "other" ? item.customType || "" : "",
        status: "예정",
        memo: item.memo || "",
        attending: item.eventType === "meeting" ? item.attending ?? null : null,
        updatedAt: now,
      };

      const eligible = isCalendarEligible({ type: payload.type, attending: payload.attending });
      let calendarSync = conflict?.calendarSync ?? false;
      let googleCalendarId = conflict?.googleCalendarId ?? null;

      if (item.addToCalendar && eligible) {
        let token = await getValidAccessToken();
        if (!token) {
          await connect();
          token = await getValidAccessToken();
        }
        if (token) {
          try {
            if (googleCalendarId) {
              await updateCalendarEvent(token, googleCalendarId, payload);
            } else {
              googleCalendarId = await createCalendarEvent(token, payload);
            }
            calendarSync = true;
          } catch (err) {
            calendarSync = false;
            if (err instanceof MissingEndTimeError) {
              setCalendarWarnings((prev) => ({ ...prev, [armKey]: err.message }));
            } else {
              console.error("[Calendar] sync failed:", err);
              setCalendarWarnings((prev) => ({
                ...prev,
                [armKey]: "일정은 저장되었지만 Google Calendar 동기화에 실패했습니다.",
              }));
            }
          }
        } else {
          setCalendarWarnings((prev) => ({
            ...prev,
            [armKey]: "Google Calendar 연결이 필요합니다. 설정에서 연결한 뒤 다시 시도해 주세요.",
          }));
        }
      }

      if (conflict) {
        await updateDocById("events", conflict.id, { ...payload, calendarSync, googleCalendarId });
      } else {
        await createDoc("events", user.uid, {
          ...payload,
          source: "ai_document",
          calendarSync,
          googleCalendarId,
          createdAt: now,
        });
      }
    } else if (item.kind === "task") {
      const payload = { title: item.title, dueDate: item.date, memo: item.memo || "", updatedAt: now };
      if (conflict) {
        await updateDocById("tasks", conflict.id, payload);
      } else {
        await createDoc("tasks", user.uid, {
          ...payload,
          priority: "medium",
          completed: false,
          source: "ai_document",
          createdAt: now,
        });
      }
    } else if (item.kind === "timetable_change") {
      const payload = {
        date: item.date,
        className: item.className || "",
        subject: "",
        memo: item.memo || item.title || "",
        period: Number(item.period) || 0,
      };
      if (conflict) {
        await updateDocById("timetable_overrides", conflict.id, payload);
      } else {
        await createDoc("timetable_overrides", user.uid, payload);
      }
    } else {
      await createDoc("notices", user.uid, {
        content: item.memo ? `${item.title} - ${item.memo}` : item.title,
        important: false,
        expiresAt: "",
        dateAdded: todayDateString(),
        source: "ai_document",
        createdAt: now,
      });
    }

    setArmed((prev) => ({ ...prev, [armKey]: false }));
    await persistItemsUpdate(doc, { ...item, status: "saved" });
    load();
  }

  return (
    <div className="page documents-page">
      <header className="page__head">
        <h1 className="page__title">자료 업로드</h1>
        <p className="page__desc">
          주간·월간 교육계획이나 학사일정 문서를 선택하면, 파일을 어디에도 저장하지 않고 그
          자리에서 바로 분석합니다. AI가 찾은 내용은 자동으로 저장되지 않으며, 하나씩 확인하고
          저장하거나 무시할 수 있습니다.
        </p>
      </header>

      <section className="page__section">
        <h2 className="section__title">문서 분석</h2>
        <form className="form doc-form" onSubmit={handleAnalyzeUpload}>
          <div className="doc-form__row">
            <div className="field field--grow">
              <label>제목</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="예: 9월 2주 주간 교육계획"
                required
              />
            </div>
            <div className="field">
              <label>종류</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {DOC_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="doc-form__row">
            <div className="field">
              <label>기간 시작(선택)</label>
              <input
                type="date"
                value={form.periodStart}
                onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
              />
            </div>
            <div className="field">
              <label>기간 끝(선택)</label>
              <input
                type="date"
                value={form.periodEnd}
                onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
              />
            </div>
          </div>

          <div className="field field--grow">
            <label>문서 파일</label>
            {/* 실제 <input type="file">는 그대로 유지하고 시각적으로만 숨긴다(display:none이
                아니라 화면 밖으로 보내는 방식) - custom UI 클릭이 이 input을 그대로 연다. */}
            <input
              ref={fileInputRef}
              type="file"
              className="doc-form__file-input"
              accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg,.docx"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {!file ? (
              <button type="button" className="doc-picker" onClick={() => fileInputRef.current?.click()}>
                <span className="doc-picker__text">분석할 문서를 선택해주세요</span>
                <span className="doc-picker__hint">PDF · Excel · 이미지 · Word</span>
                <span className="doc-picker__btn">파일 선택</span>
              </button>
            ) : (
              <div className="doc-picker doc-picker--selected">
                <span className="doc-picker__icon" aria-hidden="true">
                  📄
                </span>
                <span className="doc-picker__file">
                  <span className="doc-picker__filename">{file.name}</span>
                  <span className="doc-picker__filemeta">
                    {FILE_FORMAT_LABEL[detectFileFormat(file)]} · {formatFileSize(file.size)}
                  </span>
                </span>
                <button type="button" className="doc-picker__change" onClick={() => fileInputRef.current?.click()}>
                  변경
                </button>
              </div>
            )}
            {file && detectFileFormat(file) === "unsupported" && (
              <p className="status status--error">
                현재 지원하지 않는 파일 형식입니다. PDF, Excel, 이미지, Word 파일만 선택할 수
                있습니다. (한글 HWP/HWPX는 아직 지원하지 않습니다.)
              </p>
            )}
          </div>

          <div className="form__actions doc-form__actions">
            <button
              type="submit"
              className="btn"
              disabled={analyzing || (!!file && detectFileFormat(file) === "unsupported")}
            >
              {analyzing ? "분석 중…" : "✨ 분석하기"}
            </button>
          </div>
        </form>
      </section>

      {loading && <p className="status">불러오는 중…</p>}
      {error && <p className="status status--error">{error.message || "문제가 발생했습니다."}</p>}

      {!loading && (
        <section className="page__section">
          <h2 className="section__title">분석한 자료</h2>
          {documents.length === 0 && <p className="list--empty">아직 분석한 자료가 없습니다.</p>}

          <div className="doc-list">
            {documents.map((doc) => {
              const pendingItems = (doc.extractedItems || []).filter((it) => it.status === "pending");
              return (
                <div className="doc-card" key={doc.id}>
                  <div className="doc-card__head">
                    <div>
                      <p className="doc-card__title">{doc.title}</p>
                      <p className="list__meta">
                        {DOC_TYPES.find((t) => t.value === doc.documentType)?.label ?? doc.documentType}
                        {doc.fileFormat && ` · ${FILE_FORMAT_LABEL[doc.fileFormat] ?? doc.fileFormat}`}
                        {doc.periodStart && ` · ${doc.periodStart} ~ ${doc.periodEnd || ""}`}
                        {" · "}
                        {pendingItems.length > 0 ? "검토 필요" : "완료"}
                      </p>
                    </div>
                    <div className="list__actions">
                      <button className="btn btn--danger btn--small" onClick={() => handleDeleteDocument(doc)}>
                        삭제
                      </button>
                    </div>
                  </div>

                  {pendingItems.length === 0 && (
                    <p className="list--empty">검토할 새 항목이 없습니다.</p>
                  )}

                  {pendingItems.map((item) => {
                    const editedItem = getEdit(doc.id, item);
                    const conflict = findConflict(editedItem);
                    const timeConflicts = findTimeConflictsFor(editedItem, conflict);
                    const armKey = `${doc.id}:${item.id}`;
                    const isArmed = !!armed[armKey];
                    const hasWarning = !!conflict || timeConflicts.length > 0;

                    return (
                      <div className="extracted-item" key={item.id}>
                        <div className="extracted-item__head">
                          <span className={`badge badge--${item.kind === "task" ? "medium" : "personal"}`}>
                            {KIND_LABEL[item.kind] ?? item.kind}
                          </span>
                          <span className="list__meta">출처: {doc.title}</span>
                        </div>

                        <div className="form" style={{ marginBottom: 8 }}>
                          <div className="field field--grow">
                            <label>제목</label>
                            <input
                              value={editedItem.title}
                              onChange={(e) => setEdit(doc.id, item.id, { title: e.target.value })}
                            />
                          </div>
                          <div className="field">
                            <label>날짜</label>
                            <input
                              type="date"
                              value={editedItem.date}
                              onChange={(e) => setEdit(doc.id, item.id, { date: e.target.value })}
                            />
                          </div>
                          {item.kind === "event" && (
                            <div className="field">
                              <label>구분</label>
                              <select
                                value={editedItem.eventType}
                                onChange={(e) => setEdit(doc.id, item.id, { eventType: e.target.value })}
                              >
                                {EVENT_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>
                                    {t.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          {item.kind === "event" && (
                            <div className="field">
                              <label>시작 시간</label>
                              <input
                                type="time"
                                value={editedItem.startTime}
                                onChange={(e) => setEdit(doc.id, item.id, { startTime: e.target.value })}
                              />
                            </div>
                          )}
                          {item.kind === "event" && (
                            <div className="field">
                              <label>종료 시간</label>
                              <input
                                type="time"
                                value={editedItem.endTime}
                                onChange={(e) => setEdit(doc.id, item.id, { endTime: e.target.value })}
                              />
                            </div>
                          )}
                          {item.kind === "event" && editedItem.eventType === "meeting" && (
                            <div className="field">
                              <label>참석 여부</label>
                              <select
                                value={attendingToSelectValue(editedItem.attending)}
                                onChange={(e) =>
                                  setEdit(doc.id, item.id, { attending: parseAttendingValue(e.target.value) })
                                }
                              >
                                {ATTENDING_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                          )}
                          {item.kind === "event" && editedItem.eventType === "other" && (
                            <div className="field">
                              <label>직접 입력</label>
                              <input
                                value={editedItem.customType ?? ""}
                                onChange={(e) => setEdit(doc.id, item.id, { customType: e.target.value })}
                                placeholder="예: 웨딩 준비"
                              />
                            </div>
                          )}
                          {item.kind === "timetable_change" && (
                            <>
                              <div className="field">
                                <label>교시</label>
                                <input
                                  value={editedItem.period}
                                  onChange={(e) => setEdit(doc.id, item.id, { period: e.target.value })}
                                  placeholder="예: 5"
                                />
                              </div>
                              <div className="field">
                                <label>학급</label>
                                <input
                                  value={editedItem.className}
                                  onChange={(e) => setEdit(doc.id, item.id, { className: e.target.value })}
                                  placeholder="예: 3-2"
                                />
                              </div>
                            </>
                          )}
                          <div className="field field--grow">
                            <label>메모</label>
                            <input
                              value={editedItem.memo}
                              onChange={(e) => setEdit(doc.id, item.id, { memo: e.target.value })}
                            />
                          </div>
                        </div>

                        {conflict && (
                          <p className="status status--error">
                            ⚠️ 기존 데이터와 겹칩니다 — 저장하면 기존 항목이 이 내용으로 대체됩니다.
                            {isArmed ? " 다시 누르면 적용됩니다." : ""}
                          </p>
                        )}

                        {timeConflicts.length > 0 && (
                          <div className="status status--error">
                            <p style={{ margin: "0 0 4px" }}>
                              🕒 시간 충돌 가능성
                              {isArmed ? " (다시 누르면 그대로 저장됩니다)" : ""}
                            </p>
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                              {timeConflicts.map((ev) => (
                                <li key={ev.id}>
                                  {ev.startTime}
                                  {ev.endTime ? `~${ev.endTime}` : ""}
                                  {"에 "}
                                  {ev.endTime ? "" : "시작하는 "}
                                  &lsquo;{ev.title}&rsquo; 일정과 겹칠 수 있습니다.
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {item.kind === "event" &&
                          calendarConfigured &&
                          isCalendarEligible({
                            type: editedItem.eventType,
                            attending: editedItem.attending,
                          }) && (
                            <div className="field field--checkbox" style={{ marginBottom: 8 }}>
                              <input
                                type="checkbox"
                                id={`add-to-calendar-${item.id}`}
                                checked={!!editedItem.addToCalendar}
                                onChange={(e) =>
                                  setEdit(doc.id, item.id, { addToCalendar: e.target.checked })
                                }
                              />
                              <label htmlFor={`add-to-calendar-${item.id}`}>Google Calendar에 추가</label>
                            </div>
                          )}
                        {item.kind === "event" && calendarConfigured && editedItem.eventType === "meeting" && editedItem.attending !== true && (
                          <p className="list__meta" style={{ marginBottom: 8 }}>
                            참석으로 표시해야 Google Calendar에 추가할 수 있습니다.
                          </p>
                        )}
                        {calendarWarnings[armKey] && (
                          <p className="status status--error">{calendarWarnings[armKey]}</p>
                        )}

                        <div className="form__actions">
                          <button className="btn btn--small" onClick={() => handleSave(doc, item)}>
                            {hasWarning ? (isArmed ? "그래도 저장" : "저장 (확인 필요)") : "저장"}
                          </button>
                          <button className="btn btn--ghost btn--small" onClick={() => handleIgnore(doc, item)}>
                            무시
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
