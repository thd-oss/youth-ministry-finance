import React from 'react';

interface AutoResizeTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
}

/**
 * 순수 CSS 기반 자동 확장 멀티라인 입력 컴포넌트입니다.
 * - 최신 브라우저: CSS `field-sizing: content`로 JS 측정 없이 즉시 높이를 확장합니다.
 * - 구형 브라우저: `@supports not (field-sizing: content)` CSS Grid 미러 폴백으로 숨김(display:none) 해제 시에도 잘림 없이 높이를 확보합니다.
 * - 인쇄(@media print): 폼 컨트롤(<textarea>) 대신 정적 미러 텍스트를 출력해 브라우저 인쇄 잘림을 원천 차단합니다.
 */
export const AutoResizeTextarea: React.FC<AutoResizeTextareaProps> = ({
  value,
  className = '',
  onChange,
  rows = 1,
  placeholder,
  ...rest
}) => {
  const mirrorText = value.endsWith('\n') ? `${value} ` : value;

  return (
    <div className="growable-textarea w-full min-w-0">
      <div
        aria-hidden="true"
        className={`growable-textarea-mirror whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:keep-all] leading-snug ${className}`}
      >
        {value ? (
          mirrorText
        ) : (
          <span className="print:hidden">{placeholder || '\u00A0'}</span>
        )}
      </div>

      <textarea
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={onChange}
        className={`growable-textarea-input block w-full bg-transparent whitespace-pre-wrap break-words [overflow-wrap:anywhere] [word-break:keep-all] leading-snug focus:outline-none ${className}`}
        {...rest}
      />
    </div>
  );
};
