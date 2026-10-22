import { useState } from "react";
import { generateWritingAssistantText, refineWritingAssistantText } from "../ai/writingAssistant";
import "./crud-shared.css";
import "./WritingAssistantPage.css";

const TYPE_OPTIONS = [
  { value: "messenger", label: "메신저" },
  { value: "email", label: "이메일" },
];

const RECIPIENT_OPTIONS = [
  { value: "coworker", label: "동료 교사" },
  { value: "parent", label: "학부모" },
  { value: "admin", label: "학교 관리자" },
  { value: "officer", label: "주무관" },
  { value: "supervisor", label: "장학사" },
  { value: "other", label: "기타" },
];

const TONE_OPTIONS = [
  { value: "polite", label: "정중하게" },
  { value: "warm", label: "부드럽게" },
  { value: "friendly", label: "친근하게" },
];

const LENGTH_OPTIONS = [
  { value: "short", label: "짧게" },
  { value: "normal", label: "보통" },
  { value: "detailed", label: "자세히" },
];

const REFINE_QUICK_OPTIONS = [
  { key: "shorter", label: "더 짧게" },
  { key: "moreFormal", label: "더 정중하게" },
  { key: "softer", label: "더 부드럽게" },
  { key: "friendlier", label: "더 친근하게" },
];

const initialForm = {
  type: "messenger",
  recipient: "coworker",
  customRelationship: "",
  tone: "polite",
  length: "normal",
  content: "",
};

// select/dropdown 대신 선택지를 한눈에 볼 수 있는 pill 버튼 그룹. 실제 <button>을 쓰고
// aria-pressed로 선택 상태를 전달해서, 보기에만 선택된 것처럼 보이는 div 클릭 방식이
// 되지 않게 한다. 값/상태는 각 호출부의 기존 form state를 그대로 쓴다.
function OptionGroup({ label, idPrefix, options, value, onChange, disabled }) {
  const labelId = `${idPrefix}-label`;
  return (
    <div className="field wa-option-field">
      <span className="wa-option-field__label" id={labelId}>
        {label}
      </span>
      <div className="wa-option-group" role="group" aria-labelledby={labelId}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            className={"wa-option-btn" + (value === o.value ? " wa-option-btn--active" : "")}
            aria-pressed={value === o.value}
            disabled={disabled}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function WritingAssistantPage() {
  const [form, setForm] = useState(initialForm);
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [refineText, setRefineText] = useState("");

  function updateForm(patch) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function runGenerate() {
    if (loading) return;
    if (!form.content.trim()) {
      setError("전달할 내용을 입력해 주세요.");
      return;
    }
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const { text } = await generateWritingAssistantText(form);
      setResult(text || "작성된 내용이 없습니다. 다시 시도해 주세요.");
    } catch (err) {
      console.error("작성 도우미 생성 실패:", err);
      setError("글을 작성하는 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setLoading(false);
    }
  }

  async function runRefine(instructionKey, customInstruction) {
    if (loading || !result) return;
    setLoading(true);
    setError("");
    setCopied(false);
    try {
      const { text } = await refineWritingAssistantText({
        currentResult: result,
        instructionKey,
        customInstruction,
        type: form.type,
        recipient: form.recipient,
        customRelationship: form.customRelationship,
        tone: form.tone,
      });
      if (text) {
        setResult(text);
        if (!instructionKey) setRefineText("");
      } else {
        setError("다듬기 결과를 받지 못했습니다. 기존 내용은 그대로 유지됩니다.");
      }
    } catch (err) {
      console.error("작성 도우미 다듬기 실패:", err);
      setError("다듬기 중 오류가 발생했습니다. 기존 내용은 그대로 유지됩니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("복사 실패:", err);
      setError("클립보드 복사에 실패했습니다.");
    }
  }

  return (
    <div className="page writing-assistant-page">
      <header className="page__head">
        <h1 className="page__title">메신저·메일 작성 도우미</h1>
        <p className="page__desc">학교에서 보내는 메신저와 이메일을 상황에 맞게 작성해 드려요.</p>
      </header>

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          runGenerate();
        }}
      >
        <OptionGroup
          label="작성 유형"
          idPrefix="wa-type"
          options={TYPE_OPTIONS}
          value={form.type}
          onChange={(v) => updateForm({ type: v })}
          disabled={loading}
        />

        <OptionGroup
          label="받는 사람"
          idPrefix="wa-recipient"
          options={RECIPIENT_OPTIONS}
          value={form.recipient}
          onChange={(v) => updateForm({ recipient: v })}
          disabled={loading}
        />

        {form.recipient === "other" && (
          <div className="field field--grow">
            <label htmlFor="wa-custom-relationship">받는 사람(직접 입력)</label>
            <input
              id="wa-custom-relationship"
              value={form.customRelationship}
              onChange={(e) => updateForm({ customRelationship: e.target.value })}
              placeholder="예: 교육청 담당자"
            />
          </div>
        )}

        <OptionGroup
          label="말투"
          idPrefix="wa-tone"
          options={TONE_OPTIONS}
          value={form.tone}
          onChange={(v) => updateForm({ tone: v })}
          disabled={loading}
        />

        <OptionGroup
          label="길이"
          idPrefix="wa-length"
          options={LENGTH_OPTIONS}
          value={form.length}
          onChange={(v) => updateForm({ length: v })}
          disabled={loading}
        />

        <div className="field field--grow wa-field--content">
          <label htmlFor="wa-content">전달할 내용</label>
          <textarea
            id="wa-content"
            value={form.content}
            onChange={(e) => updateForm({ content: e.target.value })}
            placeholder="예: 다음 주 금요일 현장학습 때문에 도움 요청드리고 싶어요."
            rows={4}
          />
        </div>

        <div className="form__actions">
          <button type="submit" className="btn" disabled={loading}>
            {loading ? "작성 중…" : "작성하기"}
          </button>
        </div>
      </form>

      {error && <p className="status status--error">{error}</p>}

      {result && (
        <section className="page__section wa-result">
          <h2 className="section__title">작성 결과</h2>
          <p className="wa-result__text">{result}</p>

          <div className="wa-result__actions">
            <button type="button" className="btn btn--ghost" onClick={handleCopy} disabled={loading}>
              {copied ? "복사됨" : "복사하기"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={runGenerate} disabled={loading}>
              다시 작성
            </button>
          </div>

          <div className="wa-refine">
            <p className="wa-refine__label">다듬기</p>
            <div className="wa-refine__quick">
              {REFINE_QUICK_OPTIONS.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  className="btn btn--ghost btn--small"
                  onClick={() => runRefine(o.key)}
                  disabled={loading}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <form
              className="wa-refine__custom"
              onSubmit={(e) => {
                e.preventDefault();
                const text = refineText.trim();
                if (!text) return;
                runRefine(null, text);
              }}
            >
              <input
                value={refineText}
                onChange={(e) => setRefineText(e.target.value)}
                placeholder="직접 다듬기 요청 입력 (예: 두 문장으로 줄여줘)"
                disabled={loading}
              />
              <button type="submit" className="btn btn--small" disabled={loading || !refineText.trim()}>
                적용
              </button>
            </form>
          </div>
        </section>
      )}
    </div>
  );
}
