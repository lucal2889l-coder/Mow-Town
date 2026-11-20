// Mow Town — server script (v1.15)
// ─────────────────────────────────────────────────────────────────────────────
// Paste this whole file into your dashboard: Game → Server logic → Save & deploy.
// See SETUP-SERVER.md for the dashboard settings that go with it.
//
// What it does:
//   • Accounts: a username + a secret sign-in code. Every device sends the code with each request, so one
//     account can be signed in on as many devices as you like AT THE SAME TIME. Saves, profiles and leaderboard
//     numbers are kept here, and only this script can change them.
//   • Old accounts (from v1.13–1.14, which used the server's one-device logins) are moved over automatically.
//   • Admin panel: checks the admin password (it lives only here, never in the game), changes money / stats /
//     mowers, sends messages, and kicks or bans players.
//   • Scott Bonnar vs Rover event: one vote per account, lawns at a believable speed, winner set once.
// DON'T upload this file to GitHub: it contains the admin password and the secret below.

const ADMIN_PASSWORD = '2913';          // change this to change the admin password (longer is safer)
const SECRET = 'mowtown-7Qx2-kP9v-Lm4s'; // scrambles sign-in codes before they're stored. NEVER change it, or every code stops working.

const EV = {
  key: 'ev1_',                          // must match EVENT.key in index.html
  sides: ['scott', 'rover'],
  target: 250,                          // first team to this many lawns wins
  end: Date.UTC(2026, 10, 19, 9, 0, 0), // must match EVENT.end in index.html (month 10 = November)
  burst: 6, refillSec: 20, maxPerMsg: 6, // 6 lawns at once, then 1 more every 20 s (faster than anyone can mow)
  dayCap: 150                           // no account can add more than this many lawns in one day (UTC)
};
const LB = {                            // leaderboard speed limits (the real numbers stay in the player's save)
  firstEarned: 500000, earnedBurst: 20000, earnedPerSec: 40,
  firstLawns: 5000, lawnsBurst: 10, secPerLawn: 8,
  minRace: 5                            // fastest lawn cut can't be quicker than this (seconds)
};
const ONLINE_MS = 100000;               // the game checks in every 40 s, so "seen in the last 100 s" means online

