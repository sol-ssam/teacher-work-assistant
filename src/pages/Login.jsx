import { useState } from "react";
import { signInWithGoogle } from "../firebase/authService";
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

export default function Login() {
  const [signingIn, setSigningIn] = useState(false);
  const [loginError, setLoginError] = useState("");

  async function handleGoogleSignIn() {
    if (signingIn) return;
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
        <button className="login__button" onClick={handleGoogleSignIn} disabled={signingIn}>
          {signingIn ? "로그인 중…" : "Google 계정으로 시작하기"}
        </button>
        {loginError && <p className="login__error">{loginError}</p>}
      </div>
    </div>
  );
}
