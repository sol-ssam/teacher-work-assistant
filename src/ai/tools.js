import { Schema } from "firebase/ai";

// 이 파일은 "선언"만 담당한다. 실제 Firestore 접근은 toolExecutors.js에서
// 기존 firebase/collections.js, firebase/crud.js 함수를 통해서만 이루어진다.
// Gemini는 여기 정의된 함수 이름과 파라미터 구조 밖의 어떤 컬렉션이나 쿼리도 만들어낼 수 없다.

const eventTypeSchema = Schema.enumString({
  description:
    "일정 구분. academic=학사일정, school=학교 행사, meeting=회의, council=협의회, training=연수, personal=개인 일정, other=기타(사용자가 직접 입력한 구분명을 customType에 채운다)",
  enum: ["academic", "school", "meeting", "council", "training", "personal", "other"],
});

const prioritySchema = Schema.enumString({
  description: "업무 중요도",
  enum: ["high", "medium", "low"],
});

const dateSchema = (description) => Schema.string({ description: `${description} (YYYY-MM-DD 형식)` });

export const addEventDeclaration = {
  name: "addEvent",
  description:
    "사용자가 자신의 일정(학사일정/학교행사/회의/개인일정)으로 명확히 확인한 경우에만 새 일정을 등록한다. 참석 여부가 불명확한 회의는 이 함수를 호출하지 말고 먼저 사용자에게 확인한다.",
  parameters: Schema.object({
    properties: {
      title: Schema.string({ description: "일정 제목" }),
      date: dateSchema("일정 날짜"),
      startTime: Schema.string({ description: "시작 시간 (HH:MM, 24시간제)" }),
      endTime: Schema.string({ description: "종료 시간 (HH:MM, 24시간제)" }),
      type: eventTypeSchema,
      customType: Schema.string({
        description:
          "type이 other(기타)일 때만 사용한다. 사용자가 말한 구분명을 그대로 채운다 (예: '웨딩 준비'). 그 외 type에서는 채우지 않는다.",
      }),
      attending: Schema.boolean({
        description:
          "type이 meeting(회의) 또는 council(협의회)일 때만 사용한다. 사용자가 참석한다고 명확히 말했으면 true, 불참이라고 말했으면 false로 채운다. 참석 여부가 불명확하면 이 필드를 채우지 말고, 애초에 이 함수를 호출하기 전에 먼저 사용자에게 참석 여부를 물어봐야 한다.",
      }),
      addToCalendar: Schema.boolean({
        description:
          "사용자가 '캘린더에도 추가해줘', 'Google 캘린더에 넣어줘'처럼 Google Calendar 동기화를 명확히 요청한 경우에만 true로 채운다. 사용자가 캘린더에 대해 언급하지 않았다면 이 필드를 채우지 않는다 - 동기화 의사를 임의로 추측하지 않는다.",
      }),
      memo: Schema.string({ description: "짧은 메모 (선택)" }),
    },
    optionalProperties: ["startTime", "endTime", "customType", "attending", "addToCalendar", "memo"],
  }),
};

export const updateEventDeclaration = {
  name: "updateEvent",
  description:
    "이미 등록된 일정 하나를 수정한다. eventId는 searchEvents 결과의 id를 사용한다. 취소된 일정은 여기서 status를 '취소'로 바꾼다 (기록은 남긴다) - 실제로 지우려면 deleteEvent를 쓴다.",
  parameters: Schema.object({
    properties: {
      eventId: Schema.string({ description: "수정할 일정의 id (searchEvents 결과에서 얻음)" }),
      title: Schema.string({ description: "새 제목 (변경 시)" }),
      date: dateSchema("새 날짜 (변경 시)"),
      startTime: Schema.string({ description: "새 시작 시간 (변경 시)" }),
      endTime: Schema.string({ description: "새 종료 시간 (변경 시)" }),
      type: eventTypeSchema,
      customType: Schema.string({
        description: "type을 other(기타)로 바꿀 때만 사용. 사용자가 말한 구분명을 채운다.",
      }),
      attending: Schema.boolean({
        description: "type이 meeting 또는 council일 때, 참석 여부가 바뀌었으면 채운다.",
      }),
      status: Schema.string({ description: "상태: 예정/완료/취소 (변경 시)" }),
      memo: Schema.string({ description: "새 메모 (변경 시)" }),
    },
    optionalProperties: [
      "title",
      "date",
      "startTime",
      "endTime",
      "type",
      "customType",
      "attending",
      "status",
      "memo",
    ],
  }),
};

