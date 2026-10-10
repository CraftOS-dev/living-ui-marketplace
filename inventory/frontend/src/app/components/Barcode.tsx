/**
 * Scannable codes drawn as SVG: a Code 128 barcode (read by every handheld
 * scanner) and a QR code (read by 2D scanners and phone cameras). Labels
 * are printed black on white whatever the theme, so these use fixed ink.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';
import qrcode from 'qrcode-generator';

/** Code 128 holds plain ASCII; anything else needs a QR code. */
export function code128Ok(value: string): boolean {
  if (value === '') return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

export function Code128({ value, height = 48, className, barWidth = 2 }: { value: string; height?: number; className?: string; barWidth?: number }): React.JSX.Element {
  const ref = useRef<SVGSVGElement | null>(null);
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    if (!code128Ok(value)) {
      setFailed(true);
      return;
    }
    try {
      JsBarcode(el, value, {
        format: 'CODE128',
        displayValue: false,
        height,
        width: barWidth,
        margin: 0,
        background: 'transparent',
        lineColor: '#111111',
      });
      // Scale to the box it is given, keeping the bars' proportions.
      const w = el.getAttribute('width');
      const h = el.getAttribute('height');
      if (w !== null && h !== null) {
        el.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
        el.setAttribute('preserveAspectRatio', 'none');
        el.removeAttribute('width');
        el.removeAttribute('height');
      }
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [value, height, barWidth]);
  if (failed) {
    return <span className={className}>This code has characters a barcode cannot hold. Print it as a QR code.</span>;
  }
  return <svg ref={ref} className={className} role="img" aria-label={`Barcode ${value}`} />;
}

export function QrCode({ value, className }: { value: string; className?: string }): React.JSX.Element {
  const qr = useMemo(() => {
    const q = qrcode(0, 'M');
    q.addData(value, 'Byte');
    q.make();
    return q;
  }, [value]);
  const n = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    }
  }
  return (
    <svg viewBox={`-1 -1 ${n + 2} ${n + 2}`} className={className} role="img" aria-label={`QR code ${value}`} shapeRendering="crispEdges">
      <rect x={-1} y={-1} width={n + 2} height={n + 2} fill="#ffffff" />
      <path d={d} fill="#111111" />
    </svg>
  );
}
