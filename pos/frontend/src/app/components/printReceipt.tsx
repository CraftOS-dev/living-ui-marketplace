/** Print a sale's receipt on the receipt printer; a reprint (`copy`) is marked COPY. */
import { printNode } from '../lib/print.tsx';
import type { Sale } from '../lib/types.ts';
import { Receipt } from './Receipt.tsx';

export function printReceipt(sale: Sale, width: '80' | '58', barcode: boolean, copy = false): void {
  const w = width === '58' ? 58 : 80;
  printNode(<Receipt sale={sale} width={w} barcode={barcode} copy={copy} />, w);
}
