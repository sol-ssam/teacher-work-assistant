import "./PrivacyPage.css";

const CONTACT_EMAIL = import.meta.env.VITE_PRIVACY_CONTACT_EMAIL;

export default function PrivacyPage() {
  return (
    <div className="privacy">
      <div className="privacy__card">
        <p className="privacy__brand">Teacher AI Assistant</p>
        <h1 className="privacy__title">개인정보처리방침</h1>
        <p className="privacy__updated">최종 업데이트: 2026년 9월 1일</p>

        <p className="privacy__intro">
          Teacher AI Assistant(이하 &ldquo;이 앱&rdquo;)는 교사가 자신의 일정, 업무, 시간표, 수업
          진도, 교육계획 등의 정보를 관리하기 위해 사용하는 개인용 교사 업무 지원 웹
          애플리케이션입니다. 이 문서는 이 앱이 어떤 정보를 다루고, 어떻게 사용하는지 설명합니다.
        </p>

        <h2>1. 개인정보의 처리</h2>
        <p>이 앱은 다음과 같은 정보를 수집하거나 처리할 수 있습니다.</p>
        <ul>
          <li>Google 로그인에 필요한 기본 계정 정보</li>
          <li>Firebase Authentication에서 제공되는 사용자 식별 정보</li>
          <li>사용자가 직접 앱에 입력한 일정, 업무, 시간표, 수업 진도 정보</li>
          <li>사용자가 분석을 위해 직접 선택한 문서의 내용</li>
          <li>Google Calendar 연동을 사용자가 선택한 경우 필요한 Calendar 접근 권한</li>
        </ul>

        <h2>2. 이용 목적</h2>
        <p>위 정보는 다음 목적을 위해서만 사용됩니다.</p>
        <ul>
          <li>사용자 인증</li>
          <li>개인 업무 및 일정 관리</li>
          <li>오늘의 브리핑 제공</li>
          <li>사용자가 요청한 문서 분석</li>
          <li>사용자가 명시적으로 선택한 일정의 Google Calendar 동기화</li>
        </ul>

        <h2>3. Google Calendar 연동</h2>
        <ul>
          <li>Google Calendar 접근은 사용자가 직접 연결을 선택한 경우에만 이루어집니다.</li>
          <li>
            이 앱은 사용자가 동기화를 요청한 일정을 생성·수정·삭제하기 위해서만 Calendar 권한을
            사용합니다.
          </li>
          <li>
            시간표, 일반 업무, 수업 진도 등은 자동으로 Google Calendar에 전송되지 않습니다.
          </li>
          <li>
            이 앱이 생성한 Google Calendar 일정을 식별하기 위해 필요한 이벤트 ID를 Firestore에
            저장할 수 있습니다.
          </li>
          <li>Google OAuth access token 또는 refresh token은 Firestore에 평문으로 저장하지 않습니다.</li>
          <li>Google Calendar 데이터는 광고 목적으로 사용하지 않습니다.</li>
          <li>Google Calendar 데이터를 판매하지 않습니다.</li>
        </ul>

        <h2>4. 생성형 AI 및 문서 분석</h2>
        <p>
          이 앱은 Firebase AI Logic을 통한 Gemini 기능을 사용하여 자연어 명령 처리와, 사용자가
          요청한 문서 분석을 수행할 수 있습니다.
        </p>
        <ul>
          <li>사용자가 직접 선택한 문서만 분석 대상이 됩니다.</li>
          <li>이 앱은 Firebase Storage에 원본 문서를 업로드하지 않는 구조입니다.</li>
          <li>문서는 브라우저에서 처리되며, 필요한 내용이 AI 분석을 위해 전달될 수 있습니다.</li>
          <li>
            Firestore에는 문서의 메타데이터(제목, 종류, 분석 시각 등)와 사용자가 검토 후 승인한
            분석 결과가 저장될 수 있습니다.
          </li>
        </ul>
        <p className="privacy__notice">
          학생 이름, 연락처, 상담 내용, 건강정보 등 학생 개인을 특정할 수 있는 민감한 정보는 AI
          비서나 문서 분석에 입력하지 않도록 주의해 주세요.
        </p>

        <h2>5. 데이터 저장 및 삭제</h2>
        <p>
          사용자의 업무 데이터는 Google Cloud Firestore에 저장될 수 있습니다. Firestore의 데이터는
          로그인한 사용자의 고유 식별자(uid/ownerId)를 기준으로 구분되며, 보안 규칙상 본인의
          데이터만 조회·수정·삭제할 수 있도록 설계되어 있습니다.
        </p>
        <p>이 앱에는 &ldquo;내 데이터 초기화&rdquo; 기능이 있습니다.</p>
        <ul>
          <li>
            사용자는 이 기능으로 자신의 일정, 업무, 시간표, 시간표 변경, 수업 계획, 수업 진도,
            문서 분석 기록을 삭제할 수 있습니다.
          </li>
          <li>전체 사용자 데이터 초기화를 선택하면 설정(settings) 데이터도 함께 삭제됩니다.</li>
          <li>이 초기화 기능으로 Firebase Authentication 계정 자체가 삭제되지는 않습니다.</li>
          <li>
            Google Calendar에 동기화된 일정은 초기화 시 사용자가 선택한 방식에 따라 처리됩니다 —
            앱 데이터만 지우고 Calendar 일정은 그대로 둘 수도 있고, 이 앱이 생성해 이벤트 ID로
            식별 가능한 일정만 Calendar에서 함께 삭제할 수도 있습니다.
          </li>
        </ul>

        <h2>6. 제3자 서비스</h2>
        <p>이 앱은 다음 서비스를 이용합니다.</p>
        <ul>
          <li>Google Firebase (인증, 데이터베이스, 호스팅, App Check)</li>
          <li>Google Calendar API (사용자가 연결을 선택한 경우)</li>
          <li>Google Gemini / Firebase AI Logic (자연어 비서 및 문서 분석)</li>
        </ul>
        <p>
          이 앱이 Google API를 통해 접근·사용하는 사용자 데이터는 위에서 설명한 목적(일정 동기화,
          AI 분석) 범위 안에서만 사용되며, 그 밖의 목적으로 사용되지 않습니다.
        </p>

        <h2>7. 보안 및 사용자 주의</h2>
        <p>
          학생 이름, 상담 내용, 건강정보 등 민감한 학생 개인정보는 AI 비서, 문서 분석, Google
          Calendar 일정 설명란 등 이 앱의 어떤 입력창에도 넣지 않도록 주의해 주세요.
        </p>

        <h2>8. 문의</h2>
        {CONTACT_EMAIL ? (
          <p>문의 이메일: {CONTACT_EMAIL}</p>
        ) : (
          <p className="privacy__notice">문의 채널이 아직 설정되지 않았습니다.</p>
        )}
      </div>
    </div>
  );
}
