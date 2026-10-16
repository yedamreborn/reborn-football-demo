/* 공통 로직. window.DATA가 있으면(정적 스냅샷) 그 값을, 없으면 API를 조회한다. 여러 대회 동시 운영을 전제로 한다. */
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
const TSTATUS = { DRAFT: "준비 중", OPEN: "접수 중", RUNNING: "진행 중", CLOSED: "종료", CANCELLED: "취소" };
const MODE = { NONE: "스코어만", GOAL: "득점 기록", FULL: "전체 기록" };
const played = (m) => m.status === "FINISHED" || m.status === "APPROVED";

const S = { ts: [], teams: {}, players: {}, matches: [], events: {}, cur: "all" };
const tname = (id) => (S.teams[id] || {}).name || "";
const tour = (id) => S.ts.find((t) => t.id === id) || {};
const short = (name) => (name || "").replace(/^\[데모\]\s*/, "");
const inScope = (m) => S.cur === "all" || m.tournament_id === S.cur;
const scoped = () => S.matches.filter(inScope);
const crest = (id, lg) => h("span", { class: "crest" + (lg ? " lg" : ""), "aria-hidden": "true" }, tname(id).trim()[0] || "?");
const statusTag = (m) => m.status === "LIVE" ? h("span", { class: "tag live" }, h("span", { class: "dot" }), "LIVE")
  : h("span", { class: "tag" + (played(m) ? " done" : "") }, STATUS[m.status]);

async function loadModel() {
  const [ts, teams, players] = await Promise.all([api("/tournaments?page_size=100"), api("/teams?page_size=100"), api("/players?page_size=100")]);
  S.ts = ts.items.slice().sort((a, b) => a.start_date.localeCompare(b.start_date) || a.name.localeCompare(b.name, "ko"));
  if (!S.ts.length) return false;
  teams.items.forEach((t) => (S.teams[t.id] = { name: t.name }));
  players.items.forEach((p) => (S.players[p.id] = p.name));
  const per = await Promise.all(S.ts.map((t) => api(`/tournaments/${t.id}/matches?page_size=100`)));
  S.matches = per.flatMap((r) => r.items).sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at) || a.field_no - b.field_no);
  const evs = await Promise.all(S.matches.map((m) => m.status === "SCHEDULED" ? { items: [] } : api(`/matches/${m.id}/events?page_size=100`)));
  S.matches.forEach((m, i) => (S.events[m.id] = evs[i].items));
  if (S.cur !== "all" && !tour(S.cur).id) S.cur = "all";
  return true;
}

/* 대회별 집계 */
function summary(tid) {
  const ms = S.matches.filter((m) => m.tournament_id === tid);
  const teams = new Set(ms.flatMap((m) => [m.home_team_id, m.away_team_id]));
  return { teams: teams.size, matches: ms.length, live: ms.filter((m) => m.status === "LIVE").length,
    pending: ms.filter((m) => m.status === "FINISHED").length, goals: ms.reduce((n, m) => n + m.home_score + m.away_score, 0) };
}

/* 순위: 한 대회의 종료/확정 경기만, 승 3 무 1 */
function standings(tid) {
  const tb = {}, ms = S.matches.filter((m) => m.tournament_id === tid);
  ms.forEach((m) => [m.home_team_id, m.away_team_id].forEach((id) => (tb[id] ??= { id, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 })));
  ms.filter(played).forEach((m) => {
    const H = tb[m.home_team_id], A = tb[m.away_team_id];
    H.p++; A.p++; H.gf += m.home_score; H.ga += m.away_score; A.gf += m.away_score; A.ga += m.home_score;
    if (m.home_score > m.away_score) { H.w++; A.l++; } else if (m.home_score < m.away_score) { A.w++; H.l++; } else { H.d++; A.d++; }
  });
  return Object.values(tb).map((r) => ({ ...r, gd: r.gf - r.ga, pts: r.w * 3 + r.d }))
    .sort((a, b) => b.pts - a.pts || b.gd - a.gd || b.gf - a.gf || tname(a.id).localeCompare(tname(b.id), "ko"));
}

/* 이벤트에서 다시 계산한 스코어 (취소된 득점 제외). 기록 방식이 스코어만(NONE)인 대회는 비교 대상이 아니다 */
function recomputed(m) {
  let hs = 0, as = 0;
  (S.events[m.id] || []).forEach((e) => { if (GOALS.has(e.event_type) && !e.reversed) (e.scoring_team_id === m.home_team_id ? hs++ : as++); });
  return [hs, as];
}
const checkable = (m) => m.status !== "SCHEDULED" && tour(m.tournament_id).record_mode !== "NONE";
