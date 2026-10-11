/**
 * A Code 128 barcode drawn as SVG (read by every handheld scanner): the
 * receipt number printed under each receipt, so a return starts with a
 * scan. Receipts print black on white whatever the theme, so it uses fixed
 * ink.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import JsBarcode from 'jsbarcode';

/** Code 128 holds plain ASCII; anything else needs a QR code. */
export function code128Ok(value: string): boolean {
  if (value === '') return false;
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c < 32 || c > 126) return false;
  }
  return true;
}

export function Code128({ value, height = 48, className, barWidth = 2 }: { value: string; height?: number; className?: string; barWidth?: number }): React.JSX.Element | null {
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
    return null;
  }
  return <svg ref={ref} className={className} role="img" aria-label={`Barcode ${value}`} />;
}
