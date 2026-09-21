import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL } from "../utils/constants";
import { formatDateDisplay, todayDateString } from "../utils/date";
import { useFieldErrors, isBlank } from "../utils/formValidation";
import FieldError from "../components/FieldError";
import "./crud-shared.css";
import "./TasksPage.css";

const emptyForm = { title: "", dueDate: "", priority: "medium", memo: "" };

function validateTaskForm(values) {
  const errors = {};
  if (isBlank(values.title)) errors.title = "업무명을 입력해 주세요.";
  if (isBlank(values.dueDate)) errors.dueDate = "마감일을 선택해 주세요.";
  return errors;
}

// 등록 form과 인라인 수정 form이 완전히 동일한 필드 UI를 공유한다.
function TaskFormFields({ values, onChange, errors = {}, registerField, idPrefix }) {
  const id = (name) => `${idPrefix}-${name}`;
  return (
    <>
      <div className={"field field--grow" + (errors.title ? " field--invalid" : "")}>
        <label htmlFor={id("title")}>업무명</label>
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
      <div className={"field" + (errors.dueDate ? " field--invalid" : "")}>
        <label htmlFor={id("dueDate")}>마감일</label>
        <input
          id={id("dueDate")}
          ref={registerField("dueDate")}
          type="date"
          aria-invalid={!!errors.dueDate}
          aria-describedby={errors.dueDate ? id("dueDate-error") : undefined}
          value={values.dueDate}
          onChange={(e) => onChange({ ...values, dueDate: e.target.value })}
        />
        <FieldError id={id("dueDate-error")} message={errors.dueDate} />
      </div>
      <div className="field">
        <label htmlFor={id("priority")}>중요도</label>
        <select
          id={id("priority")}
          value={values.priority}
          onChange={(e) => onChange({ ...values, priority: e.target.value })}
        >
          {TASK_PRIORITIES.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field field--grow">
        <label htmlFor={id("memo")}>메모</label>
        <input id={id("memo")} value={values.memo} onChange={(e) => onChange({ ...values, memo: e.target.value })} />
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
  const createErrors = useFieldErrors();
  const onCreateChange = createErrors.withErrorClearing(setCreateForm);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);
  const editErrors = useFieldErrors();
  const onEditChange = editErrors.withErrorClearing(setEditForm);

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
    createErrors.clearAll();
  }

  function startEdit(t) {
    setShowCreateForm(false); // 한 번에 하나의 form만 - 신규 등록 form이 열려 있으면 닫는다.
    setEditingId(t.id);
    editErrors.clearAll();
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
    editErrors.clearAll();
  }

  // 할 일/완료/전체 필터를 바꾸면 수정 중이던 항목이 새 필터의 visible 목록에서 사라져
  // 보이지 않게 될 수 있다 - 그 상태로 편집 state만 남아 있다가, 다시 그 필터로 돌아오면
  // 예전 수정 폼이 그대로 다시 나타났다. 필터를 바꿀 때 기존 cancelEdit()으로 정리한다.
  // 작성 중인 새 업무 등록 폼(showCreateForm/createForm)은 건드리지 않는다.
  function handleSetFilter(f) {
    cancelEdit();
    setFilter(f);
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!createErrors.runValidation(validateTaskForm(createForm))) return;
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
    if (!editErrors.runValidation(validateTaskForm(editForm))) return;
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
            onClick={() => handleSetFilter("todo")}
          >
            할 일 {incomplete.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "done"}
            className={"tt-tabs__btn" + (filter === "done" ? " tt-tabs__btn--active" : "")}
            onClick={() => handleSetFilter("done")}
          >
            완료 {completed.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={"tt-tabs__btn" + (filter === "all" ? " tt-tabs__btn--active" : "")}
            onClick={() => handleSetFilter("all")}
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
            <form className="form tp-form" onSubmit={submitCreate} noValidate>
              <TaskFormFields
                values={createForm}
                onChange={onCreateChange}
                errors={createErrors.errors}
                registerField={createErrors.registerField}
                idPrefix="task-create"
              />
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
                <form className="form tp-form tp-form--inline" key={t.id} onSubmit={submitEdit} noValidate>
                  <TaskFormFields
                    values={editForm}
                    onChange={onEditChange}
                    errors={editErrors.errors}
                    registerField={editErrors.registerField}
                    idPrefix="task-edit"
                  />
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
