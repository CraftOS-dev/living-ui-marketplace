/**
 * The company in 3D on the admin Home (home-reports), with the company's
 * readouts floating around it (no card, no border, no background). Two views,
 * switched at the top right and remembered per viewer (localStorage):
 *
 *   Globe   every office as a pillar on a turning globe of dots (globe3d.ts);
 *   Office  a dollhouse cutaway, one floor per entity, a desk per person
 *           (office3d.ts).
 *
 * Each scene is its own chunk (three.js shared), loaded after Home has painted
 * and only where WebGL starts; without it the readouts stand alone. Switching
 * disposes the old scene. The data is the `globe` part of home.admin, so the
 * page still sends one read. Hovering a thing (or a first tap) shows its
 * tooltip; a click (or a second tap) opens its people or the person.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Money, Segmented } from '../ui.tsx';
import { fmtDay, minutes, number, pad2, time } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { navigate } from '../../lib/router.ts';
import { setUi } from '../../lib/store.tsx';
import type { SceneData } from './globe3d.ts';
import type { OfficeSceneData, Plate } from './office3d.ts';
import type { GlobeAnswer, GlobeOffice, OfficeFloor, OfficePerson } from './types.ts';

type View = 'globe' | 'office';
const VIEW_KEY = 'hr.home.view3d';
/** Floors drawn in the office view; the rest fold into a "+N more offices" plate. */
const OFFICE_FLOORS = 8;

function readView(): View {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'office' ? 'office' : 'globe';
  } catch {
    return 'globe';
  }
}

function saveView(v: View): void {
  try {
    window.localStorage.setItem(VIEW_KEY, v);
  } catch {
    /* storage is off: the choice lasts for this visit */
  }
}

let webgl: boolean | null = null;

/** Can this browser start WebGL? Asked once, with a throwaway context. */
function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    const g = (c.getContext('webgl2') ?? c.getContext('webgl')) as WebGLRenderingContext | null;
    webgl = g !== null;
    g?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl = false;
  }
  return webgl;
}

function useReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const f = (): void => setOn(m.matches);
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, []);
  return on;
}

function sceneData(g: GlobeAnswer): SceneData {
  return {
    offices: g.offices.map((o) => ({ key: o.key, label: o.kind === 'entity' ? o.code || o.name : o.name, lat: o.lat, lng: o.lng, headcount: o.headcount, in_now: o.in_now, remote: o.remote, on_leave: o.on_leave, ins_recent: o.ins_recent, last_in: o.last_in })),
    head: g.head,
    close: g.mode === 'locations',
    payDays: g.next_pay !== null ? g.next_pay.days : null,
  };
}

function officeData(g: GlobeAnswer): OfficeSceneData {
  const floors = g.floors ?? [];
  return {
    floors: floors.slice(0, OFFICE_FLOORS).map((f) => ({ key: 'f:' + f.entity, timezone: f.timezone, rooms: f.departments.map((d) => ({ key: d.id, people: d.people.map((x) => ({ key: 'p:' + x.id, state: x.state, since: x.since_min })) })) })),
    more: Math.max(0, floors.length - OFFICE_FLOORS),
  };
}

/** Open an entity's people (the sidebar switch set to it). */
function openEntity(entity: string): void {
  setUi({ entity });
  navigate('/people');
}

/** Open an office's people: the entity in the sidebar switch, or the location filter. */
function openPeople(o: GlobeOffice): void {
  if (o.kind === 'location') navigate('/people', { location: o.id });
  else {
    setUi({ entity: o.entity });
    navigate('/people');
  }
}

/** Time to the next pay day, ticking (by the minute with reduced motion). */
function Countdown({ at, reduced }: { at: string; reduced: boolean }): React.JSX.Element {
  const target = Date.parse(at);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setNow(Date.now()), reduced ? 30000 : 1000);
    return () => window.clearInterval(h);
  }, [reduced]);
  let s = Math.max(0, Math.floor((target - now) / 1000));
  if (!Number.isFinite(s) || s === 0) return <>{t('home.globe.today')}</>;
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  return (
    <>
      {d > 0 && (
        <>
          {d}
          <span className="text-[15px] text-[var(--hr-muted)]">d</span>{' '}
        </>
      )}
      {pad2(h)}:{pad2(m)}
      {!reduced && <span className="text-[var(--hr-muted)]">:{pad2(s - m * 60)}</span>}
    </>
  );
}

