import { useEffect, useState } from 'react';

// ─── Player progression: coins, XP, unlocks, daily reward, challenges ─────
// Saved on this device (localStorage). The server sends a 'roundResult' to
// each player after every round; applyRoundResult turns it into rewards.

const KEY = 'dasharena.profile';
const START_COINS = 200;

// ── Shop prices ──
export const CAR_PRICES = { sports: 0, kart: 0, muscle: 0, rally: 500, drift: 750, suv: 900, truck: 1200, supercar: 1500 };
export const ITEM_PRICES = {
    paint: { factory: 0, blue: 0, red: 0, orange: 0, green: 100, purple: 100, teal: 100, pink: 150, white: 150, lime: 150, black: 250, gold: 400 },
    finish: { gloss: 0, metallic: 150, matte: 150, chrome: 500 },
    decal: { stock: 0, none: 0, stripes: 100, side: 100, number: 150, flames: 250, checker: 250 },
    spoiler: { stock: 0, none: 0, lip: 100, wing: 200, gt: 350 },
    hood: { stock: 0, bulge: 100, scoop: 150, vents: 150, carbon: 300 },
    wheel: { stock: 0, red: 100, blue: 100, neon: 200, chrome: 250, gold: 400 },
    underglow: { none: 0, cyan: 200, pink: 200, green: 200, purple: 200, orange: 200, red: 200 },
    tint: { stock: 0, dark: 100, mirror: 200 },
    topper: { none: 0, cap: 100, party: 100, antenna: 150, propeller: 200, horns: 250, halo: 350, crown: 500 },
    trail: { classic: 0, fire: 150, ice: 150, toxic: 150, purple: 200, rainbow: 500 },
};
export const itemPrice = (field, key) => (ITEM_PRICES[field] || {})[key] || 0;

// ── Levels ──
export const xpForLevel = (lvl) => 100 + (lvl - 1) * 50;     // XP needed to go from lvl → lvl+1
export function levelInfo(xp) {
    let lvl = 1, left = xp;
    while (left >= xpForLevel(lvl)) { left -= xpForLevel(lvl); lvl++; }
    return { level: lvl, into: left, need: xpForLevel(lvl) };
}
const levelUpCoins = (lvl) => (lvl % 5 === 0 ? 300 : 100);

// ── Daily reward: 7-day streak ──
export const DAILY_REWARDS = [50, 75, 100, 150, 200, 250, 400];

// ── Daily challenges ──
const CAR_NAMES = { sports: 'Venom GT', muscle: 'Thunder V8', truck: 'War Rig', rally: 'Dust Devil', kart: 'Pocket Rocket', suv: 'Iron Shield', drift: 'Sidewinder', supercar: 'Phantom X' };
const POOL = [
    { id: 'win1', text: 'Win a round', goal: 1, reward: 150, step: r => (r.won ? 1 : 0) },
    { id: 'win3', text: 'Win 3 rounds', goal: 3, reward: 300, step: r => (r.won ? 1 : 0) },
    { id: 'kills5', text: 'Knock out 5 cars', goal: 5, reward: 200, step: r => r.kills },
    { id: 'rounds5', text: 'Play 5 rounds', goal: 5, reward: 120, step: () => 1 },
    { id: 'top3', text: 'Finish top 3 in 4 rounds', goal: 4, reward: 180, step: r => (r.rank <= 3 ? 1 : 0) },
    { id: 'survive60', text: 'Survive 60 s in one round', goal: 1, reward: 150, step: r => (r.survival >= 60 ? 1 : 0) },
    { id: 'powerups6', text: 'Grab 6 power-ups', goal: 6, reward: 150, step: r => r.powerups },
    { id: 'damage300', text: 'Deal 300 damage', goal: 300, reward: 180, step: r => r.damage },
    { id: 'online2', text: 'Play 2 online rounds', goal: 2, reward: 200, step: r => (r.online ? 1 : 0) },
    { id: 'hardwin', text: 'Win a round on Hard or Insane', goal: 1, reward: 300, step: r => (r.won && !r.online && (r.difficulty === 'hard' || r.difficulty === 'insane') ? 1 : 0) },
    { id: 'carwin', text: 'Win a round with the {car}', goal: 1, reward: 250, step: (r, c) => (r.won && r.carType === c.car ? 1 : 0) },
];

const today = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const yesterday = () => { const d = new Date(); d.setDate(d.getDate() - 1); return today(d); };

// Same three challenges all day, different every day
function rollChallenges(date, owned) {
    let seed = 0;
    for (const ch of date) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const pool = [...POOL];
    const out = [];
    while (out.length < 3 && pool.length) {
        const c = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
        if ((c.id === 'win1' && out.some(o => o.id === 'win3')) || (c.id === 'win3' && out.some(o => o.id === 'win1'))) continue;
        const entry = { id: c.id, progress: 0, done: false };
        if (c.id === 'carwin') entry.car = owned[Math.floor(rnd() * owned.length)] || 'sports';
        out.push(entry);
    }
    return out;
}

export function challengeInfo(c) {
    const def = POOL.find(p => p.id === c.id) || POOL[0];
    return { ...c, text: def.text.replace('{car}', CAR_NAMES[c.car] || 'Venom GT'), goal: def.goal, reward: def.reward };
}

