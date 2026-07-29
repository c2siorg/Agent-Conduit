import { dismissToast, useToasts } from '../lib/toast';

/** Renders the stack of active toasts (bottom-right). Click to dismiss. */
export function Toaster(): JSX.Element {
  const toasts = useToasts();
  return (
    <div className="toaster" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.message}
        </button>
      ))}
    </div>
  );
}
