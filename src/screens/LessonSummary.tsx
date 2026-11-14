import { BigButton } from '../ui/BigButton';
import './LessonScreen.css';

export interface LessonSummaryData { clean: number; total: number; xp: number }

export function LessonSummary({ clean, total, xp, onDone }: LessonSummaryData & { onDone(): void }) {
  return (
    <section className="lesson-summary">
      <div className="lesson-summary-body">
        <h1>Урок пройден</h1>
        <p>Решено с первого раза: {clean} из {total}</p>
        <p className="lesson-summary-xp">Опыт: +{xp}</p>
      </div>
      <div className="task-actions">
        <BigButton className="task-main" onClick={onDone}>Готово</BigButton>
      </div>
    </section>
  );
}
