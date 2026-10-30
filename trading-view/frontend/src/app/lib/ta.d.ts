/** Types of the shared indicator library (ta.js, a copy of pb/pb_hooks/lib_ta.js). */

export interface TaBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type Series = (number | null)[];

export interface ParamDef {
  key: string;
  label: string;
  default: number | string;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface OutputDef {
  key: string;
  label: string;
  kind: 'line' | 'histogram' | 'dots' | 'hidden';
}

export interface IndicatorDef {
  id: string;
  name: string;
  short: string;
  group: 'Trend' | 'Momentum' | 'Volatility' | 'Volume';
  overlay: boolean;
  params: ParamDef[];
  outputs: OutputDef[];
  bands?: number[];
  range?: [number, number];
  fill?: [string, string];
}

export type Params = Record<string, number | string>;

export interface Computed {
  id: string;
  params: Params;
  label: string;
  outputs: Record<string, Series>;
  offsets: Record<string, number>;
}

export interface Level {
  price: number;
  kind: 'support' | 'resistance';
  touches: number;
  last_touch: number;
  distance_pct: number;
}

export const CATALOGUE: IndicatorDef[];
export const SOURCES: string[];
export function find(id: string): IndicatorDef | null;
export function params(id: string, given?: Params): Params;
export function label(id: string, prm: Params): string;
export function compute(id: string, bars: TaBar[], given?: Params, opts?: { offset?: number; periodsPerYear?: number }): Computed;
export function sma(x: Series, len: number): Series;
export function ema(x: Series, len: number): Series;
export function rma(x: Series, len: number): Series;
export function stdev(x: Series, len: number): Series;
export function trueRange(bars: TaBar[]): number[];
export function rsiOf(x: Series, len: number): Series;
export function swings(bars: TaBar[], span?: number): { i: number; t: number; price: number; kind: 'high' | 'low' }[];
export function levels(bars: TaBar[], maxLevels?: number): Level[];
export function lastOf(x: Series): number | null;
