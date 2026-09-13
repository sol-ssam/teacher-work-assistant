import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { getClassProgress } from "../firebase/collections";
import { listDocsByOwner } from "../firebase/crud";
import { getEffectiveDayTimetable, isTimetableChangedDay } from "../utils/effectiveTimetable";
import { getSettings, markBriefingShownToday } from "../firebase/settingsService";
import { todayDateString, todayDisplayString, formatDateDisplay } from "../utils/date";
import { shouldTriggerAutoBriefing } from "../utils/briefing";
import { analyzeProgress } from "../utils/progressAnalysis";
import { sortByPriorityThenDate } from "../utils/taskUrgency";
import {
  deriveTodayEvents,
  deriveUpcomingEvents,
  deriveOverdueTasks,
  deriveTodayDueTasks,
  deriveUpcomingTasks,
} from "../utils/briefingDerive";
import { eventTypeDisplayLabel } from "../utils/constants";
import { formatClassName } from "../utils/progressComparison";
import BriefingSection from "../components/BriefingSection";
import HomeQuickAssistant from "../components/HomeQuickAssistant";
import "./Home.css";

// Promise.allSettled 결과 하나를 { value, failed } 형태로 풀어주고, 실패한 경우
// 어떤 조회가 실패했는지 개발 콘솔에 명확히 남긴다. 사용자 화면에는 이 원문 오류를
// 노출하지 않는다 - 화면에는 해당 섹션만 "불러오지 못했습니다"로 표시한다.
function unwrap(result, label) {
  if (result.status === "fulfilled") {
    return { value: result.value, failed: false };
  }
  console.error(`[Briefing] ${label} failed:`, result.reason);
  return { value: [], failed: true };
}

