/* 공통 로직. window.DATA가 있으면(정적 스냅샷) 그 값을, 없으면 API를 조회한다. */
const $ = (s, r = document) => r.querySelector(s);
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) k === "class" ? (e.className = v) : e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
};
const icon = (name, fill) => h("i", { class: (fill ? "ph-fill ph-" : "ph-bold ph-") + name, "aria-hidden": "true" });
const api = async (p) => {
  if (window.DATA) { const d = window.DATA[p.split("?")[0]]; if (!d) throw new Error(p); return d; }
  const r = await fetch(p); if (!r.ok) throw new Error(p); return (await r.json()).data;
};
const TZ = { timeZone: "Asia/Seoul" };
const day = (iso) => { const p = new Intl.DateTimeFormat("ko-KR", { ...TZ, month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(iso));
  const g = (t) => p.find((x) => x.type === t).value; return `${g("month")}.${g("day")}(${g("weekday")})`; };
const hms = (iso) => new Date(iso).toLocaleTimeString("ko-KR", { ...TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const hm = (iso) => new Date(iso).toLocaleTimeString("ko-KR", { ...TZ, hour: "2-digit", minute: "2-digit", hour12: false });
const HALF = { 1: "전반", 2: "후반", 3: "연장 전반", 4: "연장 후반" };
const GOALS = new Set(["GOAL", "PENALTY_GOAL", "OWN_GOAL"]);
const STATUS = { SCHEDULED: "예정", LIVE: "진행 중", FINISHED: "종료", APPROVED: "결과 확정", CANCELLED: "취소" };
const played = (m) => m.status === "FINISHED" || m.status === "APPROVED";

const S = { t: null, teams: {}, players: {}, matches: [], events: {} };
const tname = (id) => (S.teams[id] || {}).name || "";
const crest = (id, lg) => h("span", { class: "crest" + (lg ? " lg" : ""), "aria-hidden": "true" }, tname(id).trim()[0] || "?");
const statusTag = (m) => m.status === "LIVE" ? h("span", { class: "tag live" }, h("span", { class: "dot" }), "LIVE")
  : h("span", { class: "tag" + (played(m) ? " done" : "") }, STATUS[m.status]);

async function loadModel() {
  const [ts, teams, players] = await Promise.all([api("/tournaments?page_size=1"), api("/teams?page_size=100"), api("/players?page_size=100")]);
  S.t = ts.items[0]; S.tTotal = ts.total; if (!S.t) return false;
  teams.items.forEach((t) => (S.teams[t.id] = { name: t.name }));
  players.items.forEach((p) => (S.players[p.id] = p.name));
  S.matches = (await api(`/tournaments/${S.t.id}/matches?page_size=100`)).items
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.field_no - b.field_no);
  const evs = await Promise.all(S.matches.map((m) => m.status === "SCHEDULED" ? { items: [] } : api(`/matches/${m.id}/events?page_size=100`)));
  S.matches.forEach((m, i) => (S.events[m.id] = evs[i].items));
  return true;
}

/* 순위: 종료/확정 경기만, 승 3 무 1 */
function standings() {
  const tb = {};
  S.matches.forEach((m) => [m.home_team_id, m.away_team_id].forEach((id) => (tb[id] ??= { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 })));
  S.matches.filter(played).forEach((m) => {
    const H = tb[m.home_team_id], A = tb[m.away_team_id];
    H.p++; A.p++; H.gf += m.home_score; H.ga += m.away_score; A.gf += m.away_score; A.ga += m.home_score;
    if (m.home_score > m.away_score) { H.w++; A.l++; } else if (m.home_score < m.away_score) { A.w++; H.l++; } else { H.d++; A.d++; }
  });
  return Object.values(tb).map((r) => ({ ...r, gd: r.gf - r.ga, pts: r.w * 3 + r.d }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || tname(a.id).localeCompare(tname(b.id), "ko"));
}

/* 이벤트에서 다시 계산한 스코어 (취소된 득점 제외). 저장된 스코어와 비교해 정합성 확인 */
function recomputed(m) {
  let hs = 0, as = 0;
  (S.events[m.id] || []).forEach((e) => { if (GOALS.has(e.event_type) && !e.reversed) (e.scoring_team_id === m.home_team_id ? hs++ : as++); });
  return [hs, as];
}