// ── Storage ──
function fresh() {
    // Players from before progression keep whatever they had already equipped
    const items = {};
    try {
        const g = JSON.parse(localStorage.getItem('dasharena.garage') || '{}');
        for (const car of Object.values(g || {})) {
            for (const [field, key] of Object.entries(car || {})) {
                if (ITEM_PRICES[field] && itemPrice(field, key) > 0) items[`${field}:${key}`] = true;
            }
        }
    } catch (_) { /* ignore */ }
    const cars = Object.keys(CAR_PRICES).filter(k => CAR_PRICES[k] === 0);
    try {
        const sel = localStorage.getItem('dasharena.car');
        if (sel && CAR_PRICES[sel] !== undefined && !cars.includes(sel)) cars.push(sel);
    } catch (_) { /* ignore */ }
    return {
        coins: START_COINS, xp: 0, cars, items,
        daily: { last: null, streak: 0 },
        challenges: { date: null, list: [] },
        stats: { rounds: 0, wins: 0, kills: 0, best: 0 },
        tutorialDone: false,
    };
}

let profile = null;
const subs = new Set();

function load() {
    if (profile) return profile;
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        profile = raw && typeof raw === 'object' ? { ...fresh(), ...raw } : fresh();
    } catch (_) { profile = fresh(); }
    if (!localStorage.getItem(KEY)) save();
    return profile;
}

function save() {
    try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch (_) { /* ignore */ }
    subs.forEach(fn => fn());
}

function ensureChallenges() {
    const p = load();
    const d = today();
    if (p.challenges.date !== d) {
        p.challenges = { date: d, list: rollChallenges(d, p.cars) };
        save();
    }
    return p.challenges.list;
}

export function getProfile() { ensureChallenges(); return load(); }

export function useProfile() {
    const [, force] = useState(0);
    useEffect(() => {
        const fn = () => force(n => n + 1);
        subs.add(fn);
        return () => subs.delete(fn);
    }, []);
    return getProfile();
}

// ── Shop ──
export const ownsCar = (k) => load().cars.includes(k);
export const ownsItem = (field, key) => itemPrice(field, key) === 0 || !!load().items[`${field}:${key}`];

function spend(cost) {
    const p = load();
    if (p.coins < cost) return false;
    p.coins -= cost;
    return true;
}
export function buyCar(k) {
    if (ownsCar(k)) return true;
    if (!spend(CAR_PRICES[k] || 0)) return false;
    load().cars.push(k);
    save();
    return true;
}
export function buyItem(field, key) {
    if (ownsItem(field, key)) return true;
    if (!spend(itemPrice(field, key))) return false;
    load().items[`${field}:${key}`] = true;
    save();
    return true;
}

// ── Daily reward ──
export function dailyStatus() {
    const p = load();
    const d = today();
    if (p.daily.last === d) return { canClaim: false, day: p.daily.streak, reward: 0 };
    const day = p.daily.last === yesterday() ? (p.daily.streak % 7) + 1 : 1;
    return { canClaim: true, day, reward: DAILY_REWARDS[day - 1] };
}
export function claimDaily() {
    const s = dailyStatus();
    if (!s.canClaim) return 0;
    const p = load();
    p.daily = { last: today(), streak: s.day };
    p.coins += s.reward;
    save();
    return s.reward;
}

// ── Round rewards ──
const DIFF_MULT = { easy: 0.7, medium: 1, hard: 1.3, insane: 1.6 };

export function applyRoundResult(r) {
    const p = load();
    ensureChallenges();
    const mult = r.online ? 1.5 : (DIFF_MULT[r.difficulty] || 1) * Math.min(1, 0.55 + 0.15 * (r.bots || 1));
    const placeBonus = r.rank === 1 ? 40 : r.rank === 2 ? 25 : r.rank === 3 ? 15 : 5;
    const lines = [
        ['Finished', 10],
        [r.rank === 1 ? 'Winner!' : `#${r.rank} place`, placeBonus],
        r.kills > 0 && [`${r.kills} knock-out${r.kills > 1 ? 's' : ''}`, 15 * r.kills],
        r.survival >= 5 && ['Survival', Math.min(20, Math.floor(r.survival / 5))],
    ].filter(Boolean).map(([label, v]) => [label, Math.round(v * mult)]);
    const coins = lines.reduce((s, l) => s + l[1], 0);
    const xp = coins + (r.won ? 20 : 0);

    const before = levelInfo(p.xp).level;
    p.coins += coins;
    p.xp += xp;
    const after = levelInfo(p.xp).level;
    let levelCoins = 0;
    for (let l = before + 1; l <= after; l++) levelCoins += levelUpCoins(l);
    p.coins += levelCoins;

    p.stats.rounds++;
    if (r.won) p.stats.wins++;
    p.stats.kills += r.kills || 0;

    const finished = [];
    for (const c of p.challenges.list) {
        if (c.done) continue;
        const def = POOL.find(x => x.id === c.id);
        if (!def) continue;
        c.progress = Math.min(def.goal, c.progress + (def.step(r, c) || 0));
        if (c.progress >= def.goal) {
            c.done = true;
            p.coins += def.reward;
            p.xp += Math.round(def.reward / 2);
            finished.push(challengeInfo(c));
        }
    }
    save();
    const summary = { coins, xp, lines, level: after, leveledUp: after > before, levelCoins, challenges: finished, total: p.coins };
    lastReward = { ...summary, at: Date.now() };
    rewardSubs.forEach(fn => fn(lastReward));
    return summary;
}

// The most recent round's rewards, for the results screens
let lastReward = null;
const rewardSubs = new Set();
export function onReward(fn) { rewardSubs.add(fn); return () => rewardSubs.delete(fn); }
export const getLastReward = () => lastReward;

export function markTutorialDone() { load().tutorialDone = true; save(); }