export default function Home() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isFreshBriefing, setIsFreshBriefing] = useState(false);
  // "다가오는 일정" 카드 안의 일정/업무 탭 - Home 안에서만 쓰이는 단순 UI state다.
  // 기본값은 "events"(기존 사용 경험 그대로 다가오는 일정이 먼저 보임). 저장하지 않으므로
  // Home을 다시 열면 항상 "일정"으로 돌아간다.
  const [upcomingTab, setUpcomingTab] = useState("events");

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        // 이 부분(설정 조회)이 실패하면 브리핑 전체를 보여줄 수 없으므로 총체적 실패로 다룬다.
        const settings = await getSettings(user.uid);
        const triggerAuto = shouldTriggerAutoBriefing(settings);

        // events/tasks는 각각 ownerId 기준으로 딱 한 번만 읽고, 오늘/기한초과/다가오는
        // 항목 등 여러 조각은 전부 클라이언트에서 파생시킨다 (불필요한 복합 색인과
        // 중복 조회를 피하기 위함). 하나가 실패해도 나머지는 정상 표시되도록
        // Promise.all이 아니라 Promise.allSettled를 사용한다.
        const results = await Promise.allSettled([
          listDocsByOwner("timetable", user.uid),
          listDocsByOwner("timetable_overrides", user.uid),
          listDocsByOwner("school_day_schedules", user.uid),
          listDocsByOwner("events", user.uid),
          listDocsByOwner("tasks", user.uid),
          listDocsByOwner("lesson_plan", user.uid),
          getClassProgress(user.uid),
        ]);

        if (cancelled) return;

        const { value: fullTimetable, failed: timetableFailed } = unwrap(results[0], "timetable");
        const { value: allOverrides, failed: overridesFailed } = unwrap(results[1], "timetable_overrides");
        const { value: schoolDaySchedules, failed: schedulesFailed } = unwrap(results[2], "school_day_schedules");
        const { value: allEvents, failed: eventsFailed } = unwrap(results[3], "events");
        const { value: allTasks, failed: tasksFailed } = unwrap(results[4], "tasks");
        const { value: lessonPlans, failed: lessonPlansFailed } = unwrap(results[5], "lesson_plan");
        const { value: classProgress, failed: classProgressFailed } = unwrap(
          results[6],
          "getClassProgress"
        );

        const today = todayDateString();

        // 오늘의 "최종 실제 시간표" - 학사일정 요일대체(confirmed)와 개인 timetable_overrides가
        // 이미 반영된 결과다. remainingLessons.js가 남은 수업을 셀 때 쓰는 것과 같은 우선순위
        // (school_day_schedules -> 기본 timetable -> 개인 override)를 그대로 따른다.
        const todayEffective = (timetableFailed || overridesFailed || schedulesFailed)
          ? { periods: [], scheduleDayOverride: null }
          : getEffectiveDayTimetable(today, {
              timetable: fullTimetable,
              timetableOverrides: allOverrides,
              schoolDaySchedules,
            });
        const baseTimetable = todayEffective.periods.filter((p) => p.className && !p.excludedByAcademicSchedule);
        const todayHasTimetableChange =
          !timetableFailed &&
          !overridesFailed &&
          !schedulesFailed &&
          isTimetableChangedDay(today, { timetableOverrides: allOverrides, schoolDaySchedules });
        const todayEvents = deriveTodayEvents(allEvents, today);
        const progressFailed = lessonPlansFailed || classProgressFailed;
        const { diffMessages } = progressFailed
          ? { diffMessages: [] }
          : analyzeProgress(lessonPlans, classProgress);

        setData({
          baseTimetable,
          timetableFailed,
          todayHasTimetableChange,
          meetings: todayEvents.filter((e) => e.type !== "personal"),
          personalEvents: todayEvents.filter((e) => e.type === "personal"),
          upcomingEvents: [...deriveUpcomingEvents(allEvents, today)].sort((a, b) => {
            const byDate = (a.date || "").localeCompare(b.date || "");
            if (byDate !== 0) return byDate;
            return (a.startTime || "").localeCompare(b.startTime || "");
          }),
          eventsFailed,
          overdueTasks: sortByPriorityThenDate(deriveOverdueTasks(allTasks, today)),
          dueTasks: sortByPriorityThenDate(deriveTodayDueTasks(allTasks, today)),
          upcomingTasks: sortByPriorityThenDate(deriveUpcomingTasks(allTasks, today)),
          tasksFailed,
          diffMessages,
          progressFailed,
        });

        if (triggerAuto) {
          setIsFreshBriefing(true);
          markBriefingShownToday(user.uid).catch(() => {});
        }
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Home에서 카드 하나에 보여줄 소수 항목 개수 - 기존 "다가오는 일정"도 이 카드에서는
  // 이 정도만 보여주고 나머지는 "전체 보기"로 넘긴다.
  const UPCOMING_DISPLAY_LIMIT = 4;

  // "다가오는 업무" = 오늘 마감(dueTasks) + 미래 마감(upcomingTasks). 둘 다 이미
  // briefingDerive.js가 완료 여부/마감일로 걸러낸 기존 배열이다 - 여기서는 새로 필터링하지
  // 않고 합쳐서 마감일 오름차순으로만 다시 정렬한다(요청하신 "가까운 마감일 -> 먼 마감일"
  // 순서 - 기존 sortByPriorityThenDate의 priority 우선 정렬과는 다른 기준이라 별도로 정렬).
  // 연체 업무(overdueTasks)는 포함하지 않는다 - 오늘의 주요 확인에서 이미 다룬다.
  const upcomingTasksForCard = data
    ? [...data.dueTasks, ...data.upcomingTasks].sort((a, b) =>
        (a.dueDate ?? "").localeCompare(b.dueDate ?? "")
      )
    : [];

  const priorityItems = data
    ? [
        ...data.overdueTasks.map((t) => ({
          key: `od-${t.id}`,
          category: "업무",
          text: t.title,
          meta: `${t.dueDate} 지남`,
        })),
        ...data.dueTasks.map((t) => ({
          key: `dt-${t.id}`,
          category: "업무",
          text: t.title,
          meta: "오늘까지",
        })),
        ...(data.todayHasTimetableChange
          ? [
              {
                key: "tt-changed",
                category: "시간표",
                text: "오늘 시간표 변동이 있습니다 — 아래 오늘 수업을 확인하세요.",
                meta: "오늘",
              },
            ]
          : []),
        ...data.meetings.map((e) => ({
          key: `mt-${e.id}`,
          category: "회의",
          text: `${eventTypeDisplayLabel(e)} — ${e.title}`,
          meta: e.startTime || "오늘",
        })),
      ]
    : [];

  const priorityDataFailed = data && (data.timetableFailed || data.tasksFailed || data.eventsFailed);

  return (
    <div className="home">
      <header className="home__head">
        <div className="home__head-text">
          <p className="home__greeting">선생님 안녕하세요 🌷</p>
          <p className="home__subgreeting">오늘도 좋은 하루 되세요!</p>
          <p className="home__date">{todayDisplayString()}</p>

          {data && (
            <div className="home__summary">
              <span className="home__summary-pill">
                오늘 수업 <strong>{data.baseTimetable.length}</strong>
              </span>
              <span className="home__summary-pill">
                오늘 일정 <strong>{data.meetings.length + data.personalEvents.length}</strong>
              </span>
              <span className="home__summary-pill">
                오늘 마감 <strong>{data.dueTasks.length}</strong>
              </span>
              {isFreshBriefing && <span className="home__summary-badge">🔔 오늘 처음 확인</span>}
            </div>
          )}
        </div>
        <div className="home__head-decor" aria-hidden="true" />
      </header>

      {loading && <p className="home__status">오늘 하루를 정리하는 중입니다…</p>}

      {error && (
        <p className="home__status home__status--error">
          브리핑 데이터를 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}

      {data && (
        <div className="home__grid">
          {/* 1행: 오늘의 주요 확인 + 오늘 수업. 이 row 안에 실제로 존재하는 카드만
              children으로 들어가므로, 하나만 있으면 CSS(auto-fit)가 자동으로 풀폭으로
              펼쳐준다 - 별도의 JS 레이아웃 계산이 필요 없다. */}
          {(priorityItems.length > 0 || data.baseTimetable.length > 0) && (
            <div className="home__row">
              <BriefingSection
                icon="✅"
                title="오늘의 주요 확인"
                tone="urgent"
                items={priorityItems}
                failed={!!priorityDataFailed}
                hideWhenEmpty
                emptyText=""
                renderItem={(p) => (
                  <div className="home-priority-row">
                    <span className="home-priority-row__main">
                      <span className="home-badge">{p.category}</span>
                      {p.text}
                    </span>
                    {p.meta && <span className="home-priority-row__meta">{p.meta}</span>}
                  </div>
                )}
              />

              <BriefingSection
                icon="📚"
                title="오늘 수업"
                tone="class"
                navLink={{ to: "/timetable", label: "시간표 보기" }}
                items={data.baseTimetable}
                failed={data.timetableFailed}
                hideWhenEmpty
                emptyText=""
                renderItem={(t) => (
                  <>
                    <span className="home-row-period">{t.period}교시</span>
                    {formatClassName(t.className)} — {t.subject}
                    {t.isOverride && <span className="home-badge home-badge--change">변경</span>}
                  </>
                )}
              />
            </div>
          )}

          {/* 2행: 다가오는 일정/업무 + AI 비서. AI 카드는 항상 렌더링되므로 이 row는
              절대 비지 않는다. 다가오는 일정/업무 카드는 둘 중 하나라도 있으면 유지하고,
              하나만 렌더링되는 BriefingSection 대신 탭 전환이 가능한 커스텀 마크업을 쓴다
              (탭에 따라 제목 옆 "전체 보기" 목적지도 함께 바뀌어야 하기 때문). */}
          <div className="home__row">
            {(data.upcomingEvents.length > 0 || upcomingTasksForCard.length > 0) && (
              <section className="briefing-section">
                <header className="briefing-section__head briefing-section__head--tabbed">
                  <span className="briefing-section__dot briefing-section__dot--prep" />
                  <span className="briefing-section__icon">📑</span>
                  <div className="home-tabs home-tabs--title" role="tablist" aria-label="다가오는 일정 또는 업무">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={upcomingTab === "events"}
                      className={"home-tab home-tab--title" + (upcomingTab === "events" ? " home-tab--active" : "")}
                      onClick={() => setUpcomingTab("events")}
                    >
                      다가오는 일정
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={upcomingTab === "tasks"}
                      className={"home-tab home-tab--title" + (upcomingTab === "tasks" ? " home-tab--active" : "")}
                      onClick={() => setUpcomingTab("tasks")}
                    >
                      다가오는 업무
                    </button>
                  </div>
                  <Link
                    to={upcomingTab === "events" ? "/events" : "/tasks"}
                    className="briefing-section__nav-link"
                  >
                    전체 보기 ›
                  </Link>
                </header>

                {upcomingTab === "events" ? (
                  data.eventsFailed ? (
                    <p className="briefing-section__empty briefing-section__empty--failed">
                      이 항목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
                    </p>
                  ) : data.upcomingEvents.length === 0 ? (
                    <p className="briefing-section__empty">다가오는 일정이 없어요.</p>
                  ) : (
                    <ul className="briefing-section__list">
                      {data.upcomingEvents.slice(0, UPCOMING_DISPLAY_LIMIT).map((e, i) => (
                        <li key={e.id ?? i} className="briefing-section__item">
                          <span className="home-row-date">{formatDateDisplay(e.date)}</span>
                          {e.title}
                        </li>
                      ))}
                    </ul>
                  )
                ) : data.tasksFailed ? (
                  <p className="briefing-section__empty briefing-section__empty--failed">
                    이 항목을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
                  </p>
                ) : upcomingTasksForCard.length === 0 ? (
                  <p className="briefing-section__empty">다가오는 업무가 없어요.</p>
                ) : (
                  <ul className="briefing-section__list">
                    {upcomingTasksForCard.slice(0, UPCOMING_DISPLAY_LIMIT).map((t) => (
                      <li key={t.id} className="briefing-section__item">
                        <span className="home-row-date">
                          {t.dueDate === todayDateString() ? "오늘" : formatDateDisplay(t.dueDate)}
                        </span>
                        {t.title}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            <HomeQuickAssistant />
          </div>

          {/* 3행: 수업 진도(있을 때만) - 주요 확인과 섞지 않고 하단 보조 카드로만 유지 */}
          {data.diffMessages.length > 0 && (
            <div className="home__row">
              <BriefingSection
                icon="📊"
                title="수업 진도"
                tone="class"
                navLink={{ to: "/progress", label: "수업 진도 보기" }}
                items={data.diffMessages}
                failed={data.progressFailed}
                hideWhenEmpty
                emptyText=""
                renderItem={(m) => m.text}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
