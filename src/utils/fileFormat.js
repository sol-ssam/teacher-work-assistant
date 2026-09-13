// "문서 종류"(주간계획/월간계획/학사일정/기타)와 "파일 형식"은 서로 다른 개념이다.
// 이 파일은 오직 파일 형식만 판별한다 - 어떤 문서 종류든 아래 형식 중 하나로 올 수 있다.

const EXTENSION_MAP = {
  pdf: "pdf",
  xlsx: "excel",
  xls: "excel",
  png: "image",
  jpg: "image",
  jpeg: "image",
  docx: "word",
};

export const FILE_FORMAT_LABEL = {
  pdf: "PDF",
  excel: "Excel",
  image: "이미지",
  word: "Word",
  unsupported: "지원하지 않는 형식",
};

export function detectFileFormat(file) {
  if (!file) return "unsupported";
  const ext = file.name.includes(".") ? file.name.split(".").pop().toLowerCase() : "";
  return EXTENSION_MAP[ext] || "unsupported";
}
