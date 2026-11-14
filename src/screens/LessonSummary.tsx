import { BigButton } from '../ui/BigButton';
import './LessonScreen.css';

export interface LessonSummaryData { clean: number; total: number; xp: number }

/** advice — совет после слабой контрольной заглянуть в «Слабые места». */
export function LessonSummary({ clean, total, xp, advice = false, onDone }: LessonSummaryData & {
  advice?: boolean; onDone(): void;
}) {
  return (
    <section className="lesson-summary">
      <div className="lesson-summary-body">
        <h1>Урок пройден</h1>
        {total > 0 && <p>Решено с первого раза: {clean} из {total}</p>}
        <p className="lesson-summary-xp">Опыт: +{xp}</p>
        {advice && <p className="lesson-summary-advice">Стоит заглянуть в „Слабые места“</p>}
      </div>
      <div className="task-actions">
        <BigButton className="task-main" onClick={onDone}>Готово</BigButton>
      </div>
    </section>
  );
}