interface Readout {
  key: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  href: string;
}

function ReadoutView({ r, align, small }: { r: Readout; align: 'start' | 'end'; small: boolean }): React.JSX.Element {
  return (
    <a href={r.href} className={cn('hr-focus pointer-events-auto block min-w-0 rounded-[var(--hr-radius-sm)] px-2 py-1.5 transition-colors hover:bg-[var(--hr-hover)]', align === 'end' && 'text-right')}>
      <span className="hr-label block truncate">{r.label}</span>
      <span className={cn('hr-mono hr-num mt-1 block whitespace-nowrap font-light leading-none tracking-tight', small ? 'text-[15px]' : 'text-[26px]')}>{r.value}</span>
      {r.sub !== undefined && r.sub !== null && r.sub !== '' && <span className="mt-1 block truncate text-[12px] text-[var(--hr-muted)]">{r.sub}</span>}
    </a>
  );
}

/** What the tooltip says about one office. */
function OfficeTip({ o, onOpen }: { o: GlobeOffice; onOpen: () => void }): React.JSX.Element {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const h = window.setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => window.clearInterval(h);
  }, []);
  const rows: [string, ReactNode][] = [[t('home.globe.tip.headcount'), number(o.headcount)]];
  if (o.in_now !== null) rows.push([t('home.globe.tip.in_now'), number(o.in_now) + (o.remote !== null && o.remote > 0 ? ' · ' + t('home.globe.remote', { n: o.remote }) : '')]);
  rows.push([t('home.globe.tip.on_leave'), number(o.on_leave)]);
  if (o.open_roles > 0) rows.push([t('home.globe.tip.open_roles'), number(o.open_roles)]);
  if (o.next_pay !== '') rows.push([t('home.globe.tip.next_pay'), fmtDay(o.next_pay, { weekday: true, entity: o.entity })]);
  return (
    <div role="tooltip" className="pointer-events-auto w-[220px] -translate-x-1/2 rounded-[4px] bg-[var(--hr-ink)] px-3 py-2.5 text-[12px] leading-[17px] text-[var(--hr-on-ink)] shadow-[var(--hr-shadow-lg)]">
      <div className="truncate text-[13px] font-medium">{o.name}</div>
      <div className="hr-label truncate !text-[var(--hr-on-ink)] opacity-75">{[o.kind === 'location' ? o.entity_name : o.country, t('home.globe.local', { time: time(now, { entity: o.entity }) })].filter((x) => x !== '').join(' · ')}</div>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="opacity-75">{k}</dt>
            <dd className="hr-mono text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={onOpen} className="hr-label hit mt-2 inline-flex cursor-pointer items-center gap-1 rounded-[3px] !text-[var(--hr-on-ink)] underline-offset-4 hover:underline">
        {t('home.globe.open_people')} <ArrowRight size={12} aria-hidden />
      </button>
    </div>
  );
}

const TIP = 'pointer-events-auto w-[220px] -translate-x-1/2 rounded-[4px] bg-[var(--hr-ink)] px-3 py-2.5 text-[12px] leading-[17px] text-[var(--hr-on-ink)] shadow-[var(--hr-shadow-lg)]';
const TIP_LINK = 'hr-label hit mt-2 inline-flex cursor-pointer items-center gap-1 rounded-[3px] !text-[var(--hr-on-ink)] underline-offset-4 hover:underline';

function useNow(): string {
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const h = window.setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => window.clearInterval(h);
  }, []);
  return now;
}

