import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppearanceScreen } from './screens/AppearanceScreen';
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
          <Route path="/learn" element={<Placeholder title="Учёба" />} />
          <Route path="/puzzles" element={<Placeholder title="Задачи" />} />
          <Route path="/profile" element={<Placeholder title="Профиль" />} />
          <Route path="/profile/appearance" element={<AppearanceScreen />} />
          <Route path="/profile/backup" element={<Placeholder title="Резервная копия" />} />
          <Route path="/profile/about" element={<Placeholder title="О приложении" />} />
          <Route path="/lesson/:nodeId/:lessonIndex" element={<Placeholder title="Урок" />} />
          <Route path="/run/:mode" element={<Placeholder title="Тренировка" />} />
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
