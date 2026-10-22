import { addDaysToDateString } from "../utils/date";
import { resolveEventTimeType } from "../utils/constants";

const CALENDAR_ID = "primary";
const BASE_URL = `https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}/events`;
const TIME_ZONE = "Asia/Seoul";

// 사용자가 종료 시간을 입력해야만 해결되는 상황임을 명확히 구분하기 위한 전용 에러.
// 호출부(EventsPage/DocumentsPage/AI 비서 실행기)는 이 에러를 다른 실패와 구분해서
// "Google Calendar에 추가하려면 종료 시간을 입력해 주세요." 라고 안내해야 한다.
export class MissingEndTimeError extends Error {
  constructor() {
    super("Google Calendar에 추가하려면 종료 시간을 입력해 주세요.");
    this.name = "MissingEndTimeError";
  }
}

// timeType(기존 데이터는 없으면 startTime/endTime 조합으로 추론 - resolveEventTimeType)
// 기준 규칙(임의 추측 금지):
// - all_day: 날짜(들)만 있는 종일 일정. endDate가 있으면 기간 종일 일정이다.
// - range: 시작/종료 시간이 모두 있는 timed event. endDate가 있으면 기간의 마지막 날
//   endTime에 끝난다(예: 10/20 09:00 ~ 10/22 17:00).
// - start_only / deadline: 끝나는 시점에 대한 정보가 없다(시작 시간 또는 마감 시간
//   하나뿐). 종료 시간을 임의로 만들거나 all-day로 바꾸지 않고, 기존과 같은 원칙으로
//   MissingEndTimeError를 던진다 - 사용자가 종료 시간을 직접 입력해야 Calendar에 들어간다.
function toGoogleEventBody({ title, date, endDate, timeType, startTime, endTime, memo }) {
  const resolvedType = resolveEventTimeType({ timeType, startTime, endTime });
  const rangeEndDate = endDate || date;

  if (resolvedType === "all_day") {
    // Google Calendar는 all-day 이벤트의 end.date를 "다음 날"로 요구한다(종료일이
    // 배타적/exclusive) - 기간 일정도 마지막 날의 "다음 날"을 end.date로 쓴다.
    const nextDay = new Date(`${rangeEndDate}T00:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    const googleEndDate = nextDay.toISOString().slice(0, 10);

    return {
      summary: title,
      description: memo || undefined,
      start: { date },
      end: { date: googleEndDate },
    };
  }

  if (resolvedType === "range") {
    if (!(startTime && endTime)) throw new MissingEndTimeError();
    return {
      summary: title,
      description: memo || undefined,
      start: { dateTime: `${date}T${startTime}:00`, timeZone: TIME_ZONE },
      end: { dateTime: `${rangeEndDate}T${endTime}:00`, timeZone: TIME_ZONE },
    };
  }

  // start_only / deadline
  throw new MissingEndTimeError();
}

async function callCalendarApi(accessToken, path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message || `Google Calendar API 오류 (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    throw error;
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function createCalendarEvent(accessToken, event) {
  const body = toGoogleEventBody(event);
  const result = await callCalendarApi(accessToken, "", { method: "POST", body: JSON.stringify(body) });
  return result.id;
}

export async function updateCalendarEvent(accessToken, googleEventId, event) {
  const body = toGoogleEventBody(event);
  await callCalendarApi(accessToken, `/${googleEventId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteCalendarEvent(accessToken, googleEventId) {
  try {
    await callCalendarApi(accessToken, `/${googleEventId}`, { method: "DELETE" });
  } catch (e) {
    // 이미 Calendar에서 지워진 일정(404/410)은 우리 목적에서는 성공으로 취급한다.
    if (e.status === 404 || e.status === 410) return;
    throw e;
  }
}

// Google 응답의 event 하나를 이 앱의 events 스키마와 맞는 최소 정보로 변환한다.
// description/attendees/location 등 이번 기능에 필요 없는 필드는 가져오지 않는다.
// 종일 일정은 event.start.date(포함)만 date로 쓴다 - event.end.date는 Google이 exclusive
// end로 주는 값이라(하루짜리 종일 일정도 end.date는 다음 날짜다), 절대 date 판단에 쓰지
// 않는다 - 안 그러면 하루짜리 종일 일정이 다음 날 일정으로 잘못 저장된다.
function toCandidate(event) {
  const allDay = !!event.start?.date;

  if (allDay) {
    return {
      id: event.id,
      title: event.summary || "(제목 없음)",
      date: event.start.date,
      startTime: "",
      endTime: "",
      allDay: true,
    };
  }

  const startDateTime = event.start?.dateTime || "";
  const endDateTime = event.end?.dateTime || "";
  return {
    id: event.id,
    title: event.summary || "(제목 없음)",
    date: startDateTime.slice(0, 10),
    startTime: startDateTime.slice(11, 16),
    endTime: endDateTime.slice(11, 16),
    allDay: false,
  };
}

// 특정 날짜(YYYY-MM-DD, Asia/Seoul 기준) 하루 동안의 Google Calendar 일정을 조회한다.
// 그 날짜 00:00:00 ~ 다음 날짜 00:00:00 범위이고, timeMax는 Google API 관례대로 배타적
// 경계(다음 날 0시)를 그대로 쓴다. singleEvents=true로 반복 일정의 occurrence까지 개별
// 이벤트로 펼쳐서 받고, orderBy=startTime으로 시간순 정렬한다. Firestore에는 쓰지 않는다 -
// 순수 조회 함수다.
export async function listCalendarEvents(accessToken, date) {
  const nextDate = addDaysToDateString(date, 1);
  const params = new URLSearchParams({
    timeMin: `${date}T00:00:00+09:00`,
    timeMax: `${nextDate}T00:00:00+09:00`,
    singleEvents: "true",
    orderBy: "startTime",
    timeZone: TIME_ZONE,
  });

  const result = await callCalendarApi(accessToken, `?${params.toString()}`, { method: "GET" });
  return (result.items || []).map(toCandidate);
}
