import React, { useEffect, useState } from 'react';
import {
    useProfile, levelInfo, onReward, getLastReward, dailyStatus, claimDaily, DAILY_REWARDS, challengeInfo,
} from '../progress';
import { soundManager } from '../utils/SoundManager';

// ─── Coins / level chips, round rewards, daily reward, challenges ─────────

export const fmt = (n) => n.toLocaleString('en-US');

export function Coin({ size = 16 }) {
    return (
        <span aria-hidden style={{
            display: 'inline-block', width: size, height: size, borderRadius: '50%', verticalAlign: '-0.18em',
            background: 'radial-gradient(circle at 35% 30%, #fff6b0 0 18%, #ffd84d 30%, #e8a000 75%, #a86a00 100%)',
            boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.25), 0 0 6px rgba(255,200,40,0.5)',
        }} />
    );
}

export function CoinPill({ onClick }) {
    const p = useProfile();
    return (
        <div onClick={onClick} className="gtitle" style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(0,0,0,0.4)', borderRadius: 20,
            border: '2px solid rgba(255,216,77,0.35)', padding: '4px 12px 4px 6px', color: '#ffd84d', fontSize: '0.9rem',
            cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap',
        }}><Coin size={20} />{fmt(p.coins)}</div>
    );
}

export function LevelBadge() {
    const p = useProfile();
    const { level, into, need } = levelInfo(p.xp);
    return (
        <div title={`${into} / ${need} XP`} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div className="gtitle" style={{
                width: 30, height: 30, borderRadius: 8, transform: 'rotate(45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'linear-gradient(135deg,#4fd8ff,#1f6fe0)', boxShadow: '0 2px 0 #0b3a80, 0 0 10px rgba(79,216,255,0.4)',
            }}><span style={{ transform: 'rotate(-45deg)', color: '#fff', fontSize: '0.85rem' }}>{level}</span></div>
            <div style={{ width: 56 }}>
                <div style={{ fontSize: '0.55rem', color: '#8fa1b8', letterSpacing: 1 }} className="gtitle">LEVEL</div>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.12)', overflow: 'hidden' }}>
                    <div style={{ width: `${(into / need) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#4fd8ff,#8af)' }} />
                </div>
            </div>
        </div>
    );
}

// Rewards for the round that just ended (credited in App via 'roundResult')
export function RoundRewards({ compact = false }) {
    const fresh = (r) => (r && Date.now() - r.at < 8000 ? r : null);
    const [r, setR] = useState(() => fresh(getLastReward()));
    useEffect(() => onReward(x => setR(fresh(x))), []);
    if (!r) return null;
    return (
        <div style={{
            margin: '0 0 12px', padding: compact ? '8px 12px' : '10px 14px', borderRadius: 14,
            background: 'linear-gradient(180deg, rgba(255,216,77,0.12), rgba(255,216,77,0.04))', border: '1px solid rgba(255,216,77,0.3)',
            animation: 'popIn 0.4s ease-out', textAlign: 'left',
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="gtitle" style={{ color: '#ffd84d', fontSize: compact ? '1rem' : '1.15rem' }}>+{r.coins} <Coin size={16} /></span>
                <span className="gtitle" style={{ color: '#4fd8ff', fontSize: '0.85rem' }}>+{r.xp} XP</span>
            </div>
            {!compact && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 12px', marginTop: 4 }}>
                    {r.lines.map(([label, v]) => (
                        <span key={label} style={{ fontSize: '0.72rem', color: '#c8d4e3' }}>{label} <b style={{ color: '#ffd84d' }}>+{v}</b></span>
                    ))}
                </div>
            )}
            {r.leveledUp && (
                <div className="gtitle" style={{ marginTop: 6, color: '#4fd8ff', fontSize: '0.85rem' }}>
                    ⬆ LEVEL {r.level}! &nbsp;<span style={{ color: '#ffd84d' }}>+{r.levelCoins} <Coin size={13} /></span>
                </div>
            )}
            {r.challenges.map(c => (
                <div key={c.id} className="gtitle" style={{ marginTop: 6, color: '#63e38e', fontSize: '0.8rem' }}>
                    🎯 CHALLENGE DONE: {c.text} &nbsp;<span style={{ color: '#ffd84d' }}>+{c.reward} <Coin size={13} /></span>
                </div>
            ))}
        </div>
    );
}

// Pops up on the home screen once a day
export function DailyRewardModal({ onClose }) {
    const s = dailyStatus();
    const [claimed, setClaimed] = useState(0);
    const claim = () => {
        const got = claimDaily();
        setClaimed(got);
        soundManager.playPowerup();
        setTimeout(onClose, 1100);
    };
    return (
        <div className="full-screen center" style={{ background: 'rgba(0,0,0,0.7)', zIndex: 60, padding: 16, boxSizing: 'border-box' }}>
            <div className="gpanel" style={{ padding: '16px 18px', width: 'min(560px, 94vw)', textAlign: 'center', animation: 'popIn 0.35s ease-out' }}>
                <div className="gtitle" style={{ fontSize: '1.4rem', color: '#ffd84d' }}>DAILY REWARD</div>
                <div style={{ fontSize: '0.8rem', color: '#8fa1b8', margin: '2px 0 12px' }}>Come back every day — day 7 pays the most</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
                    {DAILY_REWARDS.map((v, i) => {
                        const day = i + 1, today = day === s.day, past = day < s.day;
                        return (
                            <div key={day} style={{
                                padding: '8px 2px', borderRadius: 10,
                                background: today ? 'rgba(255,216,77,0.18)' : 'rgba(0,0,0,0.3)',
                                border: `2px solid ${today ? '#ffd84d' : 'rgba(255,255,255,0.08)'}`, opacity: past ? 0.45 : 1,
                            }}>
                                <div className="gtitle" style={{ fontSize: '0.55rem', color: '#8fa1b8' }}>DAY {day}</div>
                                <div style={{ margin: '4px 0' }}>{past ? '✓' : <Coin size={day === 7 ? 24 : 18} />}</div>
                                <div className="gtitle" style={{ fontSize: '0.75rem', color: '#ffd84d' }}>{v}</div>
                            </div>
                        );
                    })}
                </div>
                {claimed ? (
                    <div className="gtitle" style={{ marginTop: 14, fontSize: '1.3rem', color: '#ffd84d', animation: 'popIn 0.3s ease-out' }}>+{claimed} <Coin size={20} /></div>
                ) : (
                    <button className="gbtn yellow" onClick={claim} style={{ width: '100%', marginTop: 14, fontSize: '1.15rem', padding: 12 }}>
                        CLAIM {s.reward} <Coin size={18} />
                    </button>
                )}
            </div>
        </div>
    );
}

export function ChallengeList() {
    const p = useProfile();
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {p.challenges.list.map(raw => {
                const c = challengeInfo(raw);
                return (
                    <div key={c.id} style={{
                        padding: '10px 12px', borderRadius: 12, background: c.done ? 'rgba(99,227,142,0.12)' : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${c.done ? 'rgba(99,227,142,0.5)' : 'rgba(255,255,255,0.08)'}`,
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <span style={{ color: '#fff', fontSize: '0.88rem', fontWeight: 700 }}>{c.done ? '✅ ' : ''}{c.text}</span>
                            <span className="gtitle" style={{ color: '#ffd84d', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>{c.reward} <Coin size={13} /></span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                            <div style={{ flex: 1, height: 7, borderRadius: 4, background: 'rgba(255,255,255,0.1)', overflow: 'hidden' }}>
                                <div style={{ width: `${(c.progress / c.goal) * 100}%`, height: '100%', background: c.done ? '#63e38e' : 'linear-gradient(90deg,#ffb020,#ffd84d)' }} />
                            </div>
                            <span style={{ fontSize: '0.7rem', color: '#8fa1b8', minWidth: 44, textAlign: 'right' }}>{fmt(c.progress)}/{fmt(c.goal)}</span>
                        </div>
                    </div>
                );
            })}
            <div style={{ fontSize: '0.72rem', color: '#8fa1b8', textAlign: 'center' }}>New challenges every day · rewards are added automatically</div>
        </div>
    );
}