/** A floor of the office view: its office, local time and today's counts. */
function FloorTip({ f }: { f: OfficeFloor }): React.JSX.Element {
  const now = useNow();
  const rows: [string, string][] = [[t('home.globe.tip.headcount'), number(f.headcount)]];
  if (f.in_now !== null) rows.push([t('home.globe.tip.in_now'), number(f.in_now)]);
  if (f.remote !== null) rows.push([t('home.office.tip.remote'), number(f.remote)]);
  rows.push([t('home.globe.tip.on_leave'), number(f.on_leave)]);
  return (
    <div role="tooltip" className={TIP}>
      <div className="truncate text-[13px] font-medium">{f.name}</div>
      <div className="hr-label truncate !text-[var(--hr-on-ink)] opacity-75">{[f.city, t('home.globe.local', { time: time(now, { entity: f.entity }) })].filter((x) => x !== '').join(' · ')}</div>
      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="opacity-75">{k}</dt>
            <dd className="hr-mono text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <button type="button" onClick={() => openEntity(f.entity)} className={TIP_LINK}>
        {t('home.globe.open_people')} <ArrowRight size={12} aria-hidden />
      </button>
    </div>
  );
}

/** What a person's desk says: who, their title and room, and today's state. */
function PersonTip({ p, room }: { p: OfficePerson; room: string }): React.JSX.Element {
  const state =
    p.state === 'in_now' && p.since_min !== null
      ? t('home.office.in_for', { time: minutes(p.since_min) })
      : p.state === 'late'
        ? t('home.office.late_by', { time: minutes(p.late_min) })
        : t('home.office.state.' + p.state);
  const tone = p.state === 'in_now' ? 'var(--hr-rh)' : p.state === 'remote' ? 'var(--hr-lh)' : p.state === 'on_leave' || p.state === 'late' ? 'var(--hr-warn)' : 'var(--hr-line-2)';
  return (
    <div role="tooltip" className={TIP}>
      <div className="truncate text-[13px] font-medium">{p.name}</div>
      <div className="truncate opacity-75">{[p.title, room].filter((x) => x !== '').join(' · ')}</div>
      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="size-2 shrink-0 rounded-full" style={{ background: tone }} aria-hidden />
        <span className="truncate">{state}</span>
      </div>
      <button type="button" onClick={() => navigate('/people/' + p.id)} className={TIP_LINK}>
        {t('home.office.open_profile')} <ArrowRight size={12} aria-hidden />
      </button>
    </div>
  );
}

const LEGEND: { key: string; color: string; time: boolean }[] = [
  { key: 'in', color: 'var(--hr-rh)', time: true },
  { key: 'remote', color: 'var(--hr-lh)', time: true },
  { key: 'leave', color: 'var(--hr-warn)', time: false },
  { key: 'out', color: 'var(--hr-line-2)', time: false },
];

/** A scene in the stage: data pushed in when the answer changes. */
interface Live3d {
  refresh: () => void;
  setReduced: (on: boolean) => void;
  dispose: () => void;
}

