import React, { useEffect, useLayoutEffect, useRef } from 'react';

interface AutoResizeTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

/**
 * 테이블 셀 및 문서 입력란에서 텍스트 길이와 줄바꿈에 따라
 * 세로 높이(scrollHeight)를 자동으로 늘려 잘림 현상을 원천 방지하는 멀티라인 컴포넌트입니다.
 */
export const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({
  value,
  className = '',
  onChange,
  rows = 1,
  ...rest
}) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const adjustHeight = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.max(el.scrollHeight, 22)}px`;
  };

  useLayoutEffect(() => {
    adjustHeight();
  }, [value]);

  useEffect(() => {
    window.addEventListener('resize', adjustHeight);
    window.addEventListener('beforeprint', adjustHeight);
    return () => {
      window.removeEventListener('resize', adjustHeight);
      window.removeEventListener('beforeprint', adjustHeight);
    };
  }, []);

  return (
    <textarea
      ref={textareaRef}
      rows={rows}
      value={value}
      onChange={(e) => {
        onChange?.(e);
        adjustHeight();
      }}
      style={{ overflow: 'hidden', resize: 'none' }}
      className={`block w-full bg-transparent whitespace-pre-wrap break-words [word-break:keep-all] leading-snug focus:outline-none ${className}`}
      {...rest}
    />
  );
};
