import { getGenerativeModel, Schema } from "firebase/ai";
import { getAIInstance } from "../firebase/ai";
import { todayDateString } from "../utils/date";

// 학사일정 분석은 일반 문서 분석(documentAnalysis.js), 시간표 분석(timetableAnalysis.js)과
// 완전히 별개의 1회성 Gemini 호출이다. 같은 파일 처리 인프라(부모 컴포넌트가 base64/텍스트로
// 변환해서 넘겨준다)를 그대로 재사용하지만, 결과 스키마와 프롬프트는 "평소와 다르게 수업이
// 운영되는 날짜"만 뽑아내는 이 용도에 맞게 새로 만들었다.
const MODEL_NAME = "gemini-3.1-flash-lite";

const candidateSchema = Schema.object({
  properties: {
    date: Schema.string({ description: "YYYY-MM-DD 형식의 날짜" }),
    originalText: Schema.string({
      description: "학사일정 문서에 실제로 적혀 있는 문구를 그대로 옮긴 것. 절대 요약하거나 바꿔 쓰지 마라.",
    }),
    status: Schema.enumString({
      description:
        "confirmed=일반 교과수업 영향이 명확해 바로 계산에 반영 가능. needs_review=날짜는 있지만 정확히 몇 학년/몇 교시가 영향받는지 확정할 수 없어 사용자 확인이 필요. no_impact=일반 교과수업에는 영향이 없는 것으로 판단됨(참고용으로만 남김).",
      enum: ["confirmed", "needs_review", "no_impact"],
    }),
    noRegularClasses: Schema.boolean({
      description: "재량휴업일/공휴일/방학 등 전교생이 명확하게 수업하지 않는 날이면 true.",
    }),
    noClassGrades: Schema.array({
      items: Schema.integer(),
      description: "학년별 시험 등으로 일반 수업이 없는 학년 번호 목록. 명시된 학년만 넣는다. 없으면 빈 배열.",
    }),
    scheduleDayOverride: Schema.enumString({
      description:
        "그 날짜의 실제 달력 요일이 아니다. 원문에 'OO요일 수업'/'OO요일 시간표'처럼 다른 요일의 시간표를 그대로 적용한다는 명시적 문구가 있을 때만 그 요일을 채워라. 날짜를 보고 요일을 계산해서 채우는 것은 절대 금지. 원문에 근거가 없으면(시험/단축수업/특정 교시 정보만 있는 경우 포함) 이 필드 자체를 만들지 마라.",
      enum: ["월", "화", "수", "목", "금"],
    }),
    regularPeriods: Schema.array({
      items: Schema.integer(),
      description: "'1-2 수업'처럼 특정 교시까지만 정규수업이라고 명시된 경우 그 교시 번호 목록. 없으면 빈 배열(=평소대로 전체 교시).",
    }),
    affectedGrades: Schema.array({
      items: Schema.integer(),
      description: "창체/동아리 등으로 특정 학년의 특정 교시가 영향받는 경우 그 학년 목록. 확실하지 않으면 채우지 말고 status를 needs_review로 둬라.",
    }),
    affectedPeriods: Schema.array({
      items: Schema.integer(),
      description: "위와 짝을 이루는 영향 교시 목록. 정확한 교시를 알 수 없다면 절대 추측해서 채우지 말고 빈 배열로 두고 status를 needs_review로 둬라.",
    }),
    memo: Schema.string({ description: "추가로 참고할 만한 짧은 설명 (선택)" }),
  },
  optionalProperties: [
    "noRegularClasses",
    "noClassGrades",
    "scheduleDayOverride",
    "regularPeriods",
    "affectedGrades",
    "affectedPeriods",
    "memo",
  ],
});

