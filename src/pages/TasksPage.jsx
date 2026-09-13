import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "../utils/constants";
import { formatDateDisplay, todayDateString } from "../utils/date";
import "./crud-shared.css";
import "./TasksPage.css";

const emptyForm = { title: "", dueDate: "", priority: "medium", memo: "" };

// 등록 form과 인라인 수정 form이 완전히 동일한 필드 UI를 공유한다.
function TaskFormFields({ values, onChange }) {
  return (
    <>
      <div className="field field--grow">
        <label>업무명</label>
        <input value={values.title} onChange={(e) => onChange({ ...values, title: e.target.value })} required />
      </div>
      <div className="field">
        <label>마감일</label>
        <input
          type="date"
          value={values.dueDate}
          onChange={(e) => onChange({ ...values, dueDate: e.target.value })}
          required
        />
      </div>
      <div className="field">
        <label>중요도</label>
        <select value={values.priority} onChange={(e) => onChange({ ...values, priority: e.target.value })}>
          {TASK_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field field--grow">
        <label>메모</label>
        <input value={values.memo} onChange={(e) => onChange({ ...values, memo: e.target.value })} />
      </div>
    </>
  );
}

export default function TasksPage() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("todo"); // "todo" | "done" | "all"

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  async function load() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listDocsByOwner("tasks", user.uid);
      setTasks(list.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")));
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
  }

  function startEdit(t) {
    setShowCreateForm(false); // 한 번에 하나의 form만 - 신규 등록 form이 열려 있으면 닫는다.
    setEditingId(t.id);
    setEditForm({
      title: t.title ?? "",
      dueDate: t.dueDate ?? "",
      priority: t.priority ?? "medium",
      memo: t.memo ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm);
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!createForm.title || !createForm.dueDate) return;
    const now = new Date().toISOString();
    await createDoc("tasks", user.uid, {
      ...createForm,
      completed: false,
      source: "manual",
      createdAt: now,
      updatedAt: now,
    });
    closeCreateForm();
    load();
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editForm.title || !editForm.dueDate) return;
    // 기존 update 로직 그대로 - Firestore document ID(editingId) 유지, 새 document 생성 안 함.
    await updateDocById("tasks", editingId, { ...editForm, updatedAt: new Date().toISOString() });
    cancelEdit();
    load();
  }

  // 체크박스 하나로 완료<->미완료를 전환한다 - 기존과 동일한 completed/updatedAt 갱신.
  async function toggleCompleted(t) {
    await updateDocById("tasks", t.id, { completed: !t.completed, updatedAt: new Date().toISOString() });
    load();
  }

  async function remove(id) {
    await deleteDocById("tasks", id);
    if (editingId === id) cancelEdit();
    load();
  }

  const incomplete = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);
  const visible = filter === "todo" ? incomplete : filter === "done" ? completed : tasks;

  function formatDue(dueDate) {
    if (!dueDate) return "";
    const isThisYear = dueDate.slice(0, 4) === todayDateString().slice(0, 4);
    const display = formatDateDisplay(dueDate);
    return isThisYear ? `${display}까지` : `${dueDate.slice(0, 4)}년 ${display}까지`;
  }

  return (
    <div className="page tasks-page">
      <header className="page__head">
        <h1 className="page__title">업무</h1>
        <p className="page__desc">해야 할 일을 등록하고 완료 여부와 마감일을 관리해요.</p>
      </header>

      <div className="tp-toolbar">
        <div className="tt-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "todo"}
            className={"tt-tabs__btn" + (filter === "todo" ? " tt-tabs__btn--active" : "")}
            onClick={() => setFilter("todo")}
          >
            할 일 {incomplete.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "done"}
            className={"tt-tabs__btn" + (filter === "done" ? " tt-tabs__btn--active" : "")}
            onClick={() => setFilter("done")}
          >
            완료 {completed.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={"tt-tabs__btn" + (filter === "all" ? " tt-tabs__btn--active" : "")}
            onClick={() => setFilter("all")}
          >
            전체 {tasks.length}
          </button>
        </div>
        {!showCreateForm && (
          <button type="button" className="btn" onClick={openCreateForm}>
            + 업무 추가
          </button>
        )}
      </div>

      {loading && <p className="status">불러오는 중…</p>}
      {error && <p className="status status--error">업무를 불러오지 못했습니다.</p>}

      {!loading && !error && (
        <>
          {showCreateForm && (
            <form className="form tp-form" onSubmit={submitCreate}>
              <TaskFormFields values={createForm} onChange={setCreateForm} />
              <div className="form__actions">
                <button type="submit" className="btn">
                  추가
                </button>
                <button type="button" className="btn btn--ghost" onClick={closeCreateForm}>
                  취소
                </button>
              </div>
            </form>
          )}

          <div className="tp-list">
            {visible.length === 0 && (
              <p className="list--empty">
                {filter === "todo"
                  ? "현재 남은 업무가 없어요."
                  : filter === "done"
                  ? "완료된 업무가 없어요."
                  : "등록된 업무가 없어요."}
              </p>
            )}
            {visible.map((t) =>
              editingId === t.id ? (
                // 이 업무가 원래 있던 바로 그 자리에서 수정 form으로 전환된다.
                <form className="form tp-form tp-form--inline" key={t.id} onSubmit={submitEdit}>
                  <TaskFormFields values={editForm} onChange={setEditForm} />
                  <div className="form__actions">
                    <button type="submit" className="btn">
                      저장
                    </button>
                    <button type="button" className="btn btn--ghost" onClick={cancelEdit}>
                      취소
                    </button>
                  </div>
                </form>
              ) : (
                <div className="tp-row" key={t.id}>
                  <label className="tp-checkbox">
                    <input
                      type="checkbox"
                      checked={!!t.completed}
                      onChange={() => toggleCompleted(t)}
                      aria-label={t.completed ? `${t.title} 완료 취소` : `${t.title} 완료 처리`}
                    />
                    <span className="tp-checkbox__box" aria-hidden="true" />
                  </label>
                  <div className="tp-row__main">
                    <p className={"tp-row__title" + (t.completed ? " tp-row__title--done" : "")}>
                      <span className={`badge badge--${t.priority}`}>
                        {TASK_PRIORITY_LABEL[t.priority] ?? t.priority}
                      </span>
                      {t.title}
                    </p>
                    {(t.dueDate || t.memo) && (
                      <p className="tp-row__meta">
                        {t.dueDate && formatDue(t.dueDate)}
                        {t.dueDate && t.memo ? " · " : ""}
                        {t.memo}
                      </p>
                    )}
                  </div>
                  <div className="list__actions">
                    <button className="btn-text" onClick={() => startEdit(t)}>
                      수정
                    </button>
                    <button className="btn-text btn-text--danger" onClick={() => remove(t.id)}>
                      삭제
                    </button>
                  </div>
                </div>
              )
            )}
          </div>
        </>
      )}
    </div>
  );
}
