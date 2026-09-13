// "기존 데이터와 동일/유사한 일정인지 확인하는 중복 탐지"(conflictDetection.js)와는
// 완전히 다른 기능이다. 이 파일은 "서로 다른 일정이지만 시간이 겹치는지"만 판단한다.
// AI를 사용하지 않고 date/startTime/endTime 필드만으로 순수 계산한다.
// 시간 충돌은 저장을 막는 조건이 아니라 경고일 뿐이다 - 호출부(UI)에서 저장 여부는
// 사용자가 결정한다.

function toMinutes(hhmm) {
  if (!hhmm) return null;
  const parts = String(hhmm).split(":");
  if (parts.length < 2) return null;
  const h = Number(parts[0]);
  const m = Number(parts[1]);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

// candidate: { date, startTime, endTime } - 새로 승인하려는 일정
// existingEvents: events 컬렉션 전체 배열
// options.excludeId: 이미 "동일/유사 데이터" 충돌로 판단되어 덮어쓸 대상인 기존 일정 id
//   (자기 자신과 시간 비교를 하지 않기 위해 제외한다)
export function findTimeConflicts(candidate, existingEvents, options = {}) {
  const { excludeId } = options;

  const candStart = toMinutes(candidate.startTime);
  // 새 일정에 시작시간 자체가 없으면(날짜만 있는 경우) 시간 충돌 검사를 하지 않는다.
  if (candStart == null) return [];

  const candEnd = toMinutes(candidate.endTime);

  return existingEvents.filter((ev) => {
    if (excludeId && ev.id === excludeId) return false;
    if (ev.date !== candidate.date) return false;

    const evStart = toMinutes(ev.startTime);
    // 기존 일정에 시간 정보가 전혀 없으면 시간으로 비교할 수 없으므로 제외한다.
    if (evStart == null) return false;

    const evEnd = toMinutes(ev.endTime);

    if (evEnd != null && candEnd != null) {
      // 둘 다 시작/종료가 있는 일반적인 경우: 범위가 실제로 겹치는지.
      // 끝나는 시간과 다음 일정의 시작 시간이 정확히 같은 경우는 충돌이 아니다.
      return candStart < evEnd && candEnd > evStart;
    }
    if (evEnd != null && candEnd == null) {
      // 기존 일정은 범위가 있고, 새 일정은 시작시간만 있는 경우:
      // 새 일정의 시작 시각이 기존 범위 [evStart, evEnd) 안에 들어가는지.
      return candStart >= evStart && candStart < evEnd;
    }
    if (evEnd == null && candEnd != null) {
      // 기존 일정은 시작시간만 있고, 새 일정은 범위가 있는 경우:
      // 기존 일정의 시작 시각이 새 일정 범위 [candStart, candEnd) 안에 들어가는지.
      return evStart >= candStart && evStart < candEnd;
    }
    // 둘 다 시작시간만 있는 경우: 정확히 같은 시각일 때만 충돌 가능성으로 본다.
    // (15:00과 15:30처럼 다르면, 임의로 길이를 추측해 충돌로 보지 않는다.)
    return evStart === candStart;
  });
}