// classActivities(school_day_schedules.classActivities)로 저장될 "교시별 학교 자체
// 교육활동" 후보. 기존 candidates(날짜 전체의 학사일정 해석)와는 완전히 별개의 개념이다 -
// candidates는 "그 날짜가 평소와 다르게 운영되는가"를, classActivityCandidates는
// "그 날짜·학년(·반)·교시에 일반 교과수업 대신 학교 자체 활동이 있는가"를 다룬다.
// 반 범위(classScope/classNumbers)는 AI가 실제 className 문자열(예: "301")을 직접
// 만들어내지 않는다 - 이 앱의 className 표기는 교사마다 다를 수 있어(예: "301" 또는
// "3-1"), AI가 임의로 형식을 정하면 실제 시간표와 맞지 않을 위험이 있다. 대신 학년 안의
// "반 번호"만 숫자로 뽑고, 화면(MonthlyProgressPage.jsx)이 실제 담당 반 목록과 대조해
// 결정론적으로 className으로 바꾼다.
const classActivityCandidateSchema = Schema.object({
  properties: {
    date: Schema.string({ description: "YYYY-MM-DD 형식의 날짜" }),
    activityName: Schema.string({
      description:
        "문서에 적힌 활동명을 가능한 원문 그대로 사용해라. 임의로 축약하거나 일반화하지 마라(예: 문서에 'AI 윤리 및 디지털 시민교육'이라고 적혀 있으면 'AI교육'처럼 줄이지 말고 그대로 사용). 예: '롯데월드', 'AI윤리교육', '장애교육'.",
    }),
    originalText: Schema.string({
      description: "문서에 실제로 적힌 문구를 그대로 옮긴 것. 절대 요약하거나 바꿔 쓰지 마라.",
    }),
    grades: Schema.array({
      items: Schema.integer(),
      description: "이 활동의 대상 학년. 문서에서 명확히 확정할 수 있는 학년만 넣어라. 확정할 수 없으면 비워두고 status를 needs_review로 해라.",
    }),
    classScope: Schema.enumString({
      description: "all=해당 학년 전체 반이 대상. partial=일부 반만 대상(이 경우 classNumbers를 반드시 채워라).",
      enum: ["all", "partial"],
    }),
    classNumbers: Schema.array({
      items: Schema.integer(),
      description: "classScope가 partial일 때만 채운다. 대상 반 '번호'만(학급 전체 호칭이 아니라 숫자만). 예: '1~4반'→[1,2,3,4], '1,3,5반'→[1,3,5]. classScope가 all이면 빈 배열로 둬라.",
    }),
    periods: Schema.array({
      items: Schema.integer(),
      description: "활동이 적용되는 교시 번호 목록. '1~6교시'→[1,2,3,4,5,6]처럼 구간은 전부 풀어서 나열해라. 정확한 교시를 알 수 없으면 비워두고 status를 needs_review로 해라 - 추측 금지.",
    }),
    suggestedExcluded: Schema.boolean({
      description: "이 활동 때문에 그 교시의 일반 교과수업이 이루어지지 않는다고 볼 수 있는지에 대한 '제안값'일 뿐이다(최종 결정 아님) - 이 후보를 만들 정도로 특정 교시를 차지하는 프로그램이라면 활동의 종류와 관계없이 기본적으로 true로 제안해라. 항상 명시적으로 채워라(생략 금지).",
    }),
    status: Schema.enumString({
      description: "confirmed=학년·교시가 명확해 바로 검토 가능. needs_review=학년/반/교시 중 하나라도 불명확해 교사 확인이 필요함.",
      enum: ["confirmed", "needs_review"],
    }),
    memo: Schema.string({ description: "참고할 짧은 설명 (선택)" }),
  },
  optionalProperties: ["grades", "classScope", "classNumbers", "periods", "suggestedExcluded", "memo"],
});

const extractionSchema = Schema.object({
  properties: {
    candidates: Schema.array({ items: candidateSchema }),
    classActivityCandidates: Schema.array({ items: classActivityCandidateSchema }),
  },
});

