import { HashRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { AppearanceScreen } from './screens/AppearanceScreen';
import { LearnScreen } from './screens/LearnScreen';
import { LessonScreen, WeakSpotsScreen } from './screens/LessonScreen';
import { SettingsProvider } from './ui/settings';
import { TabBar } from './ui/TabBar';

/** Временный экран: только заголовок. Настоящие экраны появятся в следующих задачах. */
function Placeholder({ title }: { title: string }) {
  return (
    <section className="screen-placeholder">
      <h1>{title}</h1>
    </section>
  );
}

/** «Слабые места» — урок; остальные режимы появятся вместе с вкладкой «Задачи». */
function RunRoute() {
  const { mode } = useParams();
  return mode === 'weak' ? <WeakSpotsScreen /> : <Placeholder title="Тренировка" />;
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
          <Route path="/puzzles" element={<Placeholder title="Задачи" />} />
          <Route path="/profile" element={<Placeholder title="Профиль" />} />
          <Route path="/profile/appearance" element={<AppearanceScreen />} />
          <Route path="/profile/backup" element={<Placeholder title="Резервная копия" />} />
          <Route path="/profile/about" element={<Placeholder title="О приложении" />} />
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