// ─── helpers ───
const val = v => { if (v && typeof v.then === 'function') throw new Error('Mow Town script expects synchronous room.storage'); return v; };
const priv = player => ({ player: player.id, scope: 'private' });
const num = (v, lo, hi) => { v = Math.floor(Number(v)); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null; };
const cleanName = v => { const n = String(v || '').replace(/\s+/g, ' ').trim(); return n.length >= 2 && n.length <= 16 && /^[\p{L}\p{N} _'.-]+$/u.test(n) ? n : null; };
const CODE_ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const normCode = v => { const s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); return s.length === 10 && [...s].every(c => CODE_ABC.includes(c)) ? s.slice(0, 5) + '-' + s.slice(5) : null; };
function hash53(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const codeKey = c => 'code:' + hash53(SECRET + '|' + c).toString(36) + hash53(c + '|' + SECRET).toString(36); // the code itself is never stored
const oldLogin = c => 'mt' + hash53('mowtown-account|' + c).toString(36); // what v1.13 called this code's login
const rnd = n => { let s = ''; for (let i = 0; i < n; i++) s += CODE_ABC[Math.floor(Math.random() * CODE_ABC.length)]; return s; };
const activeBan = (b, now) => b && (!b.until || b.until > now) ? { until: b.until || 0, reason: b.reason || '' } : null;

function getAcc(room, aid) { return aid ? val(room.storage.get('acc:' + aid)) : null; }
function putAcc(room, aid, acc) {
  if (acc.ops.length > 30) acc.ops = acc.ops.slice(-30); if (acc.msgs.length > 20) acc.msgs = acc.msgs.slice(-20); if (acc.edits.length > 300) acc.edits = acc.edits.slice(-300);
  val(room.storage.set('acc:' + aid, acc));
}
function newAcc(name, now, pid) { return { name, created: now, devices: [pid], live: {}, saves: {}, edits: [], ops: [], msgs: [], seq: 0, kickAt: 0, ban: null }; }
function poke(room, acc) { for (const pid of (acc.devices || []).slice(0, 6)) { try { val(room.inbox.send(pid, 'mt_poke', {})); } catch (e) { } } } // "check in now"
function claimName(room, aid, wanted) { // gives back a free version of the name (adds a number if it's taken)
  for (let i = 0; i < 20; i++) {
    const name = i ? (wanted.slice(0, 13) + (i + 1)) : wanted, lc = name.toLowerCase(), owner = val(room.storage.get('name:' + lc));
    if (!owner || owner === aid) { val(room.storage.set('name:' + lc, aid)); return name; }
  }
  return null;
}
function news(room, acc) { return { ops: acc.ops, msgs: acc.msgs, kickAt: acc.kickAt || 0, bcast: val(room.storage.get('bcast')) || null, name: acc.name }; }
// Requests about an account carry its code: find the account, check bans, remember this device
function withAcc(fn) {
  return (room, player, d, reply) => {
    const now = room.now(), fails = val(room.storage.get('badc', priv(player))) || { n: 0, t: 0 };
    if (fails.n >= 15 && now - fails.t < 600000) return reply({ ok: false, why: 'too_many' });
    const c = normCode(d.c), aid = c ? val(room.storage.get(codeKey(c))) : null, acc = getAcc(room, aid);
    if (!acc) { val(room.storage.set('badc', { n: (now - fails.t < 600000 ? fails.n : 0) + 1, t: now }, priv(player))); return reply({ ok: false, why: 'bad_code' }); }
    const ban = activeBan(acc.ban, now) || activeBan(val(room.storage.get('bandev:' + player.id)), now);
    if (ban) return reply({ ok: false, banned: ban });
    let changed = false;
    if ((acc.devices || [])[0] !== player.id) { acc.devices = [player.id].concat((acc.devices || []).filter(x => x !== player.id)).slice(0, 6); changed = true; }
    return fn(room, player, d, reply, aid, acc, changed, now);
  };
}
function makeProf(prev, p, acc, now) { // public profile + leaderboard numbers that can only grow at a believable speed
  p = p || {}; prev = prev || {};
  const prof = {
    name: acc.name, nameLc: acc.name.toLowerCase(), slot: num(p.slot, 1, 3) || prev.slot || 1,
    money: num(p.money, 0, 1e12) || 0, earned: num(p.earned, 0, 1e12) || 0, lawns: num(p.lawns, 0, 1e7) || 0, jobs: num(p.jobs, 0, 1e7) || 0,
    day: num(p.day, 1, 1e6) || 1, tier: num(p.tier, 0, 999) || 0, mower: typeof p.mower === 'string' ? p.mower.slice(0, 20) : null,
    owned: Array.isArray(p.owned) ? p.owned.slice(0, 40).map(x => String(x).slice(0, 20)) : [], side: EV.sides.includes(p.side) ? p.side : null,
    race: Number(p.race) > 0 ? Math.round(Number(p.race) * 100) / 100 : 0, modded: !!p.modded, v: String(p.v || '').slice(0, 10), playing: !!p.playing,
    seen: now, created: acc.created, devs: Object.values(acc.live || {}).filter(t => now - t < ONLINE_MS).length || 1,
    ban: !!activeBan(acc.ban, now), banUntil: acc.ban ? acc.ban.until || 0 : 0, banReason: acc.ban ? acc.ban.reason || '' : ''
  };
  if (p.money == null) Object.assign(prof, { money: prev.money || 0, earned: prev.earned || 0, lawns: prev.lawns || 0, jobs: prev.jobs || 0, day: prev.day || 1, mower: prev.mower || null, owned: prev.owned || [], tier: prev.tier || 0 });
  let earned = 0, lawns = 0, race = 0;
  if (!prof.modded) {
    if (!prev.lbT) { earned = Math.min(prof.earned, LB.firstEarned); lawns = Math.min(prof.lawns, LB.firstLawns); }
    else { const dt = Math.max(0, now - prev.lbT) / 1000; earned = Math.max(prev.lbEarned || 0, Math.min(prof.earned, (prev.lbEarned || 0) + LB.earnedBurst + dt * LB.earnedPerSec)); lawns = Math.max(prev.lbLawns || 0, Math.min(prof.lawns, (prev.lbLawns || 0) + LB.lawnsBurst + dt / LB.secPerLawn)); }
    race = prof.race >= LB.minRace ? prof.race : 0;
  }
  return Object.assign(prof, { lbEarned: Math.floor(earned), lbLawns: Math.floor(lawns), lbRace: race, lbT: now });
}
function createAccount(room, player, name, code, now) {
  const aid = 'a' + now.toString(36) + rnd(5).toLowerCase(), finalName = claimName(room, aid, name);
  if (!finalName) return null;
  const acc = newAcc(finalName, now, player.id);
  putAcc(room, aid, acc); val(room.storage.set(codeKey(code), aid));
  val(room.storage.set('prof:' + aid, makeProf(null, null, acc, now)));
  console.log('New account: ' + finalName);
  return { aid, acc };
}

// ─── Admin password check, with limits so nobody can guess it ───
function adminProblem(room, player, pw) {
  const now = room.now(), hourKey = 'admfail_' + Math.floor(now / 3600000);
  const f = val(room.storage.get('admfail', priv(player))) || { n: 0, t: 0 };
  if (f.n >= 5 && now - f.t < 600000) return 'Too many wrong tries. Wait 10 minutes.';
  const hour = val(room.storage.get(hourKey)) || 0;
  if (hour >= 30) return 'Admin sign-in is paused for the rest of this hour (too many wrong tries).';
  if (typeof pw === 'string' && pw === ADMIN_PASSWORD) { if (f.n) val(room.storage.set('admfail', { n: 0, t: 0 }, priv(player))); return ''; }
  val(room.storage.set('admfail', { n: (now - f.t < 600000 ? f.n : 0) + 1, t: now }, priv(player)));
  val(room.storage.set(hourKey, hour + 1, { ttl: 7200 }));
  console.log('Wrong admin password from ' + player.name + ' (' + player.id + ')');
  return 'Wrong password.';
}
function cleanOps(o) {
  if (!o || typeof o !== 'object') return null;
  const out = {};
  if (o.money != null && num(o.money, 0, 1e12) != null) out.money = num(o.money, 0, 1e12);
  if (num(o.addMoney, -1e9, 1e9)) out.addMoney = num(o.addMoney, -1e9, 1e9);
  ['lawns', 'jobs', 'earned'].forEach(k => { if (o[k] != null && num(o[k], 0, 1e12) != null) out[k] = num(o[k], 0, 1e12); });
  if (typeof o.mower === 'string' && /^[a-z_]{1,20}$/.test(o.mower)) out.mower = o.mower;
  return Object.keys(out).length ? out : null;
}
function adminAcc(fn) { // admin requests: password first, then the account they're about
  return (room, player, d, reply) => {
    const why = adminProblem(room, player, d.pw); if (why) return reply({ ok: false, why });
    const aid = typeof d.to === 'string' ? d.to.slice(0, 40) : '', acc = getAcc(room, aid);
    if (!acc) return reply({ ok: false, why: 'That player doesn\'t exist any more.' });
    return fn(room, player, d, reply, aid, acc, room.now());
  };
}
const editProf = (room, aid, f) => { const p = val(room.storage.get('prof:' + aid)); if (p) { f(p); val(room.storage.set('prof:' + aid, p)); } };

const HANDLERS = {
  // ─── Accounts ───
  acct_name_free(room, player, d, reply) { const n = cleanName(d.name); return reply({ ok: !!n && !val(room.storage.get('name:' + n.toLowerCase())) }); },
  acct_create(room, player, d, reply) {
    const now = room.now(), ban = activeBan(val(room.storage.get('bandev:' + player.id)), now); if (ban) return reply({ ok: false, banned: ban });
    const name = cleanName(d.name); if (!name) return reply({ ok: false, why: 'bad_name', msg: 'Use 2 to 16 letters or numbers.' });
    if (val(room.storage.get('name:' + name.toLowerCase()))) return reply({ ok: false, why: 'taken' });
    const dayKey = 'mk:' + player.id + ':' + new Date(now).toISOString().slice(0, 10), made = val(room.storage.get(dayKey)) || 0;
    if (made >= 5) return reply({ ok: false, why: 'too_many', msg: 'That\'s enough new accounts for today.' });
    let code = null; for (let i = 0; i < 6 && !code; i++) { const c = rnd(5) + '-' + rnd(5); if (!val(room.storage.get(codeKey(c)))) code = c; }
    const a = code && createAccount(room, player, name, code, now); if (!a) return reply({ ok: false, why: 'refused', msg: 'Couldn\'t make an account. Try again.' });
    val(room.storage.set(dayKey, made + 1, { ttl: 2 * 86400 }));
    return reply({ ok: true, aid: a.aid, code, name: a.acc.name });
  },
  acct_login: withAcc((room, player, d, reply, aid, acc, changed) => {
    if (changed) putAcc(room, aid, acc);
    return reply(Object.assign({ ok: true, aid, saves: acc.saves, edits: acc.edits }, news(room, acc)));
  }),
  acct_migrate(room, player, d, reply) { // an account from v1.13–1.14: only its real owner (logged in with that code) can move it
    const now = room.now(), c = normCode(d.c); if (!c || player.username !== oldLogin(c)) return reply({ ok: false, why: 'not_yours' });
    const ban = activeBan(val(room.storage.get('bandev:' + player.id)), now); if (ban) return reply({ ok: false, banned: ban });
    let aid = val(room.storage.get(codeKey(c))), acc = getAcc(room, aid);
    if (!acc) { const a = createAccount(room, player, cleanName(d.name) || 'Player', c, now); if (!a) return reply({ ok: false, why: 'refused' }); aid = a.aid; acc = a.acc; console.log('Moved old account over: ' + acc.name); }
    return reply(Object.assign({ ok: true, aid, saves: acc.saves, edits: acc.edits }, news(room, acc)));
  },
  acct_save: withAcc((room, player, d, reply, aid, acc) => { // one save slot; the newest copy wins, whichever device it came from
    const n = num(d.n, 1, 3), v = d.v || {}, at = Number(v.at) || 0; if (!n || !at) return reply({ ok: false, why: 'bad_save' });
    const old = acc.saves[n]; if (old && old.at > at) return reply({ ok: true, newer: old });
    if (v.del) acc.saves[n] = { del: true, at };
    else { if (typeof v.raw !== 'string' || v.raw.length > 40000) return reply({ ok: false, why: 'too_big' }); acc.saves[n] = { raw: v.raw, sig: String(v.sig == null ? '' : v.sig).slice(0, 20), at }; }
    if (JSON.stringify(acc).length > 62000) { acc.saves[n] = old; return reply({ ok: false, why: 'too_big' }); }
    putAcc(room, aid, acc); return reply({ ok: true });
  }),
  acct_yards: withAcc((room, player, d, reply, aid, acc, changed) => { // the lawns' cut state for one slot (kept apart: it's the big bit)
    const n = num(d.n, 1, 3), v = d.v || {}; if (!n || !v.rle || typeof v.rle !== 'object') return reply({ ok: false, why: 'bad_yards' });
    const out = { rle: v.rle, at: Number(v.at) || room.now() }; if (JSON.stringify(out).length > 62000) return reply({ ok: false, why: 'too_big' });
    val(room.storage.set('accy:' + aid + ':' + n, out)); if (changed) putAcc(room, aid, acc); return reply({ ok: true });
  }),
  acct_meta: withAcc((room, player, d, reply, aid, acc) => {
    const add = Array.isArray(d.edits) ? d.edits.filter(x => typeof x === 'string').map(x => x.slice(0, 40)) : [];
    acc.edits = [...new Set(acc.edits.concat(add))]; putAcc(room, aid, acc); return reply({ ok: true });
  }),
  acct_ping: withAcc((room, player, d, reply, aid, acc, changed, now) => { // every 40 s while the game is open: "I'm online" + profile
    acc.live = acc.live || {}; acc.live[player.id] = now; for (const k in acc.live) if (now - acc.live[k] > ONLINE_MS * 3) delete acc.live[k];
    putAcc(room, aid, acc);
    val(room.storage.set('prof:' + aid, makeProf(val(room.storage.get('prof:' + aid)), d.p, acc, now)));
    return reply(Object.assign({ ok: true }, news(room, acc)));
  }),
  acct_ack: withAcc((room, player, d, reply, aid, acc) => { // admin changes / messages that have been handled
    const ops = Array.isArray(d.ops) ? d.ops : [], msgs = Array.isArray(d.msgs) ? d.msgs : [];
    acc.ops = acc.ops.filter(o => !ops.includes(o.id)); acc.msgs = acc.msgs.filter(m => !msgs.includes(m.id)); putAcc(room, aid, acc); return reply({ ok: true });
  }),
  acct_name: withAcc((room, player, d, reply, aid, acc) => {
    const name = cleanName(d.name); if (!name) return reply({ ok: false, why: 'bad_name', msg: 'Use 2 to 16 letters or numbers.' });
    const lc = name.toLowerCase(), owner = val(room.storage.get('name:' + lc)); if (owner && owner !== aid) return reply({ ok: false, why: 'taken' });
    const oldLc = acc.name.toLowerCase(); val(room.storage.set('name:' + lc, aid)); if (oldLc !== lc && val(room.storage.get('name:' + oldLc)) === aid) val(room.storage.delete('name:' + oldLc));
    acc.name = name; putAcc(room, aid, acc); editProf(room, aid, p => { p.name = name; p.nameLc = lc; }); return reply({ ok: true, name });
  }),
  // ─── games still on v1.14: keep their backups working until everyone has the new version (v1.15 reads these when it moves the account over) ───
  acct_put(room, player, d, reply) {
    const k = String(d.k || ''); if (!/^(s[1-3]|y[1-3]|meta)$/.test(k)) return reply({ ok: false, why: 'bad key' });
    let size = 0; try { size = JSON.stringify(d.v).length; } catch (e) { return reply({ ok: false, why: 'bad value' }); }
    if (size > 62000) return reply({ ok: false, why: 'too big' });
    val(room.storage.set(k, d.v, priv(player))); return reply({ ok: true });
  },
  acct_profile(room, player, d, reply) { return reply({ ok: true }); }, // v1.15 profiles come from acct_ping
  guest_ping(room, player, d, reply) { const now = room.now(); return reply({ ok: true, banned: activeBan(val(room.storage.get('bandev:' + player.id)), now), bcast: val(room.storage.get('bcast')) || null }); },

  // ─── Admin panel ───
  adm_check(room, player, d, reply) {
    const why = adminProblem(room, player, d.pw); if (!why) console.log('Admin panel opened by ' + player.name);
    return reply(why ? { ok: false, why } : { ok: true });
  },
  adm_edit: adminAcc((room, player, d, reply, aid, acc) => {
    const ops = cleanOps(d.ops); if (!ops) return reply({ ok: false, why: 'Nothing to change.' });
    acc.ops.push({ id: ++acc.seq, ops, slot: num(d.slot, 1, 3) || 1 }); putAcc(room, aid, acc); poke(room, acc);
    editProf(room, aid, p => { if (ops.money != null) p.money = ops.money; if (ops.addMoney) p.money = Math.max(0, (p.money || 0) + ops.addMoney); ['earned', 'lawns', 'jobs'].forEach(k => { if (ops[k] != null) p[k] = ops[k]; }); });
    console.log('Admin ' + player.name + ' changed ' + acc.name + ': ' + JSON.stringify(ops)); return reply({ ok: true });
  }),
  adm_msg: adminAcc((room, player, d, reply, aid, acc, now) => {
    const text = String(d.text || '').trim().slice(0, 300); if (!text) return reply({ ok: false, why: 'Type a message first.' });
    acc.msgs.push({ id: ++acc.seq, text, at: now }); putAcc(room, aid, acc); poke(room, acc);
    console.log('Admin ' + player.name + ' messaged ' + acc.name + ': ' + text); return reply({ ok: true });
  }),
  adm_msg_all(room, player, d, reply) { // one message for everyone: games pick it up when they next check in (within 40 s)
    const why = adminProblem(room, player, d.pw); if (why) return reply({ ok: false, why });
    const text = String(d.text || '').trim().slice(0, 300); if (!text) return reply({ ok: false, why: 'Type a message first.' });
    const now = room.now(); val(room.storage.set('bcast', { id: now, text, by: player.name }));
    console.log('Admin ' + player.name + ' messaged everyone: ' + text); return reply({ ok: true });
  },
  adm_kick: adminAcc((room, player, d, reply, aid, acc, now) => {
    acc.kickAt = now; putAcc(room, aid, acc); poke(room, acc); console.log('Admin ' + player.name + ' kicked ' + acc.name); return reply({ ok: true });
  }),
  adm_ban: adminAcc((room, player, d, reply, aid, acc, now) => { // bans the account AND every device it's been played on
    const hours = num(d.hours, 0, 24 * 3650) || 0, until = hours ? now + hours * 3600000 : 0, reason = String(d.reason || '').trim().slice(0, 120);
    acc.ban = { until, reason, at: now }; acc.kickAt = now; putAcc(room, aid, acc);
    for (const pid of acc.devices || []) val(room.storage.set('bandev:' + pid, { until, reason, aid }, hours ? { ttl: hours * 3600 + 120 } : undefined));
    editProf(room, aid, p => Object.assign(p, { ban: true, banUntil: until, banReason: reason }));
    poke(room, acc); console.log('Admin ' + player.name + ' banned ' + acc.name + (hours ? ' for ' + hours + ' h' : ' for good') + (reason ? ' (' + reason + ')' : ''));
    return reply({ ok: true, until });
  }),
  adm_unban: adminAcc((room, player, d, reply, aid, acc) => {
    acc.ban = null; putAcc(room, aid, acc); for (const pid of acc.devices || []) val(room.storage.delete('bandev:' + pid));
    editProf(room, aid, p => Object.assign(p, { ban: false, banUntil: 0, banReason: '' })); poke(room, acc);
    console.log('Admin ' + player.name + ' unbanned ' + acc.name); return reply({ ok: true });
  }),

  // ─── Scott Bonnar vs Rover event (one vote per account; players without an account vote per device) ───
  ev_pick(room, player, d, reply) {
    const side = d.side; if (!EV.sides.includes(side)) return reply({ ok: false, drop: true, why: 'unknown team' });
    if (room.now() >= EV.end) return reply({ ok: false, drop: true, why: 'event over' });
    const who = voter(room, player, d), voted = val(room.storage.get(EV.key + 'vote:' + who)) || val(room.storage.get(EV.key + 'vote:' + player.id));
    if (voted) return reply({ ok: voted === side, drop: true, why: voted === side ? 'already voted' : 'already on the other team' });
    val(room.storage.set(EV.key + 'vote:' + who, side)); val(room.storage.incr(EV.key + 'picks_' + side, 1));
    return reply({ ok: true });
  },
  ev_lawn(room, player, d, reply) {
    const side = d.side, now = room.now(); if (!EV.sides.includes(side)) return reply({ ok: false, drop: true, why: 'unknown team' });
    if (now >= EV.end) return reply({ ok: false, drop: true, why: 'event over' });
    const who = voter(room, player, d), voted = val(room.storage.get(EV.key + 'vote:' + who)) || val(room.storage.get(EV.key + 'vote:' + player.id));
    if (voted !== side) return reply({ ok: false, drop: true, why: 'not your team' });
    let n = Math.floor(Number(d.n)); if (!(n >= 1)) return reply({ ok: false, drop: true, why: 'bad count' }); n = Math.min(n, EV.maxPerMsg);
    const rateKey = EV.key + 'rate:' + who, b = val(room.storage.get(rateKey)) || { t: now, tokens: EV.burst };
    b.tokens = Math.min(EV.burst, b.tokens + Math.max(0, now - b.t) / 1000 / EV.refillSec); b.t = now;
    const dayKey = EV.key + 'day:' + who + ':' + new Date(now).toISOString().slice(0, 10), today = val(room.storage.get(dayKey)) || 0;
    const take = Math.min(n, Math.floor(b.tokens), EV.dayCap - today);
    if (take <= 0) { val(room.storage.set(rateKey, b)); return reply({ ok: false, retry: true, why: today >= EV.dayCap ? 'daily limit' : 'too fast' }); }
    b.tokens -= take; val(room.storage.set(rateKey, b)); val(room.storage.set(dayKey, today + take, { ttl: 2 * 86400 }));
    const total = val(room.storage.incr(EV.key + 'lawns_' + side, take)), mineTotal = val(room.storage.incr(EV.key + 'mine:' + who, take));
    try { val(room.leaderboard.submit(player.id, EV.key + 'top', mineTotal)); } catch (e) { } // the board is optional
    if (total >= EV.target && val(room.storage.incr(EV.key + 'winlock', 1)) === 1) { val(room.storage.set(EV.key + 'winner', { side, at: now })); console.log('Team ' + side + ' wins with ' + total + ' lawns'); }
    return reply({ ok: true, n: take, total });
  }
};
function voter(room, player, d) { const c = normCode(d.c), aid = c ? val(room.storage.get(codeKey(c))) : null; return aid ? 'a:' + aid : player.id; }

module.exports = {
  onMessage(room, player, type, data) {
    if (!Object.prototype.hasOwnProperty.call(HANDLERS, type)) return;
    const d = data && typeof data === 'object' ? data : {}, id = typeof d.id === 'string' ? d.id.slice(0, 16) : '';
    return HANDLERS[type](room, player, d, r => room.send('ev_ack', Object.assign({ id }, r), player.id));
  }
};
