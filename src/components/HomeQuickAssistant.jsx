import { useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { useGoogleCalendar } from "../contexts/GoogleCalendarContext";
import { startAssistantChat } from "../ai/session";
import { sendAssistantMessage } from "../ai/assistant";
import { tryLocalQuery } from "../ai/localQueries";
import "./HomeQuickAssistant.css";

// Home 전용 "AI 비서에게 말하기" 카드. AssistantPage.jsx가 쓰는 것과 정확히 같은 호출
// 경로(tryLocalQuery → startAssistantChat → sendAssistantMessage)를 그대로 재사용한다 -
// Home 전용 AI 로직/엔진은 새로 만들지 않는다. 대화 세션(chatRef)은 이 컴포넌트
// 안에서만 유지되고 AssistantPage와 공유되지 않는다(이번 단계의 의도된 설계) - Home을
// 벗어났다 돌아오면 이 카드는 다시 마운트되며 새 세션으로 시작한다.
export default function HomeQuickAssistant() {
  const { user } = useAuth();
  const { getValidAccessToken, connect } = useGoogleCalendar();
  const chatRef = useRef(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [lastUserText, setLastUserText] = useState(null);
  const [lastAssistantText, setLastAssistantText] = useState(null);

  function getChat() {
    if (!chatRef.current) {
      chatRef.current = startAssistantChat();
    }
    return chatRef.current;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setError(null);
    setLastUserText(text);
    setLastAssistantText(null);
    setLoading(true);

    try {
      const localAnswer = await tryLocalQuery(text, user.uid);
      if (localAnswer !== null) {
        setLastAssistantText(localAnswer);
        return;
      }

      const chat = getChat();
      // AssistantPage.jsx와 동일하게, calendarHelpers는 여기서만 쓰이고 Gemini에는
      // 전달되지 않는다 - 실제 Calendar 호출은 tool executor가 이 함수를 통해 한다.
      const { text: replyText } = await sendAssistantMessage(chat, user.uid, text, {
        getValidAccessToken,
        connect,
      });
      setLastAssistantText(replyText || "요청을 처리했지만 답변을 만들지 못했습니다.");
    } catch {
      setError("요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="home-card home-quick-assistant">
      <h2 className="home-card__title">✨ AI 비서에게 말하기</h2>

      {(lastUserText || lastAssistantText || error) && (
        <div className="home-quick-assistant__log">
          {lastUserText && (
            <p className="home-quick-assistant__msg home-quick-assistant__msg--user">{lastUserText}</p>
          )}
          {lastAssistantText && (
            <p className="home-quick-assistant__msg home-quick-assistant__msg--assistant">{lastAssistantText}</p>
          )}
          {error && <p className="home-quick-assistant__msg home-quick-assistant__msg--error">{error}</p>}
          {loading && <p className="home-quick-assistant__msg home-quick-assistant__msg--loading">생각하는 중…</p>}
        </div>
      )}

      <form className="home-quick-assistant__form" onSubmit={handleSubmit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="일정, 업무, 수업, 시간표 변경 등을 말해보세요."
          disabled={loading}
          aria-label="AI 비서에게 말하기"
        />
        <button type="submit" disabled={loading || !input.trim()} aria-label="보내기">
          {loading ? "…" : "➤"}
        </button>
      </form>
      <p className="home-quick-assistant__hint">
        예: "오늘 2교시랑 5교시 바뀌었어." · "9월 15일 구글 캘린더 일정 가져와줘."
      </p>
    </section>
  );
}
