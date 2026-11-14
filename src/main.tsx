import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/golos-text/cyrillic-400.css';
import '@fontsource/golos-text/cyrillic-500.css';
import '@fontsource/golos-text/cyrillic-600.css';
import '@fontsource/golos-text/cyrillic-700.css';
import '@fontsource/golos-text/latin-400.css';
import '@fontsource/golos-text/latin-500.css';
import '@fontsource/golos-text/latin-600.css';
import '@fontsource/golos-text/latin-700.css';
import './ui/theme.css';
import App from './App';
import { FirstLoadScreen } from './screens/FirstLoadScreen';
import { InstallHint } from './screens/InstallHint';
import { UpdateBanner } from './screens/UpdateBanner';

// Просим браузер не стирать сохранённые задачи и прогресс; ответ не важен.
navigator.storage?.persist?.().catch(() => undefined);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UpdateBanner />
    <FirstLoadScreen>
      <App />
      <InstallHint />
    </FirstLoadScreen>
  </StrictMode>,
);
