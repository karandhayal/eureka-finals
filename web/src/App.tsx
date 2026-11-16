import { lazy, Suspense } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { LoadingRows, ToastProvider } from './ui';
import Login from './pages/auth/Login';

const Live = lazy(() => import('./pages/admin/Live'));
const Queue = lazy(() => import('./pages/admin/Queue'));
const Rooms = lazy(() => import('./pages/admin/Rooms'));
const Judges = lazy(() => import('./pages/admin/Judges'));
const Results = lazy(() => import('./pages/admin/Results'));
const Activity = lazy(() => import('./pages/admin/Activity'));
const Setup = lazy(() => import('./pages/admin/Setup'));
const Desk = lazy(() => import('./pages/floor/Desk'));
const RoomConsole = lazy(() => import('./pages/floor/RoomConsole'));
const Duty = lazy(() => import('./pages/floor/Duty'));
const JudgeSheet = lazy(() => import('./pages/judge/JudgeSheet'));
const StartupLookup = lazy(() => import('./pages/startup/Startup').then(m => ({ default: m.StartupLookup })));
const StartupPage = lazy(() => import('./pages/startup/Startup').then(m => ({ default: m.StartupPage })));
const RoomDisplay = lazy(() => import('./pages/display/Displays').then(m => ({ default: m.RoomDisplay })));
const HallBoard = lazy(() => import('./pages/display/Displays').then(m => ({ default: m.HallBoard })));

/** Staff routes: sign-in required; admin-only pages are not reachable by coordinators. */
function Staff({ admin, children }: { admin?: boolean; children: JSX.Element }) {
  const { token, me } = useAuth();
  if (!token || !me) return <Login />;
  if (admin && me.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}
function Home() {
  const { token, me } = useAuth();
  if (!token || !me) return <Login />;
  if (me.role === 'admin') return <Navigate to="/live" replace />;
  if (me.duty === 'desk') return <Navigate to="/desk" replace />;
  if (me.duty === 'room' && me.room_id) return <Navigate to={`/room/${me.room_id}`} replace />;
  if (me.duty === 'floor') return <Navigate to="/judges" replace />;
  return <Navigate to="/duty" replace />;
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter>
          <Suspense fallback={<LoadingRows />}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/live" element={<Staff admin><Live /></Staff>} />
              <Route path="/queue" element={<Staff admin><Queue /></Staff>} />
              <Route path="/rooms" element={<Staff admin><Rooms /></Staff>} />
              <Route path="/results" element={<Staff admin><Results /></Staff>} />
              <Route path="/activity" element={<Staff admin><Activity /></Staff>} />
              <Route path="/setup" element={<Staff admin><Setup /></Staff>} />
              <Route path="/judges" element={<Staff><Judges /></Staff>} />
              <Route path="/desk" element={<Staff><Desk /></Staff>} />
              <Route path="/duty" element={<Staff><Duty /></Staff>} />
              <Route path="/room/:roomId" element={<Staff><RoomConsole /></Staff>} />
              <Route path="/j/:token" element={<JudgeSheet />} />
              <Route path="/s" element={<StartupLookup />} />
              <Route path="/s/:token" element={<StartupPage />} />
              <Route path="/display/:code" element={<RoomDisplay />} />
              <Route path="/hall/:code" element={<HallBoard />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  );
}
