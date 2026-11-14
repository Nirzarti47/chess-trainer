import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AboutScreen } from './screens/AboutScreen';
import { AppearanceScreen } from './screens/AppearanceScreen';
import { BackupScreen } from './screens/BackupScreen';
import { LearnScreen } from './screens/LearnScreen';
import { LessonScreen, WeakSpotsScreen } from './screens/LessonScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { PuzzleRunScreen, PuzzlesScreen } from './screens/PuzzlesScreen';
import { SettingsProvider } from './ui/settings';
import { TabBar } from './ui/TabBar';

/** «Слабые места» — урок; free, theme-<id> и review — поток вкладки «Задачи». */
function RunRoute() {
  const { mode } = useParams();
  return mode === 'weak' ? <WeakSpotsScreen /> : <PuzzleRunScreen key={mode} />;
}

/** На экранах урока и решения задач подряд нижние вкладки скрыты. */
function isFullscreenRoute(pathname: string) {
  return pathname.startsWith('/lesson/') || pathname.startsWith('/run/');
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
    <SettingsProvider>
      <HashRouter>
        <Layout />
      </HashRouter>
    </SettingsProvider>
  );
}
