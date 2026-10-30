/// <reference path="../pb_data/types.d.ts" />
/**
 * The overview on Home: boards with their previews, what the boards hold by
 * kind, which days of a month cards were added, the latest cards, the most
 * used tags, and what is with the AI agent or waiting for the person.
 */

function pad(n) {
  return n < 10 ? '0' + n : String(n);
}

/** A stored UTC datetime as this computer's local day 'YYYY-MM-DD'. */
function localDay(pbDate) {
  const d = new Date(Date.parse(String(pbDate).replace(' ', 'T')));
  if (isNaN(d.getTime())) return '';
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function thisMonth() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1);
}

function shiftMonth(m, n) {
  const y = Number(m.slice(0, 4));
  const mm = Number(m.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(mm / 12);
  return yy + '-' + pad((((mm % 12) + 12) % 12) + 1);
}

function home(app, month) {
  const cardsLib = require(`${__hooks}/lib_cards.js`);
  const boardsLib = require(`${__hooks}/lib_boards.js`);
  const settings = require(`${__hooks}/lib_settings.js`);
  const m = month || thisMonth();
  const prev = shiftMonth(m, -1);
  const y = Number(m.slice(0, 4));
  const mo = Number(m.slice(5, 7));
  const daysIn = new Date(y, mo, 0).getDate();

  const boards = boardsLib.list(app, true);
  const boardName = {};
  for (const b of boards) boardName[b.id] = b.name;

  const live = app.findRecordsByFilter('cards', cardsLib.LIVE + " && kind != 'section'", '-created', 0, 0);
  const kinds = {};
  const perDay = {};
  const tagCount = {};
  const tagLabel = {};
  let monthTotal = 0;
  let prevTotal = 0;
  let starred = 0;
  let digestsBusy = 0;
  let digestsFailed = 0;
  for (const r of live) {
    const kind = r.getString('kind');
    kinds[kind] = (kinds[kind] || 0) + 1;
    const day = localDay(r.getString('created'));
    if (day.slice(0, 7) === m) {
      perDay[day] = (perDay[day] || 0) + 1;
      monthTotal++;
    } else if (day.slice(0, 7) === prev) prevTotal++;
    if (r.getBool('starred')) starred++;
    const ds = r.getString('digest_state');
    if (ds === 'waiting' || ds === 'reading') digestsBusy++;
    if (ds === 'failed') digestsFailed++;
    for (const t of cardsLib.jsonField(r, 'tags', [])) {
      const k = String(t).toLowerCase();
      tagCount[k] = (tagCount[k] || 0) + 1;
      if (tagLabel[k] === undefined) tagLabel[k] = String(t);
    }
  }
  const days = [];
  for (let d = 1; d <= daysIn; d++) {
    const key = m + '-' + pad(d);
    days.push({ date: key, count: perDay[key] || 0 });
  }
  const tags = Object.keys(tagCount)
    .map((k) => ({ tag: tagLabel[k], count: tagCount[k] }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 12);
  const recent = live.slice(0, 8).map((r) => {
    const c = cardsLib.serialize(app, r, null);
    c.board_name = boardName[c.board] || '';
    return c;
  });
  let links = 0;
  let proposed = 0;
  for (const b of boards) {
    links += b.links;
    proposed += b.proposed;
  }
  const reviews = boards.filter((b) => b.review_state === 'waiting' || b.review_state === 'working').length;
  return {
    title: settings.row(app).getString('title'),
    month: m,
    totals: { boards: boards.length, cards: live.length, links: links, proposed: proposed, starred: starred, tags: Object.keys(tagCount).length },
    kinds: kinds,
    days: days,
    month_total: monthTotal,
    previous_month: prev,
    previous_total: prevTotal,
    recent: recent,
    tags: tags,
    boards: boards,
    agent: { digests_busy: digestsBusy, digests_failed: digestsFailed, reviews_busy: reviews, proposed: proposed },
  };
}

module.exports = { home: home, localDay: localDay, thisMonth: thisMonth };
