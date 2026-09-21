import { useState } from "react";
import { Link } from "react-router-dom";
import { signInWithGoogle, signInAsPreviewUser } from "../firebase/authService";
import { useAuth } from "../contexts/AuthContext";
import "./Login.css";

// Firebase Auth의 대표적인 오류 코드만 사용자 친화적 문구로 바꾼다. 그 외 코드는 일반
// 안내 문구로 대체하되, 개발자가 원인을 확인할 수 있도록 console에는 항상 원본
// error.code/error.message를 그대로 남긴다(사용자 화면에는 노출하지 않는다).
const LOGIN_ERROR_MESSAGES = {
  "auth/popup-closed-by-user": "Google 로그인 창이 닫혔습니다. 다시 시도해주세요.",
  "auth/popup-blocked": "브라우저에서 로그인 팝업이 차단되었습니다.",
  "auth/unauthorized-domain": "현재 주소가 Google 로그인 허용 도메인으로 등록되어 있지 않습니다.",
};
const DEFAULT_LOGIN_ERROR_MESSAGE = "Google 로그인 중 문제가 발생했습니다. 다시 시도해주세요.";
const PREVIEW_ERROR_MESSAGE = "미리보기를 시작하지 못했습니다. 잠시 후 다시 시도해주세요.";

export default function Login() {
  const { previewError } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [startingPreview, setStartingPreview] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Anonymous 로그인에 성공하면 AuthContext가 샘플 데이터 준비가 끝날 때까지 로딩 화면을
  // 보여주고, 끝난 뒤에 Home으로 진입시킨다 - 여기서는 로그인 요청만 보낸다.
  async function handleStartPreview() {
    if (signingIn || startingPreview) return;
    setStartingPreview(true);
    setLoginError("");
    try {
      await signInAsPreviewUser();
    } catch (error) {
      console.error("Preview sign-in failed:", error.code, error.message);
      setLoginError(PREVIEW_ERROR_MESSAGE);
    } finally {
      setStartingPreview(false);
    }
  }

  async function handleGoogleSignIn() {
    if (signingIn || startingPreview) return;
    setSigningIn(true);
    setLoginError("");
    try {
      await signInWithGoogle();
    } catch (error) {
      console.error("Google sign-in failed:", error.code, error.message);
      setLoginError(LOGIN_ERROR_MESSAGES[error.code] || DEFAULT_LOGIN_ERROR_MESSAGE);
    } finally {
      setSigningIn(false);
    }
  }

  return (
    <div className="login">
      <div className="login__glow" aria-hidden="true" />
      <div className="login__card">
        <h1 className="login__title">교사용 업무 비서 🌷</h1>
        <p className="login__subtitle">선생님의 하루를 함께해요.</p>
        <p className="login__description">
          수업부터 일정과 업무까지, 필요한 정보를 한곳에서 관리해보세요.
        </p>
        <button
          className="login__button"
          onClick={handleGoogleSignIn}
          disabled={signingIn || startingPreview}
        >
          {signingIn ? "로그인 중…" : "Google 계정으로 시작하기"}
        </button>
        <button
          type="button"
          className="login__button login__button--secondary"
          onClick={handleStartPreview}
          disabled={signingIn || startingPreview}
        >
          {startingPreview ? "미리보기 준비 중…" : "미리보기로 체험하기"}
        </button>
        <p className="login__preview-hint">샘플 데이터로 교사용 업무 비서의 주요 기능을 체험해 보세요.</p>
        {(loginError || previewError) && <p className="login__error">{loginError || previewError}</p>}
      </div>
      <p className="login__legal-links">
        <Link to="/terms">이용약관</Link>
        <span aria-hidden="true"> · </span>
        <Link to="/privacy">개인정보 처리방침</Link>
      </p>
    </div>
  );
}