export const deleteEventDeclaration = {
  name: "deleteEvent",
  description:
    "일정을 Firestore에서 실제로 삭제한다(기록이 남지 않음). 사용자가 '취소됐어'라고만 말했다면 이 함수 대신 updateEvent로 status를 '취소'로 바꿔야 한다 - '삭제해줘', '지워줘'처럼 실제 삭제 의도가 명확할 때만 이 함수를 쓴다. 대상이 모호하면 먼저 searchEvents로 찾고, 여러 개가 검색되면 임의로 고르지 말고 사용자에게 어떤 일정인지 물어본다.",
  parameters: Schema.object({
    properties: {
      eventId: Schema.string({ description: "삭제할 일정의 id" }),
      alsoDeleteFromCalendar: Schema.boolean({
        description:
          "사용자가 '구글 캘린더에서도 삭제해줘', '캘린더에서도 지워줘'처럼 Calendar 삭제도 명확히 요청한 경우에만 true로 채운다. 단순히 '삭제해줘'라고만 했다면 채우지 않는다(앱에서만 삭제) - 사용자의 의도를 임의로 확장하지 않는다.",
      }),
    },
    optionalProperties: ["alsoDeleteFromCalendar"],
  }),
};

export const syncEventToCalendarDeclaration = {
  name: "syncEventToCalendar",
  description:
    "이미 Firestore에 등록되어 있는 기존 일정을 Google Calendar에 연결한다. 새 일정을 만들지 않는다 - '이것도 캘린더에 추가해줘', '방금 만든 일정 캘린더에 넣어줘'처럼 이미 언급된 일정을 가리킬 때 addEvent를 다시 호출하지 말고 이 함수를 쓴다. 이미 Calendar에 연결되어 있으면 중복으로 새로 만들지 않는다.",
  parameters: Schema.object({
    properties: {
      eventId: Schema.string({ description: "Calendar에 연결할 기존 일정의 id" }),
    },
  }),
};

export const searchEventsDeclaration = {
  name: "searchEvents",
  description: "날짜 범위 또는 구분으로 등록된 일정을 검색한다.",
  parameters: Schema.object({
    properties: {
      dateFrom: dateSchema("검색 시작 날짜 (선택, 생략 시 오늘)"),
      dateTo: dateSchema("검색 종료 날짜 (선택, 생략 시 dateFrom과 동일)"),
      type: eventTypeSchema,
    },
    optionalProperties: ["dateFrom", "dateTo", "type"],
  }),
};

export const addTaskDeclaration = {
  name: "addTask",
  description: "새로운 업무(할 일)를 마감일과 함께 등록한다.",
  parameters: Schema.object({
    properties: {
      title: Schema.string({ description: "업무명" }),
      dueDate: dateSchema("마감일"),
      priority: prioritySchema,
      memo: Schema.string({ description: "짧은 메모 (선택)" }),
    },
    optionalProperties: ["priority", "memo"],
  }),
};

export const updateTaskDeclaration = {
  name: "updateTask",
  description: "이미 등록된 업무 하나를 수정한다. taskId는 searchTasks 결과의 id를 사용한다.",
  parameters: Schema.object({
    properties: {
      taskId: Schema.string({ description: "수정할 업무의 id" }),
      title: Schema.string({ description: "새 업무명 (변경 시)" }),
      dueDate: dateSchema("새 마감일 (변경 시)"),
      priority: prioritySchema,
      memo: Schema.string({ description: "새 메모 (변경 시)" }),
    },
    optionalProperties: ["title", "dueDate", "priority", "memo"],
  }),
};

export const completeTaskDeclaration = {
  name: "completeTask",
  description: "업무를 완료 처리한다. taskId는 searchTasks 결과의 id를 사용한다.",
  parameters: Schema.object({
    properties: {
      taskId: Schema.string({ description: "완료 처리할 업무의 id" }),
    },
  }),
};

export const searchTasksDeclaration = {
  name: "searchTasks",
  description: "마감일 범위 또는 완료 여부로 업무를 검색한다.",
  parameters: Schema.object({
    properties: {
      dueFrom: dateSchema("검색 시작 마감일 (선택)"),
      dueTo: dateSchema("검색 종료 마감일 (선택)"),
      completed: Schema.boolean({ description: "완료 여부로 필터 (선택)" }),
    },
    optionalProperties: ["dueFrom", "dueTo", "completed"],
  }),
};

