import { getGenerativeModel, Schema } from "firebase/ai";
import { getAIInstance } from "../firebase/ai";
import { WEEKDAYS, PERIODS } from "../utils/constants";

// 시간표 가져오기는 일반 문서 분석(documentAnalysis.js)과 별개의 1회성 Gemini 호출이다.
// 기존 Firestore 데이터(시간표/일정/업무 등)를 함께 보내지 않는다 - 오직 업로드된 시간표
// 파일 하나만 전달한다. 분석 결과는 절대 곧바로 저장하지 않고, 미리보기에서 검토/수정한
// 뒤 사용자가 "시간표 등록"을 눌러야 Firestore에 반영된다(TimetablePage.jsx).
const MODEL_NAME = "gemini-3.1-flash-lite";

const entrySchema = Schema.object({
  properties: {
    dayOfWeek: Schema.enumString({
      description: "요일",
      enum: WEEKDAYS,
    }),
    period: Schema.integer({ description: `교시 (1~${PERIODS.length})` }),
    className: Schema.string({ description: "학급 (예: 3-2). 확실하지 않으면 빈 문자열." }),
    subject: Schema.string({ description: "과목 (있는 경우). 확실하지 않으면 빈 문자열." }),
  },
  optionalProperties: ["subject"],
});

const extractionSchema = Schema.object({
  properties: {
    entries: Schema.array({ items: entrySchema }),
  },
});

function buildPrompt() {
  return `아래 파일은 교사 본인의 학교 시간표다.
요일(월/화/수/목/금)과 교시별로 어떤 학급을, 가능하면 어떤 과목으로 가르치는지 표 형태로
정리된 자료다.

entries 배열로 각 (요일, 교시, 학급, 과목) 칸을 추출해라.
- 빈 칸(수업 없음)은 결과에 포함하지 마라.
- 학급이나 과목이 무엇인지 확실하지 않은 칸은 절대 임의로 만들어내지 말고, 그 칸 자체를
  결과에서 제외해라. 짐작으로 채우지 마라.
- 같은 칸에 두 가지 정보가 겹쳐 보여 확신이 서지 않으면 역시 제외해라.
- 교시 번호는 정수로, 학급명은 문서에 쓰인 표기(예: '3-2', '3학년 2반' 등)를 그대로 사용해라.`;
}

// content: { kind: "inline", base64, mimeType } | { kind: "text", text }
// (documentAnalysis.js의 analyzeSourceDocument와 동일한 입력 형태를 그대로 재사용한다)
export async function analyzeTimetableDocument({ content }) {
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

  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return entries
    .filter((e) => WEEKDAYS.includes(e.dayOfWeek) && Number.isInteger(e.period))
    .map((e) => ({
      dayOfWeek: e.dayOfWeek,
      period: e.period,
      className: e.className || "",
      subject: e.subject || "",
    }));
}

// 담임 학급 시간표 분석 - 위 analyzeTimetableDocument(교사 본인 수업 시간표)와는 관점이
// 다르다. 여기서는 "우리 반이 몇 교시에 어떤 과목 수업을 듣는지"가 핵심이라 학급 자체는
// 셀마다 반복해서 넣지 않고(사용자가 설정한 담임 학급 하나로 고정), 과목과(가능하면)
// 담당 교사만 뽑는다.
const homeroomEntrySchema = Schema.object({
  properties: {
    dayOfWeek: Schema.enumString({
      description: "요일",
      enum: WEEKDAYS,
    }),
    period: Schema.integer({ description: `교시 (1~${PERIODS.length})` }),
    subject: Schema.string({ description: "과목. 확실하지 않으면 빈 문자열." }),
    teacher: Schema.string({
      description: "담당 교사 이름. 문서에 명시된 경우에만 채우고, 없으면 절대 추측하지 말고 빈 문자열로 둬라.",
    }),
  },
  optionalProperties: ["teacher"],
});

const homeroomExtractionSchema = Schema.object({
  properties: {
    entries: Schema.array({ items: homeroomEntrySchema }),
  },
});

function buildHomeroomPrompt(homeroomClass) {
  return `아래 파일은 학교 시간표다. 이 안에서 "${homeroomClass}" 학급의 시간표만 찾아라.

요일(월/화/수/목/금)과 교시별로 ${homeroomClass} 학급이 무슨 과목 수업을 듣는지 entries
배열로 추출해라. 각 항목은 dayOfWeek, period, subject, teacher(선택)로 구성한다.

- 빈 칸(수업 없음)은 결과에 포함하지 마라.
- ${homeroomClass} 학급을 문서에서 찾을 수 없거나 어느 열/행이 그 학급인지 확신할 수 없으면
  entries를 빈 배열로 반환해라. 다른 학급의 시간표를 섞어서 추측하지 마라.
- 과목이 무엇인지 확실하지 않은 칸은 제외해라. 짐작으로 채우지 마라.
- 담당 교사 이름은 문서에 명시적으로 적혀 있을 때만 채우고, 없으면 절대 만들어내지 마라.
- 교시 번호는 정수로 채워라.`;
}

// content: { kind: "inline", base64, mimeType } | { kind: "text", text }
export async function analyzeHomeroomTimetableDocument({ content, homeroomClass }) {
  const model = getGenerativeModel(getAIInstance(), {
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: homeroomExtractionSchema,
    },
  });

  const prompt = buildHomeroomPrompt(homeroomClass);

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

  const entries = Array.isArray(parsed.entries) ? parsed.entries : [];
  return entries
    .filter((e) => WEEKDAYS.includes(e.dayOfWeek) && Number.isInteger(e.period))
    .map((e) => ({
      dayOfWeek: e.dayOfWeek,
      period: e.period,
      subject: e.subject || "",
      teacher: e.teacher || "",
    }));
}
