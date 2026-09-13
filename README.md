# 오늘의 업무비서

교사용 AI 업무비서 웹앱 (React + Vite + Firebase + Gemini)

현재 **Phase 6**까지 구현되어 있습니다: 프로젝트 뼈대·Google 로그인·Firestore 보안 규칙(Phase 1), 시간표/진도/일정/업무/공지 CRUD(Phase 2), 오늘의 브리핑 완성·8:20 자동 브리핑·마감 계산·반별 진도 차이 계산(Phase 3), 자연어 AI 비서·Function Calling(Phase 4), 자료 업로드 AI 분석·검토·충돌 탐지(Phase 5), Google Calendar 연동·데이터 초기화(Phase 6).

이 프로젝트는 **Firebase Spark(무료) 요금제만으로 동작하도록 유지**하는 것을 전제로 합니다. **Firebase Cloud Storage는 사용하지 않습니다** — 업로드 문서 원본은 어디에도 저장하지 않고, 브라우저 메모리에서 바로 처리한 뒤 버립니다. (아래 6장 참고)

## 0. Phase 4 이후 실제 배포 환경에서 확정된 사항

실제 Firebase 연동·배포 테스트 과정에서 아래 내용이 확정되었고, 이번 Phase 5 코드도 이 상태를 그대로 유지합니다.

- **App Check 공급자**: reCAPTCHA v3 대신 **reCAPTCHA Enterprise**(`ReCaptchaEnterpriseProvider`)를 사용합니다. 환경변수도 `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`로 바뀌었습니다.
- **Gemini 모델**: `gemini-3.1-flash-lite`로 고정합니다. (`gemini-3.5-flash-lite`는 배포 환경에서 함수 호출 왕복 시 400 오류가 재현되어 사용하지 않습니다. `gemini-3.1-flash-lite` + `functionResponse`에 `id` 포함 조합으로 정상 동작을 확인했습니다.)
- **`assistant.js`의 `functionResponse`**: `name`, `id: call.id`, `response`를 함께 전달합니다.
- **Firebase Hosting**: `firebase.json`/`.firebaserc`가 이미 구성되어 있고, `npm run build` → Hosting 배포가 정상 동작합니다.
- **App Check 토큰 발급**: 정상 확인되었습니다.
- **AI 자연어 명령 → Function Calling → Firestore 조회/수정 → 최종 AI 응답**: 정상 동작합니다.
- **App Check enforcement는 현재 진단을 위해 일시적으로 해제된 상태**입니다. 최종 단계에서 다시 켜야 합니다 (Firebase 콘솔 → App Check → 해당 API → Enforce).

## 1. Firebase 프로젝트 준비

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 새 프로젝트 생성 (요금제는 **Spark(무료)** 그대로 둡니다 — 결제 계정을 연결하지 마세요)
2. **Authentication → 로그인 방법 → Google** 사용 설정
3. **Firestore Database** 생성 (프로덕션 모드)
4. **프로젝트 설정 → 일반 → 내 앱**에서 웹 앱 추가 후 설정값 확인
5. 이 폴더에 `.env` 파일을 만들고 `.env.example`을 참고해 값 채우기

```bash
cp .env.example .env
# .env 파일을 열어 Firebase 설정값을 채워 넣는다
```

6. Firestore 보안 규칙 배포 (Firebase CLI 사용 시)

```bash
firebase deploy --only firestore:rules
```

또는 콘솔의 Firestore → 규칙 탭에 `firestore.rules` 내용을 붙여넣어도 됩니다. Phase 5에서도 이 파일은 변경하지 않았습니다 (`source_documents`는 Phase 1부터 이미 허용 목록에 있습니다). **Storage는 사용하지 않으므로 Storage를 활성화하거나 `storage.rules`를 배포할 필요가 없습니다.**

## 2~3. Firebase AI Logic / App Check 설정

1. Firebase 콘솔 → **빌드 → AI Logic** → Gemini API 제공자로 **"Gemini Developer API"** 선택 (Agent Platform 아님 — Blaze 요금제 필요)
2. Firebase 콘솔 → **Build → App Check** → 앱 등록 → 공급자로 **reCAPTCHA Enterprise** 선택 → Google Cloud Console의 reCAPTCHA Enterprise에서 발급받은 사이트 키 입력
3. `.env`의 `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`에 같은 사이트 키를 넣습니다.
4. 로컬 개발은 Debug Provider를 사용합니다 (`npm run dev` 실행 → 브라우저 콘솔에 뜨는 토큰을 콘솔의 Debug tokens에 등록).
5. **지금은 App Check enforcement가 임시로 꺼져 있습니다.** 최종 배포 전에 Firebase 콘솔 → App Check → AI Logic API에서 다시 **Enforce**로 전환해 주세요.

## 4. 실행

```bash
npm install
npm run dev
```

## 5. 폴더 구조 (Phase 5에서 추가/변경된 부분 위주)

```
src/
  ai/
    documentAnalysis.js      업로드 문서(PDF) 분석 - Tool 채팅과 별개의 1회성 Gemini 호출,
                             구조화된 JSON(responseSchema)으로 후보 항목만 추출
    session.js                (Phase4) 모델 gemini-3.1-flash-lite 고정
    assistant.js               (Phase4) functionResponse에 id 포함
  utils/
    fileFormat.js             선택한 파일의 형식(pdf/excel/image/word/unsupported) 판별
    fileToBase64.js           PDF/이미지를 브라우저 메모리에서 바로 base64로 변환 (Storage 없이)
    excelToText.js            엑셀 파일을 시트별 표 구조가 보존된 텍스트로 변환 (xlsx, 지연 로딩)
    wordToText.js             워드(.docx) 파일에서 본문 텍스트만 추출 (mammoth, 지연 로딩)
    conflictDetection.js      추출된 후보와 기존 Firestore 데이터의 충돌을 코드로 판단 (AI 미사용)
    timeConflictDetection.js  (신규) 일정(event)의 시간 겹침만 별도로 판단 (AI 미사용, conflictDetection.js와는 별개 기능)
  pages/
    DocumentsPage.jsx (+.css) 문서 선택 → 분석 → 검토/승인 화면 (Storage 없이 단일 흐름)
firebase.json                 Hosting 설정만 유지 (Storage 배포 설정 없음)

src/
  calendar/
    googleAuth.js              (Phase6, 신규) Google Identity Services 토큰 클라이언트 - 백엔드 없이 OAuth access token 발급
    calendarApi.js             (Phase6, 신규) Google Calendar API v3 호출 (fetch만 사용)
  contexts/
    GoogleCalendarContext.jsx  (Phase6, 신규) Calendar 연결 상태 전역 관리 (토큰은 메모리에만 보관)
  utils/
    calendarEligibility.js     (Phase6, 신규) 일정이 Calendar 동기화 대상인지 판단하는 순수 함수
  firebase/
    resetData.js               (Phase6, 신규) 현재 사용자 데이터 초기화 (ownerId 기준 배치 삭제)
  components/
    Modal.jsx (+.css)          (Phase6, 신규) 공용 확인 모달 (Calendar 삭제 선택, 초기화 확인에 재사용)
  pages/
    SettingsPage.jsx           (Phase6, 신규) Google Calendar 연결 상태 + 데이터 초기화
    EventsPage.jsx             (Phase6, 수정) Calendar 동기화 체크박스, 참석 여부, 삭제 시 Calendar 처리 선택 추가
    DocumentsPage.jsx          (Phase6, 수정) 회의 후보에 참석 여부 선택 + Calendar 동기화 체크박스 추가

```

`src/firebase/storage.js`와 `storage.rules`는 이번 수정에서 완전히 삭제했습니다 (7장 참고).

## 6. Phase 5: 자료 업로드 분석 (Firebase Storage 없이 브라우저에서 직접 처리, PDF·Excel·이미지·Word 지원)

### 지원 파일 형식

문서 종류(주간교육계획/월간교육계획/학사일정/기타)와 파일 형식은 서로 다른 개념이며, 어떤 문서 종류든 아래 형식 중 하나로 올라올 수 있습니다.

| 형식 | 확장자 | 처리 방식 |
|---|---|---|
| PDF | `.pdf` | 브라우저에서 base64로 변환 → Gemini 멀티모달 입력(inlineData)으로 직접 전달 |
| 이미지 | `.png`, `.jpg`, `.jpeg` | 위와 동일 (base64 → inlineData) |
| Excel | `.xlsx`, `.xls` | 브라우저에서 `xlsx` 라이브러리로 파싱 → 시트별로 `[Sheet: 이름]` + 표 형태 텍스트로 변환 → 텍스트만 Gemini에 전달 |
| Word | `.docx` | 브라우저에서 `mammoth` 라이브러리로 텍스트만 추출 → Gemini에 전달 |
| 그 외(HWP/HWPX 등) | - | 분석을 시도하지 않고 "현재 지원하지 않는 파일 형식입니다" 안내만 표시 |

두 라이브러리(`xlsx`, `mammoth`) 모두 브라우저에서 직접 동작하며, 실제로 그 형식의 파일을 분석할 때만 필요한 코드가 지연 로딩(dynamic import)되도록 해서 평소 앱 로딩 크기에 영향을 주지 않습니다.

### 흐름

1. **파일 선택** — `DocumentsPage`에서 제목/종류/기간(선택)을 입력하고 문서 파일을 고릅니다. 파일을 선택하면 파일명·형식·문서 종류가 바로 표시되고, 지원하지 않는 형식이면 그 자리에서 경고가 뜨고 "분석하기" 버튼이 비활성화됩니다. **파일은 Firebase의 어디에도 업로드되지 않습니다.**
2. **분석** — "분석하기"를 누르면 파일 형식에 따라 다르게 처리합니다.
   - PDF/이미지: `src/utils/fileToBase64.js`가 브라우저 메모리에서 바로 base64로 변환하고, `src/ai/documentAnalysis.js`가 이를 멀티모달 입력으로 Gemini에 전달합니다.
   - Excel: `src/utils/excelToText.js`가 시트 구조(시트명 + 표)를 보존한 텍스트로 변환한 뒤, 그 텍스트만 Gemini에 전달합니다.
   - Word: `src/utils/wordToText.js`가 본문 텍스트만 추출해 Gemini에 전달합니다.
   
   어느 경우든 `responseSchema`로 구조화된 JSON(후보 항목 배열)만 돌려받습니다. **파일 자체(또는 변환된 텍스트)는 이 요청이 끝나면 브라우저 메모리에서 사라지고, 어디에도 남지 않습니다.**
3. **최소 메타데이터만 저장** — 분석이 끝나면 `source_documents`에 다음 필드만 저장합니다: `ownerId`, `title`, `documentType`, `fileName`(파일 이름 문자열만, 원본 아님), `fileFormat`(pdf/excel/image/word), `periodStart`/`periodEnd`(선택), `analyzedAt`, `status`(analyzed/completed), `extractedItems`(후보 항목 배열). **원본 파일, base64, 추출된 원문 텍스트는 어디에도 저장하지 않습니다.**
4. **검토/승인** — 추출된 항목은 절대 자동으로 각 컬렉션(`events`/`tasks`/`timetable_overrides`/`notices`)에 저장되지 않습니다. 화면에서 항목별로 제목/날짜 등을 수정할 수 있고, **"저장"을 눌러야** 실제로 반영되며, **"무시"**를 누르면 버려집니다(`status: "ignored"`). 각 항목에는 어떤 문서에서 나왔는지 "출처: {문서 제목}"이 함께 표시됩니다.
5. **충돌 탐지 (중복/덮어쓰기)** — "저장"을 누르면 먼저 `src/utils/conflictDetection.js`(순수 코드, AI 미사용)가 같은 날짜의 기존 일정/업무/시간표 변경과 겹치는지 확인합니다. 겹치면 바로 덮어쓰지 않고 경고 문구를 보여주며, 버튼을 한 번 더 눌러야("그래도 저장") 기존 항목이 새 내용으로 업데이트됩니다. 충돌이 없으면 새 문서로 등록됩니다.
6. **시간 충돌 감지 (신규, 일정 전용)** — "충돌 탐지"와는 완전히 별개의 기능입니다. `src/utils/timeConflictDetection.js`(순수 코드, AI 미사용)가 event 후보에 한해, 같은 날짜의 기존 일정과 `startTime`/`endTime`이 실제로 겹치는지 확인합니다. 겹치면 화면에 "🕒 시간 충돌 가능성"과 겹치는 기존 일정 목록을 별도로 보여주지만, **저장 자체를 막지는 않습니다** — 중복 충돌과 마찬가지로 "그래도 저장"을 한 번 더 누르면 저장됩니다. 두 경고("⚠️ 기존 데이터와 겹칩니다" / "🕒 시간 충돌 가능성")는 항상 구분해서 표시됩니다.

### 시간 충돌 판단 규칙 (`src/utils/timeConflictDetection.js`)

- 기존 일정과 새 일정 모두 시작·종료 시간이 있으면 일반적인 범위 겹침(`newStart < existingEnd && newEnd > existingStart`)으로 판단합니다. 끝나는 시간과 다음 일정의 시작 시간이 정확히 같으면(예: 14:00~15:00 다음 15:00~16:00) 충돌이 아닙니다.
- 한쪽만 종료 시간이 있으면, 시작 시간만 있는 쪽의 시각이 범위가 있는 쪽의 구간 안에 들어가는지로 판단합니다.
- 양쪽 다 시작 시간만 있으면, 정확히 같은 시각일 때만 충돌 가능성으로 봅니다(15:00과 15:30처럼 다르면 길이를 추측하지 않고 충돌로 보지 않습니다).
- 어느 한쪽이라도 시작 시간이 아예 없으면(날짜만 있는 일정) 그 쪽은 시간 충돌 검사를 하지 않습니다.
- AI는 이 판단에 관여하지 않으며, 종료 시간을 임의로 추측하지 않습니다. (이를 위해 후보 추출 스키마에 `endTime`을 추가했고, 문서에 명시된 경우에만 채우도록 프롬프트에 명시했습니다.)

### 이전 버전(Storage 사용)과의 차이

이전 구현은 "업로드 → Storage 저장 → 필요할 때 다운로드해서 분석"이라는 2단계 흐름이었습니다. 지금은 "파일 선택 → 그 자리에서 바로 분석 → 최소 메타데이터만 저장"하는 1단계 흐름입니다. 그래서 예전처럼 "업로드는 해뒀지만 아직 분석 안 한 문서" 상태가 없어졌고, 목록에 있는 문서는 모두 이미 분석이 끝난 상태입니다 (다만 검토 대기 중인 후보가 남아있을 수는 있습니다).

### `source_documents` 컬렉션 (필드 변경)

| 이전 (Storage 버전) | 지금 |
|---|---|
| `uploadedAt` | `analyzedAt` (업로드가 아니라 분석이 끝난 시각) |
| `analyzed` (boolean) | `status` (`"analyzed"` → 검토 대기 항목 있음, `"completed"` → 전부 저장/무시 처리됨) |
| `fileReference` (Storage 경로) | 제거됨 — 대신 `fileName`(파일 이름 문자열만 보관) |
| `type` | `documentType` |
| (없음) | `fileFormat` (신규 — pdf/excel/image/word, 파일 형식 표시용) |

`extractedItems`는 그대로 유지됩니다: `{ id, status(pending/saved/ignored), kind(event/task/timetable_change/notice), title, date, startTime, eventType, period, className, memo }`. `firestore.rules`의 `source_documents` 허용 목록과 소유자(`ownerId`) 기반 접근 제한은 그대로입니다 — 규칙 변경은 없습니다.

### 개인정보 및 AI 호출 최소화 (Phase 4 원칙을 문서 분석에도 동일 적용)

- 문서 분석 호출에는 **선택한 파일 자체와 오늘 날짜만** 전달합니다. 기존 시간표/일정/업무/공지 전체를 함께 보내지 않습니다.
- 프롬프트에 "학생 개인정보(이름, 연락처 등)나 민감한 내용은 절대 추출하지 말고 무시해라"라고 명시했습니다. (완벽한 필터링을 보장하지는 않으므로, 학생 개인정보가 담긴 문서는 애초에 올리지 않도록 안내가 필요합니다.)
- 자동 분석 트리거가 없습니다 — 파일을 고른다고 바로 Gemini가 호출되지 않고, "분석하기"를 눌러야만 호출됩니다.
- PDF 원본, base64, 추출 원문은 Firestore에 전혀 저장하지 않으므로, 나중에 그 파일 내용이 DB에 남아 있을 걱정을 할 필요가 없습니다.
- 추출·저장 로직(구조화 파싱, 충돌 탐지, Firestore 반영)은 전부 일반 코드이며, 최종 확인 질문("겹치는 데이터가 있는데 그래도 저장할까요?")도 AI가 아니라 프로그램이 판단합니다.

### 이번 Phase에서 하지 않은 것

Google Calendar 연동, 회의의 캘린더 자동 등록은 Phase 6로 그대로 남겨두었습니다. 이메일/메신저 자동 수집, 학생 개인정보 분석도 하지 않았습니다.

### 새로 추가한 npm 패키지

- **`xlsx`** (SheetJS) — 브라우저에서 Excel(.xlsx/.xls) 파일을 읽어 시트별 표 데이터를 꺼내기 위해 사용합니다. **`package.json`은 npm 레지스트리의 구버전이 아니라 SheetJS 공식 CDN 배포판(0.20.3, `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`)을 가리키도록 되어 있습니다.** (이번 작업 환경은 `cdn.sheetjs.com`에 대한 네트워크 접근이 막혀 있어 이 CDN 배포판을 직접 설치·테스트하지는 못했습니다 — `package.json`의 의존성 경로만 그 주소로 맞춰두었고, 실제 설치·동작 확인은 받으신 뒤 `npm install` 실행 시 진행됩니다. `XLSX.read`/`XLSX.utils.sheet_to_json` API 자체는 버전 간에 바뀌지 않았으므로 `excelToText.js` 코드는 그대로 호환됩니다.)
- **`mammoth`** — 브라우저에서 Word(.docx) 파일의 본문 텍스트만 추출하기 위해 사용합니다.

두 패키지 모두 실제로 그 형식의 파일을 분석할 때만 지연 로딩(dynamic import)되도록 구현해서, PDF만 쓰는 사용자는 이 라이브러리들을 아예 내려받지 않습니다.

## 6-1. Phase 3 브리핑 안정화 수정 (버그 수정, Phase 6 아님)

실사용 중 "오늘의 브리핑"이 통째로 실패하는 문제가 있었습니다. 원인과 수정 내용:

**실제 원인**: `getTodayEvents()`가 `where("date","==",오늘) + orderBy("startTime","asc")` 조합의 쿼리를 쓰고 있었는데, 이 프로젝트에는 그 조합에 맞는 Firestore 복합 색인이 없었습니다. 이 쿼리 하나가 실패하면, `Home.jsx`가 모든 브리핑 조회를 `Promise.all()`로 묶어서 실행하고 있었기 때문에 나머지 9개 조회가 전부 성공해도 브리핑 전체가 실패로 처리됐습니다. 콘솔에 반복적으로 뜬 `AbortError: The user aborted a request`는 이와 별개로, 개발 모드 React StrictMode가 마운트 시 effect를 두 번 실행하면서 동시에 진행 중이던 Firestore 요청들이 겹쳐 취소되며 나는 부수 증상으로 보입니다 — StrictMode를 없애는 대신, 실패한 요청이 항상 안전하게 처리되도록 고쳐서 이 소음도 함께 줄였습니다.

**수정 1 — `Promise.all` → `Promise.allSettled`** (`src/pages/Home.jsx`): 각 조회 결과를 개별적으로 처리해서, 하나가 실패해도 나머지 섹션은 정상 표시됩니다. 실패한 조회는 `console.error("[Briefing] getTodayEvents failed:", ...)` 형태로 어떤 조회가 왜 실패했는지 개발 콘솔에 남기고, 화면에는 그 원문 오류 대신 해당 `BriefingSection`에만 "이 항목을 불러오지 못했습니다."를 표시합니다 (`BriefingSection.jsx`에 `failed` prop 추가). 전체 오류 문구는 "브리핑 데이터를 불러오는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요."로 바꿨고, 이는 설정 조회(`getSettings`)처럼 브리핑 전체를 그릴 수 없는 총체적 실패에만 뜹니다.

**수정 2 — Firestore 조회 원칙 재정렬** (`src/firebase/collections.js`): `getTodayEvents`/`getTodayDueTasks`/`getUpcomingTasks`/`getOverdueTasks`/`getUpcomingEvents` 5개 함수 모두, 이전에는 함수마다 각각 다른 `where` 조합(때로는 `orderBy`까지)으로 Firestore를 직접 조회했습니다. 지금은 전부 `ownerId` 하나로만 조회(`listDocsByOwner`)한 뒤 날짜·완료여부 비교와 정렬을 클라이언트에서 처리하도록 정리했습니다 — 이 프로젝트가 Phase 2부터 지켜온 "개인용 앱이므로 복합 색인 대신 클라이언트 필터링을 우선한다" 원칙에 맞춘 것입니다. **함수 이름과 반환값 형태는 그대로**라서, 이 함수들을 쓰는 Phase 4 AI 비서 코드(`toolExecutors.js`, `localQueries.js`)는 전혀 손대지 않았습니다.

**수정 3 — 홈 화면의 중복 조회 제거** (`src/pages/Home.jsx`, 신규 `src/utils/briefingDerive.js`): 예전에는 `events`를 "오늘 일정"용과 "다가오는 일정"용으로 두 번, `tasks`를 "오늘 마감"/"마감 지남"/"다가오는 마감"용으로 세 번, 총 5번 따로 읽었습니다. 지금은 `events`와 `tasks`를 각각 딱 한 번만 읽고(`listDocsByOwner`), 필요한 5가지 조각(오늘 일정, 다가오는 일정, 오늘 마감, 마감 지남, 다가오는 마감)을 전부 `briefingDerive.js`의 순수 함수로 클라이언트에서 파생시킵니다. 브리핑 로딩 시 동시에 나가는 Firestore 요청 수가 10개에서 7개로 줄었습니다.

이번 수정에서 Phase 6 기능은 추가하지 않았고, Phase 4/5(AI 비서, Function Calling, `id: call.id`, App Check, 문서 분석, 충돌 탐지 2종)는 파일 단위로 무변경임을 확인했습니다.



**제거한 코드**: `src/firebase/storage.js` 전체 파일, `storage.rules` 전체 파일, `firebase.json`의 `storage` 배포 설정. Storage import(`getStorage`, `ref`, `uploadBytes`, `getBytes`, `deleteObject`)와 `fileReference` 필드, `DocumentsPage.jsx`의 업로드/다운로드 로직도 모두 제거하고 브라우저 base64 변환(`fileToBase64.js`)으로 대체했습니다.

**Firebase Console에서 하실 것**: 없습니다. Storage를 활성화하실 필요도, `storage.rules`를 배포하실 필요도 없습니다. (이미 Storage를 활성화해 두셨다면 그대로 두셔도 무방합니다 — 이 앱이 더 이상 사용하지 않을 뿐입니다.) 이전과 동일하게 **App Check enforcement는 최종 단계에서 다시 켜주세요.**

## 8. Phase 6: Google Calendar 연동 + 데이터 초기화

### 8-1. Google Calendar 인증 방식 (중요 — Spark 요금제의 한계)

Firebase Authentication의 Google 로그인은 "누가 로그인했는지" 확인용이고, Google Calendar API 접근 권한(OAuth scope)은 별도로 받아야 합니다. 이 프로젝트는 서버가 없는 Spark 요금제 구조라서, refresh token이 필요한 정식 서버사이드 OAuth("Authorization Code" 플로우 + client secret)는 쓸 수 없습니다.

대신 **Google Identity Services(GIS)의 Token Client**를 사용했습니다 (`src/calendar/googleAuth.js`). 이건 공개 OAuth 클라이언트 ID만으로 브라우저에서 바로 access token을 받는, Google이 클라이언트 전용 앱을 위해 공식 제공하는 방식입니다. client secret이 전혀 필요 없습니다.

**한계(있는 그대로 말씀드립니다)**: 이 방식은 refresh token을 주지 않습니다. access token은 약 1시간만 유효하고, 만료되면(또는 브라우저를 새로고침/재시작하면) 사용자가 다시 "연결하기"를 눌러야 합니다. 같은 브라우저 세션 안에서는 대부분 팝업 없이 조용히 재발급됩니다. 이건 Blaze/Cloud Functions 없이 만들 수 있는 구조의 근본적인 한계이며, 의도적으로 서버 없는 구조를 지키기 위한 선택입니다. 토큰은 `GoogleCalendarContext`의 React state(메모리)에만 있고, Firestore나 localStorage에는 저장하지 않습니다.

### 8-2. 필요한 OAuth Scope

`https://www.googleapis.com/auth/calendar.events` 하나만 요청합니다. 이 scope는 캘린더 일정 생성·조회·수정·삭제만 가능하고, 캘린더 자체의 설정 변경이나 다른 캘린더 목록 조회 같은 더 넓은 권한은 요청하지 않습니다(최소 권한 원칙).

### 8-3. Firebase Console / Google Cloud Console에서 직접 하실 것

**Google Cloud Console** (Firebase 프로젝트와 연결된 GCP 프로젝트에서):
1. [Google Cloud Console](https://console.cloud.google.com/) → 해당 프로젝트 선택
2. **API 및 서비스 → 라이브러리** → "Google Calendar API" 검색 → 사용 설정
3. **API 및 서비스 → OAuth 동의 화면** → 아직 설정 안 하셨다면 구성 (User Type: 외부/내부 중 선택, 앱 이름/이메일 등 기본 정보만 입력하면 됩니다. scope 추가 단계에서 `.../auth/calendar.events`를 추가해 주세요.)
4. **API 및 서비스 → 사용자 인증 정보 → 사용자 인증 정보 만들기 → OAuth 클라이언트 ID**
   - 애플리케이션 유형: **웹 애플리케이션**
   - 승인된 자바스크립트 원본: 배포 도메인(예: `https://<프로젝트>.web.app`)과 로컬 개발용 `http://localhost:5173` 등을 추가
   - **"승인된 리디렉션 URI"는 필요 없습니다** (Token Client 방식은 리디렉션을 쓰지 않습니다)
5. 생성된 **클라이언트 ID**를 복사 (client secret은 이 방식에서 전혀 쓰지 않으니 무시하셔도 됩니다)

**Firebase Console**: 이번 Phase에서 추가로 설정하실 것은 없습니다. (기존 Firestore/Auth/AI Logic/App Check 설정 그대로)

### 8-4. `.env`에 추가할 환경변수

```
VITE_GOOGLE_OAUTH_CLIENT_ID=위에서 발급받은 OAuth 클라이언트 ID
```

(client secret은 어디에도 넣지 않습니다. 이 클라이언트 ID는 브라우저 코드에 그대로 노출되는 값이며, 원래 그렇게 쓰도록 설계된 공개 값입니다.)

### 8-5. events 데이터와 Calendar 동기화 규칙

기존 `events` 필드(title/date/startTime/endTime/type/status/memo/source/calendarSync/googleCalendarId/createdAt/updatedAt)는 그대로 두고, **`attending`(true/false/null) 필드 하나만 추가**했습니다 — 회의의 참석 여부를 저장하기 위해 꼭 필요했습니다.

동기화 가능 여부 판단(`src/utils/calendarEligibility.js`, 순수 함수):
- `type`이 `academic`(학사일정) / `school`(학교행사) / `personal`(개인일정) → 항상 동기화 가능
- `type`이 `meeting`(회의) → `attending === true`(참석 확정)일 때만 동기화 가능. AI는 참석 여부를 절대 임의로 판단하지 않으며, 문서 분석 후보에서도 회의는 항상 "아직 모름"으로 시작해서 사용자가 직접 골라야 합니다.
- 그 외(참석 여부 불명/불참) → Firestore에는 저장할 수 있지만 Calendar에는 동기화하지 않음

동기화는 **사용자가 직접 체크박스를 켰을 때만** 일어납니다 (일정 페이지, 문서 분석 승인 화면 둘 다 동일). 대상이 아닌 화면(업무/공지/시간표/진도)에는 이 옵션 자체가 보이지 않습니다.

### 8-6. 생성/수정/삭제 흐름

- **생성**: Firestore에 먼저 저장 → 체크박스가 켜져 있고 동기화 대상이면 Calendar에 이벤트 생성 → 성공하면 `googleCalendarId` 저장, `calendarSync: true`. **Calendar 생성이 실패해도 Firestore 저장은 그대로 유지**되고, `calendarSync: false`와 함께 "일정은 저장되었지만 Google Calendar 동기화에 실패했습니다." 안내만 뜹니다.
- **수정**: 이미 `googleCalendarId`가 있으면 새로 만들지 않고 그 이벤트를 PATCH로 수정합니다(중복 생성 방지). Calendar 수정이 실패해도 Firestore 수정은 취소되지 않습니다.
- **삭제**: `calendarSync && googleCalendarId`가 있는 일정을 지우려 하면 모달이 떠서 "앱과 Google Calendar에서 모두 삭제" / "앱에서만 삭제" / "취소" 중 고르게 했습니다. Calendar에서 이미 지워진 일정(404/410)은 오류로 취급하지 않습니다.
- **시간 처리**: `date+startTime+endTime`이 모두 있으면 시간 있는 이벤트로, 종료시간이 없으면(AI가 임의로 만들지 않으므로) **하루짜리(all-day) 이벤트**로 등록합니다. 날짜만 있는 일정도 all-day로 등록됩니다. 시간대는 `Asia/Seoul`로 고정했습니다.
- **오류 격리**: 권한 거부, 토큰 만료, 네트워크 오류, Calendar API 오류 등 어떤 이유로 Calendar 호출이 실패해도 예외를 던지지 않고 콘솔 로그 + 사용자 안내로만 처리합니다 — Firestore 쪽 CRUD는 Calendar 상태와 무관하게 항상 정상 동작합니다.

### 8-7. 회의 참석 여부 확인 UI

- **일정 페이지**: 구분을 "회의"로 선택하면 "참석 여부"(참석/불참/아직 모름) 셀렉트가 나타납니다. AI 비서에게 사용자가 직접 "내가 참석하는 회의"라고 명확히 말한 경우는 Phase 4의 Function Calling(`addEvent`)이 그대로 처리하며, 이번 Phase에서 그 Tool 자체는 건드리지 않았습니다. (AI 비서가 참석 여부까지 대신 판단하게 만드는 것은 이번 범위에 포함하지 않았습니다 — 시스템 지침에는 이미 "참석 여부가 불명확하면 먼저 확인 질문을 한다"는 원칙이 있습니다.)
- **문서 분석 승인 화면**: 추출된 회의 후보에는 항상 참석 여부 선택(참석/불참/아직 모름)이 함께 나타나고, 기본값은 "아직 모름"입니다. 참석 여부를 고르지 않았다고 해서 승인 자체가 막히지는 않으며, "참석"으로 고른 경우에만 "Google Calendar에 추가" 체크박스가 나타납니다.

### 8-8. Google Calendar 연결 UI

`/settings`(설정) 페이지에 연결 상태(연결됨/연결되지 않음), 연결하기/연결 해제 버튼을 뒀습니다. 연결된 계정 표시는 Firebase 로그인 이메일을 그대로 보여줍니다(같은 Google 계정으로 Calendar도 연결한다고 가정합니다 — 별도로 "이 access token이 어느 계정 것인지"를 확인하는 API 호출은 scope를 늘려야 해서 하지 않았습니다).

### 8-9. 데이터 초기화

`/settings` 페이지, `src/firebase/resetData.js`에 구현했습니다.

- **업무 데이터 초기화**: `timetable`/`timetable_overrides`/`lesson_plan`/`class_progress`/`events`/`tasks`/`notices`/`source_documents`만 삭제. `settings/{uid}`와 Firebase Authentication 계정은 그대로 둡니다.
- **전체 사용자 데이터 초기화**: 위 전체 + `settings/{uid}`까지 삭제. Authentication 계정 삭제 기능은 만들지 않았습니다.
- 모든 삭제는 `listDocsByOwner`로 **현재 로그인한 사용자의 ownerId로만** 조회한 뒤 그 문서 id만 지우므로, 다른 사용자의 데이터는 애초에 조회 결과에 포함되지 않아 삭제될 수 없습니다.
- Firestore 배치 쓰기 한도(500)를 고려해 400개씩 청크로 나눠 `writeBatch`를 커밋합니다. 컬렉션 중 하나가 실패해도 나머지는 계속 진행하고, 실패한 컬렉션 이름을 콘솔에 남기고 화면에도 안내합니다.
- **안전장치**: 브라우저 `confirm()` 하나로 처리하지 않고, "초기화"라는 글자를 정확히 입력해야 삭제 버튼이 활성화되는 모달을 만들었습니다.
- **Calendar와의 관계**: 삭제 대상 `events` 중 `calendarSync && googleCalendarId`가 있는 것이 있으면, 확인 모달에 "앱 데이터만 초기화" / "앱 데이터 + 이 앱이 생성한 Google Calendar 일정도 삭제" 선택지가 추가로 나타납니다. 후자를 고르면 **이 앱이 `googleCalendarId`로 기록해둔 이벤트만** Calendar에서 지웁니다 — 사용자의 다른 Calendar 일정은 절대 건드리지 않습니다. (이때 Calendar가 연결되어 있지 않으면 Calendar 쪽 삭제만 건너뛰고 Firestore 삭제는 정상 진행됩니다.)

### 8-10. 이번 Phase에서 하지 않은 것 / Spark 요금제 관련 확인

- Blaze 요금제, Cloud Functions, Agent Platform, Firebase Storage — 전혀 추가하지 않았습니다.
- 서버사이드 OAuth(refresh token 발급)는 서버가 필요해서 구현하지 않았습니다 — 위 8-1에 그 한계를 명시했습니다.
- 새 npm 패키지를 추가하지 않았습니다 — GIS는 `<script>` 동적 로딩, Calendar API는 브라우저 내장 `fetch`만 사용했습니다.
- 정보 우선순위(사용자 직접 입력 > 최신 메시지/공지 > 주간계획 > 월간계획 > 기본 학사일정)와 시간표 override 구조는 그대로입니다 — 이번 Phase에서 관련 로직을 건드리지 않았습니다.

### 8-11. 후속 수정 (Phase 6 실사용 테스트 후 반영)

**1) 종료 시간 없는 일정의 Calendar 처리 규칙 수정** — 예전에는 시작 시간만 있고 종료 시간이 없는 일정을 "제목 (15:00~)" 형태의 all-day 이벤트로 만들었는데, 이는 종료 시간을 알 수 없다는 사실을 얼버무리는 방식이라 제거했습니다. 지금은 (`src/calendar/calendarApi.js`):
- 시작·종료 시간이 모두 있으면 → timed event
- 시작·종료 시간이 모두 없으면 → all-day event
- 시작 시간만 있으면 → **Calendar에 생성하지 않고** `MissingEndTimeError`를 던져, 화면에 "Google Calendar에 추가하려면 종료 시간을 입력해 주세요."라고 안내합니다. Firestore 일정 자체는 시작 시간만 있어도 그대로 저장됩니다. `EventsPage.jsx`/`DocumentsPage.jsx` 모두 이 에러를 일반 동기화 실패와 구분해서 보여줍니다.

**2) AI 비서(`addEvent`)에서도 Google Calendar 동기화 가능** — 예전에는 `toolExecutors.js`의 `execAddEvent`가 항상 `calendarSync: false`로 고정되어 있었습니다. 지금은 `addEvent` Function Calling 선언(`tools.js`)에 `attending`(회의 참석 여부)과 `addToCalendar`(사용자가 명확히 캘린더 동기화를 요청했는지) 파라미터가 추가되었고, `execAddEvent`가 이 값을 보고 조건이 맞으면(참석 확정 회의이거나 학사일정/학교행사/개인일정 + 사용자가 명확히 요청) 실제로 Calendar에 등록합니다. **Gemini에는 access token이나 `calendarHelpers` 객체 자체가 전달되지 않습니다** — Gemini는 `attending`/`addToCalendar` 같은 의도만 함수 인자로 넘기고, 실제 토큰 조회와 Calendar API 호출은 `AssistantPage.jsx`에서 `useGoogleCalendar()`로 얻은 함수를 실행기에 그대로 전달해 클라이언트 코드 안에서만 수행합니다. `SYSTEM_INSTRUCTION.js`에도 "참석 여부·캘린더 동기화 의사가 불명확하면 임의로 채우지 말고 먼저 물어본다"는 지침을 추가했습니다.

**알려드릴 한계**: `addToCalendar`로 인한 Google 연결 팝업은 AI 응답을 기다리는 비동기 흐름 중간에 뜨기 때문에, 브라우저에 따라 "사용자 동작 없이 뜬 팝업"으로 간주되어 팝업 차단에 걸릴 수 있습니다. 이 경우 설정 페이지에서 미리 "연결하기"로 한 번 연결해두면(같은 브라우저 세션 동안은 토큰이 조용히 재발급되므로) 이 문제를 피할 수 있습니다.

## 9. 개인정보처리방침 페이지 (`/privacy`)

Google OAuth 브랜딩 화면(동의 화면)에 등록할 개인정보처리방침 링크용으로 `/privacy` 페이지를 추가했습니다.

- **로그인 없이 접근 가능**합니다. `App.jsx`의 라우팅 구조를 살짝 재구성해서, `/privacy`는 로그인 여부를 확인하기 전에 먼저 매치되도록 했습니다 — 그 외 모든 경로(`/`, `/events`, `/settings` 등)는 기존과 동일하게 로그인 게이트를 거칩니다.
- `firebase.json`의 기존 SPA rewrite(`"source": "**"` → `/index.html`)가 이미 모든 경로를 커버하므로 추가 설정 없이도 `https://<프로젝트>.web.app/privacy`로 직접 접속했을 때 정상적으로 페이지가 뜹니다. (`npm run preview`로 직접 접속 테스트해 200 응답과 정상 렌더링을 확인했습니다.)
- 문의 이메일은 `.env`의 `VITE_PRIVACY_CONTACT_EMAIL`로 설정합니다. 비워두면 문의 섹션에 이메일 대신 "문의 채널이 아직 설정되지 않았습니다."가 표시되며, 코드에 임의의 placeholder 이메일을 넣지 않았습니다.
- 페이지 내용은 실제 코드 구조(Storage 미사용, ownerId 기반 접근 제한, Calendar는 사용자가 선택한 경우에만 연동, 데이터 초기화 범위 등)와 일치하도록 작성했고, 과장되거나 현재 구현과 다른 보장 문구는 넣지 않았습니다.
- 새 npm 패키지는 추가하지 않았습니다. `package.json`/`package-lock.json`은 변경하지 않았습니다.

## 10. Phase 6.1: 담임 학급 시간표

교사 본인의 수업 시간표("내 수업 시간표", 기존 `timetable`)와는 완전히 독립된 기능입니다. 설정에서 담임으로 등록한 사용자에게만 나타나며, 나머지 사용자에게는 기존 화면과 동일합니다.

- **설정**: `설정` 페이지에 "담임 학급" 항목 추가 — 담임 아님/담임 라디오 + 학년/반 입력. `settings/{uid}`에 `isHomeroomTeacher`/`homeroomClass` optional 필드로 저장되며, 기존 `briefingTime`/`lastBriefingDate`는 그대로입니다. 새 필드가 없는 기존 사용자는 자동으로 비담임으로 처리됩니다. 담임을 해제해도 학급 값과 담임 학급 시간표 데이터는 지우지 않습니다(다시 담임으로 바꾸면 이어서 사용 가능).
- **시간표 페이지**: 담임으로 설정된 경우에만 상단에 "내 수업 시간표"/"{학급} 학급 시간표" 전환 버튼이 나타납니다. 기존 "내 수업 시간표" 영역(그리드, 시간표 가져오기, 일시적 변경)은 코드 한 줄도 바꾸지 않았습니다 — 조건부로 감싸기만 했습니다.
- **담임 학급 시간표**: 새 컬렉션 `homeroom_timetable`(필드: `ownerId`/`dayOfWeek`/`period`/`subject`/`teacher`)을 사용합니다. 셀 클릭으로 과목/담당 교사를 직접 수정할 수 있고, 학급 자체는 셀마다 입력하지 않고 설정의 `homeroomClass`를 그대로 씁니다.
- **PDF/Excel/이미지/Word 가져오기**: 기존 `analyzeTimetableDocument`(교사 시간표용)는 손대지 않고, 같은 파일 처리 인프라(`fileToBase64`/`excelToText`/`wordToText`, 동일한 Gemini 모델·구조화 출력 방식)를 재사용해 `analyzeHomeroomTimetableDocument`를 새로 추가했습니다. 프롬프트에 담임 학급명을 지정해 그 학급 열만 추출하도록 하고, 학급을 찾지 못하면 빈 배열을 반환하도록 지시했습니다(다른 학급 정보를 섞어 추측하지 않음). 담당 교사도 명시되지 않으면 추측하지 않습니다. 결과는 그리드 미리보기로 먼저 보여주고, 셀 수정 후 "시간표 등록"을 눌러야 저장되며, 기존 담임 학급 시간표가 있으면 교체 확인 모달이 뜹니다.
- **`timetable_overrides`는 그대로 둠**: 담임 학급의 임시 변경 기능은 이번 단계에서 만들지 않았습니다.
- **데이터 초기화**: `homeroom_timetable`을 업무 데이터 초기화 대상에 추가했고, `isHomeroomTeacher`/`homeroomClass`는 `settings/{uid}`에 속하므로 업무 데이터 초기화 후에도 유지됩니다.
- **Firestore 보안 규칙**: `homeroom_timetable`을 기존 ownerId 기반 컬렉션 허용 목록 4곳에 그대로 추가했습니다. 규칙 구조 자체는 바꾸지 않았습니다.
- **AI 비서 tool**: 이번 단계에서는 추가하지 않았습니다(요청하신 범위 그대로).

## 11. Phase 6.2: 월별 수업 진도 관리 (1차 구현 — 계산 엔진 + 수동 UI)

**이번 턴에서 구현한 범위**: 결정론적 계산 엔진(`utils/progressComparison.js`, `utils/remainingLessons.js`, `utils/schoolScheduleUtils.js`)과 새 데이터 구조, 그리고 이를 직접 다루는 수동 UI(`/monthly-progress`)까지입니다. **학사일정 문서를 AI가 분석해 후보를 추출하는 파이프라인과, 진도/시수 보정을 위한 AI function calling 확장은 이번 턴에 포함하지 않았습니다** — 계산 로직의 정확성을 먼저 확실히 검증하는 것을 우선했습니다(아래 "아직 구현하지 않은 부분" 참고). 학사일정은 이번 버전에서 `/monthly-progress` 화면에서 직접 입력하는 방식으로 관리합니다.

### 새 컬렉션
- `progress_plans` — 월별 진도 항목 (ownerId, grade, year, month, title, order, estimatedLessons?, createdAt, updatedAt)
- `progress_checks` — 반별 체크 (ownerId, planItemId, className, completed, completedAt?, createdAt, updatedAt)
- `school_day_schedules` — 특별한 수업 운영일 해석 (ownerId, date, originalText, status, noRegularClasses?, noClassGrades?, scheduleDayOverride?, regularPeriods?, affectedGrades?, affectedPeriods?, memo?, source, createdAt, updatedAt)
- `lesson_adjustments` — 수동 시수 보정 (ownerId, date, className, delta, reason, source, createdAt, updatedAt)

기존 `lesson_plan`/`class_progress`(Phase 2 시스템)는 전혀 건드리지 않았고, 그대로 `/progress` 페이지에서 계속 쓸 수 있습니다.

### 계산 로직 (모두 순수 JavaScript, Gemini 미사용)
- `progressComparison.js`: 반별 "연속 완료 위치"(현재/다음 항목 판단용)와 "전체 완료 개수"(남은 항목 수 판단용)를 분리 계산 — 중간을 건너뛰고 체크해도 안정적으로 동작합니다(단위 테스트로 확인).
- `remainingLessons.js`: 날짜를 하루씩 순회하며 완전휴업/학년제외/`scheduleDayOverride`/`regularPeriods`/`affectedGrades·Periods`를 적용하고, `timetable_overrides`와 `lesson_adjustments`까지 반영해 최종 횟수와 항목별 근거(`basis`)를 함께 반환합니다. `school_day_schedules`는 `status: "confirmed"`인 것만 계산에 반영하고, `needs_review`는 별도 목록(`unresolvedSchedules`)으로만 알려줍니다.
- 두 모듈 모두 node로 핵심 시나리오(빈칸/완전휴업/학년별 시험/"1-2 수업"/"금요일 수업"/영어듣기평가 needs_review/수동보정)를 직접 실행해 결과를 확인했습니다.

### UI (`/monthly-progress`, 신규 페이지 — 기존 `/progress`와 별개)
학년/연도/월 선택 → 진도 항목 빠른 다중 입력(제목+예상 차시 선택, ↑↓ 순서 변경, 새 라이브러리 없이) → 반별 체크 매트릭스(클릭 즉시 저장) → 반별 현황(현재/다음 항목, 남은 항목 수, 가장 빠른 반 대비 차이) → 실제 남은 수업 횟수(계산 근거 보기 포함) → 학사일정 해석 수동 등록/수정/삭제 → 수업 횟수 수동 보정 등록/수정/삭제. 학급 목록은 항상 기존 `timetable`에서 그대로 가져옵니다.

### estimatedLessons 미입력 처리
남은 진도 항목 중 하나라도 예상 차시가 비어 있으면 "부족/여유" 계산 자체를 하지 않고 `null`을 반환합니다(화면에도 표시 안 함) — 모든 남은 항목에 값이 있을 때만 비교합니다.

### 하위 호환
새 컬렉션이 전혀 없는 기존 사용자도 오류 없이 정상 작동합니다(모든 조회가 빈 배열을 안전하게 처리). `timetable`/`timetable_overrides`/`homeroom_timetable`/기존 브리핑 계산 로직은 diff로 무변경을 확인했습니다.

### Firestore Rules / 초기화
4개 컬렉션을 기존 ownerId 허용 목록에 추가했고, `resetData.js`의 업무 데이터 초기화 대상에도 추가했습니다. `settings/{uid}`(브리핑 시간, 담임 정보 포함)는 그대로 유지됩니다.

### 아직 구현하지 않은 부분 (다음 단계로 미룸)
- 연간 학사일정 문서(PDF/Excel/이미지/Word)를 AI가 분석해 `school_day_schedules` 후보를 추출하는 파이프라인, 그리고 그 검토/확정 화면 — 현재는 수동 입력만 가능합니다.
- "스포츠클럽"/"자유학기" 관련 내용을 학사일정 분석에서 제외하는 로직 — 위 AI 분석 파이프라인이 아직 없어 적용할 곳이 없습니다.
- AI function calling 확장 3종: 자연어로 월별 진도계획 입력, 자연어로 시수 보정 입력, 자연어 진도 현황 질의응답.
- 홈 브리핑에 "다가오는 수업 운영 확인 필요" 항목을 실제로 연결하는 것 — `getUpcomingNeedsReviewSchedules()`는 만들어 뒀지만 아직 어디에서도 호출하지 않습니다(요청하신 대로 브리핑 UI 자체는 손대지 않았습니다).

## 12. Phase 6.2 완성: 메뉴 통합 + 학사일정 AI 분석 + AI function calling 확장

이전 턴에서 "1차 구현"으로 남겨뒀던 부분을 마저 구현했습니다.

### 12-1. 메뉴 통합
사이드바에는 이제 "수업 진도" 하나만 남았고, `/progress`가 새 월별 진도관리 화면(`MonthlyProgressPage`)으로 연결됩니다. `/monthly-progress`는 `/progress`로 자동 이동(redirect)만 하도록 남겨뒀습니다(예전 링크 호환용). 기존 `lesson_plan`/`class_progress`와 `ProgressPage.jsx` 파일 자체는 삭제하지 않았고, 다만 라우팅에서 빠져 화면에 노출되지 않을 뿐입니다.

### 12-2. 학사일정 파일 업로드 → AI 분석 → 검토 → 저장
`/progress`의 "학사일정 해석" 영역에 파일 업로드가 추가됐습니다. PDF/Excel/이미지/Word를 그대로 올리면(사용자가 미리 정리할 필요 없음), 기존 문서 분석과 동일한 처리 유틸(`fileToBase64`/`excelToText`/`wordToText`, 동일한 Firebase AI Logic 호출 패턴)을 그대로 재사용해 신규 `src/ai/academicScheduleAnalysis.js`가 분석합니다. **분석 결과는 절대 곧바로 저장되지 않고**, 화면에 후보 목록으로 뜹니다 — 각 후보의 원문/상태/영향 학년/영향 교시/요일 대체/메모를 직접 수정하거나 항목별로 "제외"할 수 있고, "선택한 항목 저장"을 눌러야 `school_day_schedules`에 반영됩니다. 기존 `DocumentsPage.jsx`(주간/월간 문서 분석)는 전혀 건드리지 않았습니다(diff로 무변경 확인).

### 12-3. 스포츠클럽/자유학기 제외, "1-2 수업" 등 해석 규칙
전부 `academicScheduleAnalysis.js`의 프롬프트에 명시했습니다 — 스포츠클럽/자유학기 표현은 **셀 단위로만** 제외하고(같은 셀에 다른 중요 정보가 있으면 그 부분은 정상 추출), 정확한 교시를 알 수 없는 창체/동아리/영어듣기평가류는 무조건 `needs_review`로 두도록 지시했습니다. 실제 판정(`confirmed`인 것만 계산에 반영)은 여전히 `remainingLessons.js`가 코드로 수행합니다 — AI는 후보를 만들 뿐, 계산에는 관여하지 않습니다.

### 12-4. "확인이 필요한 일정" 표시
`getUpcomingNeedsReviewSchedules()`를 이번에 처음 실제로 연결했습니다 — `/progress` 화면 상단에 미확정 일정 전체와, 그중 14일 이내로 다가오는 것을 구분해서 보여줍니다. 홈 브리핑은 요청하신 대로 손대지 않았습니다.

### 12-5. AI function calling 확장 (6개 신규 tool)
기존 `tools.js`/`toolExecutors.js`/`systemInstruction.js` 구조와 스타일을 그대로 따라 추가했습니다. Google Calendar 도구, 기존 `class_progress` 도구(`updateClassProgress`/`searchClassProgress`, Phase2 시스템용)와는 분리되어 있고 둘 다 그대로 남아 있습니다.

| Tool | 설명 |
|---|---|
| `addProgressPlanItems` | 월별 진도 항목 여러 개를 한 번에 등록 (순서는 사용자가 말한 그대로) |
| `getProgressStatus` | 학년/학급의 진도 현황 조회 — **계산은 `analyzeClassProgress`/`compareClassesInGrade`가 하고, AI는 결과만 설명** |
| `getRemainingLessons` | 남은 수업 횟수 + 계산 근거 조회 — **`remainingLessons.js` 그대로 재사용, AI는 직접 계산하지 않음** |
| `addLessonAdjustment` | 수동 시수 보정 등록 (날짜/학급/증감량 불명확하면 호출 안 함) |
| `searchNeedsReviewSchedules` | 미확정 학사일정 조회 |
| `updateSchoolDaySchedule` | 미확정 학사일정을 사용자가 알려준 정보로 확정 처리 |

`addProgressPlanItems`는 후보 확인 UI 없이 바로 저장하는 방식을 택했습니다 — 기획서에서 "사용자가 명확히 저장을 요청하면 기존 function calling과 일관되게 처리해도 된다"고 허용한 더 단순한 경로이며, `addEvent`가 이미 쓰는 것과 같은 패턴(불명확하면 호출 자체를 하지 않도록 systemInstruction에 명시)입니다. 채팅 안에 별도의 "후보 검토 카드" UI를 새로 만들지는 않았습니다.

### 12-6. 실제 코드 실행 검증
`remainingLessons.js`/`progressComparison.js`는 이전 턴에 이미 8개 핵심 시나리오를 node로 직접 실행해 검증했고, 이번 턴에 함수 위치만 옮긴 뒤(`gradeOfClassName`→`progressComparison.js`, `endOfMonth`→`date.js`의 `endOfMonthDateString`) 같은 테스트를 다시 실행해 **동일하게 전부 통과**함을 확인했습니다. 추가로 "needs_review였던 일정을 사용자가 확정한 뒤 재계산에 반영되는지"도 새로 테스트해 통과를 확인했습니다(확정 전 unresolved 1건·차감 없음 → 확정 후 unresolved 0건·정확히 1회 차감). 실제 사용자 Firestore에는 아무 것도 쓰지 않았습니다 — 전부 로컬 node 스크립트의 순수 함수 테스트입니다.

### 아직 구현하지 않은 부분
- 채팅 UI 안에서 진도계획을 "후보로 보여주고 확인 버튼으로 저장"하는 전용 카드 — 대신 명확한 직접 저장 방식으로 구현했습니다(위 12-5 참고).
- 학사일정 파일 분석 시 중복 후보에 대한 자동 병합 로직 — 현재는 동일 날짜+원문이 기존 항목과 겹치면 화면에 표시만 하고, 저장 시 그 항목을 덮어쓰는 방식입니다(사용자가 화면에서 보고 판단).
- 홈 브리핑에 미확정 일정을 직접 노출하는 것 — 요청하신 대로 이번 단계에서 보류했습니다.

## 13. 담당 학년 선택 방식 개선 (여러 학년 담당 대응)

`/progress`의 "학년" 입력을 자유 텍스트에서 **드롭다운**으로 바꿨습니다. 목록은 특정 학년을 코드에 미리 정해두지 않고, 매번 `timetable`에 저장된 현재 사용자의 `className`을 분석해서 실제 담당 학년만 추출합니다(`gradeOfClassName()` 재사용, 신규 컬렉션 없음).

- 학년을 바꾸면 `progress_plans`/`progress_checks` 조회, 반별 진도 체크표·현황, "실제 남은 수업 횟수" 계산이 전부 그 학년 기준으로 다시 계산됩니다 — 전부 이미 `grade` state에 의존하는 `useMemo`였으므로 자연스럽게 반영되지만, 학년 전환 시 "남은 수업 횟수"의 대상 학급(`remainingClass`)이 이전 학년 학급에 그대로 머무르는 버그가 있어 이번에 함께 고쳤습니다(학급 목록이 바뀌면 그 목록에 없는 선택값은 자동으로 새 목록의 첫 학급으로 전환).
- 시간표가 아직 없어 담당 학년을 하나도 추출할 수 없으면 드롭다운이 비활성화되고 "시간표에 등록된 학급 없음"으로 표시됩니다.
- 학사일정(`school_day_schedules`)은 요청하신 대로 학년별로 분리하지 않고 그대로 학교 전체 공통 데이터로 둡니다 — `noClassGrades`/`affectedGrades`는 이미 `remainingLessons.js`가 선택된 `grade`와 대조해서 판단하고 있었으므로(Phase 6.2부터 존재하던 로직) 이 부분은 변경하지 않았습니다.
- `1-2`, `1-5`처럼 여러 반을 담당하는 1학년과 `3-1`, `3-3`을 담당하는 3학년이 동시에 있는 시나리오로 node에서 직접 검증했습니다 — 학년별 학급 목록이 정확히 분리되어 나오는 것을 확인했습니다.

## 14. 학급 코드("101"/"301" 형식) 대응 + 실제 버그 수정

### 수정한 핵심 문제
학교에 따라 `className`을 "3-2"(하이픈) 대신 "101", "307"처럼 **학년+반이 붙은 순수 숫자 코드**로 쓰는 경우가 있습니다. 기존 `gradeOfClassName()`은 `/^(\d+)/` 정규식으로 앞의 숫자를 전부 캡처했기 때문에, "301"을 만나면 학년을 "3"이 아니라 "301" 전체로 잘못 인식했습니다. `src/utils/progressComparison.js`에 `parseClassCode()`를 새로 추가해 이 문제를 고쳤습니다.

```
"3-2"  → { grade: "3", classNumber: "2" }   (기존 하이픈 표기, 하위 호환)
"101"  → { grade: "1", classNumber: "1" }
"105"  → { grade: "1", classNumber: "5" }
"307"  → { grade: "3", classNumber: "7" }
```

규칙: 하이픈이 있으면 그 앞뒤를 학년/반으로 쓰고, 순수 숫자면 **첫 자리만 학년, 나머지 전부가 반 번호**입니다(앞자리 0 제거). `gradeOfClassName()`은 이 함수의 결과 중 grade만 반환하도록 재구현했고, 이 함수 하나만 고치면 `MonthlyProgressPage.jsx`와 `toolExecutors.js`(AI function calling)가 전부 같은 규칙을 자동으로 쓰게 됩니다 — 두 곳 다 이 함수를 그대로 호출하기 때문입니다.

### 검증 과정에서 발견하고 함께 고친 실제 버그
시나리오 E("2,3학년 중간고사"가 학년별로 다르게 적용되는지)를 검증하던 중, **실제 프로덕션 코드에 이미 존재하던 버그**를 발견했습니다: `gradeOfClassName()`이 반환하는 `grade`는 항상 **문자열**("3")인데, `noClassGrades`/`affectedGrades`는 항상 **숫자 배열**([2,3])이라서 `.includes(grade)` 비교가 타입 불일치로 **항상 거짓**이었습니다. 즉 "학년별 시험 제외"와 "창체/동아리 학년 영향" 기능이 실제로는 한 번도 작동하지 않고 있었습니다. `src/utils/schoolScheduleUtils.js`의 `isClassExcludedForDate`/`isPeriodRegularForDate`에서 비교 전에 양쪽을 `Number(...)`로 정규화하도록 고쳤습니다. `remainingLessons.js` 자체는 이번에도 한 줄도 건드리지 않았습니다 — 그 안에서 호출하는 이 두 함수만 고쳤습니다.

### 담당 학년/학급 추출 (하드코딩 없음)
- 담당 학년 목록: `timetable`의 모든 `className`에 `parseClassCode`를 적용해 학년만 뽑고 중복 제거·오름차순 정렬 — 실제 담당 학년만 나오고, 없는 학년은 나오지 않습니다.
- 담당 학급 목록: 선택한 학년에 해당하는 `className`만 중복 제거 후 **반 번호 기준 숫자 정렬**로 나열 — 존재하지 않는 학급(예: 1학년인데 102가 없으면 102)을 만들어내지 않습니다.
- 학년 전환 시 "실제 남은 수업 횟수"의 대상 학급이 이전 학년 것에 머무르지 않도록(지난 턴에 이미 고침) 학급 목록이 바뀌면 자동으로 새 목록의 첫 학급으로 전환됩니다.

### progress_plans(학년 공통)/progress_checks(학급별) 구조 확인
검증해보니 **이미 Phase 6.2부터 올바르게 구현되어 있었습니다** — `progress_plans` 저장 payload에는 애초에 `className` 필드 자체가 없어서(grade+year+month로만 구분) 학급별 복제가 발생할 수 없는 구조였고, `progress_checks`는 처음부터 `planItemId + className` 조합으로 저장됩니다. AI의 `addProgressPlanItems`도 동일하게 `className` 없이 저장하므로, "3학년 9월 진도는 A,B,C,D야"라고 말해도 301~307용 계획이 각각 복제되지 않습니다. 이번 턴에 이 구조 자체를 바꾸지 않았습니다.

### 학사일정과 학년 필터 연결
`school_day_schedules`는 여전히 학교 전체 공통 데이터입니다. `noClassGrades`/`affectedGrades`(위에서 고친 타입 정규화 포함)와 `regularPeriods`/`scheduleDayOverride`/`noRegularClasses`가 `remainingLessons.js` 계산 시점에 선택된 학년/학급에 맞게 적용되며, 학년별로 파일을 따로 올릴 필요가 없습니다.

### 검증 (node 순수 함수 테스트, 실제 Firestore 미사용)
아래 표의 시나리오를 전부 node로 직접 실행해 확인했습니다(방금 위에서 실행한 결과 그대로).

| 시나리오 | 결과 |
|---|---|
| A: timetable에 101~105, 301~307 존재 | 담당 학년 [1,3], 1학년=101~105, 3학년=301~307 — PASS |
| B: 101,103,105,301,304,307만 존재 | 존재하지 않는 102/104/302/303/305/306 생성 안 됨 — PASS |
| C: 3학년 공통 계획 1세트, 301/302/303 체크 다름 | 301 다음=공간활용, 302 다음=조닝, 303=계획완료 — PASS |
| D: 1학년/3학년 계획 동시 존재 | grade+year+month로 완전히 분리, 항목 안 섞임 — PASS |
| E: "2,3학년 중간고사" | 1학년 차감 0건 / 3학년 차감 1건 — **최초 실패 → 버그 발견·수정 후 PASS** |
| F: 301/302 시간표 요일이 다름 | 서로 다른 횟수로 독립 계산됨 — PASS |
| G: (구조 확인) `addProgressPlanItems` payload | className 없이 grade 기준으로만 저장됨 확인 |

### 이번 턴에 실제로 수정한 파일
`src/utils/progressComparison.js`(파싱 함수 추가/교체), `src/utils/schoolScheduleUtils.js`(타입 버그 수정), `src/pages/MonthlyProgressPage.jsx`(정렬 로직 개선 + import). **`remainingLessons.js`, `tools.js`, `toolExecutors.js`, `systemInstruction.js`, 학사일정 AI 분석, Google Calendar, 시간표, 담임시간표, 업무, 일정, 문서분석, 브리핑, App Check, 초기화, Privacy는 이번 턴에 전혀 건드리지 않았습니다.** `package.json`/`package-lock.json`/`.env`/`firestore.rules`도 이번 턴 변경 없음.

## 15. className 숫자/문자열 비교 호환성 (최종 점검)

이전 턴에서 `parseClassCode()`는 입력을 정규화했지만, 실제로 서로 다른 컬렉션의 `className`을 비교하는 곳들이 여전히 `===`(strict equality)를 직접 쓰고 있어서, 예를 들어 `timetable`에 숫자 `301`로, `progress_checks`에 문자열 `"301"`로 저장된 경우 같은 학급으로 인식되지 못하는 문제가 남아 있었습니다. 이번 턴에 이 부분만 최소 범위로 고쳤습니다.

### 추가한 공용 함수 (`src/utils/progressComparison.js`)
```js
export function normalizeClassName(value) {
  return String(value ?? "").trim();
}
export function isSameClass(a, b) {
  return normalizeClassName(a) === normalizeClassName(b);
}
```
**저장되는 값 자체는 전혀 건드리지 않습니다** — Firestore에 쓸 때는 항상 원래 받은 값 그대로 저장하고, **비교할 때만** 이 함수를 거칩니다. `parseClassCode()`도 내부적으로 `normalizeClassName()`을 재사용하도록 정리했습니다(중복 로직 제거).

### 적용한 곳
- `src/utils/remainingLessons.js` — timetable/timetable_overrides에서 온 className과 대상 학급 비교(`effectiveClassName`), lesson_adjustments 필터의 className 비교
- `src/pages/MonthlyProgressPage.jsx` — 체크 매트릭스 조회/토글(`isChecked`/`toggleCheck`), 반별 현황 집계(`progressByClass`), 학급 간 차이 메시지 조회, "남은 수업 횟수" 대상 학급 조회
- `src/ai/toolExecutors.js` — `getProgressStatus`의 학급 필터링과 체크 집계 (AI가 넘기는 `className`은 항상 문자열이므로, timetable이 숫자로 저장되어 있으면 이 부분에서 실제로 문제가 됩니다)

`getRemainingLessons`(AI tool)는 `remainingLessons.js`를 그대로 호출하므로 별도 수정 없이 자동으로 혜택을 받습니다.

### 검증 (node 순수 함수 테스트)
요청하신 4가지 타입 혼재 상황을 그대로 재현해 확인했습니다 — 전부 PASS.

| 상황 | 결과 |
|---|---|
| `timetable.className`=숫자 `301` vs 조회 시 문자열 `"301"` | 정상 인식(월요일 4회로 정확히 계산) |
| `lesson_adjustments.className`=문자열 `"301"` vs `timetable`=숫자 `301` | 보정 -1이 정상 반영, 근거에도 표시 |
| `timetable_overrides.className`=숫자 `301` vs `timetable`=문자열 `"301"` | 추가 수업이 정상 반영 |
| `progress_checks.className`=문자열 `"301"` vs `timetable`에서 온 숫자 `301` | 체크 상태 정상 인식 |

이전 턴에 통과했던 시나리오 A~F도 다시 실행해 전부 그대로 PASS함을 재확인했습니다(같은 타입끼리 비교할 때는 `isSameClass`가 일반 `===`와 동일하게 동작하므로 회귀 없음).

### 이번 턴에 수정한 파일 (이 4개뿐)
`src/utils/progressComparison.js`, `src/utils/remainingLessons.js`, `src/pages/MonthlyProgressPage.jsx`, `src/ai/toolExecutors.js`. `schoolScheduleUtils.js`, `tools.js`, `systemInstruction.js`, `academicScheduleAnalysis.js`, Google Calendar, 시간표, 담임시간표, 업무, 일정, 문서분석, 브리핑, App Check, 초기화, Privacy는 이번 턴에 전혀 건드리지 않았습니다. `package.json`/`package-lock.json`/`.env`/`firestore.rules`도 변경 없음(diff로 확인).

## 16. 학사일정 AI 분석 400 오류 수정 + 실제 PDF 구조 정확도 보완

### 400 오류의 정확한 원인과 수정
`academicScheduleAnalysis.js`의 `scheduleDayOverride` 필드가 `Schema.enumString({ enum: ["", "월", "화", "수", "목", "금"] })`로 선언되어 있었습니다. Gemini structured output은 `enum` 안의 빈 문자열을 허용하지 않아 요청 자체가 거부되고 있었습니다. `enum: ["월", "화", "수", "목", "금"]`로 빈 문자열을 제거하고, "해당 없으면 필드 자체를 생략하라"고 설명을 바꿨습니다. 파일 안의 다른 enum(`status`: confirmed/needs_review/no_impact)에는 빈 문자열이 없음을 정적 검사로 확인했습니다(테스트 A).

### 검증 중 추가로 발견해 함께 고친 실제 버그 2건
1. **`MonthlyProgressPage.jsx`의 `saveConfirmedCandidates`가 실제로 빈 문자열을 Firestore에 저장하고 있었습니다** (`scheduleDayOverride: c.scheduleDayOverride || ""`). `omitUndefined()`를 적용해 값이 없으면 필드 자체를 생략하도록 고쳤습니다(다른 수동 입력 폼과 동일한 패턴).
2. **`schoolScheduleUtils.js`의 `isPeriodRegularForDate`가 빈 배열을 "제한 없음"이 아니라 "모든 교시 제외"로 잘못 처리하고 있었습니다.** `regularPeriods`/`affectedGrades`/`affectedPeriods`가 항상 빈 배열로 저장되는 실제 저장 경로를 그대로 재현해 테스트하다가 발견했습니다 — 예를 들어 "중간고사(1,2학년)"만 저장해도 3학년의 모든 교시가 잘못 제외되는 심각한 오류였습니다. 배열의 길이가 0보다 클 때만 제한을 적용하도록 고쳤고, 수정 후 테스트 G/H가 실제 저장 형태 그대로 정상 통과함을 확인했습니다. `remainingLessons.js` 자체는 이번에도 건드리지 않았습니다 — 그 안에서 호출하는 `schoolScheduleUtils.js`의 이 함수만 고쳤습니다.

### 프롬프트 보완 (실제 PDF 구조 대응)
`academicScheduleAnalysis.js`의 프롬프트를 다음 내용으로 강화했습니다.
- 날짜·교과시수·행사 문구를 같은 셀의 맥락으로 함께 읽으라는 지시 추가
- 교과시수는 "정상/부분/휴업" 판단의 보조 근거일 뿐, 교시 위치를 추측하는 근거로 쓰지 말라고 명시
- "1,2,3,4교시 수업", "1-4교시 수업", "5,6,7 수업", "1,2,5,6교시수업" 등 다양한 표기를 정확히 해석하는 예시 추가
- "중간고사(2,3)", "중간고사(1,2학년)", "3학년 기말고사", "기말고사(1,2학년)" 등 실제 표현 예시로 noClassGrades 처리 방식 명시
- **같은 날짜에 학년별로 다른 운영이 함께 적힌 경우**(예: "기말고사(1,2학년)" + "3학년 4교시") — 하루에 하나의 해석만 반영 가능한 현재 구조로는 정확히 표현할 수 없으므로, 억지로 confirmed 후보 여러 개로 쪼개지 말고 원문을 모두 보존한 needs_review 후보 하나로 반환하도록 명시(메모: "학년별 수업 운영이 달라 확인 필요")
- "교권보호·학폭1, 동아리3"류 창체 활동 뒤 숫자는 교시가 아니라 활동 시수일 수 있으므로 추측 금지, 정규수업 교시가 별도로 명시된 경우에만 그 부분은 확정 가능하다고 구분
- "영어 듣기 평가"처럼 대상 학년/교시가 불명확한 행사는 needs_review + 지정된 문구의 memo
- 제외 문구 목록을 "스포츠(1,2학년)", "스포츠(3학년)", "자유학기A/B", "주제", "진로" 등 실제 표현으로 확장

### schema 자체는 재설계하지 않음
요청하신 대로 `school_day_schedules`/`candidateSchema`의 필드 구성(`noRegularClasses`/`noClassGrades`/`regularPeriods`/`scheduleDayOverride`/`affectedGrades`/`affectedPeriods`)은 그대로 유지했습니다. "복합 학년 운영"은 스키마를 확장해 표현하려 하지 않고, 프롬프트 지시로 needs_review 유도하는 방식을 택했습니다 — `remainingLessons.js`가 날짜당 하나의 학사일정만 조회하는 현재 구조(`schoolDaySchedules.find(s => s.date === date)`)를 그대로 두었기 때문입니다.

### 검증 (node 순수 함수, 실제 Firestore/Gemini 미사용)
테스트 A~O 전부 PASS. 테스트 P(`npm run lint`)/Q(`npm run build`)도 통과. 이전 턴의 회귀 테스트(className 타입 호환성, 학급 코드 파싱, 시나리오 A~F)도 재실행해 전부 그대로 PASS함을 재확인했습니다.

### 이번 턴에 수정한 파일 (이 3개뿐)
`src/ai/academicScheduleAnalysis.js`(schema+prompt), `src/pages/MonthlyProgressPage.jsx`(저장 payload의 omitUndefined 적용), `src/utils/schoolScheduleUtils.js`(빈 배열 처리 버그 수정). **`remainingLessons.js`, `tools.js`, `systemInstruction.js`, `progressComparison.js`, Google Calendar, 업무, 일정, 문서분석, 브리핑, App Check, 초기화, Privacy, 학급 코드 파싱/`normalizeClassName`/`isSameClass`는 이번 턴에 전혀 건드리지 않았습니다.** `package.json`/`package-lock.json`/`.env`/`firestore.rules`도 diff로 무변경 확인했습니다. 새 npm 패키지 없음. Firebase/Google Cloud Console 설정 변경 불필요.

### 진단 로그
지난 턴에 추가한 `[Academic Schedule Analysis Error]` 콘솔 로그는 요청하신 대로 그대로 유지했습니다.

## 17. 수업 진도 페이지 탭 UI 개편

### 탭 구조 구현 방식
새 route를 만들지 않고, 기존 `/progress` 페이지(`MonthlyProgressPage.jsx`) 내부에 `activeTab` React state(`"manage"` | `"remaining"` | `"schedule"`, 기본값 `"manage"`)만 추가해 조건부 렌더링으로 구현했습니다. 새 npm 패키지는 추가하지 않았습니다. 기존의 모든 상태·핸들러 함수(`loadAll`, `savePlanItems`, `toggleCheck`, `submitSchedule`, `analyzeScheduleFile`, `saveConfirmedCandidates`, `submitAdjustment` 등)는 위치만 그대로 유지한 채 JSX 렌더링 부분만 재배치했습니다 — 개수와 내용이 하나도 빠지지 않았음을 재조립 후 grep으로 확인했습니다.

### 탭별로 이동한 기능
- **진도 관리**(기본 탭): 월별 학년 공통 진도계획 입력, 반별 진도 체크 매트릭스, 반별 진도 현황·학급 간 차이
- **남은 수업**: 실제 남은 수업 횟수 계산 결과·계산 근거 보기, 수업 횟수 수동 보정(lesson_adjustments) CRUD
- **학사일정**: 확인 필요 목록 → 연간 학사일정 AI 분석(파일 업로드·후보 검토) → 직접 입력 → 확정된 학사일정, 순서로 배치(기획서 권장 순서 그대로)

### 학년/연도/월 공통 상태 유지 방식
`grade`/`year`/`month` state는 원래부터 탭과 무관하게 컴포넌트 최상위에 있었고, 탭 전환은 `activeTab`만 바꾸는 것이라 이 값들이 초기화되지 않습니다. 학사일정은 탭 3에서 학년 필터 없이 그대로 전체 공통 데이터로 관리합니다(기존 원칙 그대로).

### 탭 전환 스크롤 처리
탭 콘텐츠를 감싸는 `<div ref={tabContentRef}>`에 대해, 탭 버튼 클릭 시 `tabContentRef.current.scrollIntoView({ behavior: "smooth", block: "start" })`를 호출합니다. 브라우저 전체를 최상단으로 보내지 않고 탭 영역 시작 위치로만 부드럽게 스크롤합니다.

### 학사일정 탭 배지
탭 버튼 안에 `{allNeedsReview.length > 0 && <span className="progress-tabs__badge">{allNeedsReview.length}</span>}`로 구현했습니다. 0건이면 배지 자체가 렌더링되지 않습니다. 기존에 이미 계산되어 있던 `allNeedsReview`(useMemo)를 그대로 재사용했습니다.

### 직접 입력 기본 status 변경
`emptyScheduleForm.status`를 `"needs_review"` → `"confirmed"`로 변경했습니다. AI 분석 결과의 기본값(needs_review, `academicScheduleAnalysis.js`는 무변경)과는 분리되어 있습니다.

### 확인 필요 인라인 편집 / 빠른 확정 / 제외
`renderScheduleCard(s)` 헬퍼 함수 하나로 통일했습니다. `editingScheduleId === s.id`이면 그 자리에 `renderScheduleForm()`(기존 폼과 완전히 동일한 필드·기존 `submitSchedule` 재사용)을 인라인으로 보여주고, 아니면 배지+원문+메모와 함께 버튼을 보여줍니다. `status === "needs_review"`인 카드에는 [확정]/[제외] 버튼이 추가로 나타납니다.
- **확정**: `quickConfirmSchedule(s)` — 신규 함수, 기존 문서의 다른 필드는 그대로 두고 `status: "confirmed"`만 업데이트합니다.
- **제외**: `quickExcludeSchedule(s)` — 신규 함수, 기존에 있던 `no_impact` 상태를 그대로 재사용합니다(새 상태를 만들지 않음).
둘 다 내부적으로 기존 `updateDocById` 패턴을 그대로 사용하고, 계산 로직에는 전혀 관여하지 않습니다.

### 확정된 일정 수정 UX
확정된 학사일정 목록도 같은 `renderScheduleCard`를 재사용하므로, [수정]을 누르면 상단으로 스크롤하지 않고 그 카드 자리에서 바로 인라인 편집됩니다(확인 필요 카드와 동일한 방식으로 통일 — 기획서가 허용한 "폼 유지+스크롤" 대안보다 더 일관된 인라인 방식을 선택했습니다).

### 기존 계산 로직 변경 여부
**전혀 변경하지 않았습니다.** `remainingLessons.js`, `schoolScheduleUtils.js`, `progressComparison.js`, `academicScheduleAnalysis.js`(모델/schema/prompt), `normalizeClassName`/`isSameClass`, `progress_plans`/`progress_checks`/`school_day_schedules`/`lesson_adjustments`의 Firestore 구조는 diff로 무변경을 확인했습니다. `saveConfirmedCandidates`/`submitSchedule`/`submitAdjustment` 등 저장 함수의 내부 로직도 그대로입니다.

### Firestore schema / package.json / .env / Rules / Console
전부 변경 없음 (diff로 확인). 새 npm 패키지 없음.

### 검증
`npm run build`/`npm run lint` 통과(0 error, 기존 warning 2건만 유지). 재조립 후 기존 함수 26개(로드/폼/저장/체크/보정 관련 전부)가 정확히 1회씩만 정의되어 있는지 grep으로 확인해 로직 유실이 없음을 검증했습니다. `git diff` 성격의 전체 파일 비교로 이번 턴에 변경된 파일이 `MonthlyProgressPage.jsx`/`MonthlyProgressPage.css` 두 개뿐임을 확인했습니다.

### 사용자가 브라우저에서 직접 확인하실 항목
탭 전환 시 실제 화면 전환감(부드러운 스크롤 여부), 인라인 편집 폼의 실제 입력 동작, 확정/제외 버튼 클릭 시 목록이 즉시 갱신되는지, 작은 화면(모바일 폭)에서 탭이 가로 스크롤로 자연스럽게 처리되고 페이지 전체가 가로로 밀리지 않는지는 코드 검증만으로는 완전히 보장할 수 없어 실제 브라우저에서 확인해 주셔야 합니다.

## 18. 자동 스크롤 UX 버그 수정 2건

### 원인 1: 탭 전환 시 화면이 끌려가는 문제
지난 턴에 탭 UX 개선을 위해 추가했던 `switchTab()` 함수가 `tabContentRef.current.scrollIntoView({behavior:"smooth", block:"start"})`를 호출하고 있었습니다 — 이게 명시적 원인이었습니다. `switchTab` 함수와 `tabContentRef`(및 그 ref를 달던 `<div ref={tabContentRef}>`), 더 이상 쓰이지 않게 된 `useRef` import를 전부 제거하고, 탭 버튼 `onClick`이 `setActiveTab("manage")`처럼 상태만 바꾸도록 되돌렸습니다. `requestAnimationFrame`/`setTimeout` 등 다른 스크롤 관련 코드는 애초에 없었습니다.

### 원인 2: 진도 체크 시 화면이 위로 튀는 문제
`toggleCheck()`가 Firestore 저장 후 **전체 데이터를 다시 불러오는 `loadAll()`을 호출**하고 있었는데, `loadAll()`은 시작할 때 `setLoading(true)`를 호출합니다. 페이지의 탭 콘텐츠 전체가 `{!loading && !error && (<div>...)}`로 조건부 렌더링되고 있어서, 체크박스 하나를 누를 때마다:
1. `loading = true`가 되어 탭 콘텐츠 전체(진도계획/체크표/현황/남은수업/학사일정을 담은 큰 DOM)가 통째로 언마운트되고 "불러오는 중…" 한 줄만 남습니다.
2. 페이지 높이가 순간적으로 크게 줄어들면서 브라우저가 스크롤 위치를 그 짧아진 높이에 맞춰 위로 당겨버립니다.
3. `loadAll()`이 끝나 `loading = false`가 되며 콘텐츠가 다시 마운트되지만, 스크롤 위치는 이미 위로 당겨진 채로 남습니다.

여러 반을 연속으로 체크할 때마다 이 과정이 매번 반복되어 계속 위로 튀는 것이었습니다. 스크롤 위치를 저장했다가 복원하는 방식이 아니라, **원인 자체(체크 하나로 전체를 다시 불러오는 구조)를 제거**했습니다: `toggleCheck()`가 `loadAll()` 대신 새로 만든 `reloadChecks()`를 호출하도록 바꿨습니다. `reloadChecks()`는 `progress_checks`만 다시 조회해서 `allChecks` state만 갱신하고, **`loading`을 전혀 건드리지 않습니다** — 그래서 탭 콘텐츠가 한 번도 언마운트되지 않고, 화면 위치도 그대로 유지됩니다.

### 수정한 파일 (2개)
`src/pages/MonthlyProgressPage.jsx`(스크롤 원인 코드 제거, `reloadChecks()` 추가), `src/pages/MonthlyProgressPage.css`(더 이상 의미 없어진 `scroll-margin-top` 규칙 제거).

### 진도 체크 저장 로직 / 계산 로직 변경 여부
**저장 로직 자체(Firestore에 쓰는 내용, 필드, `createDoc`/`updateDocById` 호출)는 전혀 바꾸지 않았습니다** — 화면을 다시 그리는 방식만 바꿨습니다. `remainingLessons.js`, `schoolScheduleUtils.js`, `progressComparison.js`, `academicScheduleAnalysis.js`, `progress_plans`/`progress_checks`/`school_day_schedules`/`lesson_adjustments`의 Firestore 구조는 diff로 무변경을 확인했습니다.

### package.json / .env / firestore.rules
전부 변경 없음. 새 패키지 설치 없음.

### 참고로 알려드릴 점 (이번엔 손대지 않음)
`savePlanItems`/`submitSchedule`/`removeSchedule`/`saveConfirmedCandidates`/`quickConfirmSchedule`/`quickExcludeSchedule`/`submitAdjustment`/`removeAdjustment`도 여전히 각자 작업 후 `loadAll()`을 호출하고 있어, 원리상 같은 방식의 화면 흔들림이 생길 수 있습니다. 다만 이번에 신고해 주신 문제는 "체크박스를 연속으로 여러 번 누를 때"처럼 반복적으로 발생하는 경우였고, 이 액션들은 한 번의 명시적 제출 동작이라 체감되는 정도가 다를 수 있어 이번 범위(요청하신 두 가지 스크롤 문제)에는 포함하지 않았습니다. 혹시 이 액션들에서도 비슷한 화면 흔들림이 느껴지시면 말씀해 주시면 같은 방식(`reloadChecks`처럼 필요한 컬렉션만 다시 불러오는 전용 함수)으로 정리하겠습니다.

### 테스트 결과
`npm run build`/`npm run lint` 통과(0 error, 기존 warning 2건만 유지). 코드 리딩으로 원인 경로를 확인했으며, 실제 브라우저에서 체크박스를 연속으로 클릭했을 때 화면이 고정되는지, 탭 전환이 즉시(스크롤 없이) 전환되는지는 실제 사용 환경에서 확인해 주셔야 합니다.

## 19. 학사일정 "수정 저장" 등 나머지 저장 동작의 스크롤 점프 수정

지난 항목(18)에서 "다른 저장 액션들도 같은 방식(`loadAll()`)을 쓰고 있어 비슷한 문제가 생길 수 있다"고 미리 알려드렸던 부분이 실제로 "학사일정 수정 저장"에서 재현되어, 같은 원리로 파일 전체에 일관되게 적용했습니다.

### 원인
`submitSchedule`(학사일정 등록/수정)을 포함해 `savePlanItems`/`removeSchedule`/`saveConfirmedCandidates`/`submitAdjustment`/`removeAdjustment`/`quickConfirmSchedule`/`quickExcludeSchedule` 전부 저장 후 전체 재로드용 `loadAll()`을 호출하고 있었습니다. `loadAll()`은 `setLoading(true)`로 탭 콘텐츠 전체를 순간적으로 언마운트시켜, 페이지 높이가 줄었다 늘어나며 스크롤이 위로 튀는 동일한 문제를 일으킵니다.

### 수정 방식
`reloadChecks()`와 같은 패턴으로 컬렉션별 전용 재조회 함수 3개를 추가했습니다 — 전부 해당 컬렉션만 다시 조회해서 그 state만 갱신하고, `loading`은 건드리지 않습니다.
- `reloadPlanItems()` — `progress_plans`만 재조회 (`savePlanItems`에서 사용)
- `reloadSchedules()` — `school_day_schedules`만 재조회 (`submitSchedule`/`removeSchedule`/`saveConfirmedCandidates`/`quickConfirmSchedule`/`quickExcludeSchedule`에서 사용)
- `reloadAdjustments()` — `lesson_adjustments`만 재조회 (`submitAdjustment`/`removeAdjustment`에서 사용)

페이지 최초 진입 시의 `useEffect(() => { loadAll(); }, [user])`(전체를 처음 불러오는 경우)만 원래대로 `loadAll()`을 그대로 사용합니다 — 이때는 화면에 아무 콘텐츠도 없는 최초 로딩이라 언마운트 문제가 발생하지 않습니다.

### 저장 로직 / 계산 로직 변경 여부
**변경 없음.** Firestore에 쓰는 내용, 필드, 저장 순서는 전혀 바꾸지 않았습니다 — 저장 후 화면을 갱신하는 방식만 바꿨습니다.

### 검증
`npm run build`/`npm run lint` 통과(0 error, 기존 warning 2건만 유지). 8개 `loadAll()` 호출 중 초기 로딩 1개만 남고 나머지 8개가 각각 알맞은 전용 함수로 교체됐는지 grep으로 확인했습니다.

## 20. 수업 진도 통합: AI와 화면이 같은 데이터를 쓰는 세부 진도 기능

### 20-1. Source of Truth 통일
`progress_plans`(학년별 공통 계획) + `progress_checks`(학급별 완료 체크)를 진도의 유일한 기준으로 삼았습니다. 구 Phase 2의 `updateClassProgress`/`searchClassProgress`는 **Gemini에게 노출되는 `functionDeclarations` 배열에서만 제거**했습니다 — 선언·실행기 코드, `class_progress` Firestore 컬렉션, `ProgressPage.jsx`, 관련 `resetData`/Rules 항목은 전부 그대로 남겨뒀습니다(과거 호환용, 요청하신 대로 무리하게 삭제하지 않았습니다). 이제 진도 대화에서 Gemini가 옛 도구를 선택할 수 없습니다.

### 20-2. 신규 Firestore 컬렉션
- **`progress_current`**: `{ ownerId, className, grade, planItemId, planItemTitle, detail, updatedAt, lastClassDate, createdAt }` — 학급당 문서 하나만 유지(있으면 update, 없으면 create). 완료로 체크되는 순간 자동으로 삭제됩니다(진행 중과 완료가 동시에 존재하지 않도록).
- **`progress_history`**: `{ ownerId, className, grade, date, planItemId, planItemTitle, detail, completedPlanItemIds[], source: "ai"|"manual", createdAt }` — 의미 있는 변경에만 생성되고, 직전 기록과 완전히 같으면(`historyEntriesEqual`) 새로 만들지 않습니다.

### 20-3. 핵심 계산 로직 (신규 `src/utils/progressStatusUpdate.js`, AI/화면 공용)
- `computeCompletedIdsThrough(planItems, targetId)` — "~까지 끝났어": 계획 순서상 그 항목까지(포함) 완료 id 목록
- `computeCompletedIdsBefore(planItems, targetId)` — "~의 일부까지 했어": 그 이전 항목까지만 완료 id 목록(대상 항목 자체는 미완료로 남김)
- `findPlanItemByTitle` — 정확 일치 → 정규화 후 단일 일치까지만 허용, 그 이상은 fuzzy matching 없이 `candidates` 반환
- `historyEntriesEqual` — history 중복 방지 비교

이 네 함수를 node로 직접 실행해 시나리오 A~D(완료/부분진도/전환/되돌리기)와 모호한 제목 처리까지 검증했습니다(전부 PASS). **AI 실행기(`toolExecutors.js`의 `updateProgressStatus`)와 화면(`MonthlyProgressPage.jsx`의 "진행 중 설정" 폼)이 이 함수들을 그대로 재사용**하므로, 같은 입력에는 항상 같은 결과가 나옵니다 — "AI에게 말한 진도 = 화면에 보이는 진도"가 구조적으로 보장됩니다.

### 20-4. 신규 AI 도구 2개
- **`updateProgressStatus`**: `className`(timetable에 실제 있는 학급만 허용, `isSameClass`/`gradeOfClassName` 재사용), `completedThroughTitle` 또는 `currentPlanItemTitle`+`detail` 중 하나. Gemini는 Firestore id를 만들지 않고 제목만 전달하며, 실행기가 `progress_plans`에서 실제 항목을 찾습니다. 제목이 모호하면 `success:false`+`candidates`를 반환하고 Gemini는 사용자에게 되묻습니다.
- **`getProgressHistory`**: `className`+선택적 `dateFrom`/`dateTo`/`limit`.
- 기존 `getProgressStatus`도 `progress_current`를 함께 읽어 `completedThrough`(완료 위치)와 `inProgress`(진행 중 항목+detail)를 구분해 반환하도록 확장했습니다.

### 20-5. systemInstruction 보완 (진도 규칙 + "단원" 표현 금지)
새 진도 시스템 사용 원칙(완료/부분 구분, id 추측 금지, 학급 추측 금지, 애매하면 질문, detail 수치화 금지, 남은 수업 횟수와 진도 위치 혼동 금지)을 추가했고, 말씀해 주신 대로 **"단원" 표현을 임의로 붙이지 않는 규칙**과 좋은/나쁜 예시를 그대로 추가했습니다. 기존에 "4차시까지로 업데이트했어요"처럼 오해 소지가 있던 예시 문구도 "'지방'까지로 업데이트했어요"로 고쳤습니다.

### 20-6. 화면 UI
- 체크 매트릭스: 완료(`✓`)와 별개로 진행 중 항목에 `◐` 표시(마우스 오버 시 세부 진도 툴팁)
- "반별 진도 현황"의 각 학급에 **"진행 중 설정"** 인라인 폼(진행 중 항목 select + 세부 진도 입력 + 저장/취소) 추가 — AI와 동일한 `computeCompletedIdsBefore` 로직 재사용
- 완료 체크와 진행 중 상태가 모순되지 않도록, 진행 중이던 항목을 완료로 체크하면 `progress_current`를 자동 삭제
- **"최근 기록"** 접힌 버튼 — 누를 때만 `progress_history`를 조회해서 최근 10건 표시(기본 상태에서는 로드하지 않음)
- 저장 후 `loadAll()`을 다시 호출하지 않고, `progress_current` 전용 재조회(`reloadCurrents`)만 수행 — 이전 턴에 고친 스크롤 위치 유지 UX를 그대로 보존했습니다.

### 20-7. 검증 결과
- node로 실행한 순수 함수 테스트: **전부 PASS** (완료-까지/부분진도/전환/되돌리기/모호한 제목)
- 이전 턴들의 회귀 테스트 4벌(remainingLessons 8종, 학급 코드 파싱, className 타입 혼용 4종, 학사일정 스키마/프롬프트 13종)을 **모두 재실행해 전부 그대로 PASS**함을 확인했습니다.
- `npm run build`/`npm run lint`: 통과(0 error, 기존 warning 2건만 유지)

### 20-8. 정직하게 밝혀드릴 한계
- **`updateProgressStatus`/`getProgressHistory` 실행기 자체(Firestore 비동기 호출 포함)는 end-to-end로 실행해보지 못했습니다.** 코드를 재검토해 로직이 검증된 순수 함수들과 정확히 같은 규칙을 따르는지는 확인했지만, 실제 Firestore/Gemini 환경에서의 동작은 사용자께서 직접 확인해 주셔야 합니다(요청하신 대로 실제 운영 데이터에 임의로 테스트 데이터를 쓰지 않았습니다).
- UI의 "진행 중 설정" 저장 시 history 중복 방지는, 그 학급의 "최근 기록"을 화면에서 한 번이라도 연 적이 있을 때만 정확히 비교됩니다(열지 않았다면 캐시가 없어 항상 새 기록을 씁니다) — AI 경로(`updateProgressStatus`)는 매번 Firestore에서 직접 최신 기록을 읽어 비교하므로 이 제약이 없습니다. 완벽한 중복 방지가 필요하시면 UI 저장 시에도 항상 새로 조회하도록 바꿀 수 있습니다(다만 저장마다 조회가 하나 더 늘어납니다).
- 매트릭스 셀 자체를 클릭해 바로 그 자리에서 진행 중 편집 팝오버를 여는 방식(기획서의 권장 UX) 대신, **"반별 진도 현황"의 학급별 인라인 폼**으로 구현했습니다 — 셀 단위 팝오버보다 구현이 단순하고 회귀 위험이 적다고 판단했습니다. 필요하시면 셀 클릭형으로 바꿀 수 있습니다.

## 21. 학급 코드(내부값) ↔ 표시용 학급명 완전 분리

### "101반/301반"이 나오던 정확한 원인
`101`, `301` 같은 3자리 숫자는 원래 timetable의 **내부 저장 코드**(첫 자리=학년, 나머지=반 번호)일 뿐인데, 여러 화면과 AI 응답에서 이 값을 그대로 꺼내 뒤에 "반"만 붙이거나(`{className}반`), 아예 raw 값을 그대로 보여주고 있었습니다. 즉 "저장/비교용 값"과 "사람이 읽는 학급명"이 분리되어 있지 않았던 게 근본 원인입니다.

### 신규 formatter (`src/utils/progressComparison.js`, 기존 함수는 전혀 수정하지 않음)
- **`formatClassName(className)`** — 전체 학급명("1학년 1반"). 101/103/301/307 같은 숫자 코드, "1-1"/"3-7반" 같은 하이픈 표기, 이미 "1학년 1반"인 입력까지 전부 안전하게 통일합니다. 해석할 수 없는 값은 추측하지 않고 원본을 그대로 돌려줍니다.
- **`formatClassShortName(className)`** — 짧은 학급명("1반"). 학년이 이미 화면에서 명확한 좁은 표에서만 사용합니다.
- **`resolveClassInput(rawInput, ownedClassNames)`** — 사용자의 자연어 표현("101", "101반", "1-1", "1-1반", "1학년 1반")을 실제 담당 학급(timetable에 있는 값) 중 하나로 결정론적으로 좁힙니다. "1반"처럼 학년이 빠져 여러 학년에 걸치면 후보 목록을 돌려주고(임의 선택 안 함), 담당하지 않는 학급이면 실패를 돌려줍니다(생성 안 함).

`parseClassCode`/`normalizeClassName`/`isSameClass`/`gradeOfClassName`은 이번에도 **한 줄도 바꾸지 않았습니다** — 새 함수들은 전부 이 기존 함수 위에 얹은 별개의 표시/resolve 계층입니다.

**검증 중 발견해 함께 고친 것**: `compareClassesInGrade()`의 비교 메시지가 `"${c.className}반이 ${fastest.className}반보다..."`처럼 내부 코드에 그대로 "반"을 붙이고 있었습니다(계산 값 자체는 그대로, 문구만 `formatClassName`으로 교체).

### 표시 위치별 적용 formatter
| 위치 | formatter | 이유 |
|---|---|---|
| 진도 매트릭스 행 머리글 | `formatClassShortName` | 학년 선택이 상단에 이미 명확한 좁은 표 |
| 반별 진도 현황 카드 제목 | `formatClassName` | 독립 카드 |
| 남은 수업 학급 선택 드롭다운 / 결과 카드 | `formatClassName` | 독립적 표시(기획서 예시와 동일) |
| 내 수업 시간표 그리드 셀 | `formatClassName` | 한 시간표 안에 여러 학년이 섞일 수 있어(진도 매트릭스와 달리 "학년 고정" 전제가 없음) 짧은 표현은 모호할 수 있음 |
| 시간표 "일시적 변경" 목록 | `formatClassName` | 독립 문장 |
| 홈 브리핑("오늘 수업"/"오늘 시간표 변경") | `formatClassName` | 독립 문장 |
| **저장/조회/비교(`toggleCheck`, `progress_checks` 조회, `isSameClass` 등)** | **변경 없음(raw className)** | 내부 로직은 절대 formatter를 거치지 않음 |

담임 학급 시간표(`homeroom_timetable`)는 요청하신 대로 전혀 건드리지 않았습니다.

### AI tool result의 displayClassName
`updateProgressStatus`, `clearProgressCurrent`, `getProgressStatus`, `getProgressHistory`, `getRemainingLessons` 5개 도구 모두 응답에 `className`(내부값, 필요시 재사용용)과 `displayClassName`(예: "3학년 1반")을 함께 반환하도록 고쳤습니다. 또한 이 5개 도구는 전부 새 `resolveOwnedClass()` 공용 헬퍼(`toolExecutors.js`)를 거치도록 바꿔서, 사용자가 "101"/"101반"/"1-1"/"1-1반"/"1학년 1반" 중 무엇으로 말하든 실제 담당 학급으로 정확히 resolve됩니다. `addLessonAdjustment`(기존 시수 보정 도구)는 이번 요청 범위 밖이라 손대지 않았습니다.

### systemInstruction 보완
- 101/301 같은 3자리 코드가 내부 코드일 뿐이라는 것과, 응답에는 항상 `displayClassName`을 쓰라는 규칙 추가
- className 파라미터에는 사용자가 말한 표현을 그대로 전달하고 임의 변환하지 말라는 안내 추가(각 tool 선언의 description에도 동일하게 반영)
- "1반"처럼 학년이 빠진 표현이 모호하면 후보 중 임의로 고르지 말고 되묻으라는 규칙 추가
- 기존 "단원 금지" 규칙 예시에 남아 있던 "301반"/"302반"과, 답변 스타일 예시의 "3-2반"도 전부 "N학년 M반" 형식으로 정리해 규칙과 예시가 서로 모순되지 않도록 했습니다

### Firestore schema / Rules / migration
**변경 없음.** `className` 저장값 자체(101/301 등, 숫자든 문자열이든)는 어디에서도 바꾸지 않았고, `progress_checks`/`progress_current`/`progress_history`/`timetable`/`timetable_overrides`/`lesson_adjustments` 스키마도 그대로입니다. `firestore.rules`는 diff상 차이가 있지만 이는 **이전 턴(6.3)에서 이미 추가된 `progress_current`/`progress_history` 규칙**이며, 이번 턴에는 규칙을 전혀 건드리지 않았습니다.

### 계산 로직 보호
`remainingLessons.js`, `schoolScheduleUtils.js`, `academicScheduleAnalysis.js`는 diff로 무변경 확인했습니다. `progressComparison.js`의 기존 계산 함수(`analyzeClassProgress`, `computeLessonBalance`, `compareClassesInGrade`의 fastest/slowest/gap 값)도 숫자 결과는 전혀 바뀌지 않았습니다(메시지 문구만 수정).

### 검증 (node 순수 함수, 실제 Firestore/Gemini 미사용)
- 신규 테스트 A~V(포맷터 12종 + resolve 8종 + 모호성/미담당학급 처리): **전부 PASS**
- 기존 회귀 테스트 6벌 전체 재실행: **remainingLessons 8종, 학급 코드 파싱 11종, className 타입 혼용 4종, 학사일정 스키마/프롬프트 13종, 진도 업데이트 순수 함수 6종 — 전부 그대로 PASS**
- `npm run build`/`npm run lint`: 통과(0 error, 기존 warning 2건만 유지)

### 정직하게 밝혀드릴 한계
- `updateProgressStatus`/`clearProgressCurrent`/`getProgressStatus`/`getProgressHistory`/`getRemainingLessons`의 **resolve 로직(`resolveOwnedClass`)이 실제 Gemini 대화로 end-to-end 테스트되지 않았습니다** — 순수 함수(`resolveClassInput`)와 코드 재검토로만 검증했습니다. "1반"처럼 모호한 입력에 대해 실제로 Gemini가 후보를 사용자에게 잘 되묻는지는 실사용으로 확인 부탁드립니다.
- 시간표 그리드 셀은 공간이 좁아 "1학년 1반" 전체 표기가 다소 길 수 있습니다(줄바꿈 가능). 진도 매트릭스와 달리 한 시간표 안에 여러 학년이 섞일 수 있어 짧은 표기("1반")를 쓰면 모호해질 수 있다고 판단해 전체 표기를 선택했습니다 — 실제로 보시고 너무 길면 별도의 "1-1"류 축약 포맷을 추가해드릴 수 있습니다.
- 항목 14(전체 검색)는 진도/시간표/브리핑 화면을 grep으로 점검했고, `EventsPage`/`SettingsPage`에는애초에 `className` 필드가 없어 해당 사항이 없었습니다. 문서 분석(`DocumentsPage.jsx`)의 `className`은 사용자가 직접 입력/수정하는 `<input>` 값이라 표시 formatter를 적용하지 않았습니다(수정 대상이므로 raw 값이 맞습니다).

## 22. 진도 이력(Progress History) 기능 확장 — 실제 수업 이력 관리

### 1. 기존 history 구조 분석 결과
`progress_history`는 이미 `{ ownerId, className, grade, date, planItemId, planItemTitle, detail, completedPlanItemIds[], source, createdAt }` 구조였습니다. **분석해보니 `date` 필드가 이미 "실제 수업일"을 의미하고 있었고, `createdAt`은 이미 항상 "기록이 실제로 생성된 시각"이었습니다** — `execUpdateProgressStatus`가 이전부터 `date: lastClassDate`(사용자가 `lastClassDate`를 지정하지 않으면 오늘)와 `createdAt: now`를 분리해서 써왔습니다. 즉 **요청하신 "실제 수업일과 기록 생성 시각 분리"는 스키마 차원에서 이미 구현되어 있었습니다.**

### 2. 새로 추가/변경한 필드
Firestore 스키마 자체에는 **새 필드를 추가하지 않았습니다.** 기존 `date` 필드가 이미 "실제 수업일" 역할을 하고 있어서, `lessonDate`라는 새 필드를 만들면 오히려 같은 의미의 필드가 두 개 생겨 혼란과 마이그레이션 부담만 커진다고 판단했습니다. 대신 **AI 응답과 화면 표시에서만** 이 필드를 `lessonDate`라는 명확한 이름으로 노출하도록 했습니다(내부 저장은 `date`, 외부 표현은 `lessonDate` — 매핑만 함수 안에서 처리).

### 3. 실제 수업일과 기록 생성 시각 분리 (재확인 + 안내 보강)
로직 자체는 기존 그대로 유지했고, 이번에는 **systemInstruction에 이 구분을 명확히 설명하는 규칙**을 추가했습니다: 사용자가 "어제", "9월 7일"처럼 말하면 대화 시작에 주어지는 오늘 날짜를 기준으로 Gemini가 직접 실제 날짜를 계산해 `lastClassDate`에 채우고, 기록 생성 시각(`createdAt`)은 신경 쓸 필요가 없다고 명시했습니다. node로 A~D 시나리오(날짜 미지정/어제/특정 날짜/두 값의 독립성)를 검증했습니다.

### 4. 기존 history 데이터와의 호환성
스키마를 바꾸지 않았으므로 **마이그레이션이 필요 없습니다.** 기존에 저장된 모든 기록이 그대로 유효합니다.

### 5. 최근 기록 UI 변경 내용
- 날짜 표시를 `2026-09-09` 형태의 원본 대신 사람이 읽기 쉬운 `9월 9일`로 바꿨습니다(신규 `formatDateDisplay()`, `src/utils/date.js`). 연도가 올해와 다른 기록만 `2025년 9월 7일`처럼 연도를 함께 표시합니다.
- 각 기록 줄에 `[수정]`/`[삭제]` 버튼을 추가했습니다(디자인은 기존 `list__meta` 줄 안에 자연스럽게 배치, 새 컴포넌트 없이 기존 스타일 재사용).

### 6. 수정 기능 구현 위치와 동작
`src/pages/MonthlyProgressPage.jsx`의 `startEditHistory`/`saveHistoryEdit`. `[수정]`을 누르면 그 줄이 바로 그 자리에서 "수업일" 날짜 입력 + "진도명" 텍스트 입력 폼으로 바뀝니다(인라인, 스크롤 없음). 저장하면 `progress_history` 문서의 `date`/`planItemTitle`만 업데이트하고, **`completedPlanItemIds`(그 시점의 완료 스냅샷)와 현재 진도(`progress_current`/`progress_checks`)는 전혀 건드리지 않습니다.**

### 7. 삭제 기능 구현 위치와 동작
같은 파일의 `deleteHistoryEntry` + `confirmDeleteHistoryId` state. `[삭제]`를 누르면 즉시 지워지지 않고 그 줄이 "'9월 9일 · 탄수화물' 기록을 정말 삭제할까요? [삭제] [취소]"로 바뀝니다 — 확인을 눌러야 실제로 삭제됩니다. 삭제도 `progress_history` 문서 하나만 지우고 현재 진도는 손대지 않습니다.

### 8. `getProgressHistory` 변경 내용
- `className`을 **선택 사항으로** 바꿨습니다 — 생략하면 전체 담당 학급을 대상으로 조회합니다("탄수화물 끝낸 반 알려줘"처럼 반을 가로지르는 질문에 대응).
- `planItemTitle` 필터(부분 일치)를 추가했습니다.
- 결과 각 항목에 `id`(수정/삭제용), `className`, `displayClassName`, `lessonDate`를 포함하도록 확장했습니다.
- 기존 `dateFrom`/`dateTo`/`limit` 파라미터는 그대로 유지해 기존 호출과 호환됩니다.

### 9. 새 AI tool 목록과 역할
| Tool | 역할 |
|---|---|
| `updateProgressHistory` | 과거 기록 하나의 `lessonDate`/`planItemTitle` 수정. `historyId`로 정확히 지정. 현재 진도는 전혀 건드리지 않음 |
| `deleteProgressHistory` | 과거 기록 하나 삭제. `historyId`로 정확히 지정. 현재 진도는 전혀 건드리지 않음 |

두 도구 모두 대상을 하나로 특정할 수 없으면(모호한 제목 등) 실패를 돌려주고, Gemini는 systemInstruction 규칙에 따라 먼저 `getProgressHistory`로 후보를 찾아 사용자에게 확인하도록 했습니다.

### 10. systemInstruction에 추가한 판단 규칙
"현재 진도"와 "과거 이력"을 문장의 시제·의도로 구분하는 규칙을 추가했습니다(키워드 하나가 아니라 예시 6개로 구체적으로 안내: 조회/갱신/이력조회/이력수정/이력삭제). "탄수화물 한 날짜를 9월 8일로 수정해줘" 같은 요청에는 `updateProgressStatus`가 아니라 `updateProgressHistory`를 쓰도록 명시했습니다.

### 11. Current Progress와 History 분리 안전장치
요청하신 7개 규칙 중 코드 변경이 필요했던 부분은 이미 구조적으로 분리되어 있었습니다 — `updateProgressHistory`/`deleteProgressHistory` 실행기는 `progress_history` 컬렉션만 다루고 `progress_current`/`progress_checks`를 참조하거나 쓰는 코드가 전혀 없습니다(코드 재검토로 확인). `clearProgressCurrent`가 `progress_checks`를 바꾸지 않는다는 기존 동작도 이번에 손대지 않아 그대로입니다.

### 12. 날짜 자연어 처리 방식
`lastClassDate`(`updateProgressStatus`)와 `lessonDate`(`updateProgressHistory`) 모두, 실제 날짜 계산은 **Gemini가 대화 시작에 주어지는 "오늘 날짜" 컨텍스트를 기준으로 직접 계산**해서 YYYY-MM-DD로 채우는 방식입니다(기존 `addEvent`의 날짜 처리와 동일한 기존 패턴 재사용, 새 날짜 파싱 코드를 추가하지 않았습니다). systemInstruction에 "어제"→"오늘-1일" 예시를 명시해 이 계산을 안내했습니다.

### 13. 학급 resolve 기존 로직 유지 여부
**완전히 그대로 재사용했습니다.** `getProgressHistory`(className 선택적으로 바뀌었지만 있을 때는 기존과 동일하게 `resolveOwnedClass` 사용), `updateProgressHistory`/`deleteProgressHistory`는애초에 className이 아니라 `historyId`로 특정하므로 학급 resolve 자체가 필요 없습니다. `resolveClassInput`/`resolveOwnedClass`/`formatClassName`/`formatClassShortName`은 한 줄도 수정하지 않았습니다.

### 14. displayClassName 처리 여부
`getProgressHistory`(항목별), `updateProgressHistory`, `deleteProgressHistory` 전부 `className` + `displayClassName`을 함께 반환합니다.

### 15. 수정한 파일 전체 목록
`src/utils/date.js`(`formatDateDisplay` 추가), `src/utils/progressAnalysis.js`(레거시 진도비교 메시지의 "101반" 표시 버그 수정 — 아래 설명), `src/ai/toolExecutors.js`, `src/ai/tools.js`, `src/ai/systemInstruction.js`, `src/pages/MonthlyProgressPage.jsx`.

**검증 중 추가로 발견해 함께 고친 것**: 프로젝트 전체를 다시 grep하다가 `src/utils/progressAnalysis.js`(구 Phase 2 `class_progress` 시스템, `Home.jsx` 브리핑에서 여전히 쓰이고 있음)의 학급 비교 메시지가 여전히 `"101반이 301반보다..."` 식으로 raw 코드에 "반"을 붙이고 있는 걸 발견했습니다. 이 파일의 진도 계산 로직(`gradeOf`, `stepIndex`, `buildPlanSequenceByGrade` 등)은 **전혀 건드리지 않고**, 메시지 문구 한 줄만 기존 `formatClassName`을 재사용하도록 고쳤습니다 — 계산값은 완전히 동일합니다.

### 16. Firestore schema/rules 변경 여부
**둘 다 변경 없음.** 새 필드도, 새 컬렉션도, rules 변경도 없습니다.

### 17~18. 기존/신규 테스트 결과
기존 회귀 테스트 6벌(remainingLessons 8종, 학급코드파싱 11종, 타입혼용 4종, 학사일정 13종, 표시formatter+resolve 22종, 진도업데이트 6종) **전부 재실행해 회귀 없이 PASS**. 신규 테스트도 전부 PASS했습니다: 날짜 분리 A~D, 표시 Y, 조회 E~I, 수정 J~K, 수정후불변 L, 삭제 M~N, 삭제후불변 N, 모호성 O. 학급 코드 P~V는 기존 22종 테스트에 이미 포함되어 있어 별도 재실행으로 확인했습니다.

### 19~20. lint / build
`npm run lint`: **0 error**, warning 2건(기존부터 있던 것). `npm run build`: 성공.

### 21. 이번 작업에서 수정하지 않은 핵심 기능
시간표, 시간표 변경, 반별 진도 현황(조회 로직), 진도 매트릭스, 남은 수업 계산(`remainingLessons.js`), 학사일정 분석(`academicScheduleAnalysis.js`), `progress_checks`/`progress_current` 저장 로직, 브리핑 계산 로직(문구만 수정), 학급 코드 resolve 로직, Firestore rules, 로그인/App Check, 기존 Gemini tool calling 구조 — 전부 diff와 재실행 테스트로 무변경/정상 확인했습니다.

### 22. 아직 실제 Gemini 대화로 검증하지 못한 부분 / 기타 한계
- `updateProgressHistory`/`deleteProgressHistory`가 실제 대화에서 "탄수화물 한 날짜를 9월 8일로 수정해줘" 같은 요청을 받아 정확히 하나의 기록으로 특정하고, 모호할 때 실제로 되묻는지는 **코드 재검토로만 확인했고 실제 Gemini 호출로는 테스트하지 못했습니다.**
- "어제", "지난 화요일" 같은 상대 날짜 표현을 Gemini가 실제로 정확히 오늘 날짜 기준으로 계산해 `lastClassDate`/`lessonDate`에 채우는지도 실사용 확인이 필요합니다(기존 `addEvent`의 동일 패턴이 지금까지 잘 작동해왔다는 것을 근거로 설계했습니다).
- "최근 기록" 화면 자체를 여전히 유지할지에 대해 사용자분과 나눈 대화(수정/삭제 기능 추가 후에도 여전히 열어보실 일이 적다면 화면에서 숨기는 방안)는 이번 기능 확장과는 별개로 남아 있는 논의입니다 — 원하시면 다음에 정리하겠습니다.

## 23. 학사일정 AI 분석의 scheduleDayOverride 과잉 생성 수정

### 원인
`academicScheduleAnalysis.js`의 프롬프트가 "실제 요일과 다른 요일 시간표를 쓴다는 명시가 있을 때만"이라고 안내하고 있었지만, "날짜를 보고 그 날짜의 실제 요일을 계산해서 넣으면 안 된다"는 점을 명시적으로 금지하지 않았습니다. 그 결과 모델이 `2026-04-23`(실제 목요일)처럼 학년별 시험/교시 정보만 있고 요일 대체 근거가 전혀 없는 원문에도, 그날의 실제 달력 요일을 그대로 `scheduleDayOverride`에 채워 넣는 오류를 만들었습니다.

### 수정 1 — 프롬프트 강화 (`academicScheduleAnalysis.js`)
`scheduleDayOverride` 절을 요청하신 5가지 절대 규칙(① 실제 달력 요일 아님 ② 날짜→요일 계산 금지 ③ 명시적 문구 있을 때만 ④ 근거 없으면 필드 자체 생략 ⑤ 확신 없으면 만들지 않음)으로 다시 썼고, 실제 오류 사례를 그대로 부정 예시로 추가했습니다:
> 날짜: 2026-04-23 (실제 목요일) / 원문: "중간고사(2,3) * 비급식2 (1학년 4교시)" → 잘못: `scheduleDayOverride: "목"` / 올바름: 필드 생략, `noClassGrades: [2,3]`, `regularPeriods: [1,2,3,4]`

스키마의 `scheduleDayOverride` 필드 설명(`Schema.enumString`)도 동일한 취지로 강화해 프롬프트 본문과 스키마 설명이 서로 모순되지 않도록 했습니다.

### 수정 2 — 결정론적 후처리 검증 (신규 `hasWeekdayOverrideEvidence()`)
AI 응답을 후처리하는 매핑 단계에 검증을 추가했습니다:
```js
const WEEKDAY_OVERRIDE_EVIDENCE = /(월|화|수|목|금|토|일)\s*요일\s*(수업|시간표)/;
```
`scheduleDayOverride`가 채워져 있어도 `originalText`에 이 패턴("OO요일 수업"/"OO요일 시간표", 공백 유무 모두 인식)이 없으면 무효로 보고 빈 값으로 되돌립니다. **요청하신 대로 "그 날짜의 실제 요일과 같은가"는 전혀 확인하지 않습니다** — 오직 "원문에 요일 대체 근거 문구가 있는가"만 봅니다. 그래서 실제로 목요일에 "목요일 시간표 운영"이라고 진짜로 적혀 있는 정상적인 경우는 그대로 유지됩니다(node 테스트로 확인).

### 검증
요청하신 테스트 A~E 전부 PASS, 추가로 "목요일 시간표 운영"(정상 사례가 실제 요일과 우연히 같은 경우)과 "금요일수업"(공백 없는 표기)도 정상 유지되는지 검증했습니다.

| 테스트 | 결과 |
|---|---|
| A: 중간고사(2,3)*비급식2(1학년 4교시), 목요일 → override 없음, noClassGrades=[2,3], regularPeriods=[1,2,3,4] | PASS |
| B: 월요일 날짜 + "금요일 수업" → override="금" 유지 | PASS |
| C: 기말고사(1,2학년)*3학년 4교시 → override 없음 | PASS |
| D: "1,2,3,4교시 수업" → override 없음 | PASS |
| E: 재량휴업일 → override 없음 | PASS |
| (추가) "목요일 시간표 운영" 정상 사례 → 유지 | PASS |
| (추가) "금요일수업"(공백 없음) → 유지 | PASS |

기존 학사일정 분석 테스트 13종을 포함해 전체 회귀 테스트 스위트(remainingLessons 8종, 학급코드파싱 11종, 타입혼용 4종, 표시formatter+resolve 22종, 진도업데이트 6종, history 날짜분리 5종, history 조회/수정/삭제 11종) **전부 재실행해 회귀 없이 PASS**했습니다. `remainingLessons.js`는 diff로 무변경 확인했습니다 — 계산 의미는 전혀 바뀌지 않았습니다.

### 수정한 파일
`src/ai/academicScheduleAnalysis.js` 단 하나입니다.

### 한계
이번 수정은 실제 Gemini 호출로 검증하지 못했습니다(순수 함수 검증만 진행) — 실제 학사일정 PDF를 다시 분석해 보시고, 특히 시험/단축수업 정보만 있는 날짜에 더 이상 `scheduleDayOverride`가 잘못 채워지지 않는지 확인해 주세요.

## 24. 시간표 "일시적 변동" 기능 개선 — 최종 실제 시간표 + 맞교환/이동/취소/추가

**이번 작업은 범위가 매우 커서, 핵심 계산 엔진과 일상적으로 가장 많이 쓰일 기능(맞교환/이동/취소/추가 + 변동 시간표 확인)까지 구현했고, AI 자연어 입력 연동은 이번 턴에 포함하지 못했습니다.** 아래 "구현하지 못한 부분"에 명확히 남겨둡니다.

### 1~2. 기존 timetable_overrides schema 분석 / 최종 schema
기존: `{ date, period, className, subject, memo }`. 분석 결과 이 구조로 맞교환/이동/취소/추가를 전부 표현할 수 있었습니다 — 특히 `className`을 **빈 문자열로 저장**하면 `remainingLessons.js`가 이미 그 교시를 "어떤 학급 수업으로도 세지 않음"으로 처리한다는 것을 코드 검증으로 확인했습니다(취소를 위한 별도 필드가 필요 없었습니다). 다만 기존 UI(`submitOverride`)는 `className`이 비어 있으면 저장 자체를 막고 있어서, 취소를 표현할 방법이 실제로는 없었습니다 — 이번에 추가한 "빠른 변경 > 수업 취소" 기능은 이 제약을 우회해 빈 `className`으로 저장합니다.

### 3. schema 확장 필드와 이유
`changeType`(`"swap"|"move"|"cancel"|"add"`, optional)과 `changeGroupId`(string, optional) 두 필드를 추가했습니다. **이유**: ① 화면에서 "이 override가 맞교환/이동/취소/추가 중 무엇 때문에 생겼는지" 라벨을 다시 계산하지 않고 바로 보여주기 위해(changeType), ② 맞교환 하나가 override 2건으로 저장되므로 이 둘을 하나의 사용자 작업으로 묶어 한 번에 삭제하기 위해(changeGroupId) — 기존 schema만으로는 두 override를 안전하게 그룹화할 방법이 없었습니다(요청하신 대로 다른 방법이 없는지 먼저 확인 후 추가했습니다). 기존 데이터는 이 필드가 없어도(undefined) 전부 정상 동작합니다(옵셔널).

### 4. 새 collection 추가 여부
**없습니다.** `timetable_overrides`를 그대로 재사용했습니다.

### 5~6. "최종 실제 시간표" 계산 함수 위치와 적용 순서
신규 `src/utils/effectiveTimetable.js`의 `getEffectiveDayTimetable(date, { timetable, timetableOverrides, schoolDaySchedules })`. 순서: ① 실제 요일 확인 → ② confirmed school_day_schedules 확인 → ③ scheduleDayOverride 있으면 그 요일의 기본 timetable, 없으면 실제 요일의 기본 timetable → ④ 그 날짜의 timetable_overrides로 교시별 덮어쓰기 → ⑤ 학사일정의 학년별/교시별 제외(시험·부분수업 등)를 각 교시에 표시. **`remainingLessons.js`가 이미 이 순서 그대로 구현하고 있다는 것을 코드 읽기로 확인했고**, 회귀 위험을 없애기 위해 `remainingLessons.js`를 리팩터링해 공유하는 대신, 완전히 별개의 새 파일로 동일한 순서를 재구현했습니다 — `remainingLessons.js`는 한 글자도 건드리지 않았습니다.

### 7~8. scheduleDayOverride 자동 반영 / needs_review 처리
`getEffectiveDayOfWeek`(기존 `schoolScheduleUtils.js`, 무변경, 그대로 재사용)를 그대로 써서 confirmed일 때만 요일을 대체합니다. needs_review는 `schedule` 자체를 null 처리해 실제 요일이 그대로 유지되도록 했습니다(기존 `remainingLessons.js`와 동일 원칙).

### 9~13. 맞교환/이동/취소/추가 저장 방식과 충돌 방지
- **맞교환**: `applySwap()` — 두 교시의 className을 서로 바꾼 override 2건을 같은 `changeGroupId`로 동시에 생성.
- **이동**: `applyMove()` — 원래 교시는 `className: ""`(취소)로, 목표 교시는 원래 className으로 override 생성. 목표 교시에 이미 수업이 있으면(`checkMoveConflict`) 저장하지 않고 "N교시에는 이미 OO 수업이 있습니다"를 보여준 뒤 [맞교환으로 변경]/[다른 교시 선택] 중 고르게 합니다 — **임의 덮어쓰기 없음**.
- **취소**: `applyCancel()` — `className: ""`로 override 생성.
- **추가**: `applyAdd()` — 목표 교시가 비어 있을 때만 새 className/subject로 override 생성, 이미 있으면 에러 표시.

### 14. changeGroupId 사용 여부
사용합니다(위 3번 참고). 변동 시간표 카드에서 `changeGroupId`가 있는 두 override를 한 번에 지웁니다(`removeChange`).

### 15~16. 개인 변경 삭제 / 기본 timetable 불변 여부
`removeChange(date, period)`가 `timetable_overrides` 문서(또는 같은 그룹 2건)만 삭제합니다. **`timetable` 컬렉션에는 이번 기능의 어떤 함수도 쓰기 작업을 하지 않습니다** — node 테스트(E)로 기본 시간표 배열이 override 적용 후에도 그대로임을 확인했습니다.

### 17~18. 변동 시간표 탭 구현 / 예정·지난 변동
완전히 새로운 최상단 탭 대신, "내 시간표" 화면 안에 "빠른 변경"과 "변동 시간표" 섹션을 추가하는 방식으로 구현했습니다(기존 "기본 시간표"/"일시적 변경" 섹션과 나란히, 회귀 위험이 적은 쪽을 선택했습니다). "변동 시간표"는 `isTimetableChangedDay()`(신규, 같은 파일)로 판별한 날짜만 나열하고, 오늘 이후는 항상 펼쳐서 보여주고 지난 변동은 접어둔 채 개수만 표시합니다(`showPastChanges`).

### 19. 학급명 표시 방식
전부 기존 `formatClassName()`을 재사용했습니다. 새 포맷터는 만들지 않았습니다.

### 20. AI 입력 지원 여부
**이번 턴에는 구현하지 못했습니다.** 아래 한계 항목에 이유를 밝혔습니다.

### 21. 브리핑 연동 방식
`src/pages/Home.jsx`의 "오늘 수업" 데이터 소스를 `getTodayBaseTimetable()`(실제 요일만 보고 조회, 학사일정 반영 안 됨 — 이번에 발견한 기존 버그)에서 `getEffectiveDayTimetable(오늘, ...)`로 교체했습니다. 이제 오늘이 학사일정으로 요일이 바뀌었거나 개인 맞교환이 있으면 브리핑의 "오늘 수업"이 최종 실제 시간표를 그대로 보여줍니다. "오늘 시간표 변경" 목록(개별 override 나열)은 요청하신 대로 "오늘 시간표 변동이 있습니다" 한 줄 안내로 단순화했습니다 — 브리핑 UI 전체는 재설계하지 않았습니다.

### 22. remainingLessons와의 동일성 보장 방식
같은 코드를 공유하지 않고 **알고리즘을 동일하게 재구현**했습니다(5~6번 참고). 완전한 동일성을 코드 공유로 원천 보장하지는 못했지만, 두 파일의 우선순위·조건문을 나란히 대조해 확인했고 각각 독립적으로 node 테스트를 통과했습니다.

### 23~26. remainingLessons.js / schoolScheduleUtils.js / academicScheduleAnalysis.js 변경 여부
**전부 변경 없음** (diff로 확인). Firestore Rules도 변경 없음 — `timetable_overrides`는 이미 허용된 컬렉션이고 규칙이 필드 단위 제한이 아니므로 새 필드(`changeType`/`changeGroupId`) 추가에 규칙 변경이 필요 없었습니다.

### 27~29. resetData / package.json / .env
전부 변경 없음. `timetable_overrides`는 이미 초기화 대상에 포함되어 있어 새 필드가 있는 문서도 그대로 삭제됩니다.

### 30. Firebase Console 추가 설정
불필요합니다.

### 31. 실제 Firestore/Gemini E2E 테스트 여부
**하지 않았습니다.** 전부 node 순수 함수 테스트로만 검증했습니다.

### 32. 테스트 결과
A~N, X 전부 PASS(핵심 계산 엔진 + 변동일 판정 + 기존 회귀 테스트 총 9벌 101개 재실행 전부 PASS). O~W, Y~AG는 UI/AI 상호작용을 포함하는 시나리오라 코드 재검토로 설계는 확인했지만 자동 테스트로 별도 검증하지 않았습니다 — 실제 사용해 보시고 확인 부탁드립니다.

### 33. lint/build
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것).

### 34. 회귀 가능성이 있는 부분 (숨기지 않고 명시)
- `Home.jsx`의 "오늘 수업" 데이터 조회 방식을 서버 측 쿼리(`getTodayBaseTimetable`, 요일로 필터링된 작은 쿼리)에서 클라이언트 측 전체 컬렉션 조회(`listDocsByOwner("timetable", ...)` 후 필터링)로 바꿨습니다 — 학급 수가 매우 많은 경우 이론적으로 약간 더 많은 데이터를 받아오지만, 이미 다른 화면(진도관리, 시간표)에서 쓰는 것과 같은 패턴이라 실질적 영향은 적을 것으로 예상합니다.
- "빠른 변경" 섹션과 "일시적 변경"(기존 수동 입력) 섹션이 같은 `timetable_overrides`를 공유하므로, 수동으로 만든 override에는 `changeType`/`changeGroupId`가 없습니다 — 변동 시간표 카드에서는 "변경" 배지만 붙고 맞교환처럼 그룹으로 묶여 삭제되지는 않습니다(하나씩 삭제 가능, 데이터 손실 없음).

### 아직 구현하지 못한 부분 (정직하게 밝힘)
- **섹션 25~26의 AI 자연어 입력**("다음 주 수요일 4교시 302랑 6교시 307 바뀌었어" 같은 대화로 맞교환 등록) — 날짜 resolve, 실제 시간표 대조 검증, 충돌 처리까지 포함하는 별도의 큰 기능이라 이번 턴에는 포함하지 못했습니다. 원하시면 다음 턴에 기존 `resolveClassInput`/`getEffectiveDayTimetable`을 그대로 재사용해 추가할 수 있습니다.
- "변경 미리보기"(저장 전 변경 전/후 나란히 비교, 섹션 36)는 맞교환의 경우 폼 아래 한 줄 텍스트로 간단히 보여드렸지만, 이동/취소/추가에는 별도 미리보기를 만들지 않았습니다.
- 삭제 확인 문구(섹션 37, "삭제하면 원래 시간표로 돌아갑니다" 같은 설명)는 이번에 추가하지 않았습니다 — 바로 삭제됩니다.

### 수정/신규 파일
신규: `src/utils/effectiveTimetable.js`. 수정: `src/pages/TimetablePage.jsx`, `src/pages/Home.jsx`.

## 25. 교시 이동(move) 삭제 시 반쪽만 복구되던 문제 수정

### 원인
`applyMove()`가 만드는 두 override(원래 교시 취소용 + 이동 대상 교시용)에 `changeGroupId`가 없었습니다. `removeChange()`는 `changeGroupId`가 있을 때만 같은 사용자 작업으로 보고 함께 삭제하므로, 이동을 지우면 한쪽 override만 삭제되어 시간표가 반쪽만 원상 복구되는 문제가 있었습니다.

### 수정
`applyMove()`에서도 `applySwap()`과 동일하게 `makeChangeGroupId()`로 그룹 id를 하나 만들어 두 override 모두에 부여했습니다. `removeChange()`는 전혀 수정하지 않았습니다 — 이미 `changeGroupId`가 있으면 그룹 전체 삭제, 없으면 단일 삭제하는 로직이라 그대로 재사용됩니다. `changeGroupId`가 없는 기존 move 데이터도 예전처럼 단일 삭제되어 오류 없이 동작합니다(하위 호환 확인).

### 수정 파일
`src/pages/TimetablePage.jsx` 단 하나뿐입니다. `effectiveTimetable.js`/`remainingLessons.js`/`school_day_schedules`/`academicScheduleAnalysis.js`/AI tools/Firestore rules/`package.json`/`.env`는 전혀 건드리지 않았습니다(diff로 확인).

### 테스트 결과
A~F와 하위 호환 케이스 전부 PASS(node 순수 함수 재현 테스트), 기존 회귀 테스트 10벌(101개) 전체 재실행해 PASS. `npm run build`/`npm run lint` 통과(0 error, 기존 warning 2건만 유지).

## 26. "교시 이동"을 "수업 이동"으로 확장 — 다른 날짜로도 이동 가능

### 1. 수정 파일
`src/pages/TimetablePage.jsx` 단 하나입니다.

### 2. 기존 applyMove 구조
같은 `quickDate` 안에서 두 override(원래 교시 취소용 + 이동 대상 교시용)를 동일한 `changeGroupId`로 묶어 생성하는 구조였습니다(6.4.1에서 그룹 삭제 버그를 고친 그 구조 그대로).

### 3. 확장된 수업 이동 구조
`moveToDate`(이동 대상 날짜) state를 추가했습니다. 비워두면 원래 날짜(`quickDate`)와 같은 날로 취급해 기존 "같은 날짜 안에서 교시만 이동"과 자연스럽게 이어집니다. 별도의 "요일 이동" 기능으로 나누지 않고 하나의 "수업 이동"으로 통합했습니다. **`changeType`은 여전히 `"move"` 그대로 유지**했습니다 — 저장 데이터의 의미를 바꾸지 않았습니다.

### 4. 출발일/도착일 override 저장 예
```
date: "2026-09-11", period: 3, className: "", changeType: "move", changeGroupId: "g"
date: "2026-09-10", period: 5, className: "301", subject: "가정", changeType: "move", changeGroupId: "g"
```
날짜가 서로 달라도 동일한 `changeGroupId`를 가집니다.

### 5. changeGroupId 처리
6.4.1에서 고친 `removeChange()`의 그룹 삭제 로직을 **전혀 수정하지 않고 그대로 재사용**했습니다 — `changeGroupId`로 필터링하는 코드는 날짜가 같은지 다른지 애초에 구분하지 않으므로 자동으로 날짜 간 이동에도 그대로 작동합니다.

### 6. 다른 날짜 충돌 검사 방식
이동 대상 날짜용으로 별도의 `moveTargetDayTimetable = getEffectiveDayTimetable(effectiveMoveToDate, {...})`을 계산해, 그 날짜의 대상 교시에 이미 수업이 있으면 저장을 막고 "OOOO년 O월 O일(요일) N교시에는 이미 OO 수업이 있습니다"를 보여줍니다. 날짜가 다를 때는 "맞교환으로 변경" 버튼을 숨겼습니다(맞교환은 같은 날짜 안의 개념이라 날짜가 다르면 성립하지 않기 때문입니다) — "다른 교시/날짜 선택"만 제공합니다.

### 7. scheduleDayOverride가 있는 날짜 처리
출발일·도착일 모두 `getEffectiveDayTimetable()`을 그대로 통과시켜, 각 날짜의 confirmed `scheduleDayOverride`가 반영된 실제 시간표를 기준으로 선택/충돌 검사를 하도록 했습니다. `academicScheduleAnalysis.js`/`school_day_schedules` 스키마는 전혀 건드리지 않았습니다.

### 8. 변동 시간표 양쪽 날짜 표시 방식
`allChangedDates` 계산은 이미 override의 `.date`를 그대로 쓰고 있어서, 날짜 간 이동의 두 override가 각자의 날짜에서 자동으로 "변동 시간표"에 나타납니다(추가 로직 불필요). 각 카드에는 신규 `describeMove()` 함수로 "3교시 → 5교시 이동"(같은 날짜) 또는 "9월 11일(금) 3교시 → 9월 10일(목) 5교시 이동"(다른 날짜)처럼 사람이 이해할 수 있는 문장을 붙였습니다 — `changeGroupId`로 짝을 찾아 상대편이 어느 날짜/교시인지 확인합니다. 학급명은 전부 기존 `formatClassName()`을 재사용해 "301반" 같은 raw 표기가 나오지 않습니다.

### 9. 그룹 삭제 및 원복 방식
날짜가 다른 두 override도 `changeGroupId`가 같으면 한 번의 [변동 삭제]로 함께 지워지고, 각 날짜는 그 override가 없어졌을 때의 기준 시간표(학사일정 반영 포함)로 자동 복귀합니다 — 새 코드를 추가하지 않고 기존 `getEffectiveDayTimetable()`의 결과가 자연히 그렇게 나옵니다.

### 10~11. remainingLessons 검증 결과 (날짜 간 이동 / 월 경계)
`remainingLessons.js`는 **한 글자도 수정하지 않았습니다.** node로 실제 로직을 그대로 재현해 검증한 결과, 이미 날짜별로 독립적으로 override를 조회하는 구조라 날짜 간 이동이 자동으로 정확하게 반영됩니다 — 별도의 "move는 항상 총 횟수 불변" 같은 보정 로직을 추가하지 않았습니다.
- 같은 달 안에서 빈 교시로 이동 → 총 횟수 불변 확인(PASS)
- 9/30 → 10/1 이동, 9월 계산 → -1 확인(PASS)
- 9/30 → 10/1 이동, 10월 계산 → +1 확인(PASS)

### 12. 기존 same-day move 회귀 테스트
PASS — 같은 날짜 안에서의 이동은 `moveToDate`가 비어 있으면 `quickDate`와 동일하게 처리되어 기존 동작과 완전히 같습니다.

### 13. timetable 원본 불변 확인
PASS — node 테스트로 `getEffectiveDayTimetable` 호출 전후 `timetable` 배열이 그대로임을 확인했습니다.

### 14~17. Firestore Rules / schema migration / AI tools / package·.env
**전부 변경 없음.** 새 필드도, 새 컬렉션도 추가하지 않았고(기존 `changeType`/`changeGroupId`를 그대로 재사용), AI tools/`package.json`/`.env`는 diff로 무변경 확인했습니다.

### 18. 테스트 A~R 결과
| 테스트 | 결과 |
|---|---|
| A: 같은 날짜 이동 기존 동작 | PASS |
| B/C: 다른 날짜 이동 - override 2개, 동일 changeGroupId, 양쪽 날짜 실제 시간표 정확 | PASS |
| D: 이동 삭제 → 양쪽 원복 | PASS |
| E: 대상 교시 충돌 감지 | PASS |
| F: 출발일 scheduleDayOverride 반영 | PASS |
| G: 도착일 scheduleDayOverride 반영 후 충돌 검사 | PASS |
| H: 같은 달 안, 총 횟수 불변 | PASS |
| I: 9월 계산 -1 | PASS |
| J: 10월 계산 +1 | PASS |
| K: timetable 원본 불변 | PASS |
| L: 같은 날짜 swap 기존 PASS | PASS |
| M: cancel/add 기존 PASS | PASS |
| N: 변동 시간표 양쪽 날짜 표시 | 코드 구현 확인(자동 반영 구조) |
| O: raw "301반" 미노출 | grep으로 확인 |
| P: 기존 회귀 테스트 전체 | PASS(10벌 108개 재실행) |

### 19. lint/build 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것).

### 20. 실제 Firestore에서 테스트했는지 여부
**하지 않았습니다.** 전부 node 순수 함수로 실제 계산 로직을 그대로 재현해 검증했습니다 — 실제 화면에서 날짜 간 이동을 만들어 보시고 "변동 시간표"에 양쪽 날짜가 의도하신 대로 나오는지 확인해 주시면 좋겠습니다. AI 자연어 연동은 요청하신 대로 이번 작업에서 제외했습니다.

## 27. 시간표 페이지 상위 탭 구조 개편 — [기본 시간표] [일시 변경]

### 수정 파일
`src/pages/TimetablePage.jsx`, `src/pages/TimetablePage.css`(탭 스타일 추가) 두 개뿐입니다.

### 탭 구조
기존 "내 시간표"/"담임 시간표"(`view` state)는 그대로 최상단에 유지했고, "내 시간표" 화면 **안에만** `mineSubTab`("basic"|"changes") 상위 탭을 새로 추가했습니다.
- **[기본 시간표]**: 기존 "기본 시간표" 주간 그리드 + "시간표 가져오기"(파일 불러오기) — 이 둘만. 일시 변경 관련 내용은 전혀 없습니다.
- **[일시 변경]**: 기존 "일시적 변경"(수동 입력 폼) + "빠른 변경"(맞교환/이동/취소/추가) + 새로 재구성한 "예정된 변경"/"지난 변경" 목록.

담임 시간표(`view === "homeroom"`)는 이 새 하위 탭과 완전히 분리되어 있어 전혀 영향받지 않습니다(코드 검토로 확인).

### 변경 그룹 카드로 재구성 (핵심)
기존에는 날짜마다 `ChangedDayCard`로 그 날의 전체 시간표를 항상 펼쳐서 보여줬습니다. 이번에 `changeGroupId` 기준으로 묶는 방식으로 바꿨습니다:
- 맞교환/날짜 간 이동처럼 override 2건이 같은 `changeGroupId`를 가지면 **하나의 카드**로.
- 취소/추가처럼 `changeGroupId`가 없는 단일 override는 그 자체로 하나의 카드.
- 개인 override 없이 학사일정 confirmed `scheduleDayOverride`만 있는 날짜도 별도 카드로 함께 나열(기존처럼 놓치지 않게).

각 카드는 기본적으로 **한두 줄 요약만** 보여줍니다(예: "9월 16일(수) / 4교시 · 3학년 2반 / ↕ / 6교시 · 3학년 7반", "수업 이동 / 9월 11일(금) 3교시 · 3학년 1반 / ↓ / 9월 10일(목) 5교시 · 3학년 1반", "9월 17일(목) / 4교시 · 3학년 4반 취소"). **[변경 시간표 보기]**를 눌렀을 때만 관련 날짜(들)의 `getEffectiveDayTimetable()` 결과를 펼쳐서 보여주고, 다시 누르면 접힙니다(`expandedChangeKeys` Set state로 관리, 카드마다 독립적으로 펼침/접힘). 취소된 수업이 원래 무엇이었는지는 신규 `classNameBeforeOverride()`(그 override 하나만 제외하고 다시 계산)로 정확히 표시합니다 — 별도 저장 없이 항상 최신 기준으로 계산합니다.

### 탭 badge
"일시 변경" 탭 버튼에 `upcomingChangeItems.length`(예정된 변경 카드 개수, override 건수가 아니라 **카드 개수**)를 작은 배지로 표시합니다. 0건이면 배지가 없습니다. 새 데이터 구조 없이 기존 override/schoolDaySchedules를 그 자리에서 집계한 값입니다.

### 예정된/지난 변경
"예정된 변경"은 카드의 대표 날짜(가장 이른 날짜) 기준 오름차순으로 항상 펼쳐서 보여주고, "지난 변경"은 `pastChangeItems.length`건 안내와 [펼쳐보기] 버튼 뒤에 기본적으로 숨겨둡니다(펼치면 최근 날짜부터).

### 발견해서 함께 고친 것
탭 버튼에 쓴 `progress-tabs` CSS 클래스가 `MonthlyProgressPage.css`에만 정의되어 있고 `TimetablePage.jsx`는 그 CSS 파일을 import하지 않아, 그대로 두면 탭이 스타일 없이(구분 없이) 나타났을 것입니다. `TimetablePage.css`에 동일한 스타일을 그대로 옮겨 추가해서 해결했습니다.

### 계산 로직 변경 여부
**전혀 없습니다.** `getEffectiveDayTimetable`/`removeChangeGroup`(신규, 기존 `removeChange`의 그룹 삭제 로직을 카드 단위로 옮긴 것)는 전부 저장/조회 방식이 아니라 화면 표시 방식만 바꾼 것입니다. `remainingLessons.js`는 diff로 완전 무변경을 확인했습니다.

### 검증
신규 그룹화/정렬 로직을 node로 검증(swap 카드 1개로 묶임, 날짜 간 move 카드 1개로 묶임, cancel/add 개별 카드, 학사일정 전용 카드, 예정 변경 날짜순 정렬, 학사일정+개인변경 동시 존재 시 중복 카드 없음) — 전부 PASS. 기존 회귀 테스트 12벌(114개) 전체 재실행해 **회귀 없이 전부 PASS**. `npm run build`/`npm run lint`: 통과(0 error, 기존 warning 2건만 유지).

### 한계
UI 상호작용을 포함한 시나리오(S, T, U, Y, AA, AB, AD, AE)는 실제 브라우저에서 클릭해보는 형태의 테스트라 자동화된 node 테스트로는 검증하지 못했습니다 — 코드 구조상 의도한 대로 동작해야 하지만, 실제 화면에서 탭 전환, 펼침/접힘, 담임 시간표 정상 동작을 확인해 주시면 좋겠습니다. Firestore/Gemini로 실제 테스트하지 않았습니다.

## 28. lesson_adjustments 학급 식별자 정규화 — 수동 시수 보정이 계산에 반영되도록 수정

지난 분석에서 확정된 원인(학급 식별자 표기 불일치)만 최소 범위로 수정했습니다. **`remainingLessons.js`/`isSameClass()`/날짜 계산/delta 계산/`scheduleDayOverride`/`effectiveTimetable.js`/`timetable_overrides`는 전부 diff로 무변경 확인했습니다.**

### A. 수정한 파일
`src/pages/MonthlyProgressPage.jsx`, `src/ai/toolExecutors.js`, `src/ai/tools.js` 세 개뿐입니다.

### B. 수정한 함수/컴포넌트
- `MonthlyProgressPage.jsx`: 신규 `allOwnedClasses`(학년 구분 없는 전체 담당 학급 목록, useMemo), 수동 보정 폼의 "학급" 필드(`<input>` → `<select>`), 기존 보정 목록 표시(`formatClassName` 적용)
- `toolExecutors.js`: `execAddLessonAdjustment`(`resolveOwnedClass()` 적용)
- `tools.js`: `addLessonAdjustmentDeclaration`의 `className` 설명(다른 학급 도구와 동일하게 통일)

### C. UI 학급 선택 방식
새 `<select>`가 `timetable`에서 뽑은 `allOwnedClasses`(학년 무관, 사용자가 실제 담당하는 전체 학급)를 `<option>`으로 나열합니다. **`<option value={c}>`의 `value`는 timetable에 실제 저장된 raw className 그대로(canonical), 화면에 보이는 텍스트만 `formatClassName(c)`로 사람이 읽기 좋게** 표시합니다 — 새 학급 관리 체계를 만들지 않고 기존 `timetable` 데이터를 그대로 재사용했습니다.

### D. UI에서 실제 저장되는 className 예시
드롭다운에서 "1학년 1반"을 선택하면, 저장되는 `lesson_adjustments.className`은 그 학급의 실제 내부 코드(예: `"101"`, 사용자의 timetable 저장 형식에 따름) 그대로입니다 — 화면에 보였던 "1학년 1반"이라는 문자열 자체가 저장되지 않습니다.

### E. AI resolveOwnedClass 적용 방식
```js
const { className, failure } = await resolveOwnedClass(args.className, uid);
if (!className) return failure;
```
다른 5개 학급 관련 AI 도구(`updateProgressStatus`, `clearProgressCurrent`, `getProgressStatus`, `getProgressHistory`, `getRemainingLessons`)와 완전히 동일한 패턴을 그대로 재사용했습니다. 새 resolver를 만들지 않았습니다.

### F. AI에서 실제 저장되는 className 예시
"1학년 1반 시수 +1", "1-1 시수 +1", "101반 시수 +1" 중 무엇으로 말해도 `resolveOwnedClass`가 전부 같은 내부 코드(예: `"101"`)로 resolve한 뒤 그 값으로 저장합니다(node 테스트 C-1~C-3로 확인).

### G. UI/AI 저장 형식이 동일한지
**예, 동일합니다.** 둘 다 최종적으로 `timetable`에 저장된 raw className(예: `"101"`)을 그대로 씁니다 — UI는 드롭다운 `value`로, AI는 `resolveOwnedClass`의 반환값으로. node 테스트(G)로 두 경로의 결과가 정확히 같은 문자열임을 확인했습니다.

### H. +1/-1 실제 계산 테스트 결과
`remainingLessons.js`의 실제 계산 로직(무변경)에 정규화된 className으로 보정을 넣어 검증했습니다 — 기본 계산 결과(예: 9회) 대비 +1 등록 시 10회, -1 등록 시 8회로 정확히 반영됨을 확인했습니다(테스트 A, B PASS).

### I. 담당하지 않는 학급 테스트 결과
AI가 담당하지 않는 학급(예: 담당 학급이 101/103/105/301/304/307뿐인데 "3학년 2반"을 시도)으로 시수 보정을 요청하면 `resolveOwnedClass`가 실패를 반환해 **저장되지 않습니다**(테스트 D PASS) — 다른 학급 도구와 동일한 원칙입니다.

### J. 기존 lesson_adjustments 처리 방식
**마이그레이션 코드를 추가하지 않았습니다.** 기존에 정상 canonical 값으로 저장된 보정은 계속 정상 반영됩니다(테스트 F PASS). "3-2"/"1-1"류 비정규화 표기로 이미 저장된 기존 문서는 이번 수정 이후에도 여전히 매칭되지 않으며, 이는 요청하신 대로 사용자가 삭제 후 새 드롭다운/AI로 다시 등록하는 방식으로 해결하는 것을 전제로 남겨뒀습니다(node 테스트로 이 사실도 명시적으로 확인해 "숨기지 않고" 남겼습니다).

### K. 회귀 테스트 결과
기존 회귀 테스트 스위트 13벌(120개) 전체 재실행 — **전부 PASS**(기본 수업 횟수 계산, school_day_schedules, scheduleDayOverride, needs_review, 시험/휴업일, swap, same-date move, cross-date move, cancel, add, 진도 계획/체크, AI 진도 입력 관련 테스트 전부 포함). `remainingLessons.js`/`schoolScheduleUtils.js`는 diff로 완전 무변경 확인했습니다.

### L. build 결과
성공.

### M. lint 결과
**0 error**, warning 2건(기존부터 있던 것, 이번 작업과 무관).

### 이번 작업에서 하지 않은 것 (요청하신 범위 제한 그대로 준수)
- 기존 비정규화 `lesson_adjustments` 데이터의 일괄 변환/migration — 하지 않음
- `scheduleDayOverride`의 반별 +/- 계산 정확성 검증 — 이번 작업과 분리, 다음에 별도 진행
- `remainingLessons.js`/`isSameClass()`/날짜 계산/delta 계산/`effectiveTimetable.js`/`timetable_overrides` — 전부 무수정

## 29. scheduleDayOverride의 반별 증감을 "계산 근거"(basis)에 표시

지난 조사에서 확정된 대로 **"계산을 고치는 작업"이 아니라 "이미 정확한 total 계산에 설명을 추가하는 작업"**만 진행했습니다. `total`/`baseCount`/`effectiveDay` 결정/개인 override 적용/lesson_adjustments 계산/시험·휴업 계산/needs_review 처리는 **한 글자도 바꾸지 않았습니다.**

### A. 수정 파일
`src/utils/remainingLessons.js` **단 하나입니다.** `MonthlyProgressPage.jsx`의 basis 렌더링 부분은 건드리지 않았습니다 — 기존 `{b.date} {b.label}` 형태로 이미 자연스럽게 표시되어 별도 UI 수정이 필요 없었습니다.

### B. 수정 함수
`calculateRemainingLessons()` 하나뿐입니다. 새 함수를 만들지 않고 기존 함수 안에 날짜 순회 루프 한 곳만 보강했습니다.

### C. 요일 대체 전(실제 요일) count 계산 방식
```js
const actualWeekdayBaseCount = timetable.filter(
  (t) => t.dayOfWeek === actualDayOfWeek && isSameClass(t.className, className)
).length;
```
**개인 override(timetable_overrides)를 전혀 반영하지 않은, 순수 기본 시간표만으로** 그 학급이 실제 요일에 몇 교시 있는지 셉니다.

### D. 요일 대체 후(대체요일) count 계산 방식
```js
const effectiveWeekdayBaseCount = timetable.filter(
  (t) => t.dayOfWeek === effectiveDay && isSameClass(t.className, className)
).length;
```
마찬가지로 개인 override 없이, 대체요일 기본 시간표만으로 셉니다.

### E. basis delta 계산 방식
```js
const dayOverrideDelta = effectiveWeekdayBaseCount - actualWeekdayBaseCount;
if (dayOverrideDelta !== 0) {
  dayOverrideBasis.push({ date, label: `${effectiveDay}요일 수업 적용`, delta: dayOverrideDelta, source: "schedule_day_override" });
}
```
`schedule.scheduleDayOverride`가 있을 때만(즉 `confirmed`일 때만 — `schedule` 자체가 `confirmed`가 아니면 `null`이 되므로 자동으로 걸러집니다) 계산하고, **차이가 0이면 basis에 아무것도 추가하지 않습니다.**

### F. basis 객체 예시
```js
{ date: "2026-09-14", label: "금요일 수업 적용", delta: -1, source: "schedule_day_override" }
```
기존 `academic_schedule`/`manual` 항목과 완전히 같은 `{date, label, delta, source}` 모양을 그대로 재사용했습니다 — 새 필드나 새 구조를 만들지 않았습니다.

### G. 실제 사용자 표시 예시
UI(`MonthlyProgressPage.jsx`, 무수정)가 그대로 `{b.date} {b.label}`을 렌더링하므로 화면에는:
> `2026-09-14 금요일 수업 적용    -1`

처럼 표시됩니다. `scheduleDayOverride`/`effectiveDay`/`schedule_day_override` 같은 내부 코드값은 `source` 필드에만 있고 **화면에는 절대 노출되지 않습니다**(기존 UI가 `source`를 렌더링하지 않으므로).

### H~J. 101(-1)/103(+1)/105(0, 표시 없음) 테스트 결과
node로 실제 수정된 파일을 그대로 불러와 검증했습니다 — **전부 정확히 일치**했습니다:
- 101: `schedule_day_override` 근거 1건, delta=-1
- 103: `schedule_day_override` 근거 1건, delta=+1
- 105: 근거 0건(차이가 없어 추가되지 않음)

### K. needs_review 결과
`needs_review`면 `schedule`이 `null`이 되어 새 로직 자체가 실행되지 않고, 요일 대체 basis가 생성되지 않으며 total도 변화 없음을 확인했습니다. PASS.

### L. timetable_override와 합성 결과
금요일로 대체된 103을 개인 override로 취소한 시나리오: **최종 total은 정확히 0회**(개인 취소가 반영됨), 그런데 **요일 대체 근거는 여전히 "+1"로 표시**됩니다 — 이는 의도한 대로입니다. 요일 대체 근거는 "요일 대체 자체가 만든 순수 변화"만 설명하고, 그 이후에 벌어진 개인 취소는 최종 숫자에만 반영될 뿐 요일 대체 근거와는 섞이지 않습니다(요청하신 4장의 원칙 그대로).

### M. lesson_adjustment와 합성 결과
101: 요일 대체(-1) + 수동 보정(+1) = 순증감 0. `basis`에는 `schedule_day_override` 항목(-1)과 `manual` 항목(+1)이 **각각 따로** 표시됩니다. PASS.

### N. 시험/휴업 근거와 중복 여부
같은 날짜에 요일 대체(`scheduleDayOverride:"금"`)와 시험 제외(`noClassGrades:[1]`)가 동시에 있는 시나리오: `academic_schedule` 근거(-1, 시험 제외분)와 `schedule_day_override` 근거(+1, 요일 대체 자체의 효과)가 **각각 독립적으로 존재**하고 서로 덮어쓰지 않으며, 최종 `total`도 두 효과가 정확히 합산된 0회로 계산됨을 확인했습니다. PASS — 중복이나 충돌이 없습니다.

### O. 수정 전후 total 비교
**완전히 동일합니다.** 101/103/105 전부 지난 조사에서 확정한 것과 같은 -1/+1/0 증감을 그대로 유지합니다 — basis 추가 로직이 `total`이 이미 확정된 **이후에** 실행되도록 배치했기 때문에(구체적으로 `basis.push(...dayOverrideBasis)`를 `total` 합산 루프들 뒤에 둠), 이중 계산이 발생할 수 없는 구조입니다.

### P. 전체 회귀 테스트 결과
기존 회귀 테스트 스위트 15벌(135개)을 전체 재실행 — **전부 PASS**. 기본 수업 횟수, scheduleDayOverride, needs_review, 시험/휴업, timetable_overrides(swap/same-date move/cross-date move/cancel/add), lesson_adjustments(+1/-1), 학급 코드/표시 formatter, 진도 관리, 학사일정 분석까지 전부 포함되며 **어느 것도 total 숫자가 달라지지 않았습니다.**

### Q. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 이번 작업과 무관).

### 이번 작업에서 하지 않은 것 (요청하신 범위 제한 그대로 준수)
- `total`/`baseCount`/`effectiveDay` 결정 로직 — 전혀 수정 안 함
- `timetable_overrides`/`lesson_adjustments` 적용 방식 — 전혀 수정 안 함
- `effectiveTimetable.js`, Firestore schema — 전혀 손대지 않음(md5 비교로 무변경 확인)
- `MonthlyProgressPage.jsx`의 basis 렌더링 — 이미 자연스럽게 표시되어 수정 불필요했음

## 30. 개인 시간표 일시 변경 AI 기능 연결 (changeTimetable)

### A. 실제 수정 파일
신규: `src/utils/timetableChangeService.js`. 수정: `src/pages/TimetablePage.jsx`(applySwap/checkMoveConflict/applyMove를 공통 함수 호출로 교체), `src/ai/tools.js`(신규 tool 1개), `src/ai/toolExecutors.js`(신규 실행기 1개), `src/ai/systemInstruction.js`(판단 규칙 추가). **`effectiveTimetable.js`/`remainingLessons.js`/`schoolScheduleUtils.js`/Firestore rules는 md5 비교로 완전 무변경 확인했습니다.**

### B. 신규 timetableChangeService 구조
`buildSwapPayloads(date, periodA, periodB)`와 `buildMovePayloads({sourceDate, sourcePeriod, source, destinationDate, destinationPeriod, destination})` 두 순수 함수뿐입니다. **Firestore 호출이 전혀 없습니다** — "검증 + 저장할 payload 배열 생성"까지만 하고 `{ok:true, payloads:[...]}` 또는 `{ok:false, reason, conflict?}`을 돌려줍니다. `source`/`destination`은 호출부가 `getEffectiveDayTimetable().periods`에서 미리 찾아 넘겨주는 것을 전제로 합니다 — 이 함수 자체는 날짜가 무슨 요일인지, `scheduleDayOverride`가 있는지 전혀 모릅니다.

### C. UI에서 공통 함수를 사용하는 위치
`TimetablePage.jsx`의 `applySwap()`(→`buildSwapPayloads`), `checkMoveConflict()`(→`buildMovePayloads`, 결과가 `ok`면 `applyMove(result.payloads)` 호출, 아니면 `conflict` 유무로 `moveConflict`/`quickChangeError` 분기), `applyMove(payloads)`(payload 배열을 그대로 저장하도록 단순화). **빈 값 확인용 UI 전용 가드**("이동할 수업을 선택해 주세요" 등, 아직 아무것도 선택 안 한 상태)는 그대로 남겨뒀고, 그 이후의 실제 검증(존재 여부/충돌)만 공통 함수로 위임했습니다. `applyCancel`/`applyAdd`/`removeChangeGroup`은 요청하신 대로 손대지 않았습니다.

### D. AI tool declaration
```js
changeTimetableDeclaration = {
  name: "changeTimetable",
  description: "개인 시간표의 일시적인 교시 맞교환/수업 이동만 등록하는 도구이다. school_day_schedules를 수정하지 않는다. scheduleDayOverride를 만들거나 수정하지 않는다...",
  parameters: { changeMode: "swap"|"move", sourceDate, sourcePeriod, destinationDate(선택), destinationPeriod }
}
```
`className`/`subject` 파라미터는 아예 존재하지 않습니다 — AI가 채울 방법 자체가 없습니다.

### E. AI executor 실행 흐름
`execChangeTimetable(args, uid)`: ① `timetable`/`timetable_overrides`/`school_day_schedules` 로드 → ② `getEffectiveDayTimetable(sourceDate, ...)`로 source 조회 → ③ `changeMode==="swap"`이면 같은 날짜 안에서 destinationPeriod도 `sourceDay`에서 찾아 `buildSwapPayloads` 호출(스왑은 UI와 동일하게 날짜 간 개념이 없음) → ④ `changeMode==="move"`면 `destinationDate = args.destinationDate || args.sourceDate`로 결정, 다르면 `getEffectiveDayTimetable(destinationDate, ...)`로 별도 조회 → ⑤ `buildMovePayloads` 호출 → ⑥ `ok`면 `Promise.all`로 두 override 문서 저장, 아니면 저장 없이 실패 반환.

### F. AI가 source className/subject를 결정론적으로 찾는 방법
`sourceDay.periods.find(p => p.period === args.sourcePeriod)` — `getEffectiveDayTimetable`의 결과에서 찾을 뿐, Gemini는 애초에 `className`/`subject`를 인자로 받지도 않으므로 추측이 구조적으로 불가능합니다.

### G~I. same-date swap / same-date move / cross-date move 결과
node로 서비스 함수와 실행기 로직을 그대로 재현해 검증했습니다 — 전부 UI(`applySwap`/`applyMove`)가 생성하는 것과 **완전히 동일한 필드 구조**(`date, period, className, subject, changeType, changeGroupId`)로 override를 생성함을 확인했습니다. 특히 **cross-date move에서 두 override가 서로 다른 날짜를 가지면서도 동일한 `changeGroupId`를 공유**함을 확인했습니다(테스트 C).

### J. destination 충돌 결과
목요일 5교시에 이미 103이 있는 상태에서 그곳으로 이동을 시도하면 저장 없이 `{success:false, reason:"9월 17일(목) 5교시에는 이미 1학년 3반 수업이 있습니다.", conflict:{...}}`를 반환합니다. **자동 swap 전환도, 임의 덮어쓰기도 하지 않습니다** — systemInstruction에 "사용자가 명시적으로 '그럼 맞바꿔줘'라고 다시 말했을 때만 새 swap 호출로 처리"하도록 명시했습니다.

### K. source empty 결과
등록된 수업이 없는 교시를 source로 지정하면 `{success:false, reason:"...교시에는 등록된 수업이 없습니다."}`를 저장 없이 반환합니다.

### L. 대체요일 날짜 테스트
source/destination 양쪽 모두, 월요일에 confirmed `scheduleDayOverride:"금"`이 있으면 실제로 금요일 기준 시간표에서 교시를 조회/충돌 판단함을 확인했습니다(테스트 F, G) — AI나 실행기가 요일을 직접 해석하는 코드는 전혀 없습니다.

### M. UI와 AI payload 동일성 테스트
같은 `buildSwapPayloads`/`buildMovePayloads` 함수를 UI와 AI가 각각 호출하므로 **구조적으로 동일성이 보장**됩니다(같은 함수, 다른 호출자일 뿐). `changeGroupId`만 매번 새로 생성되어 값 자체는 다르지만, 필드 구성과 의미는 완전히 같습니다.

### N. school_day_schedules/scheduleDayOverride 쓰기 경로 확인
`execChangeTimetable`을 포함해 이번에 추가/수정한 모든 코드를 검토한 결과, `school_day_schedules`에 대한 `createDoc`/`updateDocById`/`deleteDocById` 호출이 **단 한 곳도 없습니다** — 오직 `timetable_overrides`에만 씁니다. node 테스트로도 `schoolDaySchedules` 배열이 함수 실행 전후 불변임을 확인했습니다.

### O. remainingLessons 회귀 결과
`remainingLessons.js` 자체를 전혀 수정하지 않았고, AI가 생성하는 override가 UI와 동일한 구조이므로 기존 계산 로직이 별도 처리 없이 그대로 인식합니다 — 기존 회귀 테스트(15벌)에 변화 없음을 재확인했습니다.

### P. 전체 회귀 테스트 결과
기존 회귀 테스트 스위트 16벌(151개) + 신규 changeTimetable 테스트(A~M, 10종) 전체 재실행 — **전부 PASS**.

### Q. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**(새 에러 없음), warning 2건(기존부터 있던 것).

### R. 부분 저장 위험 존재 여부
**존재합니다 — 완전히 없애지는 못했습니다.** swap/move 모두 override 2건을 별도의 `createDoc` 호출로 저장하며, Firestore batch/transaction을 쓰지 않으므로 첫 번째 저장은 성공하고 두 번째가 네트워크 오류 등으로 실패하면 override 1건만 남을 수 있습니다. **이 위험은 원래 UI 코드에도 이미 있던 것**이며(순차 `await` 두 번), 이번에 공통 함수로 옮기면서 UI/AI 실행기 모두 `Promise.all`로 두 저장을 동시에 실행하도록 통일했습니다 — 동시 실행이라 원래의 순차 실행보다 지연 시간은 짧아지지만, "한쪽만 실패할 수 있다"는 근본적인 위험의 성격 자체는 동일합니다. 요청하신 대로 이번 작업에서 batch/transaction 리팩터링은 하지 않았습니다.

### S. 이번 구현에서 의도적으로 제외한 기능
- AI 기반 cancel/add (요청하신 범위 제외)
- AI 기반 변경 삭제/복원("아까 그거 취소해줘") — 다만 현재 구조(`removeChangeGroup`이 `changeGroupId` 기준으로 단순 삭제)가 이미 단순해서, 필요하시면 다음에 매우 적은 코드로 안전하게 연결할 수 있다는 점만 참고로 남겨둡니다.
- destination 충돌 시 AI가 자동으로 "맞바꿀까요?" 되묻는 구조화된 후속 플로우 — 이번엔 실패 반환까지만 하고, 그 다음 대화 턴에서 사용자가 다시 명시적으로 요청하면 새 tool 호출로 처리되는 식입니다(요청하신 13/17장과 일치).
- cross-date **swap**(맞교환)은 UI에도 없는 개념이라 이번에도 지원하지 않았습니다 — `execChangeTimetable`은 `changeMode==="swap"`일 때 `destinationDate`를 아예 참조하지 않고 항상 같은 날짜로 처리합니다.

## 31. Google Calendar → 업무비서 일정 가져오기 AI 기능

### A. 실제 수정 파일
`src/calendar/calendarApi.js`(조회 함수 1개 추가), `src/ai/tools.js`(tool 2개), `src/ai/toolExecutors.js`(실행기 2개), `src/ai/systemInstruction.js`(판단 규칙). **`googleAuth.js`/`GoogleCalendarContext.jsx`/`calendarEligibility.js`/`effectiveTimetable.js`/`remainingLessons.js`/Firestore rules는 md5 비교로 완전 무변경 확인했습니다.** 기존 `createCalendarEvent`/`updateCalendarEvent`/`deleteCalendarEvent`도 손대지 않았습니다.

### B. listCalendarEvents 구현 방식
`calendarApi.js`에 추가한 순수 조회 함수입니다. 기존 `callCalendarApi()`(공통 fetch/에러 처리 헬퍼)를 그대로 재사용해 `GET {BASE_URL}?timeMin=...&timeMax=...&singleEvents=true&orderBy=startTime`을 호출합니다. Firestore 쓰기가 전혀 없습니다.

### C. timezone 범위 생성 방식
`date` 하나만 받아 내부에서 `addDaysToDateString(date, 1)`(기존 `date.js` 함수 재사용, 새 timezone 시스템 없음)로 다음 날짜를 구하고, `timeMin: "{date}T00:00:00+09:00"`, `timeMax: "{다음날}T00:00:00+09:00"`을 그대로 씁니다 — 요청하신 "해당 날짜 00:00~다음날 00:00, timeMax는 배타적 경계" 그대로입니다.

### D. singleEvents/orderBy 적용 여부
둘 다 적용했습니다(`singleEvents=true`, `orderBy=startTime`) — node 테스트로 실제 요청 URL의 쿼리 파라미터까지 확인했습니다.

### E. Google 응답 → 후보 변환 방식
내부 `toCandidate(event)`가 `{id, title, date, startTime, endTime, allDay}`만 남기고 `description`/`attendees`/`location` 등은 가져오지 않습니다. 종일 일정은 `event.start.date`만 쓰고 **`event.end.date`(배타적 경계)는 date 판단에 전혀 쓰지 않습니다** — 하루짜리 종일 일정이 다음 날로 밀리는 문제를 이 설계로 원천 차단했습니다(node 테스트 C로 확인).

### F~G. tool 선언
```
getGoogleCalendarEvents(date) — 조회 전용, Firestore write 없음
importGoogleCalendarEvents(date, googleEventIds: string[]) — title/date/time 파라미터 자체가 없음
```

### H. 조회 후 Firestore write가 없는지
`execGetGoogleCalendarEvents`는 `listCalendarEvents`와 `listDocsByOwner("events", uid)`(alreadyImported 판단용 읽기)만 호출하고 `createDoc`/`updateDocById`가 코드에 전혀 없습니다 — node 테스트(F)로도 조회 시 write 콜백이 한 번도 호출되지 않음을 확인했습니다.

### I. 사용자 선택 후 import 흐름
"조회 → (alreadyImported 표시된) 후보를 사용자에게 제시 → 사용자가 번호로 선택 → Gemini가 그 번호에 해당하는 실제 id들을 `googleEventIds`에 담아 `importGoogleCalendarEvents` 호출" — 요청하신 2단계 구조 그대로입니다.

### J. Gemini가 title/date/time을 지어내지 못하게 한 방법
**구조적으로 불가능하게 만들었습니다.** `importGoogleCalendarEventsDeclaration`의 파라미터에는 `date`와 `googleEventIds`만 있고 title/time 필드 자체가 없습니다. 실행기는 `args.googleEventIds`에 담긴 id를 **그 날짜를 다시 `listCalendarEvents`로 조회한 결과**(`candidates`)에서 찾아, 찾은 것만 그 데이터 그대로 저장합니다. Gemini가 존재하지 않는 id를 지어내면 `candidates.find()`가 실패해 `skipped`에 `not_found`로 들어가고 저장되지 않습니다(node 테스트 R로 확인) — **저장되는 내용의 원본은 항상 이 시점에 재조회한 Google Calendar API 데이터**입니다.

### K~M. googleCalendarId / calendarSync / source 저장 결과
node 테스트로 확인 — 가져온 문서는 `googleCalendarId: <candidate.id>`, `calendarSync: true`, `source: "google_import"`로 정확히 저장됩니다(테스트 J/K/L).

### N. 이미 등록된 일정 판단 방식
`existingEvents.filter(e => e.googleCalendarId).map(e => e.googleCalendarId)`로 Set을 만들어, 조회 결과의 각 `event.id`가 이 Set에 있으면 `alreadyImported: true`로 표시합니다. **`source`가 `manual`/`ai`/`google_import` 무엇이든 상관없이 `googleCalendarId`만 같으면 이미 등록된 것으로 판단**합니다(요청하신 16장 원칙, node 테스트 N으로 확인).

### O. 앱→Google→앱 중복 방지 결과
`EventsPage.jsx`의 기존 `submit()` 로직(`if (googleCalendarId) updateCalendarEvent else createCalendarEvent`)을 전혀 수정하지 않았으므로, 가져온 일정에 `googleCalendarId`가 채워져 있는 이상 이후 수정 시 자동으로 PATCH 경로를 타게 됩니다 — **코드를 건드리지 않고도 기존 로직이 자연스럽게 올바르게 작동**합니다(코드 리딩으로 확인, 이 경로 자체는 무변경이라 별도 테스트를 새로 만들 필요가 없었습니다).

### P. Google→앱→Google 왕복 중복 방지 결과
import 시 `calendarSync: true`로 저장하므로, 이후 이 일정을 수정해도 "아직 Calendar에 없어서 새로 만들어야 하는 일정"으로 오인되지 않습니다 — 항상 기존 `googleCalendarId`를 통해 PATCH됩니다. import 직후 다시 `createCalendarEvent`를 호출하는 코드는 어디에도 없습니다(직접 확인).

### Q. 종일 일정 결과
node 테스트 B/C로 확인 — `startTime`/`endTime`이 빈 문자열로, `date`는 `start.date`만 쓰여 정확합니다.

### R. 반복 일정 결과
`singleEvents=true`를 요청 파라미터에 포함했음을 node 테스트(D)로 확인했습니다 — 실제 Google 서버가 이 옵션에 따라 occurrence를 펼쳐 주는지는 API 자체의 동작이라 이번 분석/구현에서는 요청 파라미터가 정확한지까지만 검증했습니다(실제 Google Calendar로 호출해 보시는 걸 권합니다).

### S. token 없음 결과
`execGetGoogleCalendarEvents`/`execImportGoogleCalendarEvents` 둘 다 기존 `execAddEvent`와 동일한 패턴(`getValidAccessToken()` → 없으면 `connect()` → 재조회 → 그래도 없으면 실패 반환)을 그대로 씁니다 — 새 인증 UI를 만들지 않았습니다.

### T. 기존 Calendar 생성/수정/삭제 회귀 결과
`createCalendarEvent`/`updateCalendarEvent`/`deleteCalendarEvent`를 한 글자도 수정하지 않았고, `EventsPage.jsx`/`execAddEvent`/`execDeleteEvent`/`execUpdateEvent`/`execSyncEventToCalendar`도 전혀 건드리지 않았습니다(diff로 확인) — 회귀 위험이 구조적으로 없습니다.

### U. 전체 회귀 테스트 결과
기존 회귀 테스트 18벌(169개) + 신규 Google Calendar 테스트(listCalendarEvents 7종 + import 실행기 8종, 총 15종) 전체 재실행 — **전부 PASS**.

### V. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**(새 에러 없음), warning 2건(기존부터 있던 것).

### W. 남은 알려진 한계
- **Google이 반환하는 `dateTime`의 timezone 오프셋을 별도로 검증하지 않고, 문자열에서 그대로 시:분을 잘라 씁니다.** 이 프로젝트 전체가 "항상 Asia/Seoul"이라는 전제로 설계되어 있고(다른 곳도 전부 이 가정을 씀), 사용자의 Google 계정이 다른 timezone으로 설정된 이벤트를 갖고 있다면 시간이 어긋날 수 있습니다 — 실제 Google Calendar로 테스트해 보시고 문제가 있으면 알려주세요.
- 반복 일정이 실제 Google 서버에서 `singleEvents=true`로 올바르게 펼쳐지는지는 실제 API 호출로 검증하지 못했습니다(요청 파라미터만 검증).
- 종일 일정이 **여러 날에 걸치는 경우**(예: 2박 3일 수학여행), 이 앱의 `events` 스키마 자체가 `date` 하나만 가지므로 시작일 하루만 가져와지고 나머지 날짜는 반영되지 않습니다 — 이건 이번 기능의 한계라기보다 앱의 기존 events 스키마 자체의 구조적 한계입니다.
- 실제 Firestore/Gemini/Google Calendar API로는 end-to-end 테스트를 하지 못했습니다 — 코드 재현과 mock fetch를 이용한 node 테스트로만 검증했습니다.

## 32. UI/UX 개편 1단계 — Soft Pink Assistant (Sidebar + Home)

### A. 실제 수정 파일
`src/styles/theme.css`(토큰 추가), `src/components/Sidebar.jsx`/`Sidebar.css`, `src/pages/Home.jsx`/`Home.css`, `src/components/BriefingSection.css`. 신규: `src/components/HomeQuickAssistant.jsx`/`.css`. **`effectiveTimetable.js`/`remainingLessons.js`/`timetableChangeService.js`/`calendarApi.js`/`googleAuth.js`/`GoogleCalendarContext.jsx`/`calendarEligibility.js`/`toolExecutors.js`/`tools.js`/Firestore rules는 md5 비교로 완전 무변경 확인했습니다.** 다른 페이지 파일도 전혀 건드리지 않았습니다(diff로 확인).

### B. Paperlogy 적용 방식
**적용하지 않았습니다.** 프로젝트 전체를 검색한 결과 Paperlogy asset/import가 어디에도 없었고, 요청하신 대로 "확신이 없으면 무리하게 추가하지 않는다" 원칙에 따라 비공식 경로로 받아오지 않았습니다. 대신 `theme.css`에 `--font-family-base: var(--font-body)`(현재 이미 안전하게 로드된 Noto Sans KR) 변수를 만들고 Sidebar/Home/신규 컴포넌트 전부 이 변수로 글꼴을 지정했습니다 — **나중에 Paperlogy를 정식으로 추가하실 때 이 변수 값 하나만 바꾸면 전체에 반영**되도록 준비해 뒀습니다.

### C. 한국어 줄바꿈 처리 방식
새로 작성/수정한 모든 CSS에 `word-break: keep-all; overflow-wrap: break-word;`를 적용했습니다(서비스명, subtitle, 사이드바 메뉴, 카드 제목, 카드 항목, quick assistant 메시지 전부). **`break-all`은 어디에도 쓰지 않았고, 하드코딩된 `<br>`도 JSX에 추가하지 않았습니다.**

### D. 공통 color/design token
`theme.css`에 기존 변수(`--board`/`--paper`/`--ink` 등, 다른 페이지에서 여전히 씀)는 **그대로 두고** 새 변수만 추가했습니다: `--bg-main`, `--bg-sidebar`, `--bg-sidebar-active`, `--bg-card`, `--bg-card-soft`, `--accent`, `--accent-soft`, `--text-primary`, `--text-secondary`, `--border-soft`, `--shadow-soft`, `--danger-soft`, `--danger-soft-bg`, `--font-family-base`. 요청하신 이름 그대로입니다.

### E. Sidebar 변경
- 배경: `--bg-sidebar`(light blush pink)
- 선택된 메뉴: `--bg-sidebar-active` 배경 + `--accent` 텍스트/점(요청하신 "선택된 메뉴는 조금 더 진한 blush + rose 계열" 그대로)
- 선택 안 된 메뉴: `--text-secondary`(warm gray-brown)
- 아이콘: 새 라이브러리 없이, 메뉴마다 작은 원형 점(`.sidebar__link-mark`, `currentColor` 기반) — 스타일이 하나로 통일되고 크기도 전부 동일합니다. 기존 emoji는 메뉴에서 제거했습니다(카드 제목 아이콘은 유지).
- 사용자 영역: 기능(이름 표시/로그아웃) 무변경, 여백만 정리하고 로그아웃 버튼을 둥근 pill 형태로 바꿨습니다.

### F. 서비스명 변경 결과
"오늘의 업무비서" → "솔쌤 AI 비서" + subtitle "선생님의 하루를 함께해요"(`Sidebar.jsx`). Home 인사말도 "좋은 아침이에요 👋" → "솔쌤 안녕하세요 🌷" + "오늘도 좋은 하루 되세요!"로 정확히 반영했습니다.

### G. "솔쌤 AI 비서" 클릭 → Home 이동 구현 방식
브랜드 영역 전체를 `<div>`가 아니라 **`react-router-dom`의 `<Link to="/">`**로 감쌌습니다(기존 `NavLink` 패턴과 같은 라이브러리, 새 route 없음). `focus-visible`/`hover` 스타일을 추가하고, 기존 "오늘의 브리핑" 메뉴는 그대로 남겨둬 **Home으로 가는 길이 두 가지**가 되도록 했습니다(요청 10장과 일치).

### H. Home header 변경
인사말/subtitle/날짜/summary를 세로로 배치하고, 오른쪽에 이미지 asset 없이 CSS `radial-gradient` 원형 장식(`--head-decor`)만 추가했습니다(768px 미만에서는 숨김). "오늘 처음 확인" 표시는 기존의 별도 줄(`<p className="home__fresh">`)에서 summary 옆의 작은 pill 배지로 축소했습니다 — **`shouldTriggerAutoBriefing`/`markBriefingShownToday` 판단 로직은 전혀 손대지 않았습니다.**

### I. summary 숫자 재사용 결과
`data.baseTimetable.length`/`data.meetings.length + data.personalEvents.length`/`data.dueTasks.length` — **계산식 그대로**, pill 형태로만 재배치했습니다.

### J. 오늘의 주요 확인 구성
기존 `priorityItems`(연체 업무/오늘 마감/시간표 변동/오늘 회의)에 **`data.notices`(기존 `getImportantNotices()` 결과, 중요 판단 로직 재사용)**와 **`data.upcomingEvents.slice(0, 2)`(이미 날짜순 정렬된 다가오는 일정 중 가장 가까운 2건만)**을 합쳤습니다. 각 항목에 `category`(업무/시간표/회의/주요 공지/다가오는 일정) 필드를 추가해 작은 badge로 표시합니다 — **새로운 "공지 중요도" 판단이나 "일정 임박" 알고리즘은 만들지 않았습니다**(요청하신 대로 기존 `important` 필드와 기존 정렬 결과만 재사용).

### K. 주요 확인 empty 처리
`BriefingSection`의 기존 `hideWhenEmpty` prop을 그대로 씁니다(`title="오늘의 주요 확인"`) — 항목이 0개면 카드 자체가 렌더링되지 않습니다. **"오늘은 특별히 확인할 게 없어요." 문구와 경고색 큰 카드를 완전히 제거**했습니다.

### L. 오늘 수업
`data.baseTimetable`(= `getEffectiveDayTimetable()` 결과, 무변경) 그대로 표시합니다. **변경 배지는 기존 필드 `p.isOverride`를 그대로 읽어** `{t.isOverride && <span className="home-badge home-badge--change">변경</span>}`로 표시합니다 — 새 시간표 변경 판단 로직을 전혀 만들지 않았습니다.

### M. 큰 "오늘 일정" 카드 제거 결과
`data.personalEvents`를 렌더링하던 `BriefingSection` 블록을 완전히 삭제했습니다. **`data.personalEvents` 데이터 자체(계산)는 그대로 유지**되고(summary 숫자 계산에 여전히 쓰임), 화면에 별도 카드로만 안 보이는 것입니다.

추가로, 기존 "할 일"(`data.upcomingTasks`) 카드도 이번 새 5개 영역(A~E) 목록에 명시되지 않아 함께 제거했습니다 — **`data.upcomingTasks` 계산 자체와 "업무" 페이지 기능은 전혀 삭제하지 않았습니다.** 이 부분은 요청 문서에 명시적으로 다뤄지지 않아 제가 판단해서 뺀 것이라 이 자리에서 명확히 말씀드립니다 — 다시 카드로 두고 싶으시면 쉽게 되돌릴 수 있습니다.

### N. 다가오는 일정
`deriveUpcomingEvents(allEvents, today, 7)`(함수 자체 무변경) 결과를 Home.jsx의 `setData()` 안에서 `[...결과].sort(...)`로 **날짜 오름차순, 같은 날짜면 `startTime` 오름차순**으로 정렬만 추가했습니다(요청하신 "표시 안정화를 위한 최소 변경" 그대로, `briefingDerive.js` 파일 자체는 무수정).

### O. 수업 진도 카드 처리
`data.diffMessages`(구 `class_progress` 기반 `analyzeProgress()` 결과, 무변경)를 `hideWhenEmpty`로 그대로 유지했습니다 — 내용이 없으면 카드 자체가 안 보입니다. "오늘의 주요 확인"에는 포함하지 않았습니다(요청 30장 원칙 그대로).

### P. AI quick input
- 재사용한 기존 함수: `tryLocalQuery`(`ai/localQueries.js`), `startAssistantChat`(`ai/session.js`), `sendAssistantMessage`(`ai/assistant.js`) — **AssistantPage.jsx와 정확히 같은 호출 순서/인자**입니다.
- Home 독립 `chatRef`: `useRef(null)`을 `HomeQuickAssistant.jsx` 컴포넌트 안에서만 유지합니다 — Context로 끌어올리지 않았고, AssistantPage와 세션을 공유하지 않습니다(요청 34장 그대로).
- 후속 대화 처리: 완전한 채팅 UI 대신, **직전 사용자 입력 + 직전 AI 응답**만 compact하게 보여줍니다("1번" 같은 후속 답변도 같은 `chatRef`(같은 Gemini 세션)로 이어지므로 Google Calendar 조회→선택 같은 다단계 흐름이 정상 작동합니다 — 세션 자체가 이어지는 것이지 화면에 전체 로그를 쌓아두는 게 아닙니다).
- loading/error: 전송 버튼 disable + "생각하는 중…" 텍스트, 오류는 카드 내부에만 표시 — Home 전체를 깨뜨리지 않습니다.

### Q. 빈 카드/auto-flow 처리
`home__grid`에 `grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))`를 사용했습니다 — 카드가 몇 개 남든 자동으로 재배치되고, 한 줄에 카드가 하나만 남으면 그 카드가 자연스럽게 넓어집니다(별도 JS 레이아웃 로직 없이 순수 CSS Grid만으로). "AI 비서에게 말하기"는 조건 없이 항상 렌더링됩니다.

### R. responsive 처리
`auto-fit`이 이미 화면 폭에 따라 자연스럽게 열 수를 줄여주므로 별도의 중간폭 breakpoint 없이도 자연스럽게 좁아집니다. 640px 이하에서만 명시적으로 1열 + 좁은 패딩 + header를 세로 배치로 바꾸는 미디어 쿼리를 추가했습니다. 기존 Sidebar의 폭(`--sidebar-width`)이나 `App.css`의 레이아웃 구조는 건드리지 않았습니다.

### S. 접근성 처리
브랜드 링크·로그아웃 버튼·AI 입력 폼 버튼 전부 `:focus-visible` 스타일을 추가했습니다. AI 입력창에 `aria-label`을 추가했고, 전송 버튼도 `aria-label="보내기"`를 명시했습니다. 텍스트 대비는 `--text-primary`(진한 charcoal-brown)/`--text-secondary`(중간 톤)를 흰/연핑크 카드 배경 위에서 육안으로 문제없어 보이도록 선택했습니다(정밀한 명암비 수치 측정 도구는 이번 환경에서 쓸 수 없어 실제 화면으로 한 번 확인해 주시면 좋겠습니다 — W 항목 참고).

### T. 수정하지 않은 핵심 기능 파일 확인
md5 비교로 확인 완료: `effectiveTimetable.js`, `remainingLessons.js`, `timetableChangeService.js`, `calendarApi.js`, `googleAuth.js`, `GoogleCalendarContext.jsx`, `calendarEligibility.js`, `toolExecutors.js`, `tools.js`, `firestore.rules` — **전부 이번 턴 이전과 완전히 동일**합니다.

### U. Home 기능 회귀 테스트 결과
A~M은 전부 **코드 재검토로 확인**했습니다(이번 작업은 계산 로직을 하나도 건드리지 않아 자동화된 node 테스트 대상 자체가 없습니다 — UI 렌더링 변경이라 실제 브라우저에서 눈으로 확인하는 것이 가장 정확합니다):
- A~C(오늘 수업/일정/마감 숫자): 계산식 무변경, 그대로 재사용 확인
- D~F(effective timetable 표시/override 표시/요일대체 반영): `data.baseTimetable`을 그대로 쓰므로 `getEffectiveDayTimetable()`의 기존 동작을 그대로 상속
- G~K(연체/오늘마감/시간표변경/회의/중요공지 주요확인 표시): 전부 기존 데이터 소스를 그대로 배열에 포함시켰음을 코드로 확인
- L(다가오는 일정 표시): 기존 배열 재사용
- M(날짜순 정렬): 위 N 항목의 정렬 코드로 확인
- N~O(빈 카드 DOM 제거/주요확인 0건 시 미렌더링): `hideWhenEmpty` prop 적용 확인
- P~S(AI quick input 관련): 호출 경로가 AssistantPage와 동일 함수임을 코드로 확인 — **실제 Gemini/Firestore로 실행해 보지는 못했습니다.**

### V. 다른 페이지 route/layout 회귀 결과
다른 페이지 파일을 전혀 수정하지 않았으므로(diff로 확인) route 자체는 회귀 위험이 없습니다. `Sidebar.css` 변경이 다른 페이지에 영향을 주는지도 확인했습니다 — `--board`/`--chalk`/`--paper`/`--ink` 같은 기존 전역 변수를 전혀 건드리지 않고 **새 변수만 추가**했으므로, Sidebar 바깥의 다른 페이지 CSS는 이론적으로 영향받지 않습니다. 다만 실제 브라우저로 각 페이지에 진입해 보지는 못했습니다.

### W. 기존 전체 테스트 결과
기존 회귀 테스트 스위트 18벌(169개, 계산 로직 전부) 재실행 — **전부 PASS**(이번 UI 작업이 계산 로직을 전혀 건드리지 않았으므로 당연한 결과이지만, 명시적으로 재확인했습니다).

### X~Y. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**(새 에러 없음), warning 2건(기존부터 있던 것, 이번 작업과 무관).

### Z. 남은 UI 개선 사항 (정직하게 밝힘)
- **실제 브라우저 렌더링/스크린샷 검증을 하지 못했습니다** — 이 환경에서 화면을 실제로 띄워볼 수 없어, 색상 대비·카드 간격·모바일 폭에서의 줄바꿈 등을 눈으로 확인하지 못했습니다. 꼭 실제로 열어보시고 피드백 주세요.
- Paperlogy는 위 B 항목대로 이번엔 적용하지 않았습니다 — 안전한 공식 경로(예: 정식 npm 패키지나 라이선스가 명확한 CDN)를 알려주시면 다음 턴에 `--font-family-base` 값만 바꿔 바로 적용할 수 있습니다.
- "할 일"(오늘 이후 마감 예정 업무) 카드를 제가 판단해서 제거했습니다(M 항목 참고) — 요청 문서에 명시적으로 다뤄지지 않은 부분이라, 필요하시면 알려주세요.
- 접근성 명암비는 수치로 측정하지 못했고 육안 판단만 했습니다.
- Sidebar/Home 외의 다른 8개 페이지는 이번에 전혀 손대지 않았으므로(요청하신 범위 그대로), 이제 Soft Pink 톤과 나머지 페이지(진한 초록 사이드바가 사라졌으니 페이지 이동 시 사이드바는 핑크인데 본문은 기존 종이색 그대로인 상태)가 됩니다 — 의도된 1단계 범위이지만, 실제로 보시면 이 전환 지점이 다소 눈에 띌 수 있습니다.

## 33. 7.1 UI 보정 — 3열 제거, 주요확인 중복 제거, 폭 확대

### A. 수정한 파일
`src/pages/Home.jsx`(우선순위 로직 1곳 + 렌더링 구조), `src/pages/Home.css`(전체 재작성), `src/components/Sidebar.css`(미세 조정만), `src/components/HomeQuickAssistant.css`(input 폭 보정). **`HomeQuickAssistant.jsx`(AI 로직)와 `Sidebar.jsx`(브랜드 navigation)는 요청하신 대로 전혀 건드리지 않았습니다.**

### B. Home 3열 → 2열 변경 방식
기존 하나의 flat grid(`auto-fit, minmax(320px,1fr)`)를 **행(row) 단위 구조**로 바꿨습니다. `home__grid`(flex column, 행들을 세로로 쌓음) 안에 `home__row`(각각 최대 2개 카드만 담는 grid, `auto-fit, minmax(400px,1fr)`)를 두었습니다. 각 row는 React가 최대 2개의 카드만 자식으로 렌더링하므로, CSS가 아무리 넓어져도 3열이 될 수 없습니다 — 게다가 `.home`의 `max-width:1320px`(좌우 padding 96px 제외 시 1224px)에서는 `400px×3+22px×2=1244px > 1224px`라 산술적으로도 3열이 들어갈 수 없습니다(이중으로 안전).

### C. main content width 변경
`.home`의 `max-width`를 1080px → **1320px**로 확대, 좌우 padding도 40px → 48px로 소폭 확대했습니다.

### D. greeting hierarchy 변경
`font-size` 24px→**29px**, `font-weight` 700→**800**, `letter-spacing:-0.01em` 추가, 아래 subtitle/날짜와의 여백을 늘려 시작점이라는 느낌을 강화했습니다. header와 첫 카드 행 사이 여백도 28px→40px로 넓혔습니다.

### E. header decoration 처리
**옵션 A(제거) 방향으로 처리**했습니다 — 떠 있는 원형 도형 대신, header 자체에 위치한 아주 옅은(`opacity:0.5`) radial-gradient 배경 wash로 바꿨습니다. 실제 스크린샷으로 확인한 결과 거의 인지되지 않을 정도로 은은해서, 정보보다 튀는 느낌 없이 자연스럽습니다.

### F. summary pill 변경 여부
구조는 유지하고, 숫자만 `<strong>`으로 감싸 강조했습니다(`--accent` 색상). pill에는 원래도 hover 효과가 없었어서 그대로 뒀습니다 — 버튼처럼 보이지 않는 것을 확인했습니다.

### G. 오늘의 주요 확인 데이터 구성
`overdueTasks`/`dueTasks`/`todayHasTimetableChange`/`meetings`/`notices` — **정확히 이 5가지만** 사용합니다(요청하신 그대로).

### H. upcoming event를 주요 확인에서 제거했는지
**제거했습니다.** 지난 턴에 추가했던 `data.upcomingEvents.slice(0, 2).map(...)` 블록을 `priorityItems` 배열에서 완전히 삭제했습니다. "다가오는 일정" 카드에서만 이제 이 데이터를 보여줍니다 — 실제 스크린샷으로 두 카드에 서로 다른 내용이 표시됨을 확인했습니다.

### I. 주요 확인 empty 처리
기존 `hideWhenEmpty` 그대로 유지 — 5가지 항목이 전부 없으면 카드 자체가 렌더링되지 않습니다.

### J. 주요 확인이 없을 때 오늘 수업 full-width 처리 방식
`{(priorityItems.length > 0 || data.baseTimetable.length > 0) && (<div className="home__row">...)}`로 그 row 자체를 조건부 렌더링하고, row 안에서는 실제로 존재하는 카드만 자식으로 들어갑니다. 주요 확인이 없으면 그 row에는 "오늘 수업" 카드 하나만 남고, `auto-fit`이 자동으로 풀폭으로 늘려줍니다 — **JS 레이아웃 계산 없이 순수 CSS만으로 해결**했습니다. Playwright로 실제 렌더링해 이 동작을 스크린샷으로 확인했습니다(아래 V 참고).

### K. 오늘 수업 UI 변경
데이터/계산(`data.baseTimetable` = `getEffectiveDayTimetable()`)은 무변경. 교시 번호를 `<span className="home-row-period">`로 살짝 분리해 정렬을 정돈했습니다. `[변경]` 배지는 기존 `t.isOverride` 필드를 그대로 읽어 표시합니다 — 새 판단 로직 없음.

### L. 다가오는 일정 UI 변경
날짜를 `formatDateDisplay(e.date)`(기존 유틸 재사용)로 "9월 12일" 형태로 표시하고 별도 span으로 분리해 날짜/제목의 위계를 나눴습니다. `deriveUpcomingEvents`/지난 턴에 추가한 날짜순 정렬은 그대로 유지했습니다.

### M. AI quick input 크기/layout 변경
카드 자체는 이제 두 번째 row에서 `auto-fit(minmax 400px)`로 훨씬 넓은 폭을 확보합니다(이전엔 3열 중 하나라 좁았음). `HomeQuickAssistant.css`에서 input의 `padding`/`font-size`를 소폭 키우고 `min-width:0`을 명시해 폭을 안정적으로 다 쓰도록 했습니다. **실제 스크린샷에서 placeholder와 예시 문장이 한 줄에 자연스럽게 들어가는 것을 확인**했습니다(이전 좁은 카드에서 여러 줄로 꺾이던 문제 해결).

### N. AI 기능 로직 무변경 여부
`HomeQuickAssistant.jsx`는 **이번에 단 한 줄도 수정하지 않았습니다**(diff로 확인 가능 - 이 파일 자체가 diff 목록에 안 나타남). `tryLocalQuery`/`startAssistantChat`/`sendAssistantMessage` 호출과 독립 `chatRef` 구조 전부 7.0 그대로입니다.

### O. 한국어 줄바꿈 처리
새로 추가/수정한 CSS 전부 `word-break: keep-all; overflow-wrap: break-word;` 유지, `break-all` 없음. 실제 모바일 폭(390px) 스크린샷에서 "솔쌤"/"안녕하세요"가 단어 단위로 자연스럽게 줄바꿈됨을 확인했습니다(글자 중간 분리 없음).

### P. Sidebar 미세 조정
브랜드명 `font-weight` 700→800, `font-size` 16→16.5px, 브랜드 영역 padding/margin 소폭 확대, 메뉴 사이 `gap` 2px→4px, 선택된 메뉴 `font-weight` 600→700(색상 값 자체는 과하지 않게 그대로 유지). **`Sidebar.jsx`(구조/브랜드 클릭 로직)는 전혀 건드리지 않았습니다.**

### Q. Paperlogy 처리 상태
**7.0과 동일하게 적용하지 않았습니다.** `--font-family-base` 변수 구조를 그대로 유지했고, 비공식 다운로드를 하지 않았습니다 — 이번 7.1의 필수 목표가 아니라는 점을 확인했습니다.

### R. 수정하지 않은 핵심 기능 파일 확인
md5 비교로 확인 완료: `effectiveTimetable.js`, `remainingLessons.js`, `timetableChangeService.js`, `calendarApi.js`, `googleAuth.js`, `GoogleCalendarContext.jsx`, `calendarEligibility.js`, `toolExecutors.js`, `tools.js`, `firestore.rules` — **전부 7.0 완료 시점과 완전히 동일**합니다.

### S. 기존 18 suites / 169 tests 결과
이번 턴까지 누적된 회귀 테스트는 **19벌(170개, Google Calendar 기능 등 이후 추가분 포함)**이며, 전체 재실행 결과 **전부 PASS**했습니다. 이번 UI 보정 자체는 계산 로직을 전혀 건드리지 않았으므로 당연한 결과입니다.

### T~U. build / lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**(새 에러 없음), warning 2건(기존부터 있던 것, 이번 작업과 무관).

### V. 실제 브라우저 렌더링 확인 여부
**이번에는 실제로 확인했습니다.** Firebase 로그인 없이는 실제 앱을 완전히 띄울 수 없어서, 실제 `Home.jsx`/`Sidebar.jsx`가 만들어내는 것과 동일한 DOM 구조 + 실제 CSS 파일을 그대로 사용한 정적 HTML을 만들어 Playwright(헤드리스 브라우저)로 렌더링하고 스크린샷을 찍었습니다:
- **Desktop(1440px), 주요 확인 있는 날**: 2열 확인, 카드가 이전보다 확실히 넓어짐, AI 카드 placeholder/예시가 한 줄에 들어감, 다가오는 일정과 주요 확인에 서로 다른 내용이 표시됨(중복 없음)
- **Desktop(1440px), 주요 확인 없는 날**: "오늘 수업" 카드가 그 행 전체 폭을 자연스럽게 채움을 확인
- **Mobile(390px)**: 1열로 정상 전환, "솔쌤 안녕하세요"가 단어 단위로 줄바꿈, 글자 중간 분리 없음

### W. 실제 화면에서 발견된 남은 UI 문제
- **Sidebar가 모바일 폭(390px)에서도 접히지 않고 고정 폭을 그대로 차지합니다.** 본문이 그만큼 좁아집니다 — 이건 이번 7.1이나 지난 7.0에서 만든 문제가 아니라 **원래부터 있던 앱의 특성**입니다(`--sidebar-width` 고정, 반응형 collapse 로직 자체가 처음부터 없었음). 요청하신 대로 "새로운 responsive navigation 시스템은 만들지 않는다"는 원칙을 지키기 위해 이번에는 손대지 않았습니다 — 다음에 별도로 다뤄야 할 사항으로 남겨둡니다.
- header 장식(radial wash)이 스크린샷에서 거의 안 보일 정도로 옅습니다 — "안 튀는 것"이 목적이라 의도한 결과이지만, 너무 흐려서 있으나 마나 하다면 다음에 opacity를 살짝 올리는 정도로 조정할 수 있습니다.
- 실제 Firestore 데이터로 진짜 로그인 후 화면을 보지는 못했습니다 — 정적 HTML 미리보기는 DOM 구조와 CSS는 100% 동일하지만, React 컴포넌트의 실제 동작(로딩 상태, 실제 데이터 개수에 따른 여러 조합)까지 전부 검증한 것은 아닙니다.

## 34. 7.2 UI/UX — Sidebar 접기/펼치기 + Mobile drawer + 카드 디자인 완성도

### A. 실제 수정 파일
`src/components/Sidebar.jsx`/`.css`(전체 재작성), `src/App.css`(모바일 레이아웃 최소 수정 1곳), `src/components/BriefingSection.jsx`/`.css`(navLink prop 추가 + 내부 스타일), `src/pages/Home.jsx`/`.css`(priorityItems 구조 개선 + navLink 3곳), `src/components/HomeQuickAssistant.css`(로그 영역 max-height만). **`HomeQuickAssistant.jsx`(AI 로직)는 이번에도 단 한 줄도 수정하지 않았습니다**(diff에 전혀 나타나지 않음).

### B. 7.1 대비 주요 변경점
Sidebar에 Desktop 접기/펼치기 + Mobile hamburger drawer를 추가했고, Home 카드 내부(주요확인 좌우 정렬, 오늘수업 교시 pill, 다가오는일정 날짜 블록, 항목 구분선, 조건부 "전체 보기" 링크)의 정보 위계를 다듬었습니다. **Home의 2열 row 구조 자체(7.1)는 전혀 바꾸지 않았습니다.**

### C. Desktop Sidebar 펼침 구조
기존 7.1 구조(브랜드+메뉴+사용자 영역) 그대로 유지, 메뉴 아이콘만 원형 점 → 의미가 다른 SVG 아이콘으로 교체.

### D. Desktop Sidebar 축소 구조
`.sidebar--collapsed` 클래스가 폭을 `216px → 72px`로 줄이고, 텍스트(`sidebar__brand-text`/`sidebar__link-label`/`sidebar__user-name`+로그아웃 버튼)를 조건부로 숨깁니다. 아이콘만 남고, 사용자 영역은 이니셜 대신 작은 원형 사용자 아이콘(`sidebar__user-mini`)으로 축소됩니다.

### E. Sidebar collapse state 관리 방식
`Sidebar` 컴포넌트의 `useState(() => localStorage에서 초기값 읽기)`로 관리, 버튼 클릭 시 토글 + 즉시 `localStorage.setItem`. **Mobile drawer의 `mobileOpen`은 완전히 별개의 `useState(false)`**로, `collapsed`(Desktop preference)와 절대 섞이지 않습니다 — 새로고침해도 항상 `false`(닫힘)로 시작합니다.

### F. localStorage key 및 저장 방식
`teacherAssistant.sidebarCollapsed`, 값은 `"true"`/`"false"` 문자열(단순 boolean 수준). Firestore는 전혀 쓰지 않습니다. `localStorage` 접근이 실패해도(프라이빗 모드 등) `try/catch`로 조용히 무시하고 기본값(펼침)으로 동작합니다 — node 테스트로 이 경우까지 확인했습니다.

### G. 메뉴 icon 구현 방식
**새 dependency를 설치하지 않고, 얇은 stroke 기반 SVG를 컴포넌트 안에 직접 작성**했습니다(`Icon` 래퍼 + 9개 메뉴별 아이콘 + hamburger/close/chevron/user 아이콘, 전부 `viewBox 24x24`, `strokeWidth 1.8`로 굵기 통일). 모든 아이콘이 `currentColor`를 써서 선택 상태에 따라 색이 자동으로 바뀝니다.

### H. 축소 상태 tooltip/accessibility
CSS만으로 구현했습니다 — `data-tooltip` 속성 + `:hover`/`:focus-visible` 시 `::after`로 텍스트 툴팁을 보여줍니다(무거운 tooltip 라이브러리 없음). 접기 버튼에는 `aria-label`(펼치기/접기 동적으로 바뀜), hamburger/닫기 버튼에도 각각 `aria-label`, `aria-expanded`를 hamburger 버튼에 추가했습니다.

### I. 브랜드 클릭 → Home 유지 여부
펼침/축소/Mobile drawer **세 가지 상태 모두** 브랜드 영역이 `<Link to="/">`입니다(`SidebarContent`를 desktop aside와 drawer aside가 공유하므로 자동으로 동일하게 적용됩니다). 실제 스크린샷으로 축소 상태에서도 🌷 아이콘이 그대로 클릭 가능함을 확인했습니다.

### J. Mobile header 구현 방식
`Sidebar.jsx`의 `<header className="mobile-header">` — hamburger 버튼 + 브랜드 링크 + 사용자 아이콘. `App.css`에서 900px 이하일 때만 `display:flex`로 보이도록 했습니다(Desktop에서는 `display:none`).

### K. Mobile drawer 구현 방식
Desktop sidebar와 **같은 `SidebarContent`/`NAV_ITEMS`를 그대로 재사용**하는 두 번째 `<aside className="sidebar sidebar--drawer">`를 렌더링하고, `mobileOpen` state에 따라 `transform: translateX(-100% → 0)`으로 슬라이드시킵니다. 메뉴 목록을 복제 구현하지 않았습니다.

### L. drawer 닫기 조건
① 메뉴 클릭(`onNavigate` 콜백) ② 브랜드 클릭(같은 콜백) ③ backdrop 클릭(`sidebar-backdrop`의 onClick) ④ Escape 키(`useEffect` + `keydown` 리스너) — **4가지 전부 구현**했습니다.

### M. main content와 Sidebar width 연동
`.sidebar`가 `width`에 `transition`을 걸고 있고, `.app-main`은 기존 `flex:1`이라 sidebar 폭이 줄어들면 자동으로 넓어집니다(별도 JS 계산 없음). `Home`의 `max-width:1320px`은 그대로라 카드가 모니터 끝까지 늘어나지 않습니다.

### N. Home 2열 구조 유지 여부
**완전히 유지했습니다.** `home__row`/`home__grid` 구조, `auto-fit(minmax(400px,1fr))`를 전혀 건드리지 않았습니다 — Sidebar 축소 여부와 무관하게 Home은 항상 최대 2열입니다.

### O~P. Home header/summary pill
7.1 상태를 그대로 유지(요청하신 대로 "구조 변경 불필요" 판단). summary pill의 padding/hover 등도 기존 그대로입니다.

### Q. 오늘의 주요 확인 내부 디자인
`priorityItems`에 `text`와 분리된 `meta`(실제 존재하는 데이터만: 마감일/시간/공지 만료일) 필드를 추가하고, `home-priority-row`(flex, `justify-content:space-between`, 좁으면 자연스럽게 줄바꿈)로 category+내용(좌) / 날짜·상태(우)를 구분했습니다. 존재하지 않는 데이터는 `meta`가 `null`이라 표시되지 않습니다(예: 시간표 변경은 "오늘"만, 중간고사 공지에 `expiresAt`이 없으면 아무 것도 안 뜸 — 데이터를 지어내지 않음).

### R. 오늘 수업 row/pill 디자인
`home-row-period`를 rose 배경의 작은 rounded pill로 바꿨습니다(`1교시` 등). `[변경]` 배지는 기존 `t.isOverride`를 그대로 사용, 판단 로직 무변경.

### S. 다가오는 일정 date block 디자인
`home-row-date`를 `bg-card-soft` 배경 + border의 soft block으로 바꿨습니다(달력 앱처럼 복잡하게 만들지 않음).

### T. AI quick assistant 디자인
말풍선 구조(사용자 오른쪽 rose bubble / AI 왼쪽·전체폭 연한 pink bubble)는 **이미 이전 턴에 구현되어 있어 그대로 유지**했고, 이번엔 긴 응답을 위한 `max-height:260px + overflow-y:auto`만 추가했습니다.

### U. HomeQuickAssistant AI 로직 무변경 여부
**확인 완료.** `HomeQuickAssistant.jsx`는 diff에 전혀 나타나지 않습니다 — `tryLocalQuery`/`startAssistantChat`/`sendAssistantMessage` 호출, 독립 `chatRef` 전부 그대로입니다.

### V. 수업 진도 처리
계산(`diffMessages`)/`hideWhenEmpty` 그대로, "수업 진도 보기" navLink만 추가.

### W. 조건부 navigation link 추가 여부
**오늘 수업 → `/timetable`("시간표 보기"), 다가오는 일정 → `/events`("전체 보기"), 수업 진도 → `/progress`("수업 진도 보기")** 3곳에 추가했습니다(전부 기존 route, 새 route 없음). **"오늘의 주요 확인"에는 추가하지 않았습니다** — 여러 출처(업무/시간표/회의/공지)가 섞여 있어 하나의 명확한 대상 페이지가 없기 때문입니다(요청하신 원칙 그대로).

### X. 한국어 줄바꿈
새/수정 CSS 전부 `word-break: keep-all` 유지, `break-all` 없음.

### Y. Paperlogy 상태
이번에도 프로젝트에 공식 asset이 없어 적용하지 않았습니다 — `--font-family-base` 구조 유지.

### Z. 수정하지 않은 핵심 기능 파일 확인
md5 비교로 확인: `effectiveTimetable.js`, `remainingLessons.js`, `timetableChangeService.js`, `calendarApi.js`, `googleAuth.js`, `GoogleCalendarContext.jsx`, `calendarEligibility.js`, `toolExecutors.js`, `tools.js`, `firestore.rules` — **전부 7.1과 완전히 동일**합니다.

### AA~AD. 실제 렌더링 검증 결과
7.1 때처럼 Playwright로 실제 CSS/DOM 구조를 그대로 사용한 정적 HTML을 렌더링해 확인했습니다:
- **Desktop 펼침(1440px)**: 사이드바 정상, 브랜드 링크 정상, 메뉴 아이콘 정상 표시, Home 2열 유지, 카드 내부(우측 정렬 meta/교시 pill/날짜 블록/navLink) 정상
- **Desktop 축소(72px)**: 아이콘만 남고 텍스트 숨김, 홈 아이콘 활성 표시 정상, 사용자 미니 아이콘 정상, **Home이 여전히 2열**(3열로 안 바뀜) 확인
- **Sidebar persistence**: node 테스트로 toggle→재조회 시 `true`/`false`가 정확히 유지됨을 확인(실제 브라우저 새로고침 자체는 이 환경에서 재현 못 함 — localStorage read/write 로직 자체의 정확성만 검증)
- **Mobile(390px) drawer**: hamburger→drawer 열림, backdrop 표시, 메뉴 아이콘+라벨 정상, 활성 메뉴 표시, 하단 사용자 영역 정상 — 스크린샷으로 확인

### AE. 다른 페이지 Sidebar 회귀 결과
다른 8개 페이지 파일을 전혀 수정하지 않았으므로(diff로 확인) 페이지 자체의 회귀 위험은 없습니다. `App.css`에 추가한 미디어쿼리(900px 이하에서 `.app-shell`을 `flex-direction:column`으로)는 **모든 페이지에 공통 적용**되는 레이아웃 변경이라, 다른 페이지들도 Mobile 폭에서 기존과 다르게 보일 수 있습니다 — 다만 각 페이지 자체의 CSS(`padding`/`max-width` 등)는 건드리지 않았으므로 내용이 가려지거나 넘치는 문제는 없을 것으로 예상하지만, 실제로 각 페이지를 Mobile 폭에서 열어보지는 못했습니다(아래 AJ 한계 참고).

### AF. 기존 19 suites / 170 tests 결과
전체 재실행 — **전부 PASS**.

### AG. 새로 추가한 Sidebar UI test 결과
`localStorage` 기반 collapse 로직을 node로 재현해 6개 테스트 추가 — **전부 PASS**(초기값/toggle/persistence round-trip 2방향/localStorage 차단 시 안전한 fallback/mobileOpen이 별도 state임을 확인).

### AH~AI. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**(작업 중 발생한 새 warning 1건(`setState-in-effect`)은 원인이 된 불필요한 effect를 제거해 해결 — 최종적으로 기존 warning 2건만 유지).

### AJ. 남아 있는 UI/UX 한계 (정직하게 밝힘)
- **실제 Firestore 로그인 후 브라우저로는 확인하지 못했습니다** — 이번에도 실제 DOM/CSS를 그대로 쓴 정적 HTML을 Playwright로 렌더링하는 방식으로만 검증했습니다. Desktop 펼침/축소, Mobile drawer 열림 상태는 스크린샷으로 확인했지만, **실제 새로고침 후 localStorage 값이 그대로 반영되는지, 다른 8개 페이지가 Mobile 폭에서 실제로 깨지지 않는지는 실사용으로 확인이 필요합니다.**
- 시안에 있던 헤더 우측/하단의 장식용 튤립 일러스트(여러 개 흩뿌려진 형태)는 이미지 asset 추가 없이 재현하기 어려워 이번에도 적용하지 않았습니다 — 기존 7.1의 단순한 radial-gradient wash를 그대로 유지했습니다.
- 축소 상태 tooltip은 CSS `:hover`/`:focus-visible` 기반이라 터치 전용 기기(호버 없음)에서는 나타나지 않을 수 있습니다 — 다만 모바일에서는 어차피 mini sidebar 자체를 쓰지 않고 drawer(텍스트 라벨 항상 표시)를 쓰므로 실질적 문제는 아닙니다.
- Sidebar collapse 버튼의 아이콘 방향(‹/»)이 실제로 올바르게 전환되는지는 코드 검토로 확인했으나, 미리보기 스크린샷 생성 과정에서는 일부 정적 HTML에 수동으로 값을 넣어 확인한 것이라 실제 React 상태 전환(클릭 시 실시간 전환)까지 시각적으로 확인하지는 못했습니다.

## 35. 7.2.1 소규모 UI 보정 — 폭 확대, pink-white 배경, Google 프로필

### A. 수정 파일
`src/styles/theme.css`(토큰 값 2개만 수정), `src/pages/Home.css`(max-width 1곳), `src/components/Sidebar.jsx`(사용자 영역만), `src/components/Sidebar.css`(사용자 영역 스타일만). **`Home.jsx`/`App.css`/`HomeQuickAssistant.jsx`/`BriefingSection.jsx`는 이번엔 전혀 건드리지 않았습니다**(diff에 나타나지 않음, md5로도 확인).

### B. Home/main max-width
기존 `1320px` → **`1400px`**(요청하신 1360~1420px 범위 안). 카드 내부가 휑해지지 않는 선에서, 권장 범위의 중간값을 선택했습니다.

### C. 전체 background
기존 `--paper: #faf7f0`(warm ivory/beige) → **`#fffafb`**(soft pink-white, 요청하신 1순위 기준색과 동일). **하드코딩을 여러 곳에 추가하지 않고, 기존 `--paper` 토큰 값 하나만 바꿔서 이 토큰을 쓰는 모든 곳(body, `.app-main`, 그리고 아직 자체 배경을 갖지 않은 다른 페이지들)에 자동으로 반영**되게 했습니다. 기존 Home 전용 토큰이었던 `--bg-main`도 같은 값(`#fffafb`)으로 통일해 두 토큰이 다시 갈라지지 않게 했습니다.

### D. beige/yellow undertone 제거 범위
`body`(→`--paper`), `#root`/`html`(별도 배경 없이 `body` 상속), `.app-main`(→`--paper`), `.home`(→`--bg-main`) 전부 확인해 새 값으로 자동 반영됨을 코드로 확인했습니다. `--paper-line`(줄 색상, `#e3ddcd`)은 배경이 아니라 구분선 색이라 **요청하신 "카드 내부 색 일괄 변경 금지" 원칙에 따라 그대로 뒀습니다.**

### E. card background와 main background 관계
`--bg-card: #ffffff`(무변경) vs 새 `--paper`/`--bg-main: #fffafb` — 거의 흰색이지만 미세하게 다른 두 값이라 카드와 배경이 자연스럽게 구분되면서도 튀지 않습니다. Sidebar(`--bg-sidebar: #fceff2`, 무변경)가 그보다 확실히 더 진한 blush라 계층이 자연스럽게 생깁니다(요청하신 4단계 구조 그대로).

### F. Sidebar profile UI 구조
`SidebarContent`의 사용자 영역을 재작성했습니다: 펼침 상태는 `avatar + (이름 + 로그아웃)`이 `.sidebar__profile`(flex row)로 하나처럼 묶여 보이고, 로그아웃은 큰 버튼 대신 작은 밑줄 텍스트 링크로 가벼워졌습니다. 축소 상태는 avatar(hover 시 tooltip) + 그 아래 작은 원형 로그아웃 아이콘 버튼(`.sidebar__signout-icon`, 자체 tooltip)입니다. **Mobile drawer는 같은 `SidebarContent`를 그대로 재사용**하므로 별도 markup 없이 동일하게 적용됩니다.

### G. Firebase Auth에서 사용한 user field
`user.displayName`, `user.photoURL` — `AuthContext.jsx`가 `onAuthStateChanged`의 `firebaseUser`를 그대로 state에 저장하고 있어(코드로 확인), Firebase User 객체가 기본으로 제공하는 이 두 필드를 **그대로** 읽었습니다. 새 Google API 호출이나 Context 수정 없음.

### H. Google profile image 표시 방식
신규 작은 `Avatar` 컴포넌트가 `user.photoURL`이 있으면 `<img src={user.photoURL} />`를 그대로 렌더링합니다(원형, `object-fit:cover`, 펼침 38px/축소 32px). Firebase Storage/Firestore에 저장하지 않고 매번 Firebase Auth의 값을 그대로 읽어 표시합니다.

### I. photoURL이 없을 때 fallback
`user.displayName`의 첫 글자를 soft-pink 원형 배경 위에 표시합니다(`"홍길동" → "홍"`). displayName도 없으면 기존 `IconUser` 아이콘으로 최종 fallback합니다 — 이름을 하드코딩하지 않았습니다.

### J. image load 실패 fallback
`<img onError={() => setImgError(true)}>`로 로딩 실패를 감지하면 즉시 이니셜 fallback으로 전환합니다(복잡한 캐시 시스템 없이 컴포넌트 로컬 `useState` 하나로 처리).

### K. "선생님" 이름 표현 방식
`` `${user.displayName} 선생님` `` — displayName이 없으면 "선생님"만 표시합니다(하드코딩된 이름 없음). 별도의 기존 이름 처리 helper는 프로젝트에 없어서 새로 만들지 않고 인라인 템플릿 리터럴로 최소 구현했습니다.

### L. logout UI 변경
버튼 스타일(테두리 박스 → 밑줄 텍스트/축소 시 작은 아이콘)만 바꿨고, **`onClick={signOutUser}` 핸들러는 정확히 그대로**입니다(코드 한 글자도 안 바뀜).

### M~O. Desktop 펼침/축소, Mobile drawer profile 결과
Playwright로 실제 CSS/DOM 구조 그대로 렌더링해 확인했습니다:
- **펼침**: 프로필 사진(테스트용 placeholder 이미지) 원형 표시, "홍길동 선생님" + 밑줄 "로그아웃" 정상, 배경이 이전보다 확실히 더 흰색에 가까운 pink-white로 바뀜을 확인
- **fallback(사진 없음)**: "홍" 이니셜 아바타 정상 표시
- **축소(72px)**: 아바타만 남고 그 아래 작은 원형 로그아웃 아이콘 정상, **Home 2열 유지** 재확인

### P. Sidebar 기존 collapse/drawer 기능 무변경 여부
`localStorage` 저장 로직, `mobileOpen` state, drawer 닫기 4조건, 메뉴 아이콘/selected state/tooltip 전부 **한 글자도 수정하지 않았습니다** — 이번엔 사용자 영역(`sidebar__user` 안쪽)만 건드렸습니다.

### Q. Home 기능 무변경 여부
`Home.jsx`를 이번엔 전혀 열지도 않았습니다 — 오늘 수업 pill/divider/날짜 블록/AI bubble/주요 확인 layout/전체보기 링크/수업 진도/summary pill 구조 **전부 7.2 그대로**입니다.

### R. 핵심 기능 파일 무변경 확인
md5 비교로 확인: `effectiveTimetable.js`, `remainingLessons.js`, `timetableChangeService.js`, `calendarApi.js`, `googleAuth.js`, `GoogleCalendarContext.jsx`, `calendarEligibility.js`, `toolExecutors.js`, `tools.js`, `firestore.rules`, **`HomeQuickAssistant.jsx`** — 전부 이전과 완전히 동일합니다.

### S. 테스트 결과
기존 19 suites/170 tests + Sidebar 신규 6개 = **총 20벌(176개) 전체 재실행, 전부 PASS**.

### T~U. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### V. 실제 Firebase Google profile 사진 검증 여부
**실제 Firebase 로그인 환경에서는 검증하지 못했습니다.** `photoURL` 사용 코드, fallback 코드, `onError` 처리까지는 실제 placeholder 이미지 URL로 Playwright 렌더링 검증을 마쳤지만, **실제 Google 계정의 진짜 사진이 정상적으로 뜨는지는 미검증**입니다 — 요청하신 대로 가짜 photoURL을 production 코드에 넣지 않았고(코드에는 어떤 URL도 하드코딩되어 있지 않습니다), 실제 로그인 후 확인 부탁드립니다.

### W. 남아 있는 UI 문제
- 실제 Google 프로필 사진 표시 자체는 미검증(위 V 참고)
- Sidebar 배경(`--bg-sidebar`)과 새 main 배경(`--paper`)의 차이가 이전보다 더 뚜렷해졌는지는 실제 화면에서 최종 확인 부탁드립니다 — 스크린샷상으로는 자연스러운 단계가 보입니다
- 다른 8개 페이지도 이제 `--paper` 값 변경의 영향을 받아 배경이 pink-white로 바뀝니다(의도된 동작) — 다만 이 페이지들의 다른 요소(테두리, 아이콘 색 등)가 새 배경과 잘 어울리는지는 각 페이지를 직접 열어보지 못해 확인하지 못했습니다.

## 36. Home 상단 header decoration 보정 — 사각형 배너 → 인사말 중심 은은한 glow

### 1. 수정 파일
`src/pages/Home.css` **단 하나입니다.** React 컴포넌트/기능 파일은 전혀 건드리지 않았습니다.

### 2. 기존 gradient 구현 방식
`.home__head-decor`가 `.home__head`(position:relative)의 **오른쪽 위**(`inset: -20px -20px auto auto`)에 고정 크기(260×200px)로 떠 있었고, `radial-gradient(circle at 70% 20%, var(--accent-soft) 0%, transparent 70%)` + `opacity:0.5`였습니다. 인사말(`.home__head-text`, 왼쪽)과는 무관한 위치라 별도의 사각형 배너처럼 보였습니다.

### 3. 변경한 radial glow 구현 방식
같은 요소(`.home__head-decor`)를 그대로 유지하되(새 컴포넌트/pseudo-element 추가 없이 CSS만 수정):
```css
.home__head-decor {
  position: absolute;
  top: -70px;
  left: -90px;
  width: 640px;
  height: 380px;
  background: radial-gradient(
    ellipse 50% 50% at 32% 38%,
    var(--accent-soft) 0%,
    rgba(243, 217, 224, 0.35) 32%,
    transparent 62%
  );
  opacity: 0.4;
  pointer-events: none;
  z-index: 0;
}
```
`pointer-events:none`/`z-index:0`(텍스트는 기존처럼 `.home__head-text`의 `z-index:1`이 위에 있음)은 그대로 유지했습니다.

### 4. glow 중심 위치
인사말이 있는 **왼쪽 영역**을 기준으로 옮겼습니다(`left:-90px`, ellipse 자체도 박스 안에서 `at 32% 38%`로 왼쪽-위쪽에 치우치게 설정) — 기존의 "오른쪽 위 고정" 위치를 버렸습니다.

### 5. glow 크기/opacity
박스를 260×200 → **640×380**으로 크게 키워서 gradient가 박스 경계에 닿기 훨씬 전에 이미 `transparent`가 되도록 했고, `opacity`도 `0.5 → 0.4`로, 그리고 gradient 자체에 중간 stop(`rgba(...,0.35) 32%`)을 추가해 더 부드럽게 3단계로 사그라들게 했습니다. Mobile(640px 이하)에서는 완전히 숨기던 것을 **크기(320×220)와 opacity(0.28)를 더 낮춰 축소해서 남기는 방식**으로 바꿨습니다(요청하신 "화면 전체를 덮지 않되 은은하게 남도록").

### 6. 직사각형 boundary 제거 여부
**제거했습니다.** 실제 Playwright 스크린샷(아래 7~9)으로 확인한 결과, 이전에 뚜렷하게 보이던 오른쪽 위 사각형 핑크 영역이 사라졌고, 인사말 주변에만 아주 옅은 온기가 자연스럽게 번지는 정도로 보입니다. `.home`에 `overflow-x: hidden`을 추가로 넣어(박스가 `left:-90px`로 왼쪽 바깥까지 살짝 걸치므로) 어떤 화면 폭에서도 가로 스크롤이 생기지 않게 안전장치를 뒀습니다 — 실제로 390px 폭에서 `document.documentElement.scrollWidth === clientWidth`(390=390)임을 Playwright로 직접 측정해 확인했습니다.

### 7~9. Desktop 펼침/축소/Mobile 결과
Playwright로 실제 CSS/DOM 그대로 렌더링해 확인했습니다:
- **Desktop 펼침**: 오른쪽 위 사각형 사라짐, 헤더 확대 스크린샷에서 인사말 뒤쪽에만 은은한 blush가 자연스럽게 번지고 경계 없이 사라짐을 확인
- **Desktop 축소(Sidebar 72px)**: glow가 header 기준 상대 위치라 인사말과 함께 자연스럽게 이동함(viewport 기준이 아님을 확인) — 엉뚱하게 오른쪽에 남지 않음
- **Mobile(390px)**: 화면 전체를 덮지 않고 인사말 주변에만 옅게 남음, 가로 스크롤 없음(수치로 확인)

### 10. 다른 Home UI 무변경 여부
`.home__head-decor`/`.home`(overflow-x 한 줄) 외에는 **아무것도 수정하지 않았습니다** — 오늘 수업/교시 pill/다가오는 일정/날짜 블록/AI 카드/수업 진도/2열 layout/max-width(1400px 그대로) 전부 무변경입니다.

### 11. Sidebar 무변경 여부
`Sidebar.jsx`/`Sidebar.css`는 이번엔 아예 열지도 않았습니다(diff에 전혀 나타나지 않음).

### 12. 기능 파일 무변경 여부
`Home.jsx`, `HomeQuickAssistant.jsx`를 포함해 이번 요청에서 언급된 모든 React 로직 파일이 완전히 무변경입니다 — 수정한 것은 `Home.css` 하나뿐입니다.

### 13. 테스트 결과
기존 20벌(176개, 계산 로직 전부) 전체 재실행 — **전부 PASS**(이번 작업이 CSS 장식만 건드렸으므로 당연한 결과).

### 14. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

## 37. 로그인 화면 UI를 Soft Pink Assistant로 통일

### A. 실제 수정 파일
`src/pages/Login.jsx`, `src/pages/Login.css` **두 개뿐입니다.**

### B. 기존 로그인 화면 component/CSS 구조
`Login.jsx`(단일 컴포넌트, `signInWithGoogle`을 import해 버튼에 연결) + `Login.css`. 중복 컴포넌트가 없어 그대로 재사용했습니다.

### C. dark green이 어디서 적용되고 있었는지
`.login { background: var(--board); }`(전체 배경)와 `.login__button { background: var(--board); }`(버튼) 두 곳이었습니다. `.login__mark`는 `background: var(--ink)`(검은 사각형 장식)였습니다.

### D. 변경된 background/token
`.login`의 배경을 `var(--board)` → **`var(--bg-main)`**(요청하신 대로 기존 Home 전용 토큰을 그대로 재사용, 새 하드코딩 없음 — 지난 턴에 `#fffafb`로 이미 통일해둔 값입니다)로 변경했습니다. 카드는 `var(--paper)` → `var(--bg-card)`(흰색), 버튼은 `var(--board)` → `var(--accent)`(rose)로 바꿨습니다.

### E. Login card 크기 및 구조
`width: min(90vw, 460px)`(요청하신 440~500px 범위 안), `border-radius: 20px`, `padding: 48px 44px`, `border: 1px solid var(--border-soft)` + `box-shadow: var(--shadow-soft)`. 검은 사각형(`.login__mark`)은 완전히 제거하고 제목의 🌷 이모지로 충분히 대체했습니다.

### F. soft glow 구현 방식
카드 뒤에 `.login__glow`(620×620 원형, `radial-gradient` + `opacity:0.45`)를 두고, `.login`에 `overflow:hidden`을 걸어 어떤 화면 크기에서도 경계나 overflow가 생기지 않게 했습니다 — Home 헤더 glow와 동일한 원칙(큰 크기로 경계 전에 완전히 투명해지게)을 재사용했습니다.

### G. "오늘의 업무비서" 제거 여부
**완전히 제거했습니다.** 코드 전체에서 이 문자열을 검색해도 더 이상 나타나지 않습니다.

### H~J. 최종 브랜드 문구
제목: `솔쌤 AI 비서 🌷` / subtitle: `선생님의 하루를 함께해요.` / description: `수업부터 일정과 업무까지, 필요한 정보를 한곳에서 관리해보세요.` — 요청하신 문구 그대로, **JSX에 `<br>`를 전혀 쓰지 않고 각각 하나의 문자열**로 넣었습니다(CSS `word-break: keep-all`이 자연스럽게 줄바꿈을 처리).

### K. Google login button 디자인 변경
배경만 `var(--accent)`(rose)로 바꾸고 텍스트("Google 계정으로 시작하기")는 그대로 유지했습니다. 새 Google 로고 asset은 추가하지 않았습니다(텍스트만으로 충분하다는 지침 그대로).

### L. Google login handler 무변경 여부
**확인 완료.** `src/firebase/authService.js`는 diff/md5로 완전 무변경입니다. `Login.jsx`도 `onClick={signInWithGoogle}` 연결 방식 그대로입니다.

### M. 한국어 keep-all 적용 방식
`.login__title`/`.login__subtitle`/`.login__description` 전부 `word-break: keep-all; overflow-wrap: break-word;` 적용. `text-wrap: pretty` 같은 보조 속성은 브라우저 호환성을 고려해 추가하지 않았습니다(핵심인 keep-all만으로 충분히 자연스러운 결과를 확인했습니다).

### N. 강제 `<br>` 사용 여부
**전혀 없습니다.** 기존에 있던 `<br />` 하나(부제 안)도 이번에 제거했습니다.

### O~P. 실제 렌더링 결과
Playwright로 실제 CSS/DOM 그대로 렌더링해 확인했습니다:
- **Desktop(1440px)**: dark green 완전히 사라짐, 검은 사각형 사라짐, 카드가 화면 중앙에 안정적으로 위치, glow가 경계 없이 카드 뒤로 은은하게 퍼짐, 문장이 자연스러운 지점에서 줄바꿈(단어 중간 분리 없음)
- **Mobile(390px)**: 카드가 화면 안에 안전하게 들어옴, `scrollWidth(390) === clientWidth(390)`로 가로 스크롤 없음을 수치로 확인, 제목/설명/버튼 텍스트 전부 단어 단위로만 줄바꿈

### Q. 실제 Google OAuth 검증 여부
**검증하지 못했습니다.** 이 환경에서는 실제 OAuth 플로우를 수행할 수 없어, `signInWithGoogle` 핸들러가 버튼에 정확히 연결되어 있고 무변경임을 코드로 확인하는 데 그쳤습니다 — 실제 로그인 성공 후 Home 이동은 실사용 확인이 필요합니다.

### R~S. Home/Sidebar 무변경 여부
**둘 다 이번엔 전혀 열지도 않았습니다.** `Home.jsx`/`Home.css`/`HomeQuickAssistant.jsx`/`BriefingSection.jsx`/`Sidebar.jsx`/`Sidebar.css` 전부 diff에 나타나지 않습니다 — 이번 턴에 수정된 파일은 `Login.jsx`/`Login.css` 둘뿐입니다.

### T. 핵심 기능 로직 무변경 여부
Firebase Authentication 설정, Google sign-in 방식, Auth state 관리, Google Calendar OAuth, Firestore, App Check, AI 기능 — 전부 이번 작업 범위 밖이라 손대지 않았습니다.

### U. 전체 테스트 결과
기존 20벌(176개) 전체 재실행 — **전부 PASS**.

### V~W. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### X. 남아 있는 UI 문제
- 실제 Google OAuth 로그인 자체는 미검증(위 Q 참고)
- 버튼 hover를 `filter: brightness(0.94)`로 구현했는데, 실제 브라우저에서 이 정도 밝기 변화가 "아주 미세한 변화"로 자연스러운지는 실제로 눌러봐야 확인 가능합니다
- 다른 페이지(Privacy 등 로그인 게이트를 거치지 않는 공개 페이지)의 디자인은 이번 범위 밖이라 그대로입니다

## 38. 초록 loading 화면 수정 + Google 로그인 오류 처리 추가

### 1. 수정 파일
`src/App.jsx`, `src/App.css`, `src/pages/Login.jsx`, `src/pages/Login.css`. **`src/firebase/authService.js`는 diff/md5로 완전 무변경 확인**(`signInWithGoogle`/`signInWithPopup` 자체는 한 글자도 안 바뀜).

### 2. 초록 화면의 정확한 원인
말씀하신 그대로였습니다 — `App.jsx`의 `if (loading) return <div className="app-loading">불러오는 중…</div>`와 `App.css`의 `.app-loading { background: var(--board); }`(`--board: #2b3a32`, 옛 dark green 사이드바 색)가 원인이었습니다. Firebase Auth가 로그인 상태를 복원하는 그 짧은 시간 동안 이 화면이 보였습니다.

### 3. loading 화면 변경 내용
`.app-loading`의 `background`를 `var(--board)` → **`var(--bg-main)`**으로 변경했습니다(새 하드코딩 없이 기존 Soft Pink 토큰 재사용). 내용도 "불러오는 중…" 단독 텍스트에서 요청하신 대로 `🌷 / 솔쌤 AI 비서 / 불러오는 중…` 3줄 구조로 바꿨습니다. **새 dependency, 애니메이션 라이브러리, spinner 전부 추가하지 않았습니다** — 순수 텍스트+이모지, CSS `flex-direction:column`만 사용했습니다.

### 4. signInWithGoogle 함수 자체 변경 여부
**전혀 변경하지 않았습니다.** `authService.js`를 diff/md5로 확인한 결과 기존 파일과 완전히 동일합니다 — `signInWithPopup(auth, googleProvider)` 방식 그대로입니다. `signInWithRedirect`로 바꾸거나 Firebase config/GoogleProvider/OAuth scope/authDomain/App Check 중 어느 것도 건드리지 않았습니다.

### 5. Login button handler 변경 내용
`Login.jsx`에 요청하신 정확한 구조로 `handleGoogleSignIn`을 추가했습니다:
```js
async function handleGoogleSignIn() {
  if (signingIn) return; // 중복 클릭 방지
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
```
버튼은 `onClick={handleGoogleSignIn}`, `disabled={signingIn}`으로 연결했고 로그인 중에는 "로그인 중…"으로 문구가 바뀝니다. 대표 오류 코드 3가지(`auth/popup-closed-by-user`, `auth/popup-blocked`, `auth/unauthorized-domain`)는 요청하신 문구 그대로 매핑했고, 그 외는 공통 안내 문구("Google 로그인 중 문제가 발생했습니다. 다시 시도해주세요.")로 처리합니다. **개발자 console에는 항상 `error.code`와 `error.message`를 그대로 남기고, 사용자 화면에는 기술적 원문을 노출하지 않습니다.**

### 6. 실제 로그인 테스트 여부
**실제 Google OAuth 로그인 자체는 이 환경에서 수행하지 못했습니다.** 대신 실제 CSS/DOM 구조를 그대로 쓴 정적 HTML을 Playwright로 렌더링해 ① 새 loading 화면이 더 이상 초록색이 아님 ② 로그인 카드 안에 오류 메시지가 올바른 스타일(연한 coral 배경 박스)로 표시됨을 스크린샷으로 확인했습니다 — 이건 UI 표시 확인이지, 실제 Google 팝업이 뜨고 인증이 성공/실패하는 과정 자체를 검증한 것은 아닙니다.

### 7~8. 실패 시 Firebase error.code / error.message
**해당 없음 — 실제 로그인 시도 자체를 못 했으므로 실제 오류 코드도 발생하지 않았습니다.** 미검증입니다.

### 9. build/lint/test 결과
`npm run build`: 성공. `npm run lint`: **0 error**(warning 2건은 기존부터 있던 것, 무관). 기존 회귀 테스트 20벌(176개) 전체 재실행 — **전부 PASS**(이번 작업이 계산 로직을 전혀 건드리지 않았으므로 당연한 결과).

### 참고 — 이번 작업에서 손대지 않은 것
Home, Sidebar, Google Calendar OAuth, Firestore, timetable/progress/tasks/events/notices, AI, App Check, Firebase configuration — 요청하신 대로 전부 무변경입니다(diff/md5로 확인).

## 39. Browser title/favicon 정리 + AI 비서 페이지 UI 개선

### A. 작업 전 AI 비서 구조 분석
`AssistantPage.jsx`: `chatRef`(useRef, `startAssistantChat()`로 지연 생성) + `messages`(`{role, text, toolCalls?, piiMasked?, error?, local?}` 배열 state) + `handleSubmit`이 ① `tryLocalQuery` 시도 ② 없으면 `sendAssistantMessage(chat, uid, text, {getValidAccessToken, connect})` 호출 ③ 응답을 `messages`에 추가하는 구조입니다. **자동 스크롤 기능은 기존에 전혀 없었습니다**(추가 확인). Home의 `HomeQuickAssistant.jsx`와는 완전히 별개의 독립 컴포넌트/독립 세션이며, 이번엔 이 페이지(`AssistantPage.jsx`)만 다뤘습니다.

### B. 실제 수정 파일
`index.html`, `public/favicon.svg`, `src/pages/AssistantPage.jsx`, `src/pages/AssistantPage.css`. **`assistant.js`/`tools.js`/`toolExecutors.js`/`session.js`/`localQueries.js`/`HomeQuickAssistant.jsx`는 md5로 완전 무변경 확인했습니다.**

### C. browser title
"오늘의 업무비서" → **"솔쌤 AI 비서"**(`index.html`의 `<title>`, emoji 없음). 코드 전체를 검색해 다른 곳에서 동적으로 title을 설정하는 코드나 옛 이름의 잔존이 없음을 확인했습니다.

### D. favicon
기존 보라색 번개(`#863bff` 계열, 복잡한 blur filter/gradient 다수) → **직접 그린 단순 SVG 태양**(중앙 원 + 8개의 짧은 직선 햇살, `#C96F86` 단색, gradient 없음, `viewBox 48x48`). 외부 사이트에서 내려받지 않고 코드로 직접 작성했습니다. **브라우저가 기존 favicon을 캐시하고 있을 수 있어, 실제 확인 시 hard refresh(또는 캐시 삭제)가 필요할 수 있습니다.**

### E. AI page width
`.assistant-page`의 `max-width`를 640px → **980px**(요청하신 900~1100px 범위 안)로 확대했습니다.

### F. Header 변경
"AI 비서" → **"AI 비서 🌷"**, 긴 예시 포함 설명 문단을 "무엇이든 편하게 말씀해보세요. 일정, 업무, 수업과 시간표까지 솔쌤 AI 비서가 함께 정리해드려요."로 간소화했습니다(하나의 문자열, `<br>` 없음).

### G. 개인정보 안내 변경
"⚠️ 학생 개인정보나 민감한 상담 내용은..."(주황 텍스트) → **"🔒 학생 개인정보나 민감한 상담 내용은 입력하지 말아 주세요."**를 옅은 blush 배경의 작은 box로 변경했습니다 — 요청하신 대로 **error 스타일(`.bubble--error`, coral 계열)과는 시각적으로 확실히 다르게** 구분했습니다(안내는 accent-soft/블러시, 오류는 danger-soft/coral).

### H. Empty state
"아직 대화가 없습니다. 궁금한 것을 말씀해 보세요." → **🌷 + "아직 대화가 없어요. 아래에서 편하게 말을 걸어보세요." + quick prompt 4개**로 확장했습니다.

### I. Quick prompt
**구현했습니다**(오늘 일정 알려줘 / 이번 주 업무 알려줘 / 수업 진도 확인 / 시간표 변경). **기존 전송 로직을 그대로 재사용**합니다 — `handleSubmit`이 하던 일(`tryLocalQuery` → `sendAssistantMessage` → 동일한 `messages` 구조 반영 → 동일한 에러 처리)을 `sendText(text)`라는 함수로 뽑아냈고, 폼 제출과 quick prompt 클릭 **둘 다 이 함수 하나만 호출**합니다 — 새 AI 호출 코드는 어디에도 없습니다. 대화가 시작되면(`messages.length > 0`) quick prompt는 더 이상 렌더링되지 않습니다.

### J~K. User/AI bubble
User: `var(--accent-soft)` 배경, 오른쪽 정렬. AI: `var(--bg-card-soft)` + 옅은 border, 왼쪽 정렬. 둘 다 `border-radius:16px`(카카오톡 같은 강한 스타일이 아니라 업무용 톤). 실제 스크린샷으로 확인했습니다.

### L. Composer
input을 pill 형태(`border-radius:999px`)로, send 버튼을 원형 rose 버튼(`var(--accent)`)으로 바꿨습니다 — Home의 `HomeQuickAssistant`와 같은 디자인 언어입니다. 기존 dark green 버튼은 완전히 사라졌습니다.

### M. Send button
아이콘 라이브러리 없이 기존처럼 `➤` 문자를 사용했습니다(요청하신 대로 새 icon library 미설치).

### N. 한국어 keep-all
새/수정된 모든 텍스트 요소(`title`/`desc`/`notice`/empty text/quick prompt/bubble/hint)에 `word-break: keep-all; overflow-wrap: break-word;` 적용. `break-all`/강제 `<br>` 없음.

### O. scroll behavior 보존 여부
**기존에 자동 스크롤 자체가 없었습니다**(A 항목 참고) — 이번에 `bottomRef` + `useEffect(() => bottomRef.current?.scrollIntoView(...), [messages, loading])`를 **새로 추가**했습니다. "기존 걸 보존"이 아니라 "채팅 화면다운 최소 기능을 새로 더한 것"이라 명확히 구분해 보고드립니다 — 복잡한 스크롤 시스템은 아니고 표준적인 `scrollIntoView` 한 줄입니다.

### P. AI loading/error UI
로딩 문구를 "생각하는 중…" → **"솔쌤 AI 비서가 확인하고 있어요…"**로 바꿨습니다(로직 무변경, 텍스트만). 에러 발생 시 표시되는 문구/조건(`m.error`)은 기존 그대로이고, 스타일만 `.bubble--error`(soft coral)로 다듬었습니다.

### Q. 후속 선택 session 보존 여부
**보존했습니다.** `chatRef`/`getChat()` 로직을 전혀 건드리지 않았고, `sendText`도 기존 `handleSubmit`의 순서(로컬 답변 우선 → 같은 `chat` 세션으로 `sendAssistantMessage`)를 그대로 유지합니다 — "9월 15일 구글 캘린더..." → "1번" 같은 흐름이 같은 세션으로 이어집니다(코드 검토로 확인, 실제 Gemini 호출은 미검증).

### R~T. Google Calendar/시간표/진도 AI 기능 무변경 여부
`tools.js`/`toolExecutors.js`/`assistant.js`를 전혀 열지 않았습니다(md5로 완전 무변경 확인) — tool 목록, 실행기, systemInstruction 전부 그대로입니다.

### U. HomeQuickAssistant 무변경 여부
**확인 완료.** md5가 이전과 완전히 동일합니다 — 이번 작업 내내 이 파일을 한 번도 열지 않았습니다.

### V. Home/Login/Sidebar 무변경 여부
세 파일 모두 diff에 나타나지 않습니다 — 이번엔 손대지 않았습니다.

### W. 핵심 기능 파일 무변경 확인
`effectiveTimetable.js`, `remainingLessons.js`, `timetableChangeService.js`, `calendarApi.js`, `googleAuth.js`, `GoogleCalendarContext.jsx`, `calendarEligibility.js`, `firestore.rules` — 전부 md5로 기존과 동일함을 재확인했습니다(이번 작업에서 아예 열지 않았습니다).

### X~Y. Desktop/Mobile 실제 렌더링 결과
Playwright로 실제 CSS/DOM 그대로 렌더링해 확인했습니다:
- **Desktop empty state**: 넓어진 폭(980px), 🌷+안내문+quick prompt 4개가 중앙에 자연스럽게 배치, 이전의 "거대한 빈 공간" 문제 해소
- **Desktop 대화 있음(Google Calendar 후속선택 + 긴 목록 응답 + 에러 시나리오 포함)**: user/assistant bubble 좌우 구분 정상, 여러 줄 목록도 읽기 편하게 표시, 에러 bubble이 시각적으로 구분됨
- **Mobile(390px)**: `scrollWidth === clientWidth`로 가로 스크롤 없음을 수치로 확인, 텍스트 keep-all 정상. **다만 이 특정 모바일 스크린샷은 실제 Sidebar 컴포넌트 대신 단순화한 자리표시자(placeholder) div를 썼기 때문에, 상단에 실제로는 나타나지 않는 빈 핑크 영역이 보입니다** — 이건 이번 테스트 파일의 단순화 때문이지 실제 앱 동작이 아닙니다(실제 Sidebar의 모바일 hamburger/hide 동작은 지난 7.2 턴에서 이미 별도로 검증되어 있습니다).

### Z. 실제 AI 기능 테스트 결과
**실제 Firebase/Gemini/Google Calendar 환경에서는 검증하지 못했습니다.** A~G(오늘 일정/업무/진도/시간표변경/Google Calendar 조회+가져오기/일반 대화) 전부 **미검증**입니다 — 코드 레벨에서 `sendText`가 기존 `sendAssistantMessage`/`chatRef`를 그대로 사용하도록만 확인했고, 실제 응답 내용이나 tool calling 동작 자체는 이 환경에서 실행할 수 없었습니다. 성공했다고 추측하지 않습니다.

### AA. 전체 테스트 결과
기존 20벌(176개) 전체 재실행 — **전부 PASS**.

### AB~AC. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### AD. 남아 있는 문제
- 실제 AI 기능(Google Calendar 후속선택 포함) 자체는 미검증 — 실사용 확인 필요
- favicon 교체는 브라우저 캐시 때문에 hard refresh가 필요할 수 있음(위 D 항목)
- 자동 스크롤은 이번에 새로 추가한 것이라, 실제 브라우저에서 여러 메시지를 빠르게 주고받을 때 스크롤 타이밍이 자연스러운지는 실사용으로 확인 권장
- Mobile 스크린샷은 단순화한 sidebar placeholder를 썼다는 한계가 있음(위 Y 참고)

## 40. Home "다가오는 일정" 카드에 일정/업무 탭 추가

### A. 수정 전 Home의 업무 관련 구조 분석
Home.jsx는 이미 `deriveOverdueTasks`/`deriveTodayDueTasks`/`deriveUpcomingTasks`(전부 `briefingDerive.js`, 무변경)로 `data.overdueTasks`/`data.dueTasks`/`data.upcomingTasks`를 계산해 두고 있었지만, **"업무" 전용 독립 카드는 7.1 단계에서 이미 제거**되어 있었고 `dueTasks`/`overdueTasks`는 "오늘의 주요 확인"에서만 쓰이고 있었습니다. `data.upcomingTasks`(오늘 이후~7일 이내 미완료 업무)는 계산은 되지만 **어디에도 렌더링되지 않는 미사용 데이터**였습니다 — 이번에 이 값을 실제로 화면에 연결했습니다.

### B. 실제 업무 데이터 field
`TasksPage.jsx`/`taskUrgency.js`/`briefingDerive.js`를 확인한 결과 실제 필드명은: **`dueDate`**(마감일), **`completed`**(boolean, 완료 여부), **`title`**(제목) — 추측하지 않고 이미 코드 전체에서 일관되게 쓰이던 이름을 그대로 재사용했습니다.

### C. 기존 다가오는 일정 계산 방식
`deriveUpcomingEvents(allEvents, today, 7)`(오늘 제외, 7일 이내) + Home.jsx 자체에서 날짜/시간순 정렬(지난 턴에 추가) — **이번에 전혀 건드리지 않았습니다.**

### D. 실제 수정 파일
`src/pages/Home.jsx`, `src/pages/Home.css`, `src/components/BriefingSection.css`(헤더에 `flex-wrap:wrap` 한 줄만 추가 — 모바일에서 탭이 자연스럽게 줄바꿈되도록, 다른 카드에는 영향 없음).

### E. 일정/업무 tab 구현 방식
`const [upcomingTab, setUpcomingTab] = useState("events")` — 순수 React local state, Firestore/localStorage/URL 어디에도 저장하지 않습니다. "다가오는 일정" 카드를 기존 `BriefingSection` 재사용 대신 **탭 헤더가 필요해서 이 카드만 직접 마크업**으로 작성했습니다(탭에 따라 "전체 보기" 목적지도 함께 바뀌어야 해서 범용 컴포넌트로는 부자연스러웠습니다).

### F. 기본 tab
`"events"`(일정) — 요청하신 대로 기존 사용 경험 그대로 다가오는 일정이 먼저 보입니다.

### G. 다가오는 업무 filtering 조건
**새 필터링 로직을 만들지 않았습니다.** 이미 존재하는 `data.dueTasks`(오늘 마감, 미완료)와 `data.upcomingTasks`(오늘 이후~7일 이내, 미완료)를 그대로 합쳤을 뿐입니다:
```js
const upcomingTasksForCard = [...data.dueTasks, ...data.upcomingTasks].sort((a, b) =>
  (a.dueDate ?? "").localeCompare(b.dueDate ?? "")
);
```
연체(`overdueTasks`)는 포함하지 않았습니다.

### H. 업무 정렬 기준
요청하신 "가까운 마감일 → 먼 마감일" 순서로 `dueDate` 오름차순 정렬했습니다 — 기존 `sortByPriorityThenDate`(priority 우선)와는 다른 기준이라 이 카드 전용으로 별도 정렬만 추가했습니다(새 유틸 함수를 만들지 않고 인라인 `.sort()`).

### I. 오늘 마감 처리
포함됩니다(`data.dueTasks`가 그대로 합류). 표시 시 `t.dueDate === todayDateString()`이면 날짜 대신 **"오늘"**로 표시합니다.

### J. 연체 업무 처리
**기본적으로 제외**했습니다(`overdueTasks`를 이 카드에 넣지 않음) — "오늘의 주요 확인"에서 이미 다루는 기존 동작을 그대로 유지합니다.

### K. 완료 업무 처리
`dueTasks`/`upcomingTasks` 둘 다 이미 `!t.completed` 조건으로 걸러진 배열이라 **완료 업무는 자동으로 제외**됩니다(새 조건 추가 불필요).

### L. 마감일 없는 업무 처리
`deriveUpcomingTasks`/`deriveTodayDueTasks` 둘 다 `t.dueDate === today` 또는 `t.dueDate > today` 비교라 **`dueDate`가 없는 업무는 애초에 걸리지 않습니다**(자동으로 제외).

### M. Home 표시 개수
기존 "다가오는 일정"에는 표시 개수 제한이 전혀 없었습니다(코드 확인) — 이번에 **일정/업무 공통으로 `UPCOMING_DISPLAY_LIMIT = 4`**를 새로 도입해 두 탭 모두 최대 4개까지만 보여주고 나머지는 "전체 보기"로 넘기도록 했습니다.

### N~O. 전체 보기 route
`Link to={upcomingTab === "events" ? "/events" : "/tasks"}` — `App.jsx`에 실제 존재하는 기존 route(`/events`→`EventsPage`, `/tasks`→`TasksPage`) 그대로 사용, 새 route 없음.

### P. 일정 0 / 업무 있음일 때 카드 표시 여부
카드 표시 조건을 `data.upcomingEvents.length > 0 || upcomingTasksForCard.length > 0`(OR)으로 바꿨습니다 — **일정이 0개여도 업무가 있으면 카드가 사라지지 않고, 선택된 탭(일정)에는 "다가오는 일정이 없어요."만 표시되며 업무 탭으로 전환하면 업무를 볼 수 있습니다.** 실제 스크린샷(CASE B)으로 확인했습니다.

### Q. 두 데이터 모두 0일 때 처리
카드 자체가 렌더링되지 않고(AI 비서 카드가 그 행에서 자연스럽게 풀폭이 됨) — 기존 hideWhenEmpty 철학과 일치합니다.

### R~S. Desktop/Mobile 실제 렌더링 결과
Playwright로 실제 CSS/DOM 그대로 렌더링해 확인했습니다:
- **일정 탭(기본)**: 탭이 카드 헤더 아래 자연스럽게 배치, 선택 표시 정상
- **업무 탭**: "오늘"/날짜 블록 + 업무 제목, 같은 divider/typography 재사용해 일정 탭과 시각적으로 일관됨
- **CASE B(일정 0/업무 있음)**: 카드가 사라지지 않고 "다가오는 일정이 없어요." 표시, 업무 탭 전환 가능함을 확인
- **Mobile(390px)**: `scrollWidth === clientWidth`로 가로 스크롤 없음, 탭/날짜 블록/업무 제목 전부 정상 표시

### T. 기존 오늘의 주요 확인 무변경 여부
`priorityItems` 계산 로직은 이번에 한 글자도 건드리지 않았습니다(연체/오늘마감/시간표변경/회의/공지 5종 그대로).

### U. 기존 일정 기능 무변경 여부
`deriveUpcomingEvents`, `EventsPage.jsx`, Google Calendar 동기화 — 전부 무변경(이 파일들을 열지 않았습니다).

### V. 기존 업무 기능 무변경 여부
`TasksPage.jsx`, `taskUrgency.js`, 업무 생성/수정/삭제/완료 처리 — 전부 무변경(열지 않았습니다). Home은 기존 업무 데이터를 읽기만 합니다.

### W~X. HomeQuickAssistant / 독립 AI 비서 페이지 무변경 여부
둘 다 이번엔 전혀 열지 않았습니다 — md5로 무변경 확인.

### Y. 핵심 기능 파일 무변경 확인
`effectiveTimetable.js`, `remainingLessons.js`, `timetableChangeService.js`, `calendarApi.js`, `googleAuth.js`, `GoogleCalendarContext.jsx`, `calendarEligibility.js`, `assistant.js`, `tools.js`, `toolExecutors.js`, `firestore.rules` — 전부 md5로 기존과 동일 확인.

### Z. 전체 테스트 결과
기존 20벌(176개) + 이번에 추가한 CASE A~I 검증 테스트(7개) = **21벌(183개), 전체 재실행 전부 PASS**.

### AA~AB. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### AC. 남아 있는 문제
- `UPCOMING_DISPLAY_LIMIT = 4`는 제가 임의로 정한 값입니다 — 실제 화면에서 AI 카드와의 균형을 보고 3 또는 5로 조정하고 싶으시면 말씀해 주세요.
- 실제 Firestore 데이터로 CASE A~I를 전부 확인한 것은 아니고, 계산 로직만 node로 검증했고 화면 표시는 정적 스크린샷으로 확인했습니다 — 실제 로그인 후 다양한 실제 데이터로 확인 부탁드립니다.

## 41. 시간표 페이지 Soft Pink 개편 + favicon 캐시 문제 완전 해결

### [favicon — 이번 작업의 필수 항목]

**Z. 기존 보라색 번개 favicon의 정확한 출처**
`public/favicon.svg` — 지난 턴에 이미 rose/coral 태양 SVG로 교체했던 바로 그 파일입니다. 파일 내용 자체는 이미 올바르게 바뀌어 있었습니다.

**AA. 왜 이전 변경이 실제 browser에 반영되지 않았는지**
**파일 내용은 맞았지만 URL이 그대로 `/favicon.svg`였습니다.** 브라우저(특히 Chrome)는 favicon을 origin+URL 단위로 강하게 캐시하며, hard refresh로도 잘 갱신되지 않는 경우가 흔합니다 — 파일을 덮어써도 URL이 같으면 브라우저가 예전에 캐시해 둔 아이콘을 계속 쓸 수 있습니다.

**AB. 기존 favicon 참조 위치**
`index.html`의 `<link rel="icon" type="image/svg+xml" href="/favicon.svg" />` 단 한 곳뿐이었습니다(다른 `rel="icon"`/`shortcut icon`/`apple-touch-icon`/manifest/vite.svg 참조는 프로젝트 전체를 검색한 결과 없음).

**AC~AD. 새 favicon 파일명 / index.html 실제 href**
`public/favicon.svg` → **`public/favicon-sun.svg`로 이름 변경**(기존 파일 삭제), `index.html`도 `href="/favicon-sun.svg"`로 변경했습니다.

**AE. cache busting 적용 여부**
쿼리스트링(`?v=2`) 방식은 쓰지 않고 **파일명 자체를 바꾸는 방식**을 선택했습니다(요청하신 "가장 단순하고 안정적인 방법"에 해당 — 완전히 새로운 URL이라 캐시가 원천적으로 적용될 수 없습니다).

**AF. 새 favicon SVG 디자인 설명**
중앙 원(`r=10`, `#C96F86`) + 8방향 직선 햇살(`stroke-width:3.6`, 같은 색) — gradient 없음, 단색, `viewBox 48x48`. 16x16으로 축소돼도 원+햇살 형태가 유지되는 단순 geometry입니다.

**AG~AH. 실제 브라우저에서 favicon href/응답 검증 결과**
`npm run build` → `dist/`를 실제 정적 HTTP 서버로 띄운 뒤 Playwright로 실제 페이지를 열어 확인했습니다:
```
title: 솔쌤 AI 비서
icon href (브라우저가 실제로 resolve한 절대경로): http://localhost:8811/favicon-sun.svg
icon fetch status: 200
아이콘 내용에 circle+line(태양 모양) 포함: True
보라색(#863bff) 포함 여부: False
옛 /favicon.svg 요청 시: 404
```
**"파일을 수정했다"가 아니라 "브라우저가 실제로 새 파일을 요청해서 받는다"까지 확인했습니다.**

**AI. 보라색 번개 icon이 더 이상 참조되지 않는다는 확인**
`public/favicon.svg`(구 파일) 자체를 삭제했고, 삭제 후 그 URL로 요청하면 404가 뜸을 위에서 확인했습니다 — 프로젝트 어디에서도 이 파일을 참조하지 않습니다(참조가 하나였으므로 href를 바꾸고 파일을 지운 것만으로 완전히 정리됩니다). `public/icons.svg`(Bluesky 등 별도 UI 아이콘 스프라이트)는 favicon과 무관해 그대로 뒀습니다.

**AJ. browser title 확인**
"솔쌤 AI 비서" — Playwright로 실제 `page.title()`을 읽어 확인했습니다(위 AG 결과).

### [시간표 페이지 개편]

### A. 기존 시간표 페이지 구조 분석
`TimetablePage.jsx`(1800줄+) 안에 view("mine"/"homeroom") → mineSubTab("basic"/"changes")로 나뉜 구조. 기본 시간표는 이미 `<table className="timetable-grid">`(4곳: 내수업 기본시간표/내수업 가져오기 미리보기/담임 기본시간표/담임 가져오기 미리보기)로 grid 형태였지만, **"예정된 변경"(`ChangeItemCard`)과 "빠른 변경"의 기준 시간표는 `occupied = day.periods.filter(p => p.className || p.cancelled)`로 공강을 걸러낸 뒤 문장(`<p className="list__meta">`) 목록으로만 표시**하고 있었습니다 — 요청하신 문제 그대로였습니다.

### B~D. 데이터 구조
`timetable_overrides`(changeType: swap/move/cancel/add, changeGroupId로 묶음), `school_day_schedules`(status: confirmed/needs_review, scheduleDayOverride) — 지난 턴들에서 이미 확인한 구조 그대로, 이번에도 재확인만 하고 스키마는 건드리지 않았습니다.

### E. effectiveTimetable 재사용 방식
**새 계산을 전혀 만들지 않았습니다.** 기존에 이미 호출되고 있던 `getEffectiveDayTimetable(date, {timetable, timetableOverrides, schoolDaySchedules})`의 결과(`day.periods`)를 그대로 받아, 새로 만든 `MiniTimetable` 컴포넌트가 **표시만** 담당합니다.

### F. 실제 수정 파일
`src/pages/TimetablePage.jsx`(마크업/className/표시 텍스트만, state/계산 함수 무변경), `src/pages/TimetablePage.css`(전체 재작성), `index.html`, `public/favicon-sun.svg`(신규, `public/favicon.svg` 삭제).

### G. 페이지 Header 변경
"시간표 + 긴 안내문" → "시간표 / 수업 시간표를 확인하고 필요한 날짜의 변경 사항을 관리해보세요." 한 줄로 간소화.

### H. 내 수업/담임 시간표 선택 UI
`.btn`/`.btn--ghost` 버튼 2개 → **`.tt-view-switch`**(pill 안의 segmented control, 선택 시 rose 배경). `setView()` 호출 로직은 완전히 동일합니다.

### I. 기본 시간표 디자인 변경
헤더 row/교시 column에 옅은 blush 배경, 셀에 rounded corner, hover 시 blush 배경. **셀 클릭/수정 이벤트 핸들러는 전혀 건드리지 않았습니다.**

### J. 공강 표시
빈 셀의 "＋"는 유지하고, hover 시 CSS `content`로 " 수업 추가"라는 텍스트가 더 붙어 보이도록 했습니다(`::after`, 새 기능 없음, 순수 CSS). 미니 시간표에서는 데이터가 없는 교시를 명시적으로 **"공강"** 텍스트로 표시합니다.

### K. 한국어 keep-all 적용
새로 작성한 CSS 전체(`.mini-timetable__content`, `.change-card__summary`, `.page__desc` 등)에 `word-break: keep-all; overflow-wrap: break-word;` 적용, `break-all`/강제 `<br>` 없음.

### L~N. 예정된 변경 새 디자인 / 전체 교시 표시 / 공강 포함 여부
`MiniTimetable` 컴포넌트가 **하드코딩된 숫자가 아니라 기존 `PERIODS` 상수**(이 파일에서 이미 기본 시간표 grid에도 쓰이던 것, `[1,2,3,4,5,6,7]`)를 순회하며, 각 교시를 `day.periods`에서 찾아 없거나 `className`이 없으면 **"공강"**으로 명시적으로 표시합니다 — 실제 스크린샷(1~6교시 전부 표시, 2·5교시 "공강")으로 확인했습니다.

### O~Q. 요일 변동 / 요일 변동+개인 override / cross-date move 반영 방식
**전부 `getEffectiveDayTimetable()`이 이미 처리한 결과를 그대로 받아 보여줄 뿐**입니다 — UI 컴포넌트 안에 요일 계산/override 계산/cross-date 계산을 다시 구현한 코드는 한 줄도 없습니다(`MiniTimetable`은 `day.periods`를 순회만 함). 따라서 이 세 가지는 기존 `effectiveTimetable.js`의 정확성에 완전히 의존하며, 그 파일은 이번에 전혀 수정하지 않았습니다(md5 확인).

### R. 빠른 변경 기준 시간표의 표 디자인
동일한 `MiniTimetable`을 재사용(`<MiniTimetable day={quickDayTimetable} />`) — 코드 중복 없이 "예정된 변경"과 완전히 같은 컴포넌트/스타일을 공유합니다. **`quickDayOccupiedPeriods`(select 옵션에 쓰이는 기존 변수)는 그대로 유지**, 표시 부분만 교체했습니다.

### S. 빠른 변경 form 디자인
label/select/input/button을 `.timetable-page` 스코프 안에서 rose 톤으로 재스타일링, **맞교환/이동/취소/추가 처리 함수는 전혀 수정하지 않았습니다.**

### T. 시간표 가져오기 디자인
`.form`/`.field`/`.btn`/`.status`를 같은 스코프 CSS로 재스타일링, **`analyzeTimetableDocument`/`analyzeHomeroomTimetableDocument` 호출이나 미리보기/등록 흐름은 전혀 건드리지 않았습니다.**

### U. Mobile 대응
`.timetable-page .page__section`에 `overflow-x: auto`(640px 이하) — **페이지 전체가 아니라 시간표가 들어있는 section 내부만 가로 스크롤**되도록 했습니다. Mobile 스크린샷으로 실제 확인(페이지 자체 `scrollWidth === clientWidth`, 표 안쪽만 넘침).

### V~Y. 기존 기능/파일 무변경 확인
`effectiveTimetable.js`, `remainingLessons.js`, `timetableChangeService.js`, `assistant.js`, `tools.js`, `toolExecutors.js` — **전부 md5로 기존과 완전히 동일함을 확인**했습니다. `TimetablePage.jsx`에 대한 diff도 직접 검토해, 제가 이번에 바꾼 부분이 markup/className/배지 라벨 문자열뿐이고 `useState`/데이터 조회/override 저장 로직은 건드리지 않았음을 확인했습니다.

### 다른 페이지로의 CSS 오염 방지
`.progress-tabs`가 `TimetablePage.css`와 `MonthlyProgressPage.css` 양쪽에 같은 이름으로 존재해 **번들링 시 순서에 따라 진도 페이지 탭 스타일을 의도치 않게 덮어쓸 위험**을 발견해, 이번 시간표 탭은 **`.tt-tabs`라는 고유 클래스**로 새로 만들고 옛 `.progress-tabs` 정의는 삭제했습니다. 그 외 재사용한 공유 클래스(`.btn`/`.form`/`.field`/`.status`/`.badge` 등, `crud-shared.css`)는 전부 **`.timetable-page` 조상 선택자로 범위를 좁혀** 다른 페이지(Events/Tasks/Notices 등)에는 전혀 영향이 없습니다.

### Desktop/Mobile 실제 렌더링 결과
Playwright로 실제 CSS/DOM 구조 그대로 렌더링해 확인했습니다 — 기본 시간표 grid, "예정된 변경"의 요일변동+개인변경 혼합 카드(3교시에 [변경] 배지, 공강 2건 명시), 맞교환 카드, 빠른 변경 기준 시간표, 가져오기 섹션까지 전부 한 화면에서 자연스럽게 이어짐을 확인했습니다.

### 전체 회귀 테스트 결과
기존 21벌(183개) 전체 재실행 — **전부 PASS**.

### build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### 남아 있는 문제
- 실제 Firestore 데이터로 요일변동+개인변경+cross-date move가 섞인 실제 시나리오를 테스트하지는 못했습니다 — 정적 스크린샷과 코드 검토(day.periods를 그대로 표시만 함)로 정확성을 논리적으로 확인했습니다.
- Paperlogy는 이번에도 미적용(공식 asset 없음, 전역 적용 단계에서 예정).
- 담임 학급 시간표 뷰는 별도 스크린샷으로 확인하지 못했지만, 기본 시간표/가져오기와 완전히 같은 공유 클래스를 쓰므로 코드 검토로 동일하게 스타일이 적용됨을 확인했습니다.

## 42. 수업 진도 페이지 정보 구조 재편 + Soft Pink 개편

### A. 수정 전 구조 분석
`MonthlyProgressPage.jsx`(1800줄) 안에 `activeTab`("manage"/"remaining"/"schedule") 하나로 평면적인 3-tab 구조였습니다. 학년/연도/월 selector가 tab과 무관하게 항상 상단에 노출되고, 학사일정 tab에서도 불필요하게 보였습니다.

### B~E. 데이터 구조
`progress_plans`(grade/year/month/title/order/estimatedLessons), `progress_checks`(planItemId/className/completed), `progress_current`(className/planItemId/detail), `progress_history`(className/date/planItemTitle/detail) — 기존 구조 그대로 확인만 했고 전혀 수정하지 않았습니다.

### F~G. remainingLessons/school_day_schedules 연결
`calculateRemainingLessons()` 호출과 그 결과(`remainingResult.total/baseCount/basis/unresolvedSchedules`), `school_day_schedules`의 `confirmed`/`needs_review` 상태 — 전부 기존 그대로 재사용, 새 계산 없음.

### H. 실제 수정 파일
`src/pages/MonthlyProgressPage.jsx`(state 추가 + 마크업 재구성, 계산/저장 함수 무변경), `src/pages/MonthlyProgressPage.css`(전체 재작성).

### [정보 구조]

### I~K. 큰 탭/작은 탭/selector 위치
신규 `mainTab`("progress"/"schedule") state를 추가했습니다. **[진도 관리] [학사일정]**이 큰 탭이고, `mainTab==="progress"`일 때만 담당학년/연도/월 selector(`.pp-context-bar`)와 작은 탭 **[진도 현황] [남은 수업]**(`activeTab`, 기존 상태 재사용)이 보입니다. `mainTab==="schedule"`일 때는 selector/작은탭이 전혀 렌더링되지 않습니다.

### [진도 현황]

### L~N. 진도계획 보기/편집 모드
신규 `isEditingPlan` state로 기본은 번호가 붙은 읽기 전용 목록, "편집" 클릭 시 기존 제목/차시/↑↓/삭제/추가 UI가 그대로 나타납니다. **`savePlanItems`/`addDraftRow`/`moveDraftRow`/`removeDraftRow`는 한 글자도 수정하지 않았고**, 저장 성공 후에만 보기 모드로 자동 전환되도록 한 줄 추가했습니다. "취소"는 새로 추가한 `cancelEditPlan()`이 `draftItems`를 `planItems` 기준으로 다시 계산해 되돌립니다(Firestore 호출 없음 — 애초에 저장 함수를 안 불렀으므로 되돌릴 것도 없습니다).

### O~Q. 체크표/완료·진행중 표시/detail tooltip
체크표는 기존 `toggleCheck`/`isChecked`/`inProgressDetail` 함수와 `<button title={...}>` 방식의 네이티브 tooltip을 그대로 두고 **디자인(rose 헤더, rounded cell)만** 바꿨습니다. 범례(✓ 완료 · ◐ 진행 중 · ○ 예정)를 표 아래에 추가했습니다 — 새 status를 만들지 않고 기존 done/progress 두 상태를 그대로 설명하는 표시입니다.

### R~V. 반별 accordion / 접힌 요약 / 펼친 상세 / 진행중 설정·삭제 / 최근 기록
신규 `expandedProgressClasses`(Set) state로 학급별 펼침 여부를 관리합니다. **접힌 요약**: 짧은 반 이름(`formatClassShortName`) + 상태 한 줄(진행중/완료 + detail) + 남은 개수 + chevron — 모든 반이 동시에 보입니다. **펼친 상세**: 전체 학급명(`formatClassName`), 현재/다음/남은개수/예상차시, 진도 차이 문구, 진행 중 설정/삭제, 최근 기록 — **기존 `openCurrentEditor`/`saveCurrentProgress`/`deleteCurrentProgress`/`toggleHistory`/`startEditHistory`/`saveHistoryEdit`/`deleteHistoryEntry` 전부 그대로 재사용**했습니다(함수 정의를 하나도 바꾸지 않고 렌더링 위치만 accordion 패널 안으로 옮겼습니다). 여러 반 동시 펼침 허용, Firestore/localStorage에 펼침 상태 저장 안 함.

### [남은 수업]

### W~Z. summary 디자인/계산 근거/수동 보정/lesson_adjustments
`remaining-card`(label/value 행: 남은 실제 수업 / 계획상 필요 / 예상 결과)로 재구성 — **`remainingResult` 값을 그대로 표시만 하고 재계산하지 않습니다.** "계산 근거 보기" 토글과 `remainingResult.basis` 표시는 완전히 동일하게 유지했습니다. 수동 보정은 신규 `showAdjustmentForm` state로 기본 접힘 + "+ 보정 추가" 버튼, 펼친 뒤 폼은 기존 필드(날짜/학급/변화량/이유) 그대로입니다. **`submitAdjustment`/`startEditAdjustment`/`removeAdjustment`/`lesson_adjustments` 저장 구조는 전혀 수정하지 않았습니다.**

### [학사일정]

### AA~AF. needs_review/가져오기/직접입력/월별 grouping/accordion/기존 동작 보존
"확인이 필요한 일정"을 `.pp-notice`(soft coral border/bg) 카드로 감쌌습니다. 연간 학사일정 가져오기(`analyzeScheduleFile`)는 무변경. 직접 입력은 신규 `showDirectScheduleForm` state로 기본 접힘("+ 일정 추가"), `renderScheduleForm()` 함수 자체는 손대지 않고 렌더링 여부만 감쌌습니다. 확정된 학사일정은 `confirmedSchedules.reduce(...)`로 **UI에서만** `date.slice(0,7)` 기준 월별 그룹핑(Firestore 쿼리/스키마 변경 없음, 순수 배열 reduce), 신규 `expandedScheduleMonths` state로 월별 펼침/접힘. **`renderScheduleCard()`(확정/제외/수정/삭제 버튼 포함)는 완전히 동일하게 재사용**했습니다.

### [보호 확인]

### AG~AK. 핵심 로직/Firestore 무변경
md5 비교로 확인: `remainingLessons.js`, `effectiveTimetable.js`, `timetableChangeService.js`, `assistant.js`, `tools.js`, `toolExecutors.js`, `systemInstruction.js`, `firestore.rules` — **전부 이전과 완전히 동일**합니다(이번 턴에 아예 열지 않았습니다). `progress_plans`/`progress_checks`/`progress_current`/`progress_history`/`school_day_schedules`/`lesson_adjustments` 데이터 구조도 전혀 변경하지 않았습니다.

### [렌더링]

### AL~AO. Desktop/Mobile/keep-all/overflow
Playwright로 실제 CSS/DOM 구조를 그대로 렌더링해 확인했습니다 — 큰탭/작은탭/context bar/진도계획 보기모드/체크표+범례/반별 accordion(1반 접힘, 2반 펼침 상세) 전부 한 화면에서 자연스럽게 확인했습니다. Mobile(390px)에서는 accordion 요약이 자연스럽게 2줄로 wrap되고(`flex-wrap` 미디어쿼리), `scrollWidth === clientWidth`로 페이지 전체 가로 스크롤 없음을 수치로 확인했습니다. 새로 작성한 CSS 전체에 `word-break: keep-all` 적용, `break-all`/강제 `<br>` 없음.

### [검증]

### AP~AR. 기존 결과 회귀 여부
진도/남은 수업/학사일정 관련 계산 함수(`comparison`, `calculateRemainingLessons`, `analyzeScheduleFile` 등)를 전혀 수정하지 않았으므로, 표시 위치와 마크업만 바뀌었을 뿐 계산 결과 자체는 이전과 동일합니다(코드 레벨로 확인 — 실제 Firestore 데이터로 나란히 비교하는 것은 이 환경에서는 불가능해 미검증입니다).

### AS. 전체 테스트 결과
기존 21벌(183개) 전체 재실행 — **전부 PASS**.

### AT~AU. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**(작업 중 발생한 unused-variable 경고 1건은 즉시 수정 완료), 기존 warning 2건만 유지.

### AV. 남아 있는 문제
- 실제 Firestore 데이터로 CASE A~AB 전체를 직접 클릭하며 확인하지는 못했습니다 — 정적 스크린샷과 함수 재사용 여부 코드 검토로 정확성을 논리적으로 확인했습니다.
- "직접 입력" 폼 제출 성공 후 자동으로 접히지는 않습니다(수동으로 다시 접어야 함) — `renderScheduleForm()`의 제출 로직을 건드리지 않기 위한 의도적 선택입니다.
- Paperlogy는 이번에도 미적용(전역 적용 단계에서 예정).

## 43. 일정/업무 페이지 Soft Pink 개편 + 협의회 type 추가

### [분석]

**A. 기존 EventsPage 구조**: 큰 등록 form이 페이지 최상단에 항상 펼쳐진 채로 있고, 그 아래 구분 필터 + 일정이 하나씩 긴 `.list__row`로 나열되는 구조였습니다.

**B. 기존 event Firestore 구조**: `ownerId, title, date, startTime, endTime, type, customType, status, memo, attending, source, calendarSync, googleCalendarId, createdAt, updatedAt` — 실제 코드(`EventsPage.jsx`)에서 확인, 추측 없음.

**C. 기존 event type 목록**: `constants.js`의 `EVENT_TYPES` **단일 배열**이 유일한 source였습니다 — academic/school/meeting/training/personal/other. `EVENT_TYPE_LABEL`/`eventTypeDisplayLabel`도 전부 이 배열에서 자동 파생됩니다.

**D. 기존 회의 참석 규칙**: `calendarEligibility.js`의 `isCalendarEligible()` — `event.type === "meeting"`일 때만 `attending === true`를 요구, 그 외 type은 항상 eligible.

**E. 기존 Google Calendar eligibility 구조**: `EventsPage.jsx`의 `eligibleNow`가 `isCalendarEligible()`을 그대로 호출, AI 쪽은 `toolExecutors.js`의 `execAddEvent`/`execSyncEventToCalendar`가 동일 함수를 재사용.

**F. 기존 TasksPage 구조**: 큰 등록 form + "미완료 (N)"/"완료 (N)" 두 섹션이 항상 나란히 표시.

**G. 기존 task Firestore 구조**: `title, dueDate, priority, memo, completed, source, createdAt, updatedAt`.

**H. 완료/미완료 판단 방식**: `t.completed`(boolean) 하나로 판단, `toggleCompleted()`가 **이미 양방향**(완료↔미완료) 전환을 지원하고 있었습니다(기존 "미완료로" 버튼이 이미 존재) — 새로 구현할 필요가 전혀 없었습니다.

### [일정 UI]

**I. 수정 파일**: `EventsPage.jsx`(전체 재작성), `EventsPage.css`(신규), `TasksPage.jsx`(전체 재작성), `TasksPage.css`(신규), `constants.js`, `calendarEligibility.js`, `tools.js`, `toolExecutors.js`, `systemInstruction.js`.

**J. Header**: "학사일정, 학교 행사, 회의, 개인 일정을 구분해서 등록합니다..." 긴 설명 → **"학교와 개인 일정을 한곳에서 관리해요."** 한 줄로.

**K. + 일정 추가**: 신규 `showForm` state(React local, 저장 안 함) — 기본은 닫힘, 버튼 클릭 시 기존 form이 그대로 나타남.

**L. form 접기/펼치기**: `submit()`/`startEdit()`/`resetForm()` 로직은 전혀 안 바꾸고, `closeForm()`(resetForm + setShowForm(false))만 추가. 수정 버튼을 누르면 자동으로 form이 열립니다.

**M. 날짜별 grouping**: `visible`(기존 필터링된 배열, 이미 `date+startTime` 오름차순 정렬됨)을 순회하며 같은 `date`면 그룹에 합치는 **순수 배열 reduce** — Firestore 쿼리/구조는 전혀 안 바꿈.

**N. 일정 row 디자인**: `.ep-row`(compact row) — badge + 제목 + 시간/참석여부/메모 한 줄 + Calendar 연동 표시(작은 secondary), 오른쪽에 수정/삭제 텍스트 버튼.

**O. type badge**: `eventTypeDisplayLabel(ev)`(기존 함수 그대로) + `.badge--${ev.type}` — 협의회는 `#efe3ec`/`#9a5f8f`(muted rose-purple)로 회의(rose)와 구분.

**P. filter**: 기존 `filterType` state/필터링 로직 그대로, select만 재스타일링.

**Q. status 표시**: 목록에서 "예정"은 반복 표시하지 않고(`ev.status !== "예정"`일 때만 표시), 완료/취소만 보조 metadata로 노출 — status 필드 기능 자체는 그대로 사용.

**R. Calendar 연동 표시**: "📅 Calendar 연동됨"을 `.ep-row__calendar`(11px, secondary color)로 축소 — 제목보다 강조되지 않게.

### [협의회]

**S. 내부 type value**: **`"council"`** — 기존 영어 소문자 key 컨벤션(academic/school/meeting/training/personal/other) 그대로 따름.

**T. 수정된 type 관련 위치**: `constants.js`(EVENT_TYPES 배열 1곳만 — `EVENT_TYPE_LABEL`/`eventTypeDisplayLabel`는 자동 파생이라 무수정), `calendarEligibility.js`(참석기반 판단 확장), `tools.js`(enum 2곳 + attending 설명 2곳), `toolExecutors.js`(attending 판단 1곳 + 안내 문구 2곳), `systemInstruction.js`(유형 설명 + 참석 규칙 문서). **`documentAnalysis.js`(연간 학사일정 파일 분석의 별도 eventType enum)는 이번 범위(자연어 AI 비서 대화)와 무관한 별개 기능이라 의도적으로 손대지 않았습니다** — 아래 BA 항목에서 다시 설명합니다.

**U~V. 일정 등록/수정**: `EVENT_TYPES` select에 "협의회"가 자동으로 나타나고, `form.type`이 "council"이면 기존 회의와 동일하게 참석 여부 select가 나타납니다(`isAttendanceBasedType = ATTENDANCE_BASED_EVENT_TYPES.includes(form.type)`로 판단 조건만 확장).

**W. filter**: `EVENT_TYPES.map()`으로 자동 생성되는 필터 select에도 "협의회"가 자동 포함.

**X. 목록 badge**: `eventTypeDisplayLabel()`이 자동으로 "협의회" 반환, `.badge--council` 스타일 적용.

**Y. 참석 여부**: `isCalendarEligible({type:"council", attending:true})` → node 테스트로 `true` 확인, `attending:null/false` → `false` 확인(연구 조건 회의와 완전히 동일).

**Z. Google Calendar eligibility**: `calendarEligibility.js`의 `ATTENDANCE_BASED_EVENT_TYPES.includes(event.type)` 판단 — 새 별도 시스템 없이 기존 함수 하나를 확장.

**AA. AI 처리**: `systemInstruction.js`에 "회의(meeting) 또는 협의회(council)일 때... 참석 여부가 불명확하면 attending을 채우지 말고 먼저 되묻는다"로 명시 — 기존 회의 규칙 문구를 그대로 확장.

### [업무 UI]

**AB. + 업무 추가**: 신규 `showForm` state, 기존 form 로직(`submit`/`startEdit`) 무변경.

**AC. form 접기/펼치기**: `closeForm()` 추가, 나머지 동일.

**AD. 할 일/완료/전체 filter**: 신규 `filter` state(기본값 "todo") — `incomplete`/`completed`/`tasks`(기존 `.filter(t => !t.completed)` 등 그대로)를 그대로 매핑만 함, 새 Firestore 쿼리 없음.

**AE. checkbox UI**: `<input type="checkbox" checked={!!t.completed}>` + `.tp-checkbox__box`(커스텀 시각) — **실제 `<input type="checkbox">`를 그대로 사용**해 접근성(스크린리더/키보드 포커스)을 유지, `opacity:0`으로 숨기고 형제 요소로 시각만 커스텀(표준 기법).

**AF. checkbox 완료 처리**: `onChange={() => toggleCompleted(t)}` — **기존 `toggleCompleted()` 함수를 한 글자도 안 바꾸고 그대로 연결**. "완료 처리" 버튼은 제거했습니다.

**AG. 완료 취소 지원 여부**: **이미 지원되고 있었습니다**(기존 "미완료로" 버튼이 `toggleCompleted`를 호출하던 구조 그대로) — 체크박스 해제 시 같은 함수가 호출되어 자동으로 완료→미완료 전환됩니다. 새로 구현한 것이 없습니다.

**AH. 중요도**: `TASK_PRIORITIES`/`TASK_PRIORITY_LABEL`(기존) 그대로, badge 색상만 정돈(높음=soft coral, 보통=rose, 낮음=neutral).

**AI. 마감일**: `formatDate Display()`(기존 유틸)로 "9월 14일까지" 형태로 표시, 저장되는 `dueDate` 값 자체는 무변경. 다른 연도면 연도 포함.

**AJ. 수정/삭제**: 기존 `startEdit`/`remove` 그대로, 텍스트 버튼으로 시각만 변경.

### [보호 확인]

**AK~AL. 기존 schema 호환**: event/task 문서 구조를 전혀 바꾸지 않았고, 새 필드도 추가하지 않았습니다 — 기존 데이터가 그대로 정상 표시됩니다.

**AM. Google Calendar 6.7 기능 회귀 여부**: `calendarApi.js`는 전혀 열지 않았고(md5 무변경 확인), `createCalendarEvent`/`updateCalendarEvent`/`deleteCalendarEvent`/googleCalendarId 기반 PATCH·중복방지 로직은 `EventsPage.jsx`에서 호출 방식 그대로 유지했습니다.

**AN. Home 업무 기능 회귀 여부**: **`Home.jsx`를 전혀 수정하지 않았습니다**(md5 확인) — Home의 `data.meetings = todayEvents.filter(e => e.type !== "personal")`가 이미 "personal이 아닌 모든 type"을 포함하는 방식이라, 협의회 일정도 코드 수정 없이 자동으로 Home에 반영됩니다.

**AO. Briefing 업무 기능 회귀 여부**: `briefingDerive.js`를 전혀 열지 않았습니다 — due/overdue/upcoming 판단 로직 무변경.

**AP~AQ. AI 일정/업무 기능 회귀 여부**: `assistant.js`는 전혀 안 건드림(md5 무변경), `tools.js`/`toolExecutors.js`는 협의회 확장 부분만 추가 편집 — 기존 "회의" 관련 동작은 조건문에 `council`을 OR로 추가한 것뿐이라 기존 흐름을 그대로 보존합니다.

### [렌더링]

**AR~AU. Desktop/Mobile 결과**: Playwright로 실제 CSS/DOM 그대로 렌더링해 확인했습니다 — 일정: 날짜 그룹(9월 12일/10월 6일)에 협의회+회의가 서로 다른 배지 색으로 표시, Calendar 연동 표시 축소 확인. 업무: [할 일 2][완료 1][전체 3] 탭 + 커스텀 체크박스 + 중요도 배지 확인. Mobile(390px)에서 `scrollWidth === clientWidth`로 가로 스크롤 없음을 수치로 확인, action 버튼이 자연스럽게 다음 줄로 wrap됨을 확인.

**AV. 한국어 keep-all**: 새로 작성한 CSS 전체에 적용, `break-all`/강제 `<br>` 없음.

**AW. horizontal overflow**: 없음(수치 확인).

### [교차 페이지 CSS 오염 방지 — 실제로 발견하고 수정한 문제]

작업 중 `.badge`, `.list__actions`, `.list--empty`를 **스코프 없이** 정의했다가, 이 클래스들이 `crud-shared.css`(여러 페이지가 공유)에 이미 정의되어 있어 번들링 시 다른 페이지(주요 안내 등)의 배지/버튼 스타일을 덮어쓸 위험을 발견했습니다. **`.events-page`/`.tasks-page` 조상 선택자로 전부 다시 스코프**했고, `.compact-list`도 `MonthlyProgressPage.css`와 이름이 겹쳐 `.ep-list`로 개명했습니다.

### [검증]

**AX. 전체 테스트 결과**: 기존 21벌(183개) + 신규 협의회 eligibility 테스트(6개) = **22벌(189개), 전부 PASS**.

**AY~AZ. build/lint 결과**: `npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것).

**BA. 남아 있는 문제**
- `src/ai/documentAnalysis.js`(연간 학사일정 **파일 분석**에서 쓰는 별도의 `eventType` enum: academic/school/meeting/training)에는 **의도적으로 "council"을 추가하지 않았습니다** — 이 파일은 자연어 AI 비서 대화(tools.js/toolExecutors.js)와 완전히 별개의, 문서 업로드 분석 전용 기능이고 이번 요청의 CASE 테스트(J~O)에 포함되지 않아 범위 밖으로 판단했습니다. 학사일정 파일에서 "협의회" 문구를 인식해야 할 필요가 있으시면 별도로 말씀해 주시면 추가하겠습니다.
- 실제 Firestore 데이터로 CASE A~AH 전체를 직접 클릭 테스트하지는 못했습니다 — 계산/조건 로직은 node로, 화면은 정적 스크린샷으로 검증했습니다.
- Paperlogy는 이번에도 미적용(전역 적용 단계에서 예정).

## 44. 진도표 범례 CSS 버그 수정 + 주요 안내 페이지 개편 + 전역 keep-all 보완

### [A. 진도표 범례 버그]

**1. 범례가 크게 표시된 정확한 원인**
`.progress-page .progress-matrix__check`(표 셀, 클래스 2개 조합이라 CSS 특이도 `0,0,2,0`)가 `width:30px; height:30px`를 지정하고 있었는데, 범례의 크기 축소 규칙인 `.pp-legend__swatch`는 **스코프 없이 클래스 1개**(특이도 `0,0,1,0`)로만 정의되어 있었습니다. **특이도가 낮은 규칙은 소스 순서와 무관하게 항상 집니다** — 그래서 `.pp-legend__swatch`의 `width:20px`가 전혀 적용되지 않고, 범례도 표와 똑같은 30px 버튼 크기로 렌더링되고 있었습니다.

**2. 수정한 CSS selector**
`.pp-legend__swatch` → **`.progress-page .pp-legend__swatch`**(스코프 추가, 특이도를 `0,0,2,0`으로 맞춤). 딱 이 selector 하나만 고쳤습니다.

**3. 수정 파일**: `src/pages/MonthlyProgressPage.css` 단 하나.

**4. 표 내부 indicator 무변경 확인**: `.progress-page .progress-matrix__check`/`--done`/`--progress` 규칙은 **한 글자도 건드리지 않았습니다** — 실제 스크린샷에서 표 셀은 이전과 동일한 30px 크기를 그대로 유지하고, 범례만 20px로 작아진 것을 확인했습니다.

**5. 범례 재사용 방식**: 기존 방식(`.progress-matrix__check--done`/`--progress` 클래스를 범례 swatch에도 그대로 사용) 그대로 유지 — 이번엔 크기 규칙의 **특이도만** 고쳤을 뿐, 색/모양 재사용 구조 자체는 지난 턴 그대로입니다.

### [B. 주요 안내 페이지 개편]

**6. 기존 데이터 구조**: `content, important, expiresAt, dateAdded, source, createdAt` — `NoticesPage.jsx` 코드에서 직접 확인.

**7. 수정 파일**: `src/pages/NoticesPage.jsx`(전체 재작성), `src/pages/NoticesPage.css`(신규).

**8. + 안내 추가 동작**: 신규 `showForm` state(기본 닫힘) — 기존 `submit`/`startEdit`/`resetForm` 로직은 그대로, `closeForm()`(resetForm + 닫기)만 추가.

**9. newline 저장 방식**: **기존에도 이미 newline이 그대로 저장되고 있었습니다** — 저장 시 `form.content`를 가공 없이 그대로 썼기 때문입니다. 이번에 딱 하나 추가한 것은 문자열 **맨 앞/뒤 공백만** 정리하는 `.replace(/^\s+|\s+$/g, "")`이고, **내부 줄바꿈(`\n`)은 정규식이 건드리지 않는 위치라 그대로 보존**됩니다.

**10. newline 표시 방식**: `.np-card__content { white-space: pre-wrap; }` 추가 — **문제의 진짜 원인은 저장이 아니라 표시였습니다.** `{n.content}`를 그냥 `<p>`에 넣으면 브라우저 기본값(`white-space: normal`)이 연속 공백/줄바꿈을 시각적으로 한 줄처럼 뭉개 보여주고 있었는데, 데이터 자체는 항상 온전했습니다. `dangerouslySetInnerHTML`은 쓰지 않았습니다(원문을 HTML로 해석하지 않음).

**11. 수정 시 newline 보존 여부**: `startEdit()`이 `n.content`를 그대로 `form.content`에 넣으므로 textarea에 기존 줄바꿈이 그대로 나타나고, 재저장 시에도 같은 앞뒤-only trim만 적용되어 내부 줄바꿈이 유지됩니다.

**12. 중요 표시**: `.badge--important`(soft coral, `var(--danger-soft-bg)`/`var(--danger-soft)`) — 강한 경고 카드가 아니라 작은 배지로.

**13. 유효기간 표시**: `n.expiresAt`이 있을 때만 "· 유효기간 · 9월 30일까지"로 secondary metadata에 추가, 없으면 아예 표시 안 함. **기존 만료 판단 로직(`n.expiresAt >= today`)은 전혀 안 바꿨습니다.**

**14. 만료 안내 filter**: 기존 `showExpired` state/필터링 로직 그대로, `.np-toolbar__checkbox`로 위치와 스타일만 상단 필터 영역으로 이동.

### [C. 전역 한국어 wrapping 확인]

**15. 앱 공통 wrapping rule 현황**: `theme.css`/`App.css`에는 전역 규칙이 **없었고**, 지금까지 재개편한 모든 페이지(Home/Login/Sidebar/AI비서/시간표/수업진도/일정/업무/주요안내)는 **각 페이지 CSS에서 개별적으로 `word-break: keep-all`을 적용**하고 있었습니다.

**16. break-all이 남아 있는 위치**: **프로젝트 전체를 검색한 결과 어디에도 없습니다.**

**17. anywhere를 사용한 위치**: 없습니다(이번에도 추가하지 않았습니다 — 필요한 경우가 실제로 발견되지 않았습니다).

**보완한 부분**: `crud-shared.css`(아직 개별 재개편하지 않은 설정/자료업로드 페이지 등이 공유하는 기본 파일)의 `.page__title`/`.page__desc`/`.section__title`/`.list__title`/`.list__meta`/`.status`에 `word-break: keep-all; overflow-wrap: break-word;`를 추가했습니다. **`* { }` 같은 전역 선택자는 쓰지 않았고**, 이미 한국어 텍스트를 담당하던 기존 shared 클래스에만 최소로 추가했습니다 — 아직 개편 전인 페이지에도 최소한의 안전망이 생겼습니다.

### [렌더링 검증]

**18~19. Desktop/Mobile 결과**: Playwright로 실제 CSS/DOM 렌더링 확인 — 범례 20px vs 표 셀 30px 크기 차이 확인, 주요 안내의 여러 줄(빈 줄 포함) content가 원문 그대로 보존되어 표시됨을 확인, "창립업무방-체육교육부-학교안전공제회-"처럼 긴 하이픈 연결 문자열도 자연스럽게 줄바꿈됨을 확인. Mobile(390px)에서 `scrollWidth === clientWidth`로 가로 스크롤 없음을 수치로 확인.

**20. 전체 테스트 결과**: 기존 22벌(189개) 전체 재실행 — **전부 PASS**(이번 작업이 계산 로직을 전혀 건드리지 않았으므로 당연한 결과).

**21~22. build/lint 결과**: `npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것).

**보호 확인**: `Home.jsx`, `briefingDerive.js`, `remainingLessons.js`, `effectiveTimetable.js`, `toolExecutors.js`, `firestore.rules` — 전부 md5로 이전 턴과 완전히 동일함을 확인했습니다(이번 턴에 열지 않았습니다). `progress_checks`/`progress_current`/`상태 판단`/`클릭 동작`/`AI 진도 기능`/notices Firestore schema/Home briefing 중요 안내 판단 — 전부 무변경입니다.

**23. 남아 있는 문제**
- `DocumentsPage`/`SettingsPage`는 이번에도 개별 Soft Pink 재개편을 하지 않았습니다(요청 범위 밖) — `crud-shared.css`의 keep-all 보완만 자동으로 적용됩니다.
- 실제 Firestore 데이터로 CASE A~M 전체를 직접 클릭 테스트하지는 못했습니다 — 정적 스크린샷과 코드 검토로 정확성을 확인했습니다.

## 45. 앱 전체 수정 UX 원칙 변경 — "그 자리에서 수정"으로 통일

### 사전 조사 결과 (코드 수정 전 먼저 확인)

| 페이지/기능 | 기존 수정 방식 | 분류 |
|---|---|---|
| 일정(EventsPage) | 상단 등록 form 재사용 | **B** |
| 업무(TasksPage) | 상단 등록 form 재사용 | **B** |
| 주요 안내(NoticesPage) | 상단 등록 form 재사용 | **B** |
| 수업 진도 - 최근 기록(progress_history) | 이미 해당 행 자리에서 인라인 수정됨 | A — 변경 안 함 |
| 수업 진도 - 학사일정 카드(school_day_schedules) | `renderScheduleCard`가 이미 그 자리에서 폼으로 전환됨 | A — 변경 안 함 |
| 수업 진도 - 수업 횟수 수동 보정(lesson_adjustments) | 상단 접이식 등록 form 재사용 | **B** |
| 시간표 - "일시적 변경"(레거시 직접 등록, timetable_overrides) | 상단 등록 form 재사용 | **B** |
| 시간표 - "빠른 변경"(맞교환/이동/취소/추가) | 등록 전용, 기존 항목을 다시 수정하는 기능 자체가 없음 | 해당 없음 |
| 시간표 - 예정된 변경(ChangeItemCard) | 수정 기능 없음(삭제만 존재) | 해당 없음 |

**B로 분류된 5곳만 수정했습니다.** A/C는 이미 올바른 패턴이라 손대지 않았습니다.

### 실제 변경한 모든 edit 기능

1. **일정(EventsPage)**: `showForm`+`form`+`editingId` 하나로 뒤섞여 있던 state를 **`showCreateForm`/`createForm`**(신규 전용)과 **`editingId`/`editForm`**(수정 전용)으로 완전히 분리. 필드 UI는 `EventFormFields` 공용 컴포넌트로 추출해 중복 없이 재사용. 수정 클릭 시 그 일정이 있던 날짜 그룹의 **그 행 자리**에서 폼으로 전환.
2. **업무(TasksPage)**: 동일한 패턴 — `createForm`/`editForm` 분리, `TaskFormFields` 공용 컴포넌트, 해당 행 자리에서 수정.
3. **주요 안내(NoticesPage)**: 동일한 패턴 — `createForm`/`editForm` 분리, `NoticeFormFields` 공용 컴포넌트, 해당 카드 자리에서 수정(줄바꿈 보존 로직은 create/edit 양쪽에 동일하게 적용).
4. **수업 진도 - 수동 보정**: `adjustmentForm`(등록 전용)과 `editAdjustmentForm`(수정 전용)으로 분리, `submitEditAdjustment` 신설. 목록의 해당 행이 인라인으로 폼이 됨.
5. **시간표 - 일시적 변경**: `overrideForm`(등록 전용)과 `editOverrideForm`(수정 전용)으로 분리, `submitEditOverride` 신설. 목록의 해당 행이 인라인으로 폼이 됨.

### 변경하지 않은 edit 기능과 이유

- **최근 기록(progress_history)**: 지난 턴에 이미 `editingHistoryId === h.id` 조건으로 그 기록 자리에서 바로 폼으로 전환되고 있었습니다 — 이미 요청하신 패턴 그대로였습니다.
- **학사일정 카드(school_day_schedules)**: `renderScheduleCard(s)`가 `editingScheduleId === s.id`일 때 자기 자신을 폼으로 바꿔 반환하는 구조 — 역시 이미 그 자리에서 수정되고 있었습니다.
- **시간표 빠른 변경/예정된 변경**:애초에 "기존 항목을 다시 불러와 수정"하는 기능 자체가 없습니다(맞교환/이동/취소/추가는 매번 새로 구성해서 적용하는 방식이고, 예정된 변경은 삭제만 가능) — 이번 원칙이 적용될 대상이 아니라 그대로 뒀습니다.

### 신규 form과 edit form 분리 방식

다섯 곳 모두 동일한 패턴을 사용했습니다: **`createXxx`**(신규 등록 전용 state) vs **`editingId` + `editXxxForm`**(수정 전용 state) — 완전히 별개의 state이며, 기존처럼 선택한 항목의 데이터를 상단 등록 form에 채워 넣어 재사용하는 방식은 전부 제거했습니다. "+ 추가" 버튼을 누르면 진행 중이던 인라인 수정을 닫고(`setEditingId(null)`), 반대로 "수정"을 누르면 열려 있던 등록 form을 닫아(`setShowCreateForm(false)`) **한 번에 하나의 form만** 열리도록 했습니다.

### scroll 위치 유지 여부

수정 form이 그 항목이 원래 있던 자리에서 바로 나타나므로, 페이지 상단으로 이동하거나 스크롤이 발생하지 않습니다 — 구조적으로 스크롤을 조작하는 코드 자체가 없습니다(에초에 필요 없어졌습니다).

### Firestore update 방식 유지 여부

다섯 곳 모두 **`updateDocById(collection, existingId, payload)`를 기존과 동일하게 그대로 사용**했습니다. 새 document를 생성하는 코드 경로는 없으며, document ID는 항상 유지됩니다.

### Google Calendar 수정 회귀 테스트

일정 수정 로직(`saveEvent` 공용 함수)은 `createCalendarEvent`/`updateCalendarEvent`/`googleCalendarId`/`calendarSync`/`isCalendarEligible` 호출을 **지난 턴의 `submit()` 함수와 완전히 동일한 순서와 조건으로 재사용**했습니다 — 기존에 연동된 일정을 수정하면 `googleCalendarId`가 있으므로 `updateCalendarEvent`(PATCH)가 호출되고, 새 Calendar event가 중복 생성되지 않습니다. `calendarApi.js` 자체는 이번에 전혀 열지 않았습니다(md5 무변경 확인).

### Desktop/mobile 결과

Playwright로 실제 렌더링 확인 — 일정 목록에서 "10월 6일(화)" 그룹의 협의회 항목을 수정 상태로 전환한 결과, 다른 날짜(9월 12일) 그룹은 그대로 보기 상태를 유지하면서 해당 항목만 정확히 그 자리에서 전체 필드(제목/날짜/시작/종료/구분/참석여부/상태/메모)를 갖춘 폼으로 바뀌는 것을 확인했습니다(첨부 스크린샷).

### 전체 테스트 결과

기존 22벌(189개) 전체 재실행 — **전부 PASS**.

### npm run build / npm run lint

`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관). 작업 과정에서 두 차례(MonthlyProgressPage.jsx, TimetablePage.jsx) 블록 교체 시 남은 고아 코드로 인한 문법 오류가 있었으나, 빌드 오류로 즉시 발견하여 수정했습니다.

### 남아 있는 문제

- 업무/주요 안내/수동 보정/일시적 변경의 인라인 수정은 코드 검토로 로직 정확성을 확인했지만, EventsPage만 실제로 스크린샷 렌더링까지 확인했습니다 — 나머지 넷도 동일한 패턴을 그대로 적용했으므로 구조적으로는 동일하게 동작해야 하지만, 실제 화면은 브라우저에서 직접 확인해 주시면 좋겠습니다.
- 진행 중이던 인라인 수정을 저장하지 않고 다른 항목의 "수정"을 눌렀을 때는 별도 확인창 없이 조용히 이전 수정 내용을 버리고 새 항목을 엽니다(요청하신 "불필요한 confirm 남발 금지" 원칙에 따라 confirm을 넣지 않았습니다) — 혹시 이 경우 확인이 필요하다고 판단되시면 말씀해 주세요.

## 46. AI 비서 아이콘 정리 + 진도계획 편집 UI + 조회 영역 compact + 남은 수업 반 전체 비교형

### 1. 수정 파일
`src/pages/AssistantPage.jsx`, `src/pages/MonthlyProgressPage.jsx`, `src/pages/MonthlyProgressPage.css`.

### 2. AI 비서 변경
- 제목: `"AI 비서 🌷"` → **`"AI 비서"`**(꽃 아이콘 완전 제거, 새 아이콘도 추가 안 함)
- 빈 대화 상태 중앙: `🌷` → **`✨`**
- 그 외(개인정보 안내/빠른 질문/입력창/대화 UI/AI 세션·tool calling)는 전혀 건드리지 않았습니다.

### 3. 진도계획 편집 UI
**기존 구조**: 제목 input과 숫자 input이 label 없이 나란히 있고, 숫자 뒤에 아무 단위 표시가 없어 무엇을 의미하는지 불명확했습니다.
**변경 구조**: 편집 패널 상단에 `차시명`/`차시` 헤더 label을 추가하고, 차시명 input은 넓게, 차시 숫자는 `[ 1 ] 차시`처럼 숫자+"차시" suffix를 하나의 compact control로 묶었습니다. ↑/↓/삭제 버튼도 작은 정사각형 아이콘 버튼으로 정돈했습니다. Mobile(640px 이하)에서는 헤더 label을 숨기고 차시명은 한 줄 전체, 차시/버튼은 다음 줄로 자연스럽게 wrap됩니다.
**기존 저장 로직 유지 여부**: `updateDraftRow`/`moveDraftRow`/`removeDraftRow`/`addDraftRow`/`savePlanItems`/`cancelEditPlan` **전부 한 글자도 수정하지 않았습니다** — 마크업과 CSS만 바꿨습니다.

### 4. 상단 조회 영역
- **Desktop**: 기존 `.pp-context-bar`(label 위 / select 아래로 쌓이던 구조)를 `flex-direction: row`로 바꿔 label+select가 한 줄에 나란히 오도록 하고, 맨 앞에 **"조회 기준"** prefix label을 추가해 컨텍스트가 즉시 보이도록 했습니다. 오른쪽의 "2026년 9월 계획 기준" helper는 `margin-left: auto`로 오른쪽 끝에 붙어 남는 공간을 시각적으로 활용합니다.
- **Mobile(640px 이하)**: 미디어쿼리로 다시 `flex-direction: column`으로 되돌려 기존처럼 label 위/select 아래로 쌓이는 충분한 터치 영역 레이아웃을 유지합니다. Desktop 레이아웃을 그대로 축소하지 않았습니다.

### 5. 남은 수업 — 담당 반 전체 비교형
**담당 반을 가져온 데이터**: 기존에 이미 존재하던 **`classesInGrade`**(`timetable.filter(t => gradeOfClassName(t.className) === grade)`에서 파생, 반별 진도 체크표에도 쓰이던 바로 그 값)를 그대로 재사용했습니다 — 학급을 임의로 생성하지 않고, 사용자의 실제 시간표에 등록된 반만 가져옵니다.

**기존 계산 로직 재사용 방식**: 학급 선택 dropdown(`remainingClass`)과 단일 계산(`remainingResult`)을 제거하고, **`classesInGrade.map(className => calculateRemainingLessons({className, ...}))`**로 **기존 `calculateRemainingLessons()` 함수를 각 반에 그대로 반복 적용**했습니다. 함수 내부 로직은 단 한 줄도 수정하지 않았습니다(md5로 무변경 확인).

**Desktop card grid 구조**: `.remaining-grid`(CSS Grid, `repeat(auto-fill, minmax(190px, 1fr))`)로 반 개수에 따라 자동으로 열이 늘어나는 반응형 그리드. 각 카드는 반이름 → 큰 숫자(남은 실제 수업) → 계획상 필요/예상 결과 → 계산 근거 토글 순서의 hierarchy를 갖습니다.

**Mobile compact comparison 구조**: 같은 `.remaining-card` 마크업을 미디어쿼리로 `display:flex; flex-wrap:wrap`으로 재배치해 반이름+남은수업 값이 한 줄에, 계획상필요/예상결과가 그 아래 컴팩트하게, 계산 근거 토글이 오른쪽에 오도록 했습니다 — 큰 세로 카드가 줄줄이 쌓이지 않습니다.

**계산 근거 expand 구조**: 기존 `showBasisFor` state를 그대로 재사용(이미 className 문자열 기반이라 그대로 다중 카드에도 호환)합니다. 펼치면 **그 카드 안, 그 자리에서** 바로 아래에 계산 근거가 나타납니다(Desktop/Mobile 공통 — DOM 구조가 카드당 하나씩이라 자연스럽게 해당 위치에서 열립니다).

**학급 dropdown 처리**: 기존 dropdown은 "어떤 반을 볼지" 고르는 용도 외에 다른 state/기능에 쓰이지 않음을 확인 후 제거했습니다.

**날짜 범위**: `dateFrom`/`dateTo`는 그대로 유지되며, 모든 카드가 동일한 기간을 공유해 계산됩니다(신경써서 `useMemo` 의존성에 공통으로 넣었습니다).

### 6. 핵심 로직 무변경 확인
`remainingLessons.js`, `effectiveTimetable.js`, `assistant.js`, `tools.js`, `toolExecutors.js`, `calendarApi.js`, `firestore.rules` — **전부 md5로 이전과 완전히 동일함을 확인**했습니다(이번 턴에 열지 않았습니다). `progress_checks`/`progress_current`/progress_history 의미/progress plan 저장 구조/school_day_schedules/lesson_adjustments 데이터 구조도 전혀 변경하지 않았습니다.

### 7. 테스트 결과
기존 22벌(189개) 전체 재실행 — **전부 PASS**.

### 8. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관). 작업 중 CSS 블록 교체 과정에서 발생한 고아 코드(미디어쿼리 손상)를 build 오류로 즉시 발견해 수정했습니다.

### 9. 실제 렌더링 검증
Playwright로 확인 — Desktop에서 조회 기준 toolbar가 한 줄로 컴팩트해지고, 남은 수업이 1학년 1/3/5반 3개 카드로 나란히 표시되며 그중 하나(3반)의 계산 근거가 카드 안에서 펼쳐진 상태를 확인했습니다. Mobile(390px)에서는 같은 3개 반이 컴팩트한 가로 행으로 재배치되고 계산 근거가 해당 반 바로 아래에서 펼쳐지며, `scrollWidth === clientWidth`로 가로 스크롤이 없음을 수치로 확인했습니다.

### 10. 발견된 제한사항
- 실제 Firestore 데이터로 여러 담당 반이 섞인 실사용 시나리오까지는 확인하지 못했습니다 — 계산 로직 재사용 여부는 코드 레벨로, 화면은 정적 스크린샷으로 확인했습니다.
- Mobile compact 비교 행은 요청하신 "학급 | 남은 | 필요 | 예상" 4열 표 형태를 픽셀 단위로 그대로 재현하지는 않고, flex 기반의 compact 한 줄+보조 줄 구조로 구현했습니다 — 핵심 목표(큰 카드 안 쌓임, 비교 용이, 그 자리에서 펼침)는 충족하지만 정확히 표 형태를 원하시면 추가 조정이 필요할 수 있습니다.

## 47. 자료 업로드 Soft Pink 개편 + 주요 안내 "내용 중심" form 개편

### 1. 실제 수정 파일
`src/pages/DocumentsPage.jsx`, `src/pages/DocumentsPage.css`(전체 재작성), `src/pages/NoticesPage.jsx`, `src/pages/NoticesPage.css`.

### 2. 자료 업로드

**기존 UI 문제**: `--paper-line`/`--ink`(옛 beige 토큰) 사용, `border-radius:4px`(각진 모서리), 브라우저 기본 `<input type="file">` 그대로 노출, 진한 초록 "분석하기" 버튼.

**변경한 layout**: 제목/종류를 한 행, 기간 시작/끝을 한 행으로 나눠 배치(`doc-form__row`), 파일 선택 영역을 넓은 점선 박스로, 하단에 rose 버튼.

**file input을 custom UI화한 방식**: 실제 `<input type="file" ref={fileInputRef}>`는 **그대로 유지**하고 `clip-rect` 방식으로 화면 밖에 시각적으로만 숨겼습니다(`display:none`이 아님 — 일부 브라우저에서 `display:none` input은 `.click()` 위임이 불안정할 수 있어 안전한 표준 기법인 visually-hidden을 사용). custom 버튼(`.doc-picker`)을 누르면 `fileInputRef.current.click()`으로 **기존 input을 그대로** 엽니다. `onChange={(e) => setFile(e.target.files?.[0] ?? null)}`는 한 글자도 바꾸지 않았습니다.

**선택 파일 표시 방식**: 파일명 + `FILE_FORMAT_LABEL[detectFileFormat(file)]`(기존 유틸 그대로) + 신규 `formatFileSize()` 헬퍼(바이트→KB/MB, 표시 전용, 분석 로직과 무관)로 문서 아이콘과 함께 표시, "변경" 버튼으로 재선택 가능.

**기존 분석 기능 무변경 여부**: `handleAnalyzeUpload`, `analyzeSourceDocument`, `detectFileFormat`, `excelToText`/`wordToText`, `persistItemsUpdate`, `handleSave`/`handleIgnore`, Google Calendar 동기화 로직 — **전부 한 글자도 수정하지 않았습니다.** "분석한 자료" 카드의 후보 확인/저장/무시 UI도 기존 구조 그대로, 스타일만 Soft Pink로 바꿨습니다.

### 3. 주요 안내

**textarea layout 변경**: 기존에 `.field field--grow`(다른 필드들과 같은 flex row 안에서 폭을 나눠 갖던 구조)였던 것을 **`.np-form__content-row`(자체 full-width 블록)**로 완전히 분리했습니다. 유효기간/중요는 `.np-form__meta-row`(별도의 compact 보조 행)로 이동했습니다.

**⚠️ 작업 중 발견하고 수정한 회귀**: 처음 구현에서 `.notices-page .form`에 `flex-direction: column`만 주고 `align-items`를 명시하지 않았더니, `crud-shared.css`의 기존 `.form { align-items: flex-end; }`가 (다른 속성이므로 여전히) 적용되어 textarea가 **오른쪽으로 밀리고 폭이 줄어드는** 문제가 실제로 발생했습니다. 스크린샷으로 직접 확인해 발견했고, `align-items: stretch`를 명시적으로 추가해 즉시 수정했습니다 — 최종 스크린샷에서 textarea가 폼 전체 폭을 정상적으로 사용함을 재확인했습니다.

**유효기간/중요 위치**: textarea 바로 아래, Desktop에서는 한 줄에 나란히(`flex-wrap` row), Mobile(640px 이하)에서는 세로로 쌓이도록 미디어쿼리 처리.

**저장/취소 위치**: `.form__actions`로 여전히 폼 맨 하단의 독립된 action 영역 — textarea 옆에 붙지 않습니다.

**줄바꿈 보존 방식**: **지난 턴에 이미 구현되어 있던 방식을 그대로 유지**했습니다 — 저장 시 `content.replace(/^\s+|\s+$/g, "")`(양 끝 공백만 제거, 내부 `\n`/빈 줄 보존), 표시 시 `.np-card__content { white-space: pre-wrap; }`, `dangerouslySetInnerHTML` 미사용. 이번 턴에는 이 로직을 전혀 건드리지 않았습니다.

**신규/수정 form 적용 여부**: `NoticeFormFields` 컴포넌트 하나를 신규 등록 form과 인라인 수정 form이 **공유**하므로, 개선된 layout이 양쪽 모두에 동일하게 적용됩니다. 기존 inline edit 위치(그 카드 자리에서 수정)는 지난 턴 그대로 유지했습니다 — 이번엔 폼 내부 layout만 변경했습니다.

### 4. Responsive

Playwright로 실제 렌더링 확인:
- **자료 업로드 Desktop**: 제목+종류 한 행, 기간 한 행, 넓은 파일 선택 박스, 우측 하단 분석 버튼 — 파일 선택 전/후 모두 확인
- **자료 업로드 Mobile(390px)**: 모든 필드가 세로로 자연스럽게 쌓임
- **주요 안내 Desktop**: textarea가 폼 전체 폭 사용(수정 후), 유효기간+중요 한 줄, 저장/취소 하단
- **주요 안내 Mobile(390px)**: 유효기간/중요 세로 배치
- 둘 다 `scrollWidth === clientWidth`로 **가로 스크롤 없음을 수치로 확인**했습니다.

### 5. 기능 보호
`documentAnalysis.js`, `assistant.js`, `remainingLessons.js`, `calendarApi.js`, `firestore.rules` — **전부 md5로 완전 무변경 확인**했습니다(이번 턴에 열지 않았습니다). Home/briefing의 주요 안내 표시 로직, Firestore schema(notices/source_documents), 기존 document ID/createdAt 등 metadata도 전혀 건드리지 않았습니다.

### 6. 테스트 결과
기존 22벌(189개) 전체 재실행 — **전부 PASS**.

### 7. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### 8. 발견된 제한사항
- **참고사항(이번 범위 밖이라 수정하지 않음)**: `DocumentsPage.jsx`의 AI 추출 후보 편집 영역에서 `editedItem.eventType === "meeting"`으로 참석 여부 select 표시 여부를 판단하는 조건이, 이전 턴에 일정 페이지에 추가한 "협의회(council)" 유형을 반영하지 못하고 있습니다 — 이번 작업은 "자료 업로드/주요 안내 UI 개편"으로 범위가 명확히 한정되어 있어 이 조건은 그대로 뒀습니다. 필요하시면 별도로 말씀해 주세요.
- 실제 파일 분석(PDF/Excel/이미지/Word)과 후보 저장/무시까지 실제 Firebase/Gemini 환경에서 end-to-end로 확인하지는 못했습니다 — UI 변경이 기존 함수 호출 방식을 그대로 재사용하는지 코드 레벨로 확인하는 데 그쳤습니다.

## 48. 남은 수업 — 비교형 카드로 미세조정 (시안 참고)

### 1. 수정 파일
`src/pages/MonthlyProgressPage.jsx`, `src/pages/MonthlyProgressPage.css` 단 두 개뿐입니다.

### 2. Desktop 카드 변경 내용
기존 `.remaining-card__figure`(큰 중앙 숫자 영역, 26px 굵은 글씨 + 하단 구분선)를 **완전히 제거**하고, "남은 실제 수업"을 "계획상 필요"/"예상 결과"와 **동일한 row 형태**(`.remaining-card__row`)로 통합했습니다. 세 row 사이에는 옅은 구분선(`border-bottom: 1px solid var(--border-soft)`)만 두어 시안처럼 나란히 비교되도록 했습니다. 카드 padding도 `16px 18px` → `14px 16px`로 줄여 불필요한 여백을 없앴습니다.

### 3. Mobile 변경 내용
기존에 `.remaining-card__figure`를 참조하던 모바일 미디어쿼리 규칙을 전부 정리하고, `.remaining-card__rows` 자체를 가로 flex로 배치해 "학급명 | 남은 | 필요 | 예상 | 계산근거"가 한 줄의 compact row에 오도록 재구성했습니다. 계산 근거는 여전히 해당 반 카드 바로 아래에서 펼쳐집니다(DOM 구조가 카드 하나에 그대로 포함돼 있어 자동으로 그 자리에서 열림).

### 4. 큰 숫자 스타일 제거 방법
`.remaining-card__figure-value { font-size: 26px; font-weight: 800; }` 규칙 자체를 삭제했습니다. 대신 "남은 실제 수업" 값에만 `.remaining-card__value--main`(font-size **18px**, `var(--accent)`)를 적용해 시안이 요청한 "아주 약간의 강조" 수준으로 낮췄습니다 — 요청하신 18~22px 범위 안입니다.

### 5. 계산 근거 UI 변경 여부
버튼 텍스트를 `"보기 ∨"/"숨기기 ∧"` → **`"보기 〉"/"숨기기 ⌃"`**로 문자만 바꿨습니다. 새 아이콘 library는 설치하지 않았고(순수 텍스트 문자), `onClick={() => setShowBasisFor(...)}` 로직과 `progress-basis` 표시 내용은 지난 턴 그대로 전혀 건드리지 않았습니다.

### 6~7. remainingLessons.js / effectiveTimetable.js 무변경 여부
**둘 다 md5로 완전 무변경 확인했습니다** — 이번 턴에 아예 열지 않았습니다. `calculateRemainingLessons()` 호출 방식, `result.total`/`result.basis`/`result.baseCount`/`result.unresolvedSchedules` 등 사용하는 필드도 전혀 바뀌지 않았습니다 — 표시 마크업만 재배치했습니다.

### 시안에서 의도적으로 제외한 요소
요청하신 대로 다음은 추가하지 않았습니다: 카드 우측 상단 사람 아이콘, 우측 상단 설명 아이콘, "같은 학년의 담당 반을 한눈에..." 안내 문구, 우측 하단 별 장식 카드. 이런 decorative UI는 시안에만 있는 요소이며 실제 코드에 필요하지 않다고 판단해 그대로 뒀습니다.

### 8. 테스트 결과
기존 22벌(189개) 전체 재실행 — **전부 PASS**.

### 9. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### 실제 렌더링 검증
Playwright로 확인 — Desktop에서 1학년 1~5반 5개 카드가 grid로 배치되고(5반은 다음 줄로 자연스럽게 wrap, 억지로 5열 압축하지 않음), 3반의 계산 근거가 카드 안에서 펼쳐진 상태, "1차시 부족"은 rose, "적정"은 neutral text로 구분됨을 확인했습니다. Mobile(390px)에서는 각 반이 compact한 가로 행으로 표시되고 계산 근거가 해당 반 바로 아래에서 펼쳐지며, 가로 스크롤이 없음을 확인했습니다.

## 49. 설정 페이지 Soft Pink 개편

### 1. 수정 파일 목록
`src/pages/SettingsPage.jsx`, `src/pages/SettingsPage.css`(신규).

### 2. 설정 페이지 전체
**기존 구조**: 큰 beige `.page__section` 4개(Google Calendar/아침 브리핑/담임 학급/데이터 초기화)가 큰 vertical divider+여백으로 나열, "업무 데이터 초기화"는 항상 노출, "전체 초기화"만 `showAdvanced`("고급 설정 보기") 뒤에 숨김.
**변경 구조**: 동일한 3개 카드(Google Calendar/아침 브리핑/담임 학급)를 compact `.setting-card`로, 그 아래 `고급 설정 〉` 토글, 펼치면 "데이터 초기화" 카드 하나(업무+전체 초기화 버튼 둘 다 포함) — **"데이터 초기화" 전체를 고급 설정 뒤로 옮겼습니다**(요청하신 대로).

### 3. Google Calendar
**상태 표시 방식**: 기존 `connected`(GoogleCalendarContext) 값을 그대로 읽어 "✓ 연결됨"(accent 배지) / "연결 필요"(neutral 배지)로 표시 — **새로운 연결 상태를 만들지 않았습니다.**
**기존 OAuth 로직 무변경 여부**: `connect`/`disconnect`/`connecting`/`error`/`configured` 전부 기존 `useGoogleCalendar()` 훅에서 그대로 가져와 버튼에 연결했습니다. `GoogleCalendarContext.jsx`/`calendarApi.js`/`googleAuth.js`는 **md5로 완전 무변경 확인**(이번 턴에 열지 않았습니다).

### 4. 아침 브리핑
**UI 변경**: 하나의 compact card로, Desktop에서는 label+time input+저장이 한 행에, Mobile에서는 세로로.
**기존 저장/trigger 로직 무변경 여부**: `saveBriefingTime()`(→`updateBriefingTime`), `briefingSaving`/`briefingSaved` state, `getSettings()` 초기 로드 — **전부 한 글자도 수정하지 않았습니다.** `briefing` 생성/`lastBriefingDate` 로직 파일은 이번에 열지도 않았습니다.

### 5. 담임 학급
**UI 변경**: radio 2개를 가로 그룹으로, 학년/반 input 옆에 "학년"/"반" **표시 전용 suffix**(`<span>`)를 붙였습니다 — 실제 저장값(예: `homeroomGrade = "3"`)은 전혀 바꾸지 않았고, `homeroomClass = `${grade}-${classNum}`` 조합 로직도 무변경입니다.
**담임 아님 상태 처리**: 기존 코드를 확인한 결과 `homeroomGrade`/`homeroomClassNum`은 "담임 아님" 선택 시에도 **state에서 지우지 않고 그대로 유지**하고 있었습니다(저장 시에만 `isHomeroomTeacher && ...` 조건으로 빈 문자열 전송) — 이 기존 동작은 그대로 두고, UI에서만 `disabled` + `opacity` 처리로 시각적 비활성화를 추가했습니다.
**기존 저장 구조 무변경 여부**: `saveHomeroomSettings()`(→`updateHomeroomSettings`) 로직 무변경.

### 6. 고급 설정
**기존 "고급 설정 보기" 기능을 어떻게 활용했는지**: 코드 확인 결과 `showAdvanced` state와 토글 버튼이 **이미 존재**했고(원래는 "전체 초기화"만 가렸음) — **새 state를 만들지 않고 이 기존 state를 그대로 재사용**해 라벨만 "고급 설정 〉"/"고급 설정 ⌄"으로 바꾸고, 가리는 범위를 "데이터 초기화 섹션 전체"로 확장했습니다.
**데이터 초기화 배치 방식**: 펼친 영역 안에 "업무 데이터 초기화" 버튼(항상 있던 것) + 구분선 + "전체 사용자 데이터 초기화" 버튼(원래 고급 설정 안에 있던 것) — 둘 다 `openReset("work")`/`openReset("all")`을 그대로 호출합니다. `runReset()`, Modal의 confirm-word 입력, Google Calendar 동시 삭제 옵션, `resetWorkData`/`resetAllUserData` 호출 — **전부 한 글자도 수정하지 않았습니다.**

### 7. Responsive
Playwright로 실제 렌더링 확인 — Desktop: 카드 3개 반듯하게 나열, 아침 브리핑/담임 학급이 label+control+저장 한 행 배치, 고급 설정 접힘 상태와 펼침 상태(업무 초기화 + 구분선 + 전체 초기화) 둘 다 확인. "담임 아님" 선택 시 학년/반 필드가 disabled+muted로 바뀜을 확인. Mobile(390px): 모든 필드 자연스럽게 세로 배치, `scrollWidth === clientWidth`로 **가로 스크롤 없음을 수치로 확인**했습니다.

### 8. 핵심 로직 무변경 확인
`settingsService.js`, `resetData.js`, `GoogleCalendarContext.jsx`, `calendarApi.js`, `googleAuth.js`, `firestore.rules` — **전부 md5로 이전과 완전히 동일함을 확인**했습니다(이번 턴에 아예 열지 않았습니다).

### 9. 테스트 결과
기존 22벌(189개) 전체 재실행 — **전부 PASS**. 데이터 초기화는 요청하신 대로 실제 destructive 테스트를 실행하지 않고, handler 연결과 confirm-word 안전장치가 기존 그대로 유지됨을 코드 레벨로만 확인했습니다.

### 10. build/lint 결과
`npm run build`: 성공. `npm run lint`: **0 error**, warning 2건(기존부터 있던 것, 무관).

### 11. 작업 중 발견한 문제나 제한사항
- 이번엔 `.setting-card__row` 등 **전용 클래스를 새로 만들어** 썼기 때문에, 지난 턴들에서 두 차례(주요 안내/자료 업로드) 겪었던 `crud-shared.css`의 `.form { align-items: flex-end }` 상속 버그가 이번에는 애초에 발생하지 않았습니다 — `.form` 클래스 자체를 재사용하지 않아서입니다.
- 실제 Google Calendar 연결/해제, 브리핑 시간 저장 후 새로고침 유지 여부는 이 환경에서 실제 Firebase 계정으로 end-to-end 테스트하지 못했습니다 — 기존 함수 호출 방식이 그대로인지 코드 레벨로 확인하는 데 그쳤습니다.