export const updateClassProgressDeclaration = {
  name: "updateClassProgress",
  description:
    "특정 학급의 실제 수업 진도를 수정한다(단원/차시/주제/마지막 수업일). 해당 학급 기록이 없으면 새로 만든다.",
  parameters: Schema.object({
    properties: {
      className: Schema.string({ description: "학급 (예: 3-2)" }),
      unit: Schema.string({ description: "단원 (변경 시)" }),
      lesson: Schema.string({ description: "차시 (예: 4차시) (변경 시)" }),
      topic: Schema.string({ description: "주제 (변경 시)" }),
      lastClassDate: dateSchema("수업한 날짜 (선택, 생략 시 오늘)"),
    },
    optionalProperties: ["unit", "lesson", "topic", "lastClassDate"],
  }),
};

export const searchClassProgressDeclaration = {
  name: "searchClassProgress",
  description: "학급별 실제 수업 진도를 조회한다.",
  parameters: Schema.object({
    properties: {
      className: Schema.string({ description: "특정 학급만 조회 (선택, 생략 시 전체)" }),
    },
    optionalProperties: ["className"],
  }),
};

export const searchTimetableDeclaration = {
  name: "searchTimetable",
  description: "기본 시간표를 요일별로 조회한다.",
  parameters: Schema.object({
    properties: {
      dayOfWeek: Schema.enumString({
        description: "조회할 요일 (월/화/수/목/금). 생략 시 오늘 요일.",
        enum: ["월", "화", "수", "목", "금"],
      }),
    },
    optionalProperties: ["dayOfWeek"],
  }),
};

export const searchTimetableOverridesDeclaration = {
  name: "searchTimetableOverrides",
  description: "특정 날짜의 일시적 시간표 변경 사항을 조회한다.",
  parameters: Schema.object({
    properties: {
      date: dateSchema("조회할 날짜 (선택, 생략 시 오늘)"),
    },
    optionalProperties: ["date"],
  }),
};

export const searchNoticesDeclaration = {
  name: "searchNotices",
  description:
    "등록된 주요 안내(일정/업무는 아니지만 기억해야 할 중요 정보)를 조회한다 (기본적으로 유효기간이 지나지 않은 중요 안내만).",
  parameters: Schema.object({
    properties: {
      importantOnly: Schema.boolean({ description: "중요 안내만 조회할지 (선택, 기본 true)" }),
    },
    optionalProperties: ["importantOnly"],
  }),
};

// ---- 아래부터는 월별 수업 진도 관리(progress_plans/progress_checks/school_day_schedules/
// lesson_adjustments) 관련 도구다. Google Calendar나 기존 class_progress 도구와는 완전히
//별개다. 실제 계산(남은 수업 횟수, 진도 비교, confirmed/needs_review 판정)은 전부 클라이언트
// 코드(remainingLessons.js, progressComparison.js)가 하고, 이 도구들은 그 결과를 조회하거나
// CRUD를 수행할 뿐이다.

const progressPlanItemSchema = Schema.object({
  properties: {
    title: Schema.string({ description: "진도 항목 제목" }),
    estimatedLessons: Schema.integer({
      description: "예상 차시 (선택). 사용자가 말하지 않았으면 채우지 않는다 - 임의로 추측하지 않는다.",
    }),
  },
  optionalProperties: ["estimatedLessons"],
});

export const addProgressPlanItemsDeclaration = {
  name: "addProgressPlanItems",
  description:
    "월별 진도계획 항목 여러 개를 한 번에 등록한다. 사용자가 학년과 진도 항목들을 순서대로 명확히 말한 경우에만 사용한다. items 배열의 순서가 곧 진도 순서이므로 사용자가 말한 순서 그대로 담는다.",
  parameters: Schema.object({
    properties: {
      grade: Schema.string({ description: "학년 (예: '3')" }),
      year: Schema.string({ description: "연도 (예: '2026'). 언급 없으면 오늘 날짜의 연도를 쓴다." }),
      month: Schema.string({ description: "월 (예: '9'). 언급 없으면 오늘 날짜의 월을 쓴다." }),
      items: Schema.array({
        items: progressPlanItemSchema,
        description: "사용자가 말한 순서 그대로의 진도 항목 목록",
      }),
    },
    optionalProperties: ["year", "month"],
  }),
};

