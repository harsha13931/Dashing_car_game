import React, { useState, useEffect, useRef } from 'react';
import Lobby from './components/Lobby';
import Game from './components/Game';
import Splash from './components/Splash';
import { socket } from './net/socket';
import { getToken, saveRoom, clearRoom, savedRoom } from './net/session';

export default function App() {
    const [gameState, setGameState] = useState('splash');
    const [room, setRoom] = useState(null);
    const [player, setPlayer] = useState(null);
    const [connected, setConnected] = useState(socket.connected);
    const [connError, setConnError] = useState('');
    const [notice, setNotice] = useState('');
    const noticeTimer = useRef(null);

    const showNotice = (text) => {
        setNotice(text);
        clearTimeout(noticeTimer.current);
        noticeTimer.current = setTimeout(() => setNotice(''), 3500);
    };

    // Reclaim our seat after a reconnect / page reload (phones drop the
    // connection whenever you switch apps, e.g. to share the invite link).
    const tryResume = () => {
        const id = savedRoom();
        if (!id) return;
        socket.emit('resume', { roomId: id, token: getToken() }, (res) => {
            if (!res || res.error) {
                clearRoom();
                setRoom(cur => {
                    if (cur && cur.id === id) { showNotice('Your room has closed — create a new one.'); return null; }
                    return cur;
                });
                return;
            }
            saveRoom(res.roomId);
            setPlayer(res.player);
            setRoom(res.room);
        });
    };

    useEffect(() => {
        if (socket.connected) tryResume();
    }, []);

    useEffect(() => {
        const onConnect = () => { setConnected(true); setConnError(''); tryResume(); };
        const onDisconnect = () => setConnected(false);
        const onConnectError = (e) => setConnError(e?.message || 'connection failed');
        const onRoomUpdate = (r) => {
            setRoom(r);
            if (r.running && gameState === 'lobby') setGameState('playing');
        };
        const onMatchStart = () => { if (gameState !== 'splash') setGameState('playing'); };
        const onNotice = ({ text }) => showNotice(text);

        socket.on('connect', onConnect);
        socket.on('disconnect', onDisconnect);
        socket.on('connect_error', onConnectError);
        socket.on('roomUpdate', onRoomUpdate);
        socket.on('matchStart', onMatchStart);
        socket.on('notice', onNotice);

        // Re-sync in case 'connect' fired before this listener was attached.
        setConnected(socket.connected);

        return () => {
            socket.off('connect', onConnect);
            socket.off('disconnect', onDisconnect);
            socket.off('connect_error', onConnectError);
            socket.off('roomUpdate', onRoomUpdate);
            socket.off('matchStart', onMatchStart);
            socket.off('notice', onNotice);
        };
    }, [gameState]);

    // Leaving for good (LEAVE / LOBBY buttons) forgets the room
    const handleBackToLobby = () => {
        clearRoom();
        setGameState('lobby');
        setRoom(null);
    };

    const finishSplash = () => setGameState(room && room.running ? 'playing' : 'lobby');

    return (
        <div className="app">
            {gameState === 'splash' && (
                <Splash connected={connected} onDone={finishSplash} />
            )}

            {gameState === 'lobby' && (
                <Lobby
                    room={room}
                    setRoom={setRoom}
                    setPlayer={setPlayer}
                    player={player}
                    connected={connected}
                    connError={connError}
                />
            )}

            {gameState === 'playing' && (
                <Game
                    room={room}
                    player={player}
                    onBack={handleBackToLobby}
                    onToRoom={() => setGameState('lobby')}
                />
            )}

            {notice && (
                <div style={{
                    position: 'fixed', top: 'max(14px, env(safe-area-inset-top))', left: '50%',
                    transform: 'translateX(-50%)', zIndex: 50, maxWidth: '90vw',
                    background: 'rgba(20,24,32,0.95)', border: '1px solid #e8a030', color: '#ffd9a0',
                    padding: '8px 14px', borderRadius: 10, fontSize: '0.85rem', textAlign: 'center',
                    boxShadow: '0 6px 24px rgba(0,0,0,0.5)',
                }}>{notice}</div>
            )}
        </div>
    );
}