function buildPrompt() {
  return `아래 파일은 학교의 연간(또는 일정 기간) 학사일정 문서다.
[오늘: ${todayDateString()}]

이 문서는 단순한 행사 목록이 아니라, 월별 표 안에 요일별로 날짜·교과시수(숫자)·행사/수업운영
문구가 함께 적혀 있는 형태다. 같은 날짜/셀에 여러 정보가 동시에 있을 수 있다. 반드시 그
날짜의 교과시수와 행사/수업운영 문구를 같은 맥락으로 함께 읽고 판단해라 - 행사 이름만 따로
떼어서 보지 마라.

이 문서에서 "평소 시간표와 다르게 수업이 운영되는 특별한 날짜"만 candidates 배열로 뽑아라.
아무 특이사항 없는 평범한 수업일은 후보로 만들지 마라 - 빈칸/정상수업일은 이미 있는 시간표를
그대로 쓰면 되므로 결과에 넣을 필요가 없다.

각 후보에는 originalText에 문서에 적힌 문구를 그대로 옮겨 적어라. 절대 요약하거나 다른 말로
바꾸지 마라 - 나중에 사용자가 원문과 대조해서 확인해야 한다.

# 교과시수는 "보조 근거"일 뿐, 교시 위치의 증거가 아니다
날짜 옆에 교과시수가 숫자로 적혀 있을 수 있다(예: 7, 4, 3, 2, 0). 이 숫자는 그날이
정상수업/부분수업/휴업 중 무엇인지 판단하는 보조 근거로만 써라. "교과시수 4"라는 이유만으로
regularPeriods를 [1,2,3,4]라고 추측하지 마라 - 교과시수는 수업 개수일 뿐 정확한 교시 위치를
말해주지 않는다. 교시는 아래처럼 원문에 실제로 명시된 경우에만 확정해라.

# 부분 교시 수업 (regularPeriods) - 원문에 교시가 명시된 경우만
아래처럼 표현은 다양하지만 전부 같은 뜻이다. 쉼표/물결/붙임표 표기를 정확히 해석해라.
- "1,2,3,4교시 수업", "1,2,3,4교시수업" → regularPeriods: [1,2,3,4]
- "1-4교시 수업", "1~4교시 수업" → regularPeriods: [1,2,3,4] (구간을 전부 나열)
- "5,6,7교시 수업", "5,6,7 수업" → regularPeriods: [5,6,7]
- "1,2,5,6교시수업" → regularPeriods: [1,2,5,6] (연속이 아니어도 있는 그대로)
원문에 교시 번호가 전혀 없다면(예: 교과시수 숫자만 있음) regularPeriods를 채우지 마라.

# 완전 휴업일 (noRegularClasses)
"대체공휴일", "재량휴업일", "추석연휴", "공휴일", "지방선거", "수능"처럼 학교 전체가 명확하게
정규수업을 하지 않는 날만 noRegularClasses: true로 판단해라. 행사 이름만 보고 섣불리
휴업이라고 추측하지 말고, 같은 셀의 교과시수·다른 문구도 함께 확인해라.

# 학년별 시험/행사 (noClassGrades) - 명시된 학년만
"중간고사(2,3)", "중간고사(1,2학년)", "3학년 기말고사", "기말고사(1,2학년)"처럼 시험 대상
학년이 명시되어 있으면 그 학년만 noClassGrades에 넣어라. 시험 문구가 있다고 학교 전체를
noRegularClasses: true로 처리하지 마라 - 명시되지 않은 다른 학년은 정상 수업일 수 있다.
예: "중간고사(2,3)" → noClassGrades: [2,3] (1학년까지 수업 없음으로 처리하면 안 됨)
예: "3학년 기말고사" → noClassGrades: [3] (1,2학년까지 수업 없음으로 처리하면 안 됨)

# 같은 날짜에 학년별로 운영이 다르게 적힌 복합 상황 - 매우 중요
예: "기말고사(1,2학년)" 옆에 "(3학년 4교시)"가 함께 적혀 있는 경우.
예: "중간고사(2,3)" 옆에 "(1학년 4교시)"가 함께 적혀 있는 경우.
이런 경우 한쪽 문구만 보고 모든 학년에 같은 규칙을 적용하지 마라. 이 앱은 하루에 하나의
해석만 반영할 수 있는 구조라서, 학년마다 서로 다른 운영이 동시에 적힌 날은 정확하게 나눠
표현할 수 없다. 이럴 때는 두 문구를 억지로 쪼개서 confirmed 후보 여러 개로 만들지 말고,
originalText에 두 문구를 모두 포함한 candidates 항목 하나만 만들고 status를 needs_review로
남겨라. memo에는 "학년별 수업 운영이 달라 확인 필요"라고 적어라.

# 다른 요일 시간표 적용 (scheduleDayOverride) - 매우 엄격하게 판단해라
scheduleDayOverride는 "그 날짜가 달력상 실제로 무슨 요일인가"를 저장하는 필드가 절대
아니다. 이 필드는 오직 "학사일정 원문에 다른 요일의 시간표를 그대로 적용한다는 내용이
명시되어 있을 때"만 쓴다.

절대 규칙:
1. scheduleDayOverride는 실제 달력 요일(actual calendar weekday)을 의미하지 않는다.
2. 날짜를 보고 그날이 무슨 요일인지 계산해서 채우는 행동을 절대 하지 마라.
3. 원문에 "OO요일 수업", "OO요일 시간표", "OO요일 시간표 운영/실시"처럼 다른 요일의
   시간표를 그대로 쓴다는 명시적 문구가 있을 때만 채운다.
4. 원문에 그런 근거가 전혀 없으면 이 필드 자체를 만들지 마라(omit) - 빈 문자열도 안 되고,
   그날의 실제 요일을 넣는 것도 안 된다.
5. 조금이라도 확신이 없으면 만들지 마라. 시험/단축수업/특정 학년 수업 여부/정규수업 교시
   정보(regularPeriods, noClassGrades 등)만으로는 scheduleDayOverride를 채울 근거가 되지
   않는다 - 이런 정보는 각자의 필드(regularPeriods, noClassGrades 등)에만 반영하고
   scheduleDayOverride와는 무관하게 처리해라.

올바른 예:
- 월요일 날짜, 원문 "금요일 수업" → scheduleDayOverride: "금"
- 화요일 날짜, 원문 "목요일 시간표 운영" → scheduleDayOverride: "목"

잘못된 예 (반드시 피해야 함):
- 날짜: 2026-04-23 (실제 달력상 목요일)
  원문: "중간고사(2,3) * 비급식2 (1학년 4교시)"
  잘못된 결과: scheduleDayOverride: "목" (원문에 요일 대체 근거가 전혀 없는데
  단지 그날이 목요일이라서 채운 것 - 절대 금지)
  올바른 결과: scheduleDayOverride 필드 자체를 만들지 않음, noClassGrades: [2,3],
  regularPeriods: [1,2,3,4]
- 원문 "기말고사(1,2학년) * 3학년 4교시" → scheduleDayOverride 만들지 않음
- 원문 "1,2,3,4교시 수업" → scheduleDayOverride 만들지 않음
- 원문이 단순 휴업일 표시(예: "재량휴업일") → scheduleDayOverride 만들지 않음

# 창의적 체험활동류 문구 - 숫자를 교시로 추측하지 마라
"교권보호·학폭1, 동아리3", "봉사2", "진로1", "자치1", "약물1, 동아리3"처럼 활동명 뒤에 숫자가
붙어 있으면, 그 숫자는 활동 시간 수일 뿐 정확한 교시 위치가 아니다. 이 숫자를 보고
affectedPeriods를 추측해서 채우지 마라. 이런 문구만 있고 정확한 교시를 알 수 없다면
status: needs_review로 두고 memo에 원문 그대로의 활동명을 남겨라.
단, "1,2,3,4교시 수업 / 동아리3"처럼 정규수업 교시가 별도로 명확히 적혀 있다면 그
regularPeriods는 확정해도 된다 - "동아리3"이 5~7교시라고 추측하지만 않으면 된다.

# 영어듣기평가 등 학년/교시가 불명확한 행사
"영어 듣기 평가"처럼 날짜만 있고 어느 학년의 몇 교시가 대체되는지 표에 명확히 나와 있지
않다면, affectedGrades/affectedPeriods를 추측해서 채우지 마라. status: needs_review로 두고
originalText는 원문 그대로, memo에는 "영어 듣기 평가의 대상 학년/교시 확인 필요"라고 적어라.

# 제외 규칙(중요, 문장/셀 전체가 아니라 해당 부분만 제외)
아래 표현이 있으면 그 부분은 이 교사의 일반 교과수업 시수 계산과 무관하므로 candidates로
만들지 마라: "스포츠(1,2학년)", "스포츠(3학년)", "학교스포츠클럽", "스포츠클럽", "자유학기",
"자유학년", "자유학년제", "자유학기A", "자유학기B", "주제", "진로".
단, 같은 날짜/같은 셀에 다른 중요한 내용이 함께 있다면(예: "영어 듣기 평가 / 스포츠(1,2학년)")
그 날짜 전체를 무시하지 말고, 관련 없는 부분(스포츠)만 제외한 채 나머지(영어 듣기 평가)는
정상적으로 candidates에 포함해라.

# 보수적으로 판단해라
너는 남은 수업 횟수를 직접 계산하지 않는다. 코드가 나중에 school_day_schedules를 바탕으로
계산한다. 애매한 내용을 억지로 confirmed로 만드는 것보다 needs_review로 남기는 편이 항상
더 안전하다. 조금이라도 확신이 서지 않으면 needs_review를 선택해라.

# 추가 임무: 교시별 학교 자체 교육활동 후보 (classActivityCandidates)
위 candidates(날짜 단위 학사일정 해석)와는 완전히 별개의 임무다. candidates 판단 규칙은
그대로 적용하고, 이번에는 같은 문서에서 다음 성격의 내용을 classActivityCandidates
배열로 추가로 뽑아라:

"표의 정규 교과수업이 아니라, 특정 날짜·학년(또는 일부 반)·교시 칸에 별도의
활동명/프로그램명이 적혀 있다"

는 내용이면 활동의 종류·성격과 관계없이 전부 후보로 뽑아라. 예시로 "롯데월드",
"AI윤리교육", "장애교육", "인성교육", "자치", "자치활동", "동아리", "봉사", "진로",
"진로체험", "성교육", "학교폭력예방교육", "안전교육", "디지털 시민교육", "금융교육",
"각종 특강", "뮤지컬 관람", "스케이트", "영화 관람", "고입설명회", "특성화고 설명회",
"대학생 학과 멘토링", "도자기 컵 만들기", "흡연교육", "도박예방교육", "졸업식", "축제",
"학년 행사", "반별 프로그램", "전환기 프로그램" 등이 있지만, 이 목록에 있는 단어만
찾으라는 뜻이 아니다 - 목록에 없는 활동명이라도 같은 방식으로 날짜·학년·교시 칸에
적혀 있으면 똑같이 후보로 뽑아라.

## 매우 중요 - 너의 역할은 "구조화"이고, "이 활동이 수업을 대체하는가"는 교사의 역할이다
너는 이 활동이 실제로 정규수업을 대체하는지, 교육 활동이므로 수업으로 인정될 수
있는지를 판단하지 않는다. "동아리/자치/봉사/진로/설명회는 정규수업일 수도 있어
애매하다", "이 활동이 수업을 실제로 대체하는지 불확실하다" 같은 이유로 후보 생성
자체를 건너뛰거나 버리지 마라. 활동명과 날짜를 읽을 수 있다면, 학년/반/교시 중
일부가 불명확해도(아래 각 항목의 안내에 따라 해당 필드만 비워두고 status를
needs_review로 하되) 후보 자체는 반드시 만들어라. 이 활동을 실제 수업 횟수에서
최종적으로 제외할지는 교사가 검토 화면에서 "수업 횟수에서 제외" 체크박스로 직접
결정한다 - 너는 후보를 빠짐없이 구조화하는 역할만 한다.

## 수업과 무관한 일정은 제외해라
"고입 원서접수", "합격자 발표", "서류 제출"처럼 교과수업 운영 자체에 영향을 주지 않는
단순 안내·행정 일정은 classActivityCandidates에 넣지 마라.

## 표의 헤더/메타데이터는 활동이 아니다
"날짜", "요일", "1교시"~"7교시" 같은 교시 칸 이름 자체, "학년", "반", "비고", "담당",
"장소", "점심시간", "등교", "하교"처럼 표의 틀을 이루는 헤더/메타데이터는 활동명이
아니므로 classActivityCandidates로 만들지 마라. 그 칸 안에 실제로 적힌 별도
프로그램/활동명만 후보로 뽑아라.

## 날짜 단위 학사일정과 중복 생성 금지
"재량휴업일", "방학", "개교기념일", 시험, "정규수업 없음", 특정 학년 전체 수업 없음,
"금요일 수업"/"월요일 수업" 같은 요일 대체 운영처럼 위 candidates가 이미 다루는
날짜 단위 해석은 classActivityCandidates로 다시 만들지 마라 - 그 정보는 candidates
배열에만 담는다. classActivityCandidates는 그 날짜 안에서 특정 학년·반·교시를
차지한 개별 프로그램에만 쓴다.

## 대상 학년(grades)
문서에 명시된 학년만 넣어라. 추측하지 마라. 확정할 수 없으면 비워두고 status를
needs_review로 해라.

## 대상 반(classScope/classNumbers) - 매우 중요
- 그 학년 전체가 대상이면 classScope: "all", classNumbers: [].
- "1~4반", "5,7반"처럼 일부 반만 명시돼 있으면 classScope: "partial"로 하고
  classNumbers에 반 "번호"만 정확히 나열해라(예: "1~4반"→[1,2,3,4], "1,3,5반"→[1,3,5]).
- "3학년 1~4반 AI윤리교육"과 "3학년 5~7반 AI윤리교육"처럼 같은 학년에서 반 그룹별로
  교시가 다르면, 절대 하나로 합치지 말고 각각 별도의 classActivityCandidate로 따로
  만들어라(classNumbers도 각 그룹만 따로).
- 반 번호를 정확히 알 수 없으면 classScope를 임의로 "all"로 단정하지 말고 status를
  needs_review로 남겨라.

## 교시(periods)
"1~6교시", "4교시", "6~7교시"처럼 명시된 교시만 정확히 나열해라(구간은 전부 풀어서
나열 - candidates의 regularPeriods와 같은 표기 규칙). 교시가 전혀 적혀 있지 않으면
periods를 비우고 status를 needs_review로 둬라 - 추측하지 마라.

## 같은 날 여러 활동
"4교시 장애교육 / 5교시 인성교육 / 6~7교시 자치"처럼 같은 날 서로 다른 교시에 서로
다른 활동이 있으면, 하나로 합치지 말고 활동별로 별도의 classActivityCandidate를 각각
만들어라.

## 수업 제외 추천값(suggestedExcluded) - 최종 결정이 아니다
너는 추천만 한다. 실제 적용 여부는 교사가 검토 화면에서 "수업 횟수에서 제외"
체크박스로 직접 켜고 끈다. 문서상 특정 교시를 명확히 차지하는 프로그램이라서
classActivityCandidate를 만들었다면, 활동의 종류·성격과 관계없이 기본적으로
suggestedExcluded: true로 제안해라. "동아리/자치/봉사/진로교육/설명회는 교사
상황에 따라 정규 수업으로 인정될 수도 있어 애매하다"는 이유로 suggestedExcluded를
false로 깎아내리지 마라 - 그 최종 판단은 교사의 몫이다. classActivityCandidate를
만들 때는 suggestedExcluded 필드를 생략하지 말고 항상 명시적으로 채워라.

## status
학년·교시가 명확하면 confirmed, 학년/반/교시 중 하나라도 불명확하면 needs_review로
남겨라.`;
}

