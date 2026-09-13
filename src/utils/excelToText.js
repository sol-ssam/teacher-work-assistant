// xlsx는 번들 크기가 커서, 실제로 엑셀 파일을 분석할 때만 동적으로 불러온다.
const MAX_CHARS = 20000;

// 학교 주간/월간 교육계획처럼 행/열, 시트 구조 자체가 의미를 갖는 표이므로,
// 시트명과 표 구조를 최대한 보존한 텍스트로 바꿔서 Gemini가 이해할 수 있게 한다.
// 빈 셀/빈 행은 제거해 불필요한 토큰 낭비를 줄인다.
export async function excelToText(file) {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const data = new Uint8Array(buffer);
  const workbook = XLSX.read(data, { type: "array" });

  const sections = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: "" });

    const trimmedRows = rows
      .map((row) => {
        let lastNonEmpty = row.length - 1;
        while (lastNonEmpty >= 0 && String(row[lastNonEmpty] ?? "").trim() === "") {
          lastNonEmpty--;
        }
        return row.slice(0, lastNonEmpty + 1).map((cell) => String(cell ?? "").trim());
      })
      .filter((row) => row.some((cell) => cell !== ""));

    if (trimmedRows.length === 0) return `[Sheet: ${sheetName}]\n(빈 시트)`;

    const table = trimmedRows.map((row) => `| ${row.join(" | ")} |`).join("\n");
    return `[Sheet: ${sheetName}]\n${table}`;
  });

  let text = sections.join("\n\n");
  if (text.length > MAX_CHARS) {
    text = `${text.slice(0, MAX_CHARS)}\n...(내용이 길어 이하 생략)`;
  }
  return text;
}
