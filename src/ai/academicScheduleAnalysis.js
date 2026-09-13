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

const extractionSchema = Schema.object({
  properties: {
    candidates: Schema.array({ items: candidateSchema }),
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
더 안전하다. 조금이라도 확신이 서지 않으면 needs_review를 선택해라.`;
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
  return candidates
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
}