export const getProgressStatusDeclaration = {
  name: "getProgressStatus",
  description:
    "학년(및 선택적으로 특정 학급)의 월별 진도 현황(현재/다음 항목, 남은 항목 수, 학급 간 진도 차이)을 조회한다. 계산은 전부 결정론적 코드가 하며, 너는 그 결과를 자연어로 설명하는 데만 사용한다 - 네가 직접 진도를 비교하거나 판단하지 않는다.",
  parameters: Schema.object({
    properties: {
      grade: Schema.string({ description: "학년" }),
      year: Schema.string({ description: "연도 (선택, 생략 시 이번 달 기준)" }),
      month: Schema.string({ description: "월 (선택, 생략 시 이번 달 기준)" }),
      className: Schema.string({ description: "특정 학급만 조회 (선택, 생략 시 그 학년 전체). 사용자가 말한 표현(예: '101', '101반', '1-1', '1-1반', '1학년 1반')을 그대로 전달해라 - 네가 임의로 내부 코드로 변환하려 하지 마라. 실행기가 실제 담당 학급과 대조해 결정론적으로 찾는다." }),
    },
    optionalProperties: ["year", "month", "className"],
  }),
};

export const getRemainingLessonsDeclaration = {
  name: "getRemainingLessons",
  description:
    "특정 학급의 실제 남은 수업 횟수와 계산 근거를 조회한다. 날짜·시수 계산은 전부 코드가 수행하며, 너는 그 결과를 그대로 설명한다 - 직접 계산하거나 임의로 보정하지 않는다.",
  parameters: Schema.object({
    properties: {
      className: Schema.string({ description: "학급. 사용자가 말한 표현(예: '101', '101반', '1-1', '1-1반', '1학년 1반')을 그대로 전달해라 - 네가 임의로 내부 코드로 변환하려 하지 마라. 실행기가 실제 담당 학급과 대조해 결정론적으로 찾는다." }),
      dateFrom: dateSchema("계산 시작일 (선택, 생략 시 오늘)"),
      dateTo: dateSchema("계산 종료일 (선택, 생략 시 이번 달 말일)"),
    },
    optionalProperties: ["dateFrom", "dateTo"],
  }),
};

export const addLessonAdjustmentDeclaration = {
  name: "addLessonAdjustment",
  description:
    "학사일정에 없던 갑작스러운 수업 증감을 진도 계산 전용으로 기록한다(timetable 자체는 바꾸지 않는다). 날짜·학급·증감량 중 하나라도 불명확하면 호출하지 말고 먼저 사용자에게 확인한다.",
  parameters: Schema.object({
    properties: {
      date: dateSchema("보정할 날짜"),
      className: Schema.string({ description: "학급. 사용자가 말한 표현(예: '101', '101반', '1-1', '1-1반', '1학년 1반')을 그대로 전달해라 - 네가 임의로 내부 코드로 변환하려 하지 마라. 실행기가 실제 담당 학급과 대조해 결정론적으로 찾는다." }),
      delta: Schema.integer({ description: "변화량. 수업이 빠졌으면 음수(예: -1), 추가됐으면 양수(예: 1)." }),
      reason: Schema.string({ description: "이유" }),
    },
    optionalProperties: ["reason"],
  }),
};

export const searchNeedsReviewSchedulesDeclaration = {
  name: "searchNeedsReviewSchedules",
  description: "아직 수업 영향이 확정되지 않은(추후 확인 필요) 학사일정 목록을 조회한다.",
  parameters: Schema.object({ properties: {} }),
};