/** The company in 3D with its readouts: Home's place right after the setup guide. */
export function CompanyGlobe({ g, headcount, reporting, index }: { g: GlobeAnswer; headcount: number; reporting: string; index?: string | undefined }): React.JSX.Element {
  const stage = useRef<HTMLDivElement | null>(null);
  const labels = useRef<HTMLDivElement | null>(null);
  const anchor = useRef<HTMLDivElement | null>(null);
  const handle = useRef<Live3d | null>(null);
  const reduced = useReducedMotion();
  const [view, setView] = useState<View>(readView);
  const [gl, setGl] = useState<'wait' | 'on' | 'off'>(() => (hasWebGL() ? 'wait' : 'off'));
  const [focus, setFocus] = useState<string | null>(null);
  const globeData = useMemo(() => sceneData(g), [g]);
  const office = useMemo(() => officeData(g), [g]);
  const floors = g.floors ?? [];
  const latest = useRef({ globeData, office, g, reduced });
  latest.current = { globeData, office, g, reduced };

  useEffect(() => {
    if (gl === 'off') return;
    let gone = false;
    let h: Live3d | null = null;
    setFocus(null);
    const events = {
      onFocus: setFocus,
      onSelect: (key: string): void => {
        const cur = latest.current.g;
        if (key.startsWith('f:')) openEntity(key.slice(2));
        else if (key.startsWith('p:')) navigate('/people/' + key.slice(2));
        else {
          const o = cur.offices.find((x) => x.key === key);
          if (o !== undefined) openPeople(o);
        }
      },
    };
    const make = async (): Promise<Live3d | null> => {
      if (stage.current === null || labels.current === null || anchor.current === null) return null;
      const host = { host: stage.current, labels: labels.current, anchor: anchor.current, reduced: latest.current.reduced, events };
      if (view === 'office') {
        const m = await import('./office3d.ts');
        if (gone) return null;
        const plate = (key: string): Plate => {
          const f = (latest.current.g.floors ?? []).find((x) => 'f:' + x.entity === key);
          if (f === undefined) return { code: '', time: '' };
          return { code: f.country, time: time(new Date().toISOString(), { entity: f.entity }) };
        };
        const x = await m.createOffice({ ...host, data: latest.current.office, plate, more: (n) => tn('home.office.more', n) });
        return { refresh: () => x.update(latest.current.office), setReduced: x.setReduced, dispose: x.dispose };
      }
      const m = await import('./globe3d.ts');
      if (gone) return null;
      const x = await m.createGlobe({ ...host, data: latest.current.globeData });
      return { refresh: () => x.update(latest.current.globeData), setReduced: x.setReduced, dispose: x.dispose };
    };
    make()
      .then((x) => {
        if (x === null) return;
        if (gone) {
          x.dispose();
          return;
        }
        h = x;
        handle.current = x;
        setGl('on');
      })
      .catch(() => {
        if (!gone) setGl('off');
      });
    return () => {
      gone = true;
      h?.dispose();
      handle.current = null;
    };
    // A scene is built once per view; data and motion changes go through the handle.
  }, [view]);
  useEffect(() => handle.current?.refresh(), [globeData, office]);
  useEffect(() => handle.current?.setReduced(reduced), [reduced]);
  const pick = (v: View): void => {
    setView(v);
    saveView(v);
  };

  const tot = g.totals;
  const locations = g.offices.filter((o) => o.kind === 'location').length;
  const items: Readout[] = [];
  items.push({ key: 'head', label: t('home.globe.headcount'), value: number(headcount), sub: g.mode === 'entities' ? tn('home.globe.entities', g.offices.length) : locations > 0 ? tn('home.globe.locations', locations) : (g.offices[0]?.name ?? ''), href: '#/people' });
  if (tot.in_now !== null) items.push({ key: 'in', label: t('home.globe.in_now'), value: number(tot.in_now), sub: tot.remote !== null && tot.remote > 0 ? t('home.globe.remote', { n: tot.remote }) : tn('home.globe.of_people', headcount), href: '#/time' });
  items.push({ key: 'leave', label: t('home.globe.on_leave'), value: number(tot.on_leave), sub: tn('home.globe.of_people', headcount), href: '#/leave/calendar' });
  items.push({ key: 'roles', label: t('home.globe.open_roles'), value: number(tot.open_roles), href: '#/hiring' });
  const np = g.next_pay;
  if (np !== null) items.push({ key: 'pay', label: t('home.globe.next_pay'), value: np.days <= 0 ? t('home.globe.today') : <Countdown at={np.at} reduced={reduced} />, sub: [g.mode === 'entities' ? np.entity_name : '', fmtDay(np.day, { weekday: true, entity: np.entity })].filter((x) => x !== '').join(' · '), href: '#/payroll' });
  const pm = g.payroll_month;
  if (pm !== null) {
    const value =
      pm.runs === 0 ? (
        <span className="text-[13px] tracking-normal text-[var(--hr-muted)]">{t('home.globe.no_run')}</span>
      ) : pm.minor !== null ? (
        <Money minor={pm.minor} currency={pm.currency} display="code" format={{ compact: true }} />
      ) : (
        <span className="flex flex-col gap-0.5 text-[15px]">
          {pm.parts.slice(0, 3).map((x) => (
            <Money key={x.currency} minor={x.minor} currency={x.currency} display="code" format={{ compact: true }} />
          ))}
        </span>
      );
    const sub = pm.runs === 0 ? '' : pm.minor === null ? <span className="!text-[var(--hr-warn)]">{t('home.kpi.no_rate', { currency: reporting })}</span> : t('home.globe.runs_locked', { locked: pm.locked, runs: pm.runs });
    items.push({ key: 'cost', label: t('home.globe.payroll_month'), value, sub, href: '#/reports/cost' });
  }
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);
  // The tooltip for what the pointer rests on: an office (globe), a floor or a person (office).
  let tip: ReactNode = null;
  if (focus !== null && view === 'globe') {
    const o = g.offices.find((x) => x.key === focus);
    if (o !== undefined) tip = <OfficeTip o={o} onOpen={() => openPeople(o)} />;
  } else if (focus !== null && focus.startsWith('f:')) {
    const f = floors.find((x) => 'f:' + x.entity === focus);
    if (f !== undefined) tip = <FloorTip f={f} />;
  } else if (focus !== null && focus.startsWith('p:')) {
    for (const f of floors)
      for (const d of f.departments) {
        const p = d.people.find((x) => 'p:' + x.id === focus);
        if (p !== undefined) tip = <PersonTip p={p} room={d.name !== '' ? d.name : t('home.office.no_dept')} />;
      }
  }
  const legend = LEGEND.filter((x) => g.time_visible || !x.time);
  const summary = view === 'office' ? t('home.office.aria', { list: floors.map((f) => f.name + ': ' + tn('home.people_n', f.headcount)).join('; ') }) : t('home.globe.aria', { list: g.offices.map((o) => o.name + ': ' + tn('home.people_n', o.headcount)).join('; ') });

  return (
    <section className="hr-in relative min-w-0" aria-label={t('home.globe.title')} data-globe="" data-view={view}>
      <header className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1">
        {index !== undefined && <span className="hr-label !text-[var(--hr-faint)]">{index}</span>}
        <span className="hr-label min-w-[min(100%,140px)] flex-1 truncate">{t('home.globe.title')}</span>
        {gl !== 'off' && (
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1" aria-hidden>
            {legend.map((x) => (
              <span key={x.key} className="hr-label inline-flex items-center gap-1.5">
                <span className="size-2 rounded-[2px]" style={{ background: x.color }} />
                {t('home.globe.legend.' + x.key)}
              </span>
            ))}
          </span>
        )}
        {gl !== 'off' && (
          <Segmented<View>
            size="sm"
            value={view}
            onChange={pick}
            label={t('home.globe.view')}
            options={[
              { value: 'globe', label: <span className="hr-label !text-[inherit]">{t('home.globe.view.globe')}</span> },
              { value: 'office', label: <span className="hr-label !text-[inherit]">{t('home.globe.view.office')}</span> },
            ]}
          />
        )}
      </header>
      {gl === 'off' ? (
        <div className="grid grid-cols-2 gap-1 py-2 sm:grid-cols-3 lg:grid-cols-6">
          {items.map((r) => (
            <ReadoutView key={r.key} r={r} align="start" small={false} />
          ))}
        </div>
      ) : (
        <>
          <div className="relative h-[360px] lg:h-[480px]" data-globe-stage="">
            <div ref={stage} className="absolute inset-0" role="img" aria-label={summary} />
            <div ref={labels} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden />
            <div ref={anchor} className="pointer-events-none absolute left-0 top-0 z-10" style={{ visibility: 'hidden', opacity: 0 }}>
              {tip}
            </div>
            <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-[230px] flex-col justify-center gap-5 lg:flex">
              {left.map((r) => (
                <ReadoutView key={r.key} r={r} align="start" small={false} />
              ))}
            </div>
            <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[230px] flex-col items-end justify-center gap-5 lg:flex">
              {right.map((r) => (
                <ReadoutView key={r.key} r={r} align="end" small={false} />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-1 gap-y-2 pt-1 sm:grid-cols-3 lg:hidden">
            {items.map((r) => (
              <ReadoutView key={r.key} r={r} align="start" small />
            ))}
          </div>
        </>
      )}
      <ul className="sr-only">
        {view === 'office'
          ? floors.map((f) => (
              <li key={f.entity}>
                <button type="button" onClick={() => openEntity(f.entity)}>
                  {f.name}: {tn('home.people_n', f.headcount)}
                </button>
              </li>
            ))
          : g.offices.map((o) => (
              <li key={o.key}>
                <button type="button" onClick={() => openPeople(o)}>
                  {o.name}: {tn('home.people_n', o.headcount)}
                </button>
              </li>
            ))}
      </ul>
    </section>
  );
}
