import { Link } from "react-router-dom";
import "./LegalPage.css";

const CONTACT_EMAIL = import.meta.env.VITE_PRIVACY_CONTACT_EMAIL;
const LAST_UPDATED = "2026년 9월 13일";

function Placeholder({ children }) {
  return <span className="legal-page__placeholder">[{children}]</span>;
}

export default function PrivacyPage() {
  return (
    <div className="legal-page">
      <div className="legal-page__card">
        <Link to="/" className="legal-page__back">
          ← 앱으로 돌아가기
        </Link>

        <nav className="legal-page__nav" aria-label="약관 문서">
          <Link to="/terms">이용약관</Link>
          <Link to="/privacy" aria-current="page">
            개인정보처리방침
          </Link>
        </nav>

        <p className="legal-page__brand">교사용 업무 비서</p>
        <h1 className="legal-page__title">개인정보처리방침</h1>
        <p className="legal-page__updated">
          최종 수정일: {LAST_UPDATED} · 시행일: <Placeholder>운영자 확인 필요</Placeholder>
        </p>

        <p className="legal-page__intro">
          교사용 업무 비서(이하 &ldquo;이 서비스&rdquo;)는 교사가 자신의 일정, 업무, 시간표,
          수업 진도 등 개인 업무를 관리하기 위해 사용하는 개인 업무 지원 웹
          애플리케이션입니다. 이 서비스는 학생이 직접 가입하거나 이용하는 학습용 서비스가
          아니며, 로그인한 교사 본인의 업무 데이터만을 다룹니다. 이 문서는 이 서비스가 어떤
          개인정보를 처리하고, 어떻게 보호하는지 설명합니다.
        </p>

        <h2>1. 개인정보의 처리 목적</h2>
        <p>이 서비스는 다음의 목적을 위하여 개인정보를 처리합니다.</p>
        <ul>
          <li>Google 계정을 통한 로그인 및 이용자 본인 확인</li>
          <li>이용자별 업무 데이터(일정·업무·시간표·수업 진도 등)의 저장 및 제공</li>
          <li>이용자가 선택한 경우 Google Calendar와의 일정 연동</li>
          <li>AI 비서 및 문서 분석 등 업무 지원 기능 제공</li>
          <li>Firebase App Check를 통한 서비스 보안 유지 및 부정 이용 방지</li>
        </ul>
        <p>
          위 목적 이외의 용도로 개인정보를 이용하지 않으며, 이용 목적이 변경되는 경우 관련
          법령에 따라 필요한 조치를 취합니다.
        </p>

        <h2>2. 처리하는 개인정보 및 데이터 항목</h2>
        <p>
          이 서비스는 Google 로그인 시 Firebase Authentication을 통해 아래 계정 정보를
          전달받아 로그인 세션 동안 이용자 식별에 사용합니다. 이 정보는 별도의 회원 정보
          문서로 데이터베이스에 복제·저장되지 않으며, Firestore에 저장되는 각 업무 데이터
          문서에는 이용자를 구분하기 위한 내부 식별자(UID)만 함께 저장됩니다.
        </p>
        <ul>
          <li>Google 계정의 고유 식별자(UID)</li>
          <li>이메일 주소</li>
          <li>표시 이름(닉네임)</li>
          <li>프로필 사진 URL</li>
        </ul>
        <p>이 밖에 이용자가 서비스 이용 과정에서 직접 입력하는 아래 데이터를 처리합니다.</p>
        <ul>
          <li>일정, 업무(할 일), 시간표, 임시 시간표 변경, 수업 진도, 학사일정 관련 메모</li>
          <li>
            자료 업로드 및 분석 기능에 사용자가 직접 선택해 업로드한 문서(주간·월간
            교육계획, 학사일정 등)의 내용과, 그로부터 추출되어 사용자가 검토·승인한 항목
          </li>
          <li>AI 비서 채팅창에 입력하는 질문 및 업무 관련 내용</li>
          <li>브리핑 알림 기준 시간, 담임 학급 여부 등 개인 환경설정 값</li>
        </ul>
        <p>
          Firebase App Check와 Google reCAPTCHA Enterprise는 정상적인 이용자의 요청인지
          확인하는 과정에서 기기·브라우저·접속 환경에 관한 정보를 처리할 수 있습니다. 이
          서비스는 그 세부 처리 항목을 직접 수집·저장하지 않으며, Google이 제공하는 위
          기능을 그대로 이용합니다.
        </p>
        <p>
          이 서비스는 주민등록번호, 결제·금융 정보, 위치 정보 등을 수집하지 않으며, 위에
          기재되지 않은 개인정보는 수집하지 않습니다.
        </p>

        <h2>3. Google Calendar 연동</h2>
        <ul>
          <li>
            Google Calendar 연동은 이용자가 설정 화면에서 직접 &ldquo;연결하기&rdquo;를 선택한
            경우에만 이루어지며, 자동으로 연결되지 않습니다.
          </li>
          <li>
            이 서비스가 요청하는 Google OAuth 권한 범위는{" "}
            <code>https://www.googleapis.com/auth/calendar.events</code> 하나이며, 이용자가
            앱 안에서 선택한 일정을 Google Calendar에 조회·생성·수정·삭제하는 용도로만
            사용됩니다. 그 밖의 Google 계정 정보(메일, 드라이브 등)에는 접근하지 않습니다.
          </li>
          <li>
            Calendar 접근 토큰(access token)은 Firestore나 브라우저 저장소(localStorage 등)에
            저장되지 않고, 로그인한 브라우저 탭의 메모리에만 일시적으로 보관됩니다. 새로고침
            하거나 탭·브라우저를 닫으면 즉시 사라지며, 서버에도 별도로 보관되지 않습니다.
          </li>
          <li>
            Firestore에는 이 서비스가 생성한 Calendar 일정을 나중에 다시 찾거나 삭제하기
            위해 필요한 Google Calendar의 이벤트 ID만 함께 저장될 수 있습니다.
          </li>
          <li>
            설정 화면의 &ldquo;연결 해제&rdquo; 버튼을 누르면 이 서비스가 메모리에 보관 중이던
            접근 토큰이 즉시 삭제됩니다. Google 계정에 부여한 권한 자체를 완전히 회수하려면
            Google 계정의 보안 설정 페이지에서 이 서비스에 대한 타사 앱 액세스 권한을 직접
            해제해야 합니다.
          </li>
          <li>Google Calendar 데이터를 광고 목적으로 이용하거나 제3자에게 판매하지 않습니다.</li>
        </ul>

        <h2>4. AI 기능</h2>
        <p>
          이 서비스는 Firebase AI Logic을 통해 Google Gemini 모델을 호출하여 자연어로 입력한
          일정·업무 정리를 돕고, 업로드한 문서에서 일정·업무 후보를 추출합니다.
        </p>
        <ul>
          <li>
            AI 비서에 입력한 질문과, 응답 생성을 위해 필요한 최소한의 업무 데이터(예: 오늘의
            일정·업무 목록 일부)가 Google의 AI 서비스로 전송될 수 있습니다.
          </li>
          <li>
            문서 분석 기능은 이용자가 직접 선택한 문서 파일(또는 그 안의 텍스트)을 별도 저장
            없이 곧바로 AI 서비스에 전달하여 분석하며, 원본 파일 자체를 Firebase Storage 등에
            업로드·보관하지 않습니다.
          </li>
          <li>
            AI 비서로 전송하기 직전, 휴대폰 번호·이메일 주소·주민등록번호 형태로 보이는
            문자열을 자동으로 가려주는 기능이 적용되어 있습니다. 다만 이 기능은 명확한
            패턴만 걸러내는 보조 장치이며 모든 개인정보를 완벽하게 탐지한다고 보장할 수
            없습니다.
          </li>
        </ul>
        <p className="legal-page__notice">
          학생의 이름, 연락처, 상담 내용, 건강정보 등 학생 개인을 식별할 수 있는 민감한
          정보는 AI 비서나 문서 분석 등 이 서비스의 어떤 입력창에도 입력하지 않도록
          주의해 주세요.
        </p>
        <p>
          AI가 생성하는 답변, 추출 결과, 일정·업무 자동 등록 내용은 부정확하거나 사실과 다를
          수 있습니다. AI가 등록·수정한 일정과 업무를 포함하여 최종 결과는 반드시 이용자가
          직접 확인해야 합니다.
        </p>

        <h2>5. 개인정보의 보유 및 파기</h2>
        <p>
          이용자가 입력한 업무 데이터는 Firestore의 보안 규칙에 따라 로그인한 본인만 조회·수정
          ·삭제할 수 있으며, 이용자가 서비스를 계속 이용하는 동안 보관됩니다.
        </p>
        <ul>
          <li>
            이용자는 각 페이지(일정, 업무, 시간표, 수업 진도 등)에서 항목을 직접 삭제할 수
            있으며, 삭제 즉시 Firestore에서도 제거됩니다.
          </li>
          <li>
            설정 화면의 &ldquo;업무 데이터 초기화&rdquo; 기능으로 시간표·일정·업무·수업 진도
            ·문서 분석 기록 등 이 서비스가 저장한 업무 데이터 전체를 한 번에 삭제할 수
            있습니다. &ldquo;전체 사용자 데이터 초기화&rdquo;를 선택하면 브리핑 시간 등 개인
            설정(settings) 데이터도 함께 삭제됩니다. Google Calendar에 동기화된 일정을 함께
            삭제할지 여부도 이 화면에서 선택할 수 있습니다.
          </li>
          <li>
            다만 위 초기화 기능은 Firestore에 저장된 업무 데이터만 삭제하며,{" "}
            <strong>Google/Firebase 로그인 계정 자체를 탈퇴시키는 기능은 아직 제공하지
            않습니다.</strong> 로그인 계정 자체의 삭제 또는 이 서비스와 연동을 완전히 끊고
            싶다면 아래 9.의 문의처로 요청하거나, Google 계정의 보안 설정에서 이 서비스의
            앱 연결을 직접 해제해 주세요.
          </li>
          <li>
            삭제 요청이나 계정 관련 문의를 받은 경우, 운영자는 합리적인 기간 내에 처리
            결과를 안내합니다. 처리 기한 및 절차의 세부 사항은{" "}
            <Placeholder>운영자 확인 필요</Placeholder>입니다.
          </li>
        </ul>

        <h2>6. 개인정보의 제3자 제공, 처리위탁 및 외부 서비스 이용</h2>
        <p>
          이 서비스는 개인정보를 별도로 판매하거나 제3자에게 제공하지 않으며, 서비스 제공을
          위해 아래 외부 서비스를 이용합니다.
        </p>
        <ul>
          <li>
            <strong>Google Firebase (Authentication, Cloud Firestore, App Check)</strong> —
            로그인 처리, 업무 데이터 저장, 부정 이용 방지를 위해 이용합니다.
          </li>
          <li>
            <strong>Google Calendar API</strong> — 이용자가 연동을 선택한 경우 일정을
            조회·생성·수정·삭제하기 위해 이용합니다.
          </li>
          <li>
            <strong>Firebase AI Logic / Google Gemini</strong> — AI 비서 응답 생성과 업로드
            문서 분석을 위해 이용합니다.
          </li>
          <li>
            <strong>Google reCAPTCHA Enterprise</strong> — Firebase App Check와 함께 자동화된
            부정 요청을 판별하기 위해 이용합니다.
          </li>
          <li>
            <strong>Vercel</strong> — 이 서비스의 프론트엔드(화면)를 호스팅하기 위해
            이용합니다.
          </li>
        </ul>
        <p>
          위 서비스들은 각자의 인프라 운영 정책에 따라 국외에 서버를 두고 있을 수 있습니다.
          각 서비스별 정확한 처리 사업자명, 서버 소재 국가, 국외 이전 항목·시점·방법, 그
          보유·이용 기간 등 세부 사항은 각 서비스 제공자의 정책에 따르며,{" "}
          <Placeholder>운영자 확인 필요</Placeholder>(이용약관·개인정보처리방침 링크를
          함께 기재하는 것을 권장합니다).
        </p>

        <h2>7. 안전성 확보조치</h2>
        <p>이 서비스는 다음과 같은 기술적·관리적 조치를 통해 개인정보를 보호합니다.</p>
        <ul>
          <li>모든 통신 구간에 HTTPS를 적용합니다.</li>
          <li>
            로그인 및 이용자 인증은 자체 구현 없이 Firebase Authentication(Google 로그인)에
            위임합니다.
          </li>
          <li>
            Firestore 보안 규칙으로 각 업무 데이터 문서의 소유자(UID/ownerId)를 확인하여,
            본인의 데이터만 조회·생성·수정·삭제할 수 있도록 접근을 제한합니다.
          </li>
          <li>Firebase App Check와 Google reCAPTCHA Enterprise로 비정상적인 요청을 걸러냅니다.</li>
          <li>
            Google Calendar 연동에는 필요한 최소 권한(<code>calendar.events</code>)만
            요청하며, 접근 토큰은 서버나 데이터베이스에 저장하지 않고 브라우저 메모리에만
            일시 보관합니다.
          </li>
          <li>AI 비서로 전송하기 전 명확한 개인정보 패턴을 가리는 보조 장치를 적용합니다.</li>
        </ul>

        <h2>8. 정보주체의 권리와 행사 방법</h2>
        <p>이용자는 자신의 개인정보에 대해 다음의 권리를 행사할 수 있습니다.</p>
        <ul>
          <li>이 서비스에 로그인해 자신이 입력한 업무 데이터를 언제든지 열람·수정·삭제</li>
          <li>설정 화면의 데이터 초기화 기능을 통한 업무 데이터 일괄 삭제</li>
          <li>
            Google 계정 권한 철회(Google Calendar 연동 해제) 및 로그인 자체의 중단(Google
            계정에서 로그아웃 또는 이 서비스에 대한 계정 접근 차단)
          </li>
          <li>
            위 방법으로 해결되지 않는 열람·정정·삭제·처리정지 요청은 아래 9.의 문의처를 통해
            요청할 수 있으며, 운영자는 관련 법령이 정한 절차에 따라 지체 없이 조치합니다.
          </li>
        </ul>

        <h2>9. 개인정보 보호책임자 및 문의처</h2>
        <p>
          이 서비스는 개인정보 처리에 관한 문의, 불만 처리, 피해 구제 등을 위하여 아래와
          같이 담당자를 두고 있습니다.
        </p>
        <ul>
          <li>성명: <Placeholder>운영자 입력 필요</Placeholder></li>
          <li>소속: <Placeholder>운영자 입력 필요</Placeholder></li>
          <li>직위: <Placeholder>운영자 입력 필요</Placeholder></li>
          <li>
            연락처(이메일 등):{" "}
            {CONTACT_EMAIL ? CONTACT_EMAIL : <Placeholder>운영자 입력 필요</Placeholder>}
          </li>
        </ul>
        <p>
          개인 휴대전화 번호와 같이 불필요하게 민감한 개인 연락처는 이 문서에 기재하지
          않는 것을 권장합니다.
        </p>

        <h2>10. 개인정보 처리방침의 변경 및 시행일</h2>
        <p>
          이 개인정보처리방침은 관련 법령 또는 서비스 내용 변경에 따라 개정될 수 있으며,
          변경 시 이 페이지를 통해 고지합니다.
        </p>
        <p>
          최종 수정일: {LAST_UPDATED}
          <br />
          시행일: <Placeholder>운영자 확인 필요</Placeholder>
        </p>
      </div>
    </div>
  );
}
