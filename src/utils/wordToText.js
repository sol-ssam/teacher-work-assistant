// mammoth도 번들 크기가 커서, 실제로 워드 파일을 분석할 때만 동적으로 불러온다.
const MAX_CHARS = 20000;

export async function wordToText(file) {
  const mammoth = await import("mammoth");
  const buffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  let text = result.value.trim();
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n...(내용이 길어 이하 생략)`;
  }
  return text;
}
