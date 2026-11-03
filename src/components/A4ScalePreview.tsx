import React, { useEffect, useRef, useState } from 'react';

interface A4ScalePreviewProps {
  children: React.ReactNode;
  zoomMode?: 'fit' | 'actual';
}

const A4_WIDTH_PX = 794; // 210mm @ 96dpi

export const A4ScalePreview: React.FC<A4ScalePreviewProps> = ({
  children,
  zoomMode = 'fit',
}) => {
  const outerRef = useRef<HTMLDivElement | null>(null);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState<number>(1);
  const [scaledHeight, setScaledHeight] = useState<number | undefined>(
    undefined
  );

  useEffect(() => {
    const outerEl = outerRef.current;
    const innerEl = innerRef.current;
    if (!outerEl || !innerEl) return;

    const updateDimensions = () => {
      if (zoomMode === 'actual') {
        setScale(1);
        setScaledHeight(undefined);
        return;
      }
      const availableWidth = outerEl.clientWidth;
      const nextScale =
        availableWidth > 0 && availableWidth < A4_WIDTH_PX
          ? Number((availableWidth / A4_WIDTH_PX).toFixed(4))
          : 1;
      setScale(nextScale);

      if (nextScale < 1) {
        const naturalHeight = innerEl.offsetHeight || 1123;
        setScaledHeight(Math.ceil(naturalHeight * nextScale));
      } else {
        setScaledHeight(undefined);
      }
    };

    updateDimensions();

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });
    resizeObserver.observe(outerEl);
    resizeObserver.observe(innerEl);

    window.addEventListener('resize', updateDimensions);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', updateDimensions);
    };
  }, [zoomMode, children]);

  const isScaled = zoomMode === 'fit' && scale < 1;

  return (
    <div
      ref={outerRef}
      style={
        isScaled && scaledHeight ? { height: `${scaledHeight}px` } : undefined
      }
      className={`a4-scale-outer w-full ${
        zoomMode === 'actual' ? 'overflow-x-auto' : 'overflow-hidden'
      }`}
    >
      <div
        ref={innerRef}
        style={
          isScaled
            ? {
                width: `${A4_WIDTH_PX}px`,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }
            : undefined
        }
        className="a4-scale-inner"
      >
        {children}
      </div>
    </div>
  );
};
