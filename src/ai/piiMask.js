// Gemini(Gemini Developer API)로 텍스트를 보내기 전, 로컬에서 명확하게 식별 가능한
// 개인정보 패턴만 마스킹한다. 이 탐지가 완벽하다고 가정해서는 안 되며, 어디까지나
// "명확한 패턴"만 걸러내는 보조 안전장치다. UI의 안내 문구가 1차 방어선이다.

const PATTERNS = [
  // 한국 휴대폰 번호: 010-1234-5678, 01012345678, 010 1234 5678 등
  { regex: /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g, token: "[[PHONE]]" },
  // 이메일 주소
  { regex: /[\w.+-]+@[\w-]+\.[\w.-]+/g, token: "[[EMAIL]]" },
  // 주민등록번호 형태: 6자리-7자리
  { regex: /\d{6}[-\s]?[1-4]\d{6}/g, token: "[[ID_NUMBER]]" },
];

export function maskPII(text) {
  let masked = text;
  let matched = false;

  for (const { regex, token } of PATTERNS) {
    if (regex.test(masked)) {
      matched = true;
    }
    regex.lastIndex = 0;
    masked = masked.replace(regex, token);
  }

  return { masked, matched };
}
