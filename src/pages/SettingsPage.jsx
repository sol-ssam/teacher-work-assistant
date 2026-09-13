import { useEffect, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGoogleCalendar } from "../contexts/GoogleCalendarContext";
import { listDocsByOwner } from "../firebase/crud";
import { getSettings, updateBriefingTime, updateHomeroomSettings } from "../firebase/settingsService";
import { resetWorkData, resetAllUserData } from "../firebase/resetData";
import { deleteCalendarEvent } from "../calendar/calendarApi";
import Modal from "../components/Modal";
import "./crud-shared.css";
import "./SettingsPage.css";

const CONFIRM_WORD = "초기화";

export default function SettingsPage() {
  const { user } = useAuth();
  const { configured, connected, connecting, error, connect, disconnect, getValidAccessToken } =
    useGoogleCalendar();

  const [syncedEventCount, setSyncedEventCount] = useState(0);

  useEffect(() => {
    if (!user) return;
    listDocsByOwner("events", user.uid)
      .then((events) => setSyncedEventCount(events.filter((e) => e.calendarSync && e.googleCalendarId).length))
      .catch(() => setSyncedEventCount(0));
  }, [user]);

  // 브리핑 시간
  const [briefingTime, setBriefingTime] = useState("08:20");
  const [briefingSaving, setBriefingSaving] = useState(false);
  const [briefingSaved, setBriefingSaved] = useState(false);

  // 담임 학급 설정. 담임을 해제해도 학년/반 입력값과 기존 담임 학급 시간표 데이터는
  // 지우지 않는다 - 나중에 다시 담임으로 설정했을 때 그대로 이어서 쓸 수 있게 하기 위해서다.
  const [isHomeroomTeacher, setIsHomeroomTeacher] = useState(false);
  const [homeroomGrade, setHomeroomGrade] = useState("");
  const [homeroomClassNum, setHomeroomClassNum] = useState("");
  const [homeroomSaving, setHomeroomSaving] = useState(false);
  const [homeroomSaved, setHomeroomSaved] = useState(false);

  useEffect(() => {
    if (!user) return;
    getSettings(user.uid)
      .then((s) => {
        setBriefingTime(s.briefingTime || "08:20");
        setIsHomeroomTeacher(!!s.isHomeroomTeacher);
        const [grade, classNum] = (s.homeroomClass || "").split("-");
        setHomeroomGrade(grade || "");
        setHomeroomClassNum(classNum || "");
      })
      .catch(() => {});
  }, [user]);

  async function saveBriefingTime() {
    if (!user) return;
    setBriefingSaving(true);
    setBriefingSaved(false);
    try {
      await updateBriefingTime(user.uid, briefingTime);
      setBriefingSaved(true);
    } finally {
      setBriefingSaving(false);
    }
  }

  async function saveHomeroomSettings() {
    if (!user) return;
    setHomeroomSaving(true);
    setHomeroomSaved(false);
    try {
      const homeroomClass =
        isHomeroomTeacher && homeroomGrade && homeroomClassNum
          ? `${homeroomGrade}-${homeroomClassNum}`
          : "";
      await updateHomeroomSettings(user.uid, { isHomeroomTeacher, homeroomClass });
      setHomeroomSaved(true);
    } finally {
      setHomeroomSaving(false);
    }
  }

  // 고급 설정(전체 사용자 데이터 초기화)을 기본적으로 접어둬서 실수로 누르기 어렵게 한다.
  const [showAdvanced, setShowAdvanced] = useState(false);

  // resetMode: null | "work" | "all"
  const [resetMode, setResetMode] = useState(null);
  const [confirmText, setConfirmText] = useState("");
  const [deleteCalendarToo, setDeleteCalendarToo] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  function openReset(mode) {
    setResetMode(mode);
    setConfirmText("");
    setDeleteCalendarToo(false);
    setResult(null);
  }

  function closeReset() {
    if (running) return;
    setResetMode(null);
  }

  async function runReset() {
    if (confirmText !== CONFIRM_WORD || !user) return;
    setRunning(true);
    setResult(null);
    try {
      // Google Calendar 삭제를 먼저 시도한다 - Firestore event를 먼저 지워버리면
      // googleCalendarId를 이용한 재시도가 어려워지기 때문에, 순서를
      // "Calendar 삭제 시도 → Firestore 삭제"로 둔다.
      let calendarFailures = 0;
      if (deleteCalendarToo) {
        const events = await listDocsByOwner("events", user.uid);
        const synced = events.filter((e) => e.calendarSync && e.googleCalendarId);
        const token = await getValidAccessToken();
        if (token) {
          for (const ev of synced) {
            try {
              // eslint-disable-next-line no-await-in-loop
              await deleteCalendarEvent(token, ev.googleCalendarId);
            } catch (e) {
              console.error("[Reset] calendar event delete failed:", e);
              calendarFailures += 1;
            }
          }
        } else if (synced.length > 0) {
          calendarFailures = synced.length;
        }
      }

      const { failedCollections } =
        resetMode === "all" ? await resetAllUserData(user.uid) : await resetWorkData(user.uid);

      setResult({ failedCollections, calendarFailures });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="page settings-page">
      <header className="page__head">
        <h1 className="page__title">설정</h1>
        <p className="page__desc">
          Google Calendar 연결, 아침 브리핑, 담임 학급과 데이터를 관리해요.
        </p>
      </header>

      <div className="setting-card">
        <div className="setting-card__head">
          <h2 className="setting-card__title">
            <span aria-hidden="true">📅</span> Google Calendar
          </h2>
          {configured && (
            <span className={"setting-card__status" + (connected ? " setting-card__status--ok" : "")}>
              {connected ? "✓ 연결됨" : "연결 필요"}
            </span>
          )}
        </div>

        {!configured ? (
          <p className="list--empty">Google Calendar 연동이 아직 설정되지 않았습니다.</p>
        ) : (
          <>
            <p className="setting-card__desc">선택한 일정을 Google Calendar와 연동할 수 있어요.</p>
            {!connected && (
              <p className="setting-card__helper">
                일정을 캘린더에 추가하려는 순간 자동으로 연결 창이 뜰 수도 있어요.
              </p>
            )}
            {error && <p className="status status--error">연결 오류: {error}</p>}
            <div className="setting-card__actions">
              {connected ? (
                <button className="btn btn--ghost btn--small" onClick={disconnect}>
                  연결 해제
                </button>
              ) : (
                <button className="btn btn--small" onClick={connect} disabled={connecting}>
                  {connecting ? "연결하는 중…" : "연결하기"}
                </button>
              )}
            </div>
          </>
        )}
      </div>

      <div className="setting-card">
        <h2 className="setting-card__title">
          <span aria-hidden="true">☀️</span> 아침 브리핑
        </h2>
        <p className="setting-card__desc">
          앱을 열었을 때 오늘의 브리핑을 보여주는 기준 시간을 설정해요.
        </p>
        <div className="setting-card__row">
          <div className="setting-card__field">
            <label>브리핑 기준 시간</label>
            <input
              type="time"
              value={briefingTime}
              onChange={(e) => {
                setBriefingTime(e.target.value);
                setBriefingSaved(false);
              }}
            />
          </div>
          <div className="setting-card__actions">
            <button className="btn btn--small" onClick={saveBriefingTime} disabled={briefingSaving}>
              {briefingSaving ? "저장 중…" : "저장"}
            </button>
            {briefingSaved && <span className="setting-card__saved">저장했습니다.</span>}
          </div>
        </div>
      </div>

      <div className="setting-card">
        <h2 className="setting-card__title">
          <span aria-hidden="true">🏫</span> 담임 학급
        </h2>
        <p className="setting-card__desc">
          담임을 맡고 있다면 학급을 등록해 시간표에서 함께 관리할 수 있어요.
        </p>

        <div className="setting-card__radio-group">
          <label className="setting-card__radio">
            <input
              type="radio"
              checked={!isHomeroomTeacher}
              onChange={() => {
                setIsHomeroomTeacher(false);
                setHomeroomSaved(false);
              }}
            />
            담임 아님
          </label>
          <label className="setting-card__radio">
            <input
              type="radio"
              checked={isHomeroomTeacher}
              onChange={() => {
                setIsHomeroomTeacher(true);
                setHomeroomSaved(false);
              }}
            />
            담임
          </label>
        </div>

        <div className="setting-card__row">
          <div className={"setting-card__field" + (!isHomeroomTeacher ? " setting-card__field--disabled" : "")}>
            <label>학년</label>
            <span className="setting-card__suffix-input">
              <input
                value={homeroomGrade}
                onChange={(e) => {
                  setHomeroomGrade(e.target.value);
                  setHomeroomSaved(false);
                }}
                placeholder="예: 3"
                disabled={!isHomeroomTeacher}
              />
              <span className="setting-card__suffix">학년</span>
            </span>
          </div>
          <div className={"setting-card__field" + (!isHomeroomTeacher ? " setting-card__field--disabled" : "")}>
            <label>반</label>
            <span className="setting-card__suffix-input">
              <input
                value={homeroomClassNum}
                onChange={(e) => {
                  setHomeroomClassNum(e.target.value);
                  setHomeroomSaved(false);
                }}
                placeholder="예: 6"
                disabled={!isHomeroomTeacher}
              />
              <span className="setting-card__suffix">반</span>
            </span>
          </div>
          <div className="setting-card__actions">
            <button className="btn btn--small" onClick={saveHomeroomSettings} disabled={homeroomSaving}>
              {homeroomSaving ? "저장 중…" : "저장"}
            </button>
            {homeroomSaved && <span className="setting-card__saved">저장했습니다.</span>}
          </div>
        </div>
      </div>

      {/* 고급 설정 - 기존 showAdvanced state를 그대로 재사용한다(새 state를 만들지 않음).
          기본적으로 접혀 있고, 펼치면 그 안에 데이터 초기화(업무/전체) 둘 다 들어간다 -
          예전에는 "업무 데이터 초기화"만 항상 노출되고 "전체"만 고급 설정 뒤에 있었지만,
          이번에 데이터 초기화 전체를 고급 설정 안으로 옮겼다. */}
      <button
        type="button"
        className="setting-advanced-toggle"
        onClick={() => setShowAdvanced((v) => !v)}
        aria-expanded={showAdvanced}
      >
        고급 설정 {showAdvanced ? "⌄" : "〉"}
      </button>

      {showAdvanced && (
        <div className="setting-card">
          <h2 className="setting-card__title">데이터 초기화</h2>
          <p className="setting-card__desc">
            현재 로그인한 계정({user?.email})의 데이터만 삭제돼요. 개인 설정은 유지되며 삭제한
            데이터는 복구할 수 없어요.
          </p>
          <div className="setting-card__actions">
            <button className="btn btn--danger-outline" onClick={() => openReset("work")}>
              업무 데이터 초기화
            </button>
          </div>

          <div className="setting-card__advanced-divider" />

          <p className="setting-card__helper">
            설정(브리핑 시간 포함)까지 함께 삭제해요. Firebase Authentication 계정 자체는
            삭제되지 않아요.
          </p>
          <div className="setting-card__actions">
            <button className="btn btn--danger-outline" onClick={() => openReset("all")}>
              전체 사용자 데이터 초기화
            </button>
          </div>
        </div>
      )}

      <Modal
        open={!!resetMode}
        title={resetMode === "all" ? "전체 사용자 데이터 초기화" : "업무 데이터 초기화"}
        onClose={closeReset}
      >
        {result ? (
          <>
            <p style={{ marginTop: 0 }}>초기화를 완료했습니다.</p>
            {result.failedCollections.length > 0 && (
              <p className="status status--error">
                다음 항목은 삭제하지 못했습니다: {result.failedCollections.join(", ")}
              </p>
            )}
            {deleteCalendarToo && result.calendarFailures > 0 && (
              <p className="status status--error">
                Google Calendar 일정 {result.calendarFailures}건은 삭제하지 못했습니다.
              </p>
            )}
            <div className="form__actions">
              <button className="btn" onClick={() => setResetMode(null)}>
                닫기
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ marginTop: 0 }}>
              {resetMode === "all"
                ? "시간표, 일정, 업무, 주요 안내, 진도, 문서 분석 기록과 설정(브리핑 시간 포함)이 모두 삭제되며 되돌릴 수 없습니다."
                : "시간표, 일정, 업무, 주요 안내, 진도, 문서 분석 기록이 모두 삭제되며 되돌릴 수 없습니다. 브리핑 시간 등 개인 설정은 유지됩니다."}
            </p>

            {syncedEventCount > 0 && (
              <div className="field" style={{ marginBottom: 12 }}>
                <label>Google Calendar에 동기화된 일정이 {syncedEventCount}건 있습니다.</label>
                <div className="field--checkbox">
                  <input
                    type="radio"
                    id="reset-app-only"
                    checked={!deleteCalendarToo}
                    onChange={() => setDeleteCalendarToo(false)}
                  />
                  <label htmlFor="reset-app-only">앱 데이터만 초기화 (Google Calendar 일정은 유지)</label>
                </div>
                <div className="field--checkbox">
                  <input
                    type="radio"
                    id="reset-with-calendar"
                    checked={deleteCalendarToo}
                    onChange={() => setDeleteCalendarToo(true)}
                  />
                  <label htmlFor="reset-with-calendar">
                    앱 데이터 + 이 앱이 생성한 Google Calendar 일정도 삭제
                  </label>
                </div>
              </div>
            )}

            <div className="field" style={{ marginBottom: 12 }}>
              <label>계속하려면 &lsquo;{CONFIRM_WORD}&rsquo;를 입력하세요</label>
              <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} />
            </div>

            <div className="form__actions">
              <button
                className="btn btn--danger"
                disabled={confirmText !== CONFIRM_WORD || running}
                onClick={runReset}
              >
                {running ? "삭제하는 중…" : "삭제"}
              </button>
              <button className="btn btn--ghost" onClick={closeReset} disabled={running}>
                취소
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
