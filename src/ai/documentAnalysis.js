import { getGenerativeModel, Schema } from "firebase/ai";
import { getAIInstance } from "../firebase/ai";
import { todayDateString, todayWeekdayKorean } from "../utils/date";

// 문서 분석은 자연어 비서(Tool 채팅)와 완전히 별개의 1회성 호출이다.
// Firestore의 기존 데이터(시간표/일정/업무/공지 등)를 함께 보내지 않는다 - 오직 업로드된
// 문서 파일 하나와, 날짜 해석에 필요한 오늘 날짜 정도만 전달한다.
const MODEL_NAME = "gemini-3.1-flash-lite";

const DOC_TYPE_LABEL = {
  weekly_plan: "주간 교육계획",
  monthly_plan: "월간 교육계획",
  academic_calendar: "학교 학사일정",
  other: "기타 자료",
};

const candidateItemSchema = Schema.object({
  properties: {
    kind: Schema.enumString({
      description:
        "추출된 항목의 종류. event=학사일정/학교행사/회의, task=제출·마감 업무, timetable_change=시간표 변경 가능성, notice=기타 중요 정보",
      enum: ["event", "task", "timetable_change", "notice"],
    }),
    title: Schema.string({ description: "항목 제목 (짧게)" }),
    date: Schema.string({ description: "관련 날짜 (YYYY-MM-DD). 알 수 없으면 빈 문자열." }),
    startTime: Schema.string({ description: "시작 시간 (HH:MM, 알 수 없으면 빈 문자열)" }),
    endTime: Schema.string({
      description:
        "종료 시간 (HH:MM). 문서에 종료 시간이 명시된 경우에만 채우고, 없으면 절대 추측하지 말고 빈 문자열로 둬라.",
    }),
    eventType: Schema.enumString({
      description: "kind가 event일 때만 사용: academic/school/meeting/training",
      enum: ["academic", "school", "meeting", "training"],
    }),
    period: Schema.string({
      description: "kind가 timetable_change일 때, 문서에 언급된 교시 (예: '5'). 모르면 빈 문자열.",
    }),
    className: Schema.string({
      description: "kind가 timetable_change일 때, 문서에 언급된 학급/학년 (예: '3학년' 또는 '3-2'). 모르면 빈 문자열.",
    }),
    memo: Schema.string({ description: "짧은 부연 설명" }),
  },
  optionalProperties: ["startTime", "endTime", "eventType", "period", "className", "memo"],
});

const extractionSchema = Schema.object({
  properties: {
    items: Schema.array({ items: candidateItemSchema }),
  },
});

function buildPrompt(docType, periodStart, periodEnd) {
  const period =
    periodStart || periodEnd ? `문서가 다루는 기간: ${periodStart || "?"} ~ ${periodEnd || "?"}` : "";

  return `아래 문서는 교사가 업로드한 "${DOC_TYPE_LABEL[docType] ?? docType}" 자료다.
[오늘: ${todayDateString()} (${todayWeekdayKorean()})] ${period}

문서에서 다음 성격의 정보를 찾아 items 배열로 추출해라.
- 주요 학교 행사, 학사 일정
- 회의
- 제출 또는 마감 업무
- 준비해야 할 업무
- 수업에 영향을 주는 일정, 시간표 변경 가능성이 있는 정보
- 그 외 교사에게 중요할 가능성이 높은 정보

각 항목의 날짜는 문서에 나온 표현을 오늘 날짜를 기준으로 실제 YYYY-MM-DD로 계산해서 채워라.
날짜를 알 수 없으면 date를 빈 문자열로 둬라. 정보를 지어내지 말고, 문서에 실제로 있는 내용만 추출해라.
학생 개인정보(이름, 연락처 등)나 민감한 내용은 절대 추출하지 말고 무시해라.`;
}

// content: { kind: "inline", base64, mimeType } - PDF/이미지처럼 Gemini에 멀티모달로 직접 전달
//        | { kind: "text", text } - 엑셀/워드처럼 브라우저에서 이미 텍스트로 변환해온 경우
export async function analyzeSourceDocument({ content, docType, periodStart, periodEnd }) {
  const model = getGenerativeModel(getAIInstance(), {
    model: MODEL_NAME,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: extractionSchema,
    },
  });

  const prompt = buildPrompt(docType, periodStart, periodEnd);

  const parts =
    content.kind === "inline"
      ? [{ text: prompt }, { inlineData: { mimeType: content.mimeType, data: content.base64 } }]
      : [{ text: `${prompt}\n\n다음은 문서에서 추출한 내용이다:\n${content.text}` }];

  const result = await model.generateContent(parts);

  const text = result.response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("AI 응답을 해석하지 못했습니다.");
  }

  const items = Array.isArray(parsed.items) ? parsed.items : [];
  return items.map((item, i) => ({
    id: `cand-${Date.now()}-${i}`,
    status: "pending",
    kind: item.kind,
    title: item.title || "",
    date: item.date || "",
    startTime: item.startTime || "",
    endTime: item.endTime || "",
    eventType: item.eventType || "school",
    period: item.period || "",
    className: item.className || "",
    memo: item.memo || "",
  }));
}
