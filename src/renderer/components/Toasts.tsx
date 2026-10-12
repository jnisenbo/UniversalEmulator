import { useStore } from '../state/store';

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.level}`}>
          <div className="toast-title">{t.title}</div>
          {t.detail && <pre className="toast-detail">{t.detail}</pre>}
        </div>
      ))}
    </div>
  );
}
