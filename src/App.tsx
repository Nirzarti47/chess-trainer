import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { GamesBackground } from './games/gamesStore';
import { AboutScreen } from './screens/AboutScreen';
import { AppearanceScreen } from './screens/AppearanceScreen';
import { BackupScreen } from './screens/BackupScreen';
import { GamesScreen } from './screens/games/GamesScreen';
import { GameSummaryScreen } from './screens/games/GameSummaryScreen';
import { ReviewScreen } from './screens/games/ReviewScreen';
import { LearnScreen } from './screens/LearnScreen';
import { LessonScreen, WeakSpotsScreen } from './screens/LessonScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { PuzzleRunScreen, PuzzlesScreen } from './screens/PuzzlesScreen';
import { ErrorBoundary } from './ui/ErrorBoundary';
import { SettingsProvider } from './ui/settings';
import { TabBar } from './ui/TabBar';

/** «Слабые места» — урок; free, theme-<id> и review — поток вкладки «Задачи». */
function RunRoute() {
  const { mode } = useParams();
  return mode === 'weak' ? <WeakSpotsScreen /> : <PuzzleRunScreen key={mode} />;
}

/** На экранах урока, решения задач подряд, разбора партии и задач из партий нижние вкладки скрыты. */
function isFullscreenRoute(pathname: string) {
  return pathname.startsWith('/lesson/') || pathname.startsWith('/run/')
    || /^\/games\/[^/]+\/(review|fix)$/.test(pathname) || pathname === '/games/patterns/train';
}

function Layout() {
  const { pathname } = useLocation();
  return (
    <div className="app">
      <main className="app-main">
        <Routes>
          <Route path="/" element={<Navigate to="/learn" replace />} />
          <Route path="/learn" element={<LearnScreen />} />
          <Route path="/puzzles" element={<PuzzlesScreen />} />
          <Route path="/games" element={<GamesScreen />} />
          <Route path="/games/:gameId" element={<GameSummaryScreen />} />
          <Route path="/games/:gameId/review" element={<ReviewScreen />} />
          <Route path="/profile" element={<ProfileScreen />} />
          <Route path="/profile/appearance" element={<AppearanceScreen />} />
          <Route path="/profile/backup" element={<BackupScreen />} />
          <Route path="/profile/about" element={<AboutScreen />} />
          <Route path="/lesson/:nodeId/:lessonIndex" element={<LessonScreen />} />
          <Route path="/run/:mode" element={<RunRoute />} />
          <Route path="*" element={<Navigate to="/learn" replace />} />
        </Routes>
      </main>
      {!isFullscreenRoute(pathname) && <TabBar />}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <SettingsProvider>
        <HashRouter>
          <GamesBackground />
          <Layout />
        </HashRouter>
      </SettingsProvider>
    </ErrorBoundary>
  );
}
