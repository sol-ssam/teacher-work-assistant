const SEOUL_TZ = "Asia/Seoul";

// YYYY-MM-DD (Asia/Seoul 기준)
export function todayDateString() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function todayDisplayString() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(new Date());
}

export function nowHourMinuteInSeoul() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: SEOUL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hour = Number(parts.find((p) => p.type === "hour").value);
  const minute = Number(parts.find((p) => p.type === "minute").value);
  return { hour, minute };
}

// "월", "화", "수", "목", "금", "토", "일" (Asia/Seoul 기준, WEEKDAYS 상수와 동일한 표기)
export function todayWeekdayKorean() {
  return new Intl.DateTimeFormat("ko-KR", {
    timeZone: SEOUL_TZ,
    weekday: "short",
  }).format(new Date());
}

// 브라우저의 로컬 타임존과 무관하게 순수 캘린더 날짜 연산만 한다.
// (new Date(dateStr).toISOString() 방식은 로컬 타임존에 따라 하루가 밀리는 문제가 있어 사용하지 않는다.)
export function addDaysToDateString(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  utcDate.setUTCDate(utcDate.getUTCDate() + days);
  const yyyy = utcDate.getUTCFullYear();
  const mm = String(utcDate.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utcDate.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// todayWeekdayKorean()과 같은 표기("월"~"일")를, 오늘이 아닌 임의의 YYYY-MM-DD에 대해 계산한다.
// 남은 수업 횟수 계산처럼 미래/과거 날짜의 요일이 필요한 곳에서 쓴다.
export function weekdayKoreanOf(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcDate = new Date(Date.UTC(y, m - 1, d));
  return new Intl.DateTimeFormat("ko-KR", { timeZone: SEOUL_TZ, weekday: "short" }).format(utcDate);
}

// dateStr이 from~to(둘 다 포함) 범위에 있는지, 문자열 비교로 안전하게 확인한다.
export function isDateInRange(dateStr, from, to) {
  return dateStr >= from && dateStr <= to;
}

// 주어진 YYYY-MM-DD 날짜를 사람이 읽기 쉬운 "9월 9일" 형태로 표시한다. 올해가 아닌
// 날짜는 "2025년 9월 9일"처럼 연도를 함께 표시한다. 최근 기록처럼 여러 날짜가 섞여
// 나열되는 화면에서 쓴다.
export function formatDateDisplay(dateStr) {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const currentYear = Number(todayDateString().slice(0, 4));
  return y === currentYear ? `${m}월 ${d}일` : `${y}년 ${m}월 ${d}일`;
}

// from~to(둘 다 포함) 사이의 모든 날짜를 YYYY-MM-DD 배열로 나열한다.
export function enumerateDateRange(from, to) {
  const dates = [];
  let cursor = from;
  let guard = 0;
  while (cursor <= to && guard < 400) {
    dates.push(cursor);
    cursor = addDaysToDateString(cursor, 1);
    guard += 1;
  }
  return dates;
}

// 주어진 연/월의 마지막 날짜를 YYYY-MM-DD로 반환한다. 남은 수업 횟수 계산의 기본 종료일
// ("이번 달 말까지")로 쓴다.
export function endOfMonthDateString(year, month) {
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
}