export const updateSchoolDayScheduleDeclaration = {
  name: "updateSchoolDaySchedule",
  description:
    "이미 등록된 학사일정 해석 하나를 수정한다. 특히 사용자가 '추후 확인 필요' 상태였던 일정의 실제 학년/교시를 알려주면, 그 정보를 반영해 상태를 confirmed로 바꿀 때 쓴다. scheduleId는 searchNeedsReviewSchedules 결과의 id를 사용한다. 정보가 불명확하면 임의로 확정하지 말고 사용자에게 다시 확인한다.",
  parameters: Schema.object({
    properties: {
      scheduleId: Schema.string({ description: "수정할 학사일정의 id" }),
      status: Schema.enumString({
        description: "새 상태",
        enum: ["confirmed", "needs_review", "no_impact"],
      }),
      affectedGrades: Schema.array({ items: Schema.integer(), description: "영향 받는 학년 (선택)" }),
      affectedPeriods: Schema.array({ items: Schema.integer(), description: "영향 받는 교시 (선택)" }),
      noClassGrades: Schema.array({ items: Schema.integer(), description: "수업 없는 학년 (선택)" }),
    },
    optionalProperties: ["status", "affectedGrades", "affectedPeriods", "noClassGrades"],
  }),
};

export const updateProgressStatusDeclaration = {
  name: "updateProgressStatus",
  description:
    "실제 학급의 수업 진도 상태를 기록/수정한다. 사용자가 '~까지 끝났다/완료했다/끝냈다'처럼 말하면 completedThroughTitle을 채우고(그 항목까지 전부 완료 처리, 진행 중 상태는 정리됨), '~을 진행 중이다/~시작했다/~의 일부까지 했다'처럼 부분 진도를 말하면 currentPlanItemTitle과 detail을 채운다(그 이전 항목까지만 완료 처리, 이 항목 자체는 미완료로 남고 세부 진도로 기록됨). 두 경우를 동시에 채우지 않는다. Firestore id는 네가 만들어내지 않는다 - 실행기가 progress_plans에서 제목으로 실제 항목을 찾는다. 완료인지 진행 중인지 불명확하면 이 함수를 호출하지 말고 먼저 사용자에게 확인한다.",
  parameters: Schema.object({
    properties: {
      className: Schema.string({ description: "학급 (timetable에 실제 존재하는, 사용자가 담당하는 학급만 허용된다). 사용자가 말한 표현(예: '101', '101반', '1-1', '1-1반', '1학년 1반')을 그대로 전달해라 - 네가 임의로 내부 코드로 변환하려 하지 마라. 실행기가 실제 담당 학급과 대조해 결정론적으로 찾는다." }),
      year: Schema.string({ description: "연도 (선택, 생략 시 이번 달 기준)" }),
      month: Schema.string({ description: "월 (선택, 생략 시 이번 달 기준)" }),
      completedThroughTitle: Schema.string({
        description: "'~까지 끝났다'고 말한 진도 항목의 제목 그대로. 이걸 채우면 currentPlanItemTitle/detail은 채우지 않는다.",
      }),
      currentPlanItemTitle: Schema.string({
        description: "지금 진행 중인 진도 항목의 제목 그대로. completedThroughTitle과 동시에 쓰지 않는다.",
      }),
      detail: Schema.string({
        description: "currentPlanItemTitle과 함께 쓴다. 사용자가 말한 세부 진도 서술을 그대로 담는다(예: '지방의 기능까지'). 임의로 만들어내지 않는다.",
      }),
      lastClassDate: dateSchema("이 진도가 진행된 날짜 (선택, 생략 시 오늘)"),
    },
    optionalProperties: ["year", "month", "completedThroughTitle", "currentPlanItemTitle", "detail", "lastClassDate"],
  }),
};

export const getProgressHistoryDeclaration = {
  name: "getProgressHistory",
  description:
    "과거 진도 이력(progress_history)을 조회한다. '지난 수업에 어디까지 했지?', '탄수화물 언제 끝났어?', '탄수화물 완료한 반은 어디야?' 같은 질문에 쓴다. className을 생략하면 전체 담당 학급을 대상으로 조회한다(예: '탄수화물 끝낸 반 알려줘'). 날짜·제목 필터링은 코드가 수행하며, 없는 기록을 추측해서 만들어내지 않는다.",
  parameters: Schema.object({
    properties: {
      className: Schema.string({ description: "학급 (선택, 생략 시 전체 담당 학급 대상). 사용자가 말한 표현(예: '101', '101반', '1-1', '1-1반', '1학년 1반')을 그대로 전달해라 - 네가 임의로 내부 코드로 변환하려 하지 마라. 실행기가 실제 담당 학급과 대조해 결정론적으로 찾는다." }),
      planItemTitle: Schema.string({ description: "진도명으로 필터링 (선택, 예: '탄수화물'). 부분 일치로 찾는다." }),
      dateFrom: dateSchema("조회 시작일 (선택)"),
      dateTo: dateSchema("조회 종료일 (선택)"),
      limit: Schema.integer({ description: "최대 조회 개수 (선택, 기본 15)" }),
    },
    optionalProperties: ["className", "planItemTitle", "dateFrom", "dateTo", "limit"],
  }),
};

