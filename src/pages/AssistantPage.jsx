import { useEffect, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGoogleCalendar } from "../contexts/GoogleCalendarContext";
import { startAssistantChat } from "../ai/session";
import { sendAssistantMessage } from "../ai/assistant";
import { tryLocalQuery } from "../ai/localQueries";
import "./AssistantPage.css";

// 대화가 하나도 없는 초기 상태에서만 보여주는 quick prompt다. 새 AI 기능이 아니라 기존
// 전송 흐름(sendText)을 그대로 트리거하는 UI shortcut일 뿐이다.
const QUICK_PROMPTS = ["오늘 일정 알려줘", "이번 주 업무 알려줘", "수업 진도 확인", "시간표 변경"];

export default function AssistantPage() {
  const { user } = useAuth();
  const { getValidAccessToken, connect } = useGoogleCalendar();
  const chatRef = useRef(null);
  const bottomRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  function getChat() {
    if (!chatRef.current) {
      chatRef.current = startAssistantChat();
    }
    return chatRef.current;
  }

  // 새 메시지가 추가되거나 로딩 상태가 바뀔 때마다 가장 최근 대화가 보이도록 스크롤한다.
  // 기존에는 이런 자동 스크롤 자체가 없었다 - 채팅 화면다운 최소한의 동작으로 새로 추가했다.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading]);

  // 기존 handleSubmit이 하던 전송 로직 그대로다(tryLocalQuery -> sendAssistantMessage ->
  // 동일한 messages 구조 -> 동일한 에러 처리). 폼 제출과 quick prompt 클릭이 이 함수
  //하나만 공유하게 분리했을 뿐, AI 호출 방식/순서/session은 전혀 바뀌지 않았다.
  async function sendText(text) {
    if (!text || loading) return;

    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);

    try {
      const localAnswer = await tryLocalQuery(text, user.uid);
      if (localAnswer !== null) {
        setMessages((prev) => [...prev, { role: "assistant", text: localAnswer, local: true }]);
        return;
      }

      const chat = getChat();
      // calendarHelpers는 addEvent 같은 도구가 Google Calendar API를 호출할 때만 쓰인다.
      // Gemini에는 이 객체나 access token이 전달되지 않는다 - Gemini는 addToCalendar
      // 같은 의도만 함수 인자로 넘기고, 실제 토큰 조회/Calendar 호출은 여기 클라이언트
      // 코드에서 이루어진다.
      const { text: replyText, toolCalls, piiMasked } = await sendAssistantMessage(
        chat,
        user.uid,
        text,
        { getValidAccessToken, connect }
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: replyText || "요청을 처리했지만 답변을 만들지 못했습니다.",
          toolCalls,
          piiMasked,
        },
      ]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text:
            "현재 AI 비서 기능을 사용할 수 없습니다. 시간표, 일정, 업무, 진도 등의 직접 관리 기능은 정상적으로 사용할 수 있습니다.",
          error: true,
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    await sendText(text);
  }

  return (
    <div className="assistant-page">
      <header className="assistant-page__head">
        <h1 className="assistant-page__title">AI 비서</h1>
        <p className="assistant-page__desc">
          무엇이든 편하게 말씀해보세요. 일정, 업무, 수업과 시간표까지 솔쌤 AI 비서가 함께 정리해드려요.
        </p>
        <p className="assistant-page__notice">🔒 학생 개인정보나 민감한 상담 내용은 입력하지 말아 주세요.</p>
      </header>

      <div className="assistant-page__transcript">
        {messages.length === 0 ? (
          <div className="assistant-page__empty">
            <span className="assistant-page__empty-mark" aria-hidden="true">
              ✨
            </span>
            <p className="assistant-page__empty-text">
              아직 대화가 없어요. 아래에서 편하게 말을 걸어보세요.
            </p>
            <div className="assistant-page__quick-prompts">
              {QUICK_PROMPTS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className="assistant-page__quick-prompt"
                  onClick={() => sendText(p)}
                  disabled={loading}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`bubble bubble--${m.role}${m.error ? " bubble--error" : ""}`}>
              <p className="bubble__text">{m.text}</p>
              {m.toolCalls && m.toolCalls.length > 0 && (
                <p className="bubble__meta">사용한 기능: {m.toolCalls.join(", ")}</p>
              )}
              {m.piiMasked && <p className="bubble__meta">일부 개인정보로 보이는 내용은 전송 전에 가려졌어요.</p>}
            </div>
          ))
        )}
        {loading && <p className="assistant-page__status">솔쌤 AI 비서가 확인하고 있어요…</p>}
        <div ref={bottomRef} />
      </div>

      <form className="assistant-page__form" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="일정, 업무, 수업, 시간표 변경 등을 말해보세요."
          disabled={loading}
          aria-label="AI 비서에게 말하기"
        />
        <button
          type="submit"
          className="assistant-page__send"
          disabled={loading || !input.trim()}
          aria-label="보내기"
        >
          ➤
        </button>
      </form>
      <p className="assistant-page__hint">
        예: &ldquo;금요일까지 평가계획서 제출해야 해&rdquo; · &ldquo;9월 15일 구글 캘린더 일정
        가져와줘&rdquo;
      </p>
    </div>
  );
}
