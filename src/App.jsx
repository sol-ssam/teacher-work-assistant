import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { GoogleCalendarProvider } from "./contexts/GoogleCalendarContext";
import Sidebar from "./components/Sidebar";
import Login from "./pages/Login";
import Home from "./pages/Home";
import AssistantPage from "./pages/AssistantPage";
import TimetablePage from "./pages/TimetablePage";
import MonthlyProgressPage from "./pages/MonthlyProgressPage";
import EventsPage from "./pages/EventsPage";
import TasksPage from "./pages/TasksPage";
import DocumentsPage from "./pages/DocumentsPage";
import SettingsPage from "./pages/SettingsPage";
import PrivacyPage from "./pages/PrivacyPage";
import TermsPage from "./pages/TermsPage";
import "./App.css";

function AuthenticatedApp() {
  const { user, loading, previewPreparing } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <span className="app-loading__mark" aria-hidden="true">
          🌷
        </span>
        <span className="app-loading__brand">교사용 업무 비서</span>
        <span className="app-loading__text">{previewPreparing ? "미리보기 준비 중…" : "불러오는 중…"}</span>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/assistant" element={<AssistantPage />} />
          <Route path="/timetable" element={<TimetablePage />} />
          <Route path="/progress" element={<MonthlyProgressPage />} />
          <Route path="/monthly-progress" element={<Navigate to="/progress" replace />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/tasks" element={<TasksPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

// /privacy, /terms는 Google OAuth 브랜딩(개인정보처리방침/이용약관 링크)용 공개
// 페이지라서, 로그인 여부를 확인하기 전에 먼저 매치되어야 한다. 그 외 모든 경로는
// 기존 그대로 로그인 게이트를 거친다.
function AppShell() {
  return (
    <Routes>
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/*" element={<AuthenticatedApp />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <GoogleCalendarProvider>
        <BrowserRouter>
          <AppShell />
        </BrowserRouter>
      </GoogleCalendarProvider>
    </AuthProvider>
  );
}
