import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { createDoc, updateDocById, deleteDocById, listDocsByOwner } from "../firebase/crud";
import { todayDateString } from "../utils/date";
import "./crud-shared.css";

const emptyPlanForm = { grade: "", unit: "", lesson: "", topic: "", plannedWeek: "", memo: "" };
const emptyProgressForm = { className: "", unit: "", lesson: "", topic: "", lastClassDate: "", memo: "" };

export default function ProgressPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState([]);
  const [progress, setProgress] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [planForm, setPlanForm] = useState(emptyPlanForm);
  const [editingPlanId, setEditingPlanId] = useState(null);

  const [progressForm, setProgressForm] = useState(emptyProgressForm);
  const [editingProgressId, setEditingProgressId] = useState(null);

  async function loadAll() {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const [p, cp] = await Promise.all([
        listDocsByOwner("lesson_plan", user.uid),
        listDocsByOwner("class_progress", user.uid),
      ]);
      setPlans(p.sort((a, b) => (a.plannedWeek ?? "").localeCompare(b.plannedWeek ?? "")));
      setProgress(cp.sort((a, b) => (a.className ?? "").localeCompare(b.className ?? "")));
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

  // 진도계획
  function startEditPlan(p) {
    setEditingPlanId(p.id);
    setPlanForm({
      grade: p.grade ?? "",
      unit: p.unit ?? "",
      lesson: p.lesson ?? "",
      topic: p.topic ?? "",
      plannedWeek: p.plannedWeek ?? "",
      memo: p.memo ?? "",
    });
  }

  function resetPlanForm() {
    setEditingPlanId(null);
    setPlanForm(emptyPlanForm);
  }

  async function submitPlan(e) {
    e.preventDefault();
    if (!planForm.grade || !planForm.unit) return;
    if (editingPlanId) {
      await updateDocById("lesson_plan", editingPlanId, planForm);
    } else {
      await createDoc("lesson_plan", user.uid, planForm);
    }
    resetPlanForm();
    loadAll();
  }

  async function removePlan(id) {
    await deleteDocById("lesson_plan", id);
    if (editingPlanId === id) resetPlanForm();
    loadAll();
  }

  // 학급별 실제 진도
  function startEditProgress(cp) {
    setEditingProgressId(cp.id);
    setProgressForm({
      className: cp.className ?? "",
      unit: cp.unit ?? "",
      lesson: cp.lesson ?? "",
      topic: cp.topic ?? "",
      lastClassDate: cp.lastClassDate ?? todayDateString(),
      memo: cp.memo ?? "",
    });
  }

  function startNewProgress() {
    setEditingProgressId(null);
    setProgressForm({ ...emptyProgressForm, lastClassDate: todayDateString() });
  }

  function resetProgressForm() {
    setEditingProgressId(null);
    setProgressForm(emptyProgressForm);
  }

  async function submitProgress(e) {
    e.preventDefault();
    if (!progressForm.className) return;
    const payload = { ...progressForm, lastClassDate: progressForm.lastClassDate || todayDateString() };
    if (editingProgressId) {
      await updateDocById("class_progress", editingProgressId, payload);
    } else {
      await createDoc("class_progress", user.uid, payload);
    }
    resetProgressForm();
    loadAll();
  }

  async function removeProgress(id) {
    await deleteDocById("class_progress", id);
    if (editingProgressId === id) resetProgressForm();
    loadAll();
  }

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">수업 진도</h1>
        <p className="page__desc">
          진도계획은 앞으로의 계획, 학급별 진도는 실제로 어디까지 수업했는지를 나타냅니다. 두 값을
          비교해 반별 진도 차이를 확인할 수 있습니다.
        </p>
      </header>

      {loading && <p className="status">불러오는 중…</p>}
      {error && <p className="status status--error">진도 정보를 불러오지 못했습니다.</p>}

      {!loading && !error && (
        <>
          <section className="page__section">
            <h2 className="section__title">진도계획</h2>

            <form className="form" onSubmit={submitPlan}>
              <div className="field">
                <label>학년</label>
                <input
                  placeholder="예: 3"
                  value={planForm.grade}
                  onChange={(e) => setPlanForm({ ...planForm, grade: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>단원</label>
                <input
                  placeholder="예: 영양소"
                  value={planForm.unit}
                  onChange={(e) => setPlanForm({ ...planForm, unit: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>차시</label>
                <input
                  placeholder="예: 3차시"
                  value={planForm.lesson}
                  onChange={(e) => setPlanForm({ ...planForm, lesson: e.target.value })}
                />
              </div>
              <div className="field field--grow">
                <label>주제</label>
                <input
                  placeholder="예: 5대 영양소의 기능"
                  value={planForm.topic}
                  onChange={(e) => setPlanForm({ ...planForm, topic: e.target.value })}
                />
              </div>
              <div className="field">
                <label>계획 주차</label>
                <input
                  placeholder="예: 2026-09-1주"
                  value={planForm.plannedWeek}
                  onChange={(e) => setPlanForm({ ...planForm, plannedWeek: e.target.value })}
                />
              </div>
              <div className="field field--grow">
                <label>메모</label>
                <input
                  value={planForm.memo}
                  onChange={(e) => setPlanForm({ ...planForm, memo: e.target.value })}
                />
              </div>
              <div className="form__actions">
                <button type="submit" className="btn">
                  {editingPlanId ? "수정 저장" : "추가"}
                </button>
                {editingPlanId && (
                  <button type="button" className="btn btn--ghost" onClick={resetPlanForm}>
                    취소
                  </button>
                )}
              </div>
            </form>

            <div className="list">
              {plans.length === 0 && <p className="list--empty">등록된 진도계획이 없습니다.</p>}
              {plans.map((p) => (
                <div className="list__row" key={p.id}>
                  <div className="list__main">
                    <p className="list__title">
                      {p.grade}학년 · {p.unit} {p.lesson} — {p.topic}
                    </p>
                    <p className="list__meta">
                      {p.plannedWeek}
                      {p.memo ? ` · ${p.memo}` : ""}
                    </p>
                  </div>
                  <div className="list__actions">
                    <button className="btn btn--ghost btn--small" onClick={() => startEditPlan(p)}>
                      수정
                    </button>
                    <button className="btn btn--danger btn--small" onClick={() => removePlan(p.id)}>
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="page__section">
            <h2 className="section__title">학급별 실제 진도</h2>

            <form className="form" onSubmit={submitProgress}>
              <div className="field">
                <label>학급</label>
                <input
                  placeholder="예: 3-2"
                  value={progressForm.className}
                  onChange={(e) => setProgressForm({ ...progressForm, className: e.target.value })}
                  required
                />
              </div>
              <div className="field">
                <label>단원</label>
                <input
                  value={progressForm.unit}
                  onChange={(e) => setProgressForm({ ...progressForm, unit: e.target.value })}
                />
              </div>
              <div className="field">
                <label>차시</label>
                <input
                  placeholder="예: 2차시"
                  value={progressForm.lesson}
                  onChange={(e) => setProgressForm({ ...progressForm, lesson: e.target.value })}
                />
              </div>
              <div className="field field--grow">
                <label>주제</label>
                <input
                  value={progressForm.topic}
                  onChange={(e) => setProgressForm({ ...progressForm, topic: e.target.value })}
                />
              </div>
              <div className="field">
                <label>수업한 날짜</label>
                <input
                  type="date"
                  value={progressForm.lastClassDate}
                  onChange={(e) => setProgressForm({ ...progressForm, lastClassDate: e.target.value })}
                />
              </div>
              <div className="form__actions">
                <button type="submit" className="btn">
                  {editingProgressId ? "수정 저장" : "추가"}
                </button>
                {editingProgressId ? (
                  <button type="button" className="btn btn--ghost" onClick={resetProgressForm}>
                    취소
                  </button>
                ) : (
                  progressForm.className && (
                    <button type="button" className="btn btn--ghost" onClick={startNewProgress}>
                      초기화
                    </button>
                  )
                )}
              </div>
            </form>

            <div className="list">
              {progress.length === 0 && <p className="list--empty">등록된 학급 진도가 없습니다.</p>}
              {progress.map((cp) => (
                <div className="list__row" key={cp.id}>
                  <div className="list__main">
                    <p className="list__title">
                      {cp.className} — {cp.unit} {cp.lesson} {cp.topic ? `· ${cp.topic}` : ""}
                    </p>
                    <p className="list__meta">
                      마지막 수업일: {cp.lastClassDate}
                      {cp.memo ? ` · ${cp.memo}` : ""}
                    </p>
                  </div>
                  <div className="list__actions">
                    <button className="btn btn--ghost btn--small" onClick={() => startEditProgress(cp)}>
                      수정
                    </button>
                    <button className="btn btn--danger btn--small" onClick={() => removeProgress(cp.id)}>
                      삭제
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
