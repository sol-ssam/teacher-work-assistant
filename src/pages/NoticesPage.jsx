import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { todayDateString, formatDateDisplay } from "../utils/date";
import "./crud-shared.css";
import "./NoticesPage.css";

const emptyForm = { content: "", important: false, expiresAt: "" };

// 등록 form과 인라인 수정 form이 완전히 동일한 필드 UI를 공유한다.
// 내용 textarea는 자체 full-width row를 갖고(다른 field와 flex-wrap으로 폭을
// 나눠 갖지 않도록 별도 wrapper로 분리), 유효기간/중요는 그 아래 보조 행에 배치한다.
function NoticeFormFields({ values, onChange }) {
  return (
    <>
      <div className="np-form__content-row">
        <label>내용</label>
        <textarea
          className="np-form__textarea"
          value={values.content}
          onChange={(e) => onChange({ ...values, content: e.target.value })}
          required
        />
      </div>
      <div className="np-form__meta-row">
        <div className="field">
          <label>유효기간(선택)</label>
          <input type="date" value={values.expiresAt} onChange={(e) => onChange({ ...values, expiresAt: e.target.value })} />
        </div>
        <div className="field field--checkbox">
          <input type="checkbox" checked={values.important} onChange={(e) => onChange({ ...values, important: e.target.checked })} />
          <label>중요</label>
        </div>
      </div>
    </>
  );
}

export default function NoticesPage() {
  const { user } = useAuth();
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showExpired, setShowExpired] = useState(false);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState(emptyForm);

  const [editingId, setEditingId] = useState(null);
  const [editForm, setEditForm] = useState(emptyForm);

  async function load() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listDocsByOwner("notices", user.uid);
      setNotices(list.sort((a, b) => (b.dateAdded ?? "").localeCompare(a.dateAdded ?? "")));
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

  function startEdit(n) {
    setShowCreateForm(false); // 한 번에 하나의 form만 - 신규 등록 form이 열려 있으면 닫는다.
    setEditingId(n.id);
    setEditForm({
      content: n.content ?? "",
      important: !!n.important,
      expiresAt: n.expiresAt ?? "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm);
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!createForm.content) return;
    const now = new Date().toISOString();
    const payload = { ...createForm, content: createForm.content.replace(/^\s+|\s+$/g, "") };
    await createDoc("notices", user.uid, { ...payload, source: "manual", dateAdded: todayDateString(), createdAt: now });
    closeCreateForm();
    load();
  }

  async function submitEdit(e) {
    e.preventDefault();
    if (!editForm.content) return;
    // 시작/끝 공백만 정리하고, 사용자가 입력한 내부 줄바꿈(\n)은 그대로 보존한다.
    const payload = { ...editForm, content: editForm.content.replace(/^\s+|\s+$/g, "") };
    await updateDocById("notices", editingId, payload);
    cancelEdit();
    load();
  }

  async function remove(id) {
    await deleteDocById("notices", id);
    if (editingId === id) cancelEdit();
    load();
  }

  const today = todayDateString();
  const visible = notices.filter((n) => showExpired || !n.expiresAt || n.expiresAt >= today);

  return (
    <div className="page notices-page">
      <header className="page__head">
        <h1 className="page__title">주요 안내</h1>
        <p className="page__desc">기억해둘 중요한 정보를 기록하고 관리해요.</p>
        <p className="page__helper">중요 표시된 안내는 홈 화면 브리핑에도 함께 표시됩니다.</p>
      </header>

      <div className="np-toolbar">
        <label className="np-toolbar__checkbox">
          <input type="checkbox" checked={showExpired} onChange={(e) => setShowExpired(e.target.checked)} />
          유효기간 지난 안내도 보기
        </label>
        {!showCreateForm && (
          <button type="button" className="btn" onClick={openCreateForm}>
            + 안내 추가
          </button>
        )}
      </div>

      {loading && <p className="status">불러오는 중…</p>}
      {error && <p className="status status--error">주요 안내를 불러오지 못했습니다.</p>}

      {!loading && !error && (
        <>
          {showCreateForm && (
            <form className="form np-form" onSubmit={submitCreate}>
              <NoticeFormFields values={createForm} onChange={setCreateForm} />
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

          <div className="np-list">
            {visible.length === 0 && <p className="list--empty">등록된 주요 안내가 없습니다.</p>}
            {visible.map((n) =>
              editingId === n.id ? (
                // 이 안내가 원래 있던 바로 그 카드 자리에서 수정 form으로 전환된다.
                <form className="form np-form np-form--inline" key={n.id} onSubmit={submitEdit}>
                  <NoticeFormFields values={editForm} onChange={setEditForm} />
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
                <div className="np-card" key={n.id}>
                  {n.important && <span className="badge badge--important">중요</span>}
                  <p className="np-card__content">{n.content}</p>
                  <div className="np-card__footer">
                    <p className="np-card__meta">
                      등록 · {formatDateDisplay(n.dateAdded)}
                      {n.expiresAt ? ` · 유효기간 · ${formatDateDisplay(n.expiresAt)}까지` : ""}
                    </p>
                    <div className="list__actions">
                      <button className="btn-text" onClick={() => startEdit(n)}>
                        수정
                      </button>
                      <button className="btn-text btn-text--danger" onClick={() => remove(n.id)}>
                        삭제
                      </button>
                    </div>
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