// AI가 scheduleDayOverride를 채웠더라도, 원문에 "OO요일 수업"/"OO요일 시간표"처럼 명시적인
// 요일 대체 근거가 없으면 무효로 본다. 중요: "그 날짜의 실제 요일과 같은가"로 판단하지
// 않는다 - 우연히 실제 요일과 같은 요일이 원문에 정말로 적혀 있을 수도 있으므로, 오직
// "원문에 근거 문구가 있는가"만 확인한다.
const WEEKDAY_OVERRIDE_EVIDENCE = /(월|화|수|목|금|토|일)\s*요일\s*(수업|시간표)/;

function hasWeekdayOverrideEvidence(originalText) {
  return WEEKDAY_OVERRIDE_EVIDENCE.test(originalText || "");
}

// content: { kind: "inline", base64, mimeType } | { kind: "text", text }
// (documentAnalysis.js / timetableAnalysis.js와 동일한 입력 형태를 그대로 재사용한다)
export async function analyzeAcademicSchedule({ content }) {
  const model = getGenerativeModel(getAIInstance(), {
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });

  const prompt = buildPrompt();

  const parts =
    content.kind === "inline"
      ? [{ text: prompt }, { inlineData: { mimeType: content.mimeType, data: content.base64 } }]
      : [{ text: `${prompt}\n\n다음은 파일에서 추출한 내용이다:\n${content.text}` }];

  const result = await model.generateContent(parts);

  const text = result.response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI 응답을 해석하지 못했습니다.");
  }

  const candidates = Array.isArray(parsed.candidates) ? parsed.candidates : [];
  const normalizedCandidates = candidates
    .filter((c) => c.date && c.originalText)
    .map((c, i) => {
      const rawOverride = c.scheduleDayOverride || "";
      const scheduleDayOverride = rawOverride && hasWeekdayOverrideEvidence(c.originalText) ? rawOverride : "";
      return {
        _key: `cand-${Date.now()}-${i}`,
        date: c.date,
        originalText: c.originalText,
        status: c.status || "needs_review",
        noRegularClasses: !!c.noRegularClasses,
        noClassGrades: Array.isArray(c.noClassGrades) ? c.noClassGrades : [],
        scheduleDayOverride,
        regularPeriods: Array.isArray(c.regularPeriods) ? c.regularPeriods : [],
        affectedGrades: Array.isArray(c.affectedGrades) ? c.affectedGrades : [],
        affectedPeriods: Array.isArray(c.affectedPeriods) ? c.affectedPeriods : [],
        memo: c.memo || "",
        excluded: false,
      };
    });

  // classNames는 여기서 만들지 않는다 - AI는 반 "번호"만 주고, 실제 className
  // 문자열(교사마다 다른 표기)로의 변환은 화면(MonthlyProgressPage.jsx)이 실제 담당
  // 반 목록과 대조해 결정론적으로 한다. classScope는 화면에서 "전체 반/일부 반" 토글
  // 상태로만 쓰이고 그대로 저장되지 않는다(저장 데이터는 classNames만으로 "전체 반"을
  // 표현한다 - 빈 배열 하나로 통일).
  const classActivityCandidates = Array.isArray(parsed.classActivityCandidates)
    ? parsed.classActivityCandidates
    : [];
  const normalizedClassActivityCandidates = classActivityCandidates
    .filter((c) => c.date && c.activityName)
    .map((c, i) => ({
      _key: `actcand-${Date.now()}-${i}`,
      date: c.date,
      activityName: c.activityName,
      originalText: c.originalText || c.activityName,
      grades: Array.isArray(c.grades) ? c.grades : [],
      classScope: c.classScope === "partial" ? "partial" : "all",
      classNumbers: Array.isArray(c.classNumbers) ? c.classNumbers : [],
      classNames: [], // 화면에서 grades+classNumbers를 실제 담당 반과 대조해 채운다.
      periods: Array.isArray(c.periods) ? c.periods : [],
      excluded: !!c.suggestedExcluded,
      status: c.status || "needs_review",
      memo: c.memo || "",
      ignored: false,
    }));

  return { candidates: normalizedCandidates, classActivityCandidates: normalizedClassActivityCandidates };
}
