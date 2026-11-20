// Money is unambiguous by default: the ISO code, and the symbol only for the reporting
// currency while it is the only currency on screen; exponents per currency. No server.
// Usage: node money.mjs  (HR_APP points at the app copy; Node 24 runs the .ts directly)
import { pathToFileURL } from 'node:url';

const APP = process.env.HR_APP ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/app';
const m = await import(pathToFileURL(APP + '/frontend/src/app/lib/money.ts').href);
const nb = (s) => s.replace(/\u00a0/g, ' ');
const fails = [];
const want = (label, got, exp) => {
  if (nb(got) !== exp) fails.push(`${label}: got "${nb(got)}", want "${exp}"`);
};

m.setReportingCurrency('SGD');
want('USD is not the reporting currency', m.formatMoney(125000, 'USD'), 'USD 1,250.00');
want('JPY has no decimals', m.formatMoney(250000, 'JPY'), 'JPY 250,000');
want('KWD has three', m.formatMoney(1250500, 'KWD'), 'KWD 1,250.500');
const offSgd = m.showCurrency('SGD');
want('reporting currency alone on screen', m.formatMoney(125000, 'SGD'), '$1,250.00');
const offUsd = m.showCurrency('USD');
want('SGD beside USD', m.formatMoney(125000, 'SGD'), 'SGD 1,250.00');
offUsd();
want('USD left the screen', m.formatMoney(125000, 'SGD'), '$1,250.00');
offSgd();
want('forced code', m.formatMoney(125000, 'SGD', { display: 'code' }), 'SGD 1,250.00');
want('forced symbol', m.formatMoney(125000, 'USD', { display: 'symbol' }), '$1,250.00');
want('none', m.formatMoney(125000, 'SGD', { display: 'none' }), '1,250.00');
want('parse JPY', String(m.parseMoney('250,000', 'JPY')), '250000');
want('parse refuses JPY decimals', String(m.parseMoney('1.5', 'JPY')), 'null');
console.log(fails.length === 0 ? 'ok: money shows codes unless the reporting currency is alone on screen; exponents hold' : fails.join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
