import React, { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';

interface TdsDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  variant?: 'bottom-sheet' | 'modal';
  children: React.ReactNode;
}

export const TdsDialog: React.FC<TdsDialogProps> = ({
  open,
  onClose,
  title,
  subtitle,
  variant = 'bottom-sheet',
  children,
}) => {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [open]);

  // modern-web-guidance: light-dismiss-a-dialog fallback for browsers without native closedby="any" support
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const handleNativeClose = () => {
      onClose();
    };

    const handleBackdropClick = (event: MouseEvent) => {
      if ('closedBy' in HTMLDialogElement.prototype) return;
      if (event.target !== dialog) return;

      const rect = dialog.getBoundingClientRect();
      const isDialogContent =
        rect.top <= event.clientY &&
        event.clientY <= rect.top + rect.height &&
        rect.left <= event.clientX &&
        event.clientX <= rect.left + rect.width;

      if (isDialogContent) return;
      dialog.close();
    };

    dialog.addEventListener('close', handleNativeClose);
    dialog.addEventListener('click', handleBackdropClick);

    return () => {
      dialog.removeEventListener('close', handleNativeClose);
      dialog.removeEventListener('click', handleBackdropClick);
    };
  }, [onClose]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className={variant === 'bottom-sheet' ? 'tds-bottom-sheet no-print' : 'tds-modal-sheet no-print'}
      {...({ closedby: 'any' } as React.DialogHTMLAttributes<HTMLDialogElement>)}
    >
      <div className="flex flex-col max-h-[90dvh] bg-[#FFFFFF]">
        {/* 바텀 시트 상단 핸들바 */}
        {variant === 'bottom-sheet' && (
          <div className="pt-3 pb-1 flex justify-center shrink-0">
            <div className="w-9 h-1 bg-[#D1D6DB] rounded-full" />
          </div>
        )}

        {/* 시트 헤더 */}
        <div className="px-6 pt-4 pb-3 flex items-start justify-between shrink-0">
          <div>
            <h2 id={titleId} className="text-[19px] font-bold text-[#191F28] leading-snug">
              {title}
            </h2>
            {subtitle && (
              <p className="text-[13px] text-[#8B95A1] mt-0.5">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            aria-label="닫기"
            className="w-8 h-8 rounded-full bg-[#F2F4F6] text-[#4E5968] flex items-center justify-center active:scale-[0.97] active:bg-[#E5E8EB] transition-all duration-150 ease-out"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 시트 스크롤 본문 */}
        <div className="px-6 pb-7 overflow-y-auto flex-1">{children}</div>
      </div>
    </dialog>
  );
};
