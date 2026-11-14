"use client";

import { AlertTriangle } from "lucide-react";
import type { ReactNode } from "react";
import { Dialog } from "@/components/ui/Dialog";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  /** Destructive actions get a red confirm button and a warning icon. */
  destructive?: boolean;
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", destructive = true }: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="btn-ghost btn-sm" data-autofocus>
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className={destructive ? "btn btn-sm bg-danger text-white hover:bg-accent-dark" : "btn-primary btn-sm"}
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="flex gap-4 px-5 py-5">
        {destructive && (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-soft text-danger" aria-hidden>
            <AlertTriangle size={18} />
          </span>
        )}
        <div className="text-sm leading-6 text-muted">{description}</div>
      </div>
    </Dialog>
  );
}