export const updateProgressHistoryDeclaration = {
  name: "updateProgressHistory",
  description:
    "이미 기록된 과거 진도 이력(progress_history) 하나를 수정한다 - 현재 진도(updateProgressStatus가 관리하는 progress_current/progress_checks)에는 전혀 영향을 주지 않는다. historyId로 정확히 하나를 지정해야 한다. historyId를 모르면 먼저 getProgressHistory로 조회하고, 후보가 여러 개면 임의로 고르지 말고 사용자에게 어느 기록인지 확인한다. '~까지 했다/끝났다'처럼 현재 진도를 바꾸려는 말에는 이 도구가 아니라 updateProgressStatus를 쓴다.",
  parameters: Schema.object({
    properties: {
      historyId: Schema.string({ description: "수정할 기록의 id (getProgressHistory 결과의 id)" }),
      lessonDate: dateSchema("새 실제 수업일(완료일)"),
      planItemTitle: Schema.string({ description: "새 진도명" }),
    },
    optionalProperties: ["lessonDate", "planItemTitle"],
  }),
};

export const deleteProgressHistoryDeclaration = {
  name: "deleteProgressHistory",
  description:
    "이미 기록된 과거 진도 이력(progress_history) 하나를 삭제한다 - 현재 진도(progress_current/progress_checks)는 전혀 건드리지 않는다. historyId로 정확히 지정된 기록 하나만 삭제한다. 여러 후보 중 하나로 특정할 수 없으면 절대 임의로 삭제하지 말고 사용자에게 먼저 확인한다 - 삭제는 되돌릴 수 없다.",
  parameters: Schema.object({
    properties: {
      historyId: Schema.string({ description: "삭제할 기록의 id (getProgressHistory 결과의 id)" }),
    },
  }),
};

export const clearProgressCurrentDeclaration = {
  name: "clearProgressCurrent",
  description:
    "학급의 '진행 중' 세부 진도 표시만 지운다 - 완료 처리는 하지 않는다. 사용자가 '진행 중 표시 지워줘', '진행중 잘못 기록했어 그냥 지워줘'처럼 완료 여부는 언급하지 않고 진행 중 상태만 없애 달라고 할 때 쓴다. 이미 완료로 체크된 항목에는 영향을 주지 않는다. '~까지 끝났다'나 '~까지만 했다'처럼 완료 상태 자체를 바꾸려는 요청에는 이 도구 대신 updateProgressStatus를 쓴다.",
  parameters: Schema.object({
    properties: {
      className: Schema.string({ description: "학급 (timetable에 실제 존재하는, 사용자가 담당하는 학급만 허용된다). 사용자가 말한 표현(예: '101', '101반', '1-1', '1-1반', '1학년 1반')을 그대로 전달해라 - 네가 임의로 내부 코드로 변환하려 하지 마라. 실행기가 실제 담당 학급과 대조해 결정론적으로 찾는다." }),
    },
  }),
};

export const changeTimetableDeclaration = {
  name: "changeTimetable",
  description:
    "개인 시간표의 일시적인 교시 맞교환/수업 이동만 등록하는 도구이다. school_day_schedules를 수정하지 않는다. scheduleDayOverride를 만들거나 수정하지 않는다. 학사일정을 수정하지 않는다. 기본 timetable을 수정하지 않는다 - 오직 그 날짜에만 적용되는 timetable_overrides를 추가할 뿐이다. '오늘은 금요일 수업이야'처럼 학교 전체 대체요일을 말하는 입력에는 이 도구를 쓰지 않는다(지원 범위 아님 - 학사일정 관리 기능을 안내한다). 실제 수업 내용(학급/과목)은 네가 채우지 않는다 - 실행기가 그 날짜의 실제 적용 시간표(학사일정 반영 포함)에서 결정론적으로 조회한다. source 교시에 등록된 수업이 없거나 destination 교시에 이미 다른 수업이 있으면 저장하지 않고 실패를 돌려준다 - 임의로 덮어쓰거나 자동으로 맞교환으로 바꾸지 않는다.",
  parameters: Schema.object({
    properties: {
      changeMode: Schema.enumString({
        description: "'바뀌었다/맞바뀌었다'처럼 서로 교환된 경우 swap, '옮겨졌다/이동했다'처럼 한쪽만 자리를 옮긴 경우 move.",
        enum: ["swap", "move"],
      }),
      sourceDate: dateSchema("원래 수업 날짜"),
      sourcePeriod: Schema.integer({ description: "원래 교시" }),
      destinationDate: dateSchema("바뀔 날짜 (선택, 생략 시 sourceDate와 동일 - 같은 날짜 안에서의 이동/맞교환)"),
      destinationPeriod: Schema.integer({ description: "바뀔 교시" }),
    },
    optionalProperties: ["destinationDate"],
  }),
};

