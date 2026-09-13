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
import NoticesPage from "./pages/NoticesPage";
import DocumentsPage from "./pages/DocumentsPage";
import SettingsPage from "./pages/SettingsPage";
import PrivacyPage from "./pages/PrivacyPage";
import "./App.css";

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="app-loading">
        <span className="app-loading__mark" aria-hidden="true">
          🌷
        </span>
        <span className="app-loading__brand">솔쌤 AI 비서</span>
        <span className="app-loading__text">불러오는 중…</span>
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
          <Route path="/notices" element={<NoticesPage />} />
          <Route path="/documents" element={<DocumentsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
    </div>
  );
}

// /privacy는 Google OAuth 브랜딩(개인정보처리방침 링크)용 공개 페이지라서, 로그인 여부를
// 확인하기 전에 먼저 매치되어야 한다. 그 외 모든 경로는 기존 그대로 로그인 게이트를 거친다.
function AppShell() {
  return (
    <Routes>
      <Route path="/privacy" element={<PrivacyPage />} />
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
