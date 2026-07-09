import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { IcoClose } from '../icons';

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancelar',
  tone = 'default',
  icon,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="overlay alert-overlay" onClick={onCancel}>
      <section
        className={`panel alert-modal alert-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="alert-title"
        aria-describedby="alert-message"
        onClick={(event) => event.stopPropagation()}
      >
        <button className="btn small ghost alert-close" onClick={onCancel} aria-label="Fechar">
          <IcoClose />
        </button>
        {icon && <div className="alert-icon">{icon}</div>}
        <h2 id="alert-title">{title}</h2>
        <p id="alert-message">{message}</p>
        <div className="alert-actions">
          <button ref={cancelRef} className="btn ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className={`btn ${tone === 'danger' ? 'danger strong' : 'primary'}`} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
