import { useEffect, useId, useRef, type FormEvent, type ReactNode } from "react";
import clsx from "clsx";
import { X } from "lucide-react";
import { Button, IconButton } from "./Button";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "md" | "lg";
}

/** Accessible modal built on the native <dialog> element (focus trap + Esc for free). */
export function Modal({ open, title, onClose, children, footer, width = "md" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={clsx(
        "m-auto max-h-[88vh] w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-surface p-0 text-fg shadow-2xl",
        width === "md" ? "max-w-lg" : "max-w-2xl",
      )}
    >
      {open && (
        <div className="flex max-h-[88vh] flex-col">
          <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <h2 className="text-base font-semibold">{title}</h2>
            <IconButton label="Close" onClick={onClose}>
              <X className="size-4" />
            </IconButton>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex justify-end gap-2 border-t border-border px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

interface FormModalProps extends Omit<ModalProps, "footer"> {
  onSubmit: () => void;
  submitLabel: string;
  submitting?: boolean;
  formError?: string | null;
}

export function FormModal({ onSubmit, submitLabel, submitting, formError, children, ...modal }: FormModalProps) {
  const formId = useId();
  const handle = (e: FormEvent) => {
    e.preventDefault();
    if (!submitting) onSubmit();
  };
  return (
    <Modal
      {...modal}
      footer={
        <>
          <Button variant="ghost" onClick={modal.onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary" loading={submitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handle} className="flex flex-col gap-4" noValidate>
        {children}
        {formError && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{formError}</p>}
      </form>
    </Modal>
  );
}

interface ConfirmProps {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  /** Shown when the action failed (e.g. from useConfirmAction). */
  error?: string | null;
}

export function ConfirmDialog({ open, title, message, confirmLabel = "Delete", busy, error, onConfirm, onClose }: ConfirmProps) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" loading={busy} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{message}</div>
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </Modal>
  );
}
