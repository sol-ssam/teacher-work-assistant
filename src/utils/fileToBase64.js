// 선택한 파일을 어디에도 업로드하지 않고, 브라우저 메모리에서 바로 base64로 바꾼다.
// Gemini(Firebase AI Logic)에 멀티모달 입력(inlineData)으로 보내기 위한 용도이며,
// 이 결과는 그 자리에서만 쓰이고 Firestore에는 저장하지 않는다.
export async function fileToBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.byteLength; i += chunk) {
    binary += String.fromCharCode(...bytes.slice(i, i + chunk));
  }
  return btoa(binary);
}
