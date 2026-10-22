import { getGenerativeModel } from "firebase/ai";
import { getAIInstance } from "../firebase/ai";
import { maskPII } from "./piiMask";

// AI 비서(session.js)와 같은 무료 등급 모델을 쓴다. 다만 작성 도우미는 도구 호출이 필요
// 없는 단순 1회성 생성 흐름이라 tools/systemInstruction 없이 모델을 만든다 - 기존
// AI 비서의 startChat() 기반 대화형 구조와는 완전히 분리되어 있다.
const MODEL_NAME = "gemini-3.1-flash-lite";

function getWritingModel() {
  return getGenerativeModel(getAIInstance(), { model: MODEL_NAME });
}

// "주무관"은 화면에 보이는 이름이고, AI에게는 실제 역할을 더 명확히 전달하기 위해
// "학교 행정실 주무관"으로 바꿔서 보낸다.
const RECIPIENT_LABELS = {
  coworker: "동료 교사",
  parent: "학부모",
  admin: "학교 관리자(교장/교감)",
  officer: "학교 행정실 주무관",
  supervisor: "장학사",
};

// 관리자/주무관/장학사처럼 조직 내 권위를 가진 대상에게는 "친근하게"를 요청해도
// 지나치게 편한 표현으로 흘러가지 않도록 말투에 상한선을 둔다.
const HIGH_FORMALITY_RECIPIENTS = new Set(["admin", "officer", "supervisor"]);

function recipientLabelForAI(recipient, customRelationship) {
  if (recipient === "other") {
    const trimmed = (customRelationship || "").trim();
    return trimmed || "받는 사람";
  }
  return RECIPIENT_LABELS[recipient] || "받는 사람";
}

function typeGuidance(type) {
  if (type === "email") {
    return "형식: 학교 업무용 이메일 본문. 짧은 인사(첫 인사)와 마무리 인사를 포함한 완결된 본문으로 작성한다. 제목(Subject)은 만들지 않는다.";
  }
  return "형식: 메신저(메신저 앱/문자)로 보낼 짧은 메시지. 이메일처럼 격식을 갖춘 인사/서명 문단을 따로 만들지 않고, 용건이 바로 전달되는 자연스러운 메시지로 작성한다.";
}

function toneGuidance(tone, recipient) {
  const overrideNote = HIGH_FORMALITY_RECIPIENTS.has(recipient)
    ? " 받는 사람이 관리자/행정실/장학사처럼 격식이 필요한 대상이므로, 말투 요청이 '친근하게'여도 예의를 벗어나는 편한 표현은 쓰지 않는다."
    : "";

  if (tone === "friendly") {
    return `말투: 친근하고 다정한 느낌으로 쓰되, 반말은 절대 쓰지 않고 항상 존댓말을 유지한다.${overrideNote}`;
  }
  if (tone === "warm") {
    return `말투: 부드럽고 따뜻한 느낌으로 쓰되, 전문적인 업무 커뮤니케이션의 선은 넘지 않는다.${overrideNote}`;
  }
  return "말투: 정중한 존댓말로 쓴다. '다름이 아니오라', '삼가', '귀하', '부디', '바쁘시겠지만'처럼 지나치게 옛스럽고 딱딱한 표현은 피하고, 자연스러운 현대 업무 존댓말을 쓴다.";
}

function lengthGuidance(length) {
  if (length === "short") return "길이: 짧게 - 2~3문장 정도로 용건만 간결하게 전달한다.";
  if (length === "detailed") return "길이: 자세히 - 배경과 세부 내용을 충분히 풀어서 설명하되, 불필요한 반복은 넣지 않는다.";
  return "길이: 보통 - 한두 문단 정도로 필요한 내용을 충분히 담는다.";
}

function buildBaseRules() {
  return [
    "너는 학교 교사가 보낼 메신저/이메일 글을 대신 작성해주는 도우미다.",
    "사용자가 제공하지 않은 이름, 학교명, 직책, 연락처 등은 절대로 임의로 만들어 넣지 않는다.",
    "결과는 바로 보내도 되는 메시지/이메일 본문 그 자체만 출력한다.",
    "'다음과 같이 작성했습니다' 같은 설명, 메타 발언, 마크다운 코드블록(```)은 절대 포함하지 않는다.",
  ].join("\n");
}

function cleanResultText(raw) {
  let text = (raw || "").trim();
  // 모델이 코드블록으로 감싸서 보내는 경우를 대비한 방어적 제거 (금지했지만 혹시 섞여 나올 때만).
  const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  return text;
}

async function callModel(promptText) {
  const model = getWritingModel();
  const result = await model.generateContent(promptText);
  return cleanResultText(result.response.text());
}

export async function generateWritingAssistantText({ type, recipient, customRelationship, tone, length, content }) {
  const { masked, matched } = maskPII(content || "");
  const recipientLabel = recipientLabelForAI(recipient, customRelationship);

  const prompt = [
    buildBaseRules(),
    typeGuidance(type),
    `받는 사람: ${recipientLabel}`,
    toneGuidance(tone, recipient),
    lengthGuidance(length),
    "아래는 선생님이 전달하고 싶은 내용이다. 이 내용을 바탕으로 받는 사람과 상황에 맞는 글을 작성하라.",
    "---",
    masked,
    "---",
  ].join("\n");

  const text = await callModel(prompt);
  return { text, piiMasked: matched };
}

const REFINE_INSTRUCTION_LABELS = {
  shorter: "지금 글을 더 짧게 줄여줘.",
  moreFormal: "지금 글을 더 정중하게 다시 써줘.",
  softer: "지금 글을 더 부드러운 느낌으로 다시 써줘.",
  friendlier: "지금 글을 더 친근한 느낌으로 다시 써줘(단, 존댓말은 유지해줘).",
};

export function refineInstructionLabel(key) {
  return REFINE_INSTRUCTION_LABELS[key] || "";
}

export async function refineWritingAssistantText({
  currentResult,
  instructionKey,
  customInstruction,
  type,
  recipient,
  customRelationship,
  tone,
}) {
  const instructionRaw =
    instructionKey && REFINE_INSTRUCTION_LABELS[instructionKey]
      ? REFINE_INSTRUCTION_LABELS[instructionKey]
      : customInstruction || "";

  const { masked: maskedResult } = maskPII(currentResult || "");
  const { masked: maskedInstruction, matched: instructionMatched } = maskPII(instructionRaw);
  const recipientLabel = recipientLabelForAI(recipient, customRelationship);

  const prompt = [
    buildBaseRules(),
    typeGuidance(type),
    `받는 사람: ${recipientLabel}`,
    HIGH_FORMALITY_RECIPIENTS.has(recipient)
      ? "받는 사람이 격식이 필요한 대상이므로 예의를 벗어나는 편한 표현은 쓰지 않는다."
      : "",
    `기본 말투는 '${tone === "friendly" ? "친근하게(항상 존댓말)" : tone === "warm" ? "부드럽게" : "정중하게"}'였다.`,
    "아래는 방금 작성된 글이다.",
    "---",
    maskedResult,
    "---",
    "이 글을 아래 요청에 맞게 다듬어서 전체 글을 다시 작성하라. 요청과 무관한 내용/사실을 새로 지어내지 않는다.",
    "요청:",
    maskedInstruction,
  ]
    .filter(Boolean)
    .join("\n");

  const text = await callModel(prompt);
  return { text, piiMasked: instructionMatched };
}