export const getGoogleCalendarEventsDeclaration = {
  name: "getGoogleCalendarEvents",
  description:
    "특정 날짜의 Google Calendar 일정을 조회한다 - 조회 전용이며 Firestore에 절대 저장하지 않는다. 결과를 후보 목록으로 사용자에게 보여주기만 한다. '가져와줘'라고 말했어도 조회 직후 자동으로 전부 저장하지 않는다 - 사용자가 어떤 것을 가져올지 고르면 그때 importGoogleCalendarEvents를 별도로 호출한다. alreadyImported가 true인 항목은 이미 업무비서에 등록되어 있다는 뜻이다.",
  parameters: Schema.object({
    properties: {
      date: dateSchema("조회할 날짜"),
    },
  }),
};

export const importGoogleCalendarEventsDeclaration = {
  name: "importGoogleCalendarEvents",
  description:
    "직전에 getGoogleCalendarEvents로 조회한 후보 중 사용자가 실제로 선택한 일정만 Firestore events에 저장한다. 제목/날짜/시간을 네가 새로 만들어서 넘기지 않는다 - 반드시 방금 조회 결과에 있던 실제 Google event id만 googleEventIds에 담아 전달한다. 실행기가 그 id로 Google Calendar를 다시 조회해 실제 데이터를 확인한 뒤 저장하므로, 존재하지 않는 id를 지어내면 저장되지 않는다. 이미 업무비서에 등록된(alreadyImported) 일정은 다시 저장하지 않는다.",
  parameters: Schema.object({
    properties: {
      date: dateSchema("조회했던 날짜 (직전 getGoogleCalendarEvents에 쓴 것과 같은 날짜)"),
      googleEventIds: Schema.array({
        items: Schema.string(),
        description: "사용자가 선택한 일정들의 실제 Google event id 목록",
      }),
    },
  }),
};

export const TOOLS = [
  {
    functionDeclarations: [
      addEventDeclaration,
      updateEventDeclaration,
      deleteEventDeclaration,
      syncEventToCalendarDeclaration,
      searchEventsDeclaration,
      addTaskDeclaration,
      updateTaskDeclaration,
      completeTaskDeclaration,
      searchTasksDeclaration,
      // updateClassProgressDeclaration / searchClassProgressDeclaration(구 Phase 2
      // class_progress 시스템)은 더 이상 Gemini에게 노출하지 않는다. 새 진도관리
      // (progress_plans/progress_checks/progress_current)가 진도의 단일 기준이 되었으므로,
      // Gemini가 진도 대화에서 옛 class_progress 도구를 고르지 않도록 이 목록에서만 뺐다.
      // 실행기/선언 자체는 과거 호환을 위해 코드에 남겨뒀다(다른 곳에서 참조하지 않음).
      searchTimetableDeclaration,
      searchTimetableOverridesDeclaration,
      searchNoticesDeclaration,
      addProgressPlanItemsDeclaration,
      getProgressStatusDeclaration,
      getRemainingLessonsDeclaration,
      addLessonAdjustmentDeclaration,
      searchNeedsReviewSchedulesDeclaration,
      updateSchoolDayScheduleDeclaration,
      updateProgressStatusDeclaration,
      getProgressHistoryDeclaration,
      updateProgressHistoryDeclaration,
      deleteProgressHistoryDeclaration,
      clearProgressCurrentDeclaration,
      changeTimetableDeclaration,
      getGoogleCalendarEventsDeclaration,
      importGoogleCalendarEventsDeclaration,
    ],
  },
];
