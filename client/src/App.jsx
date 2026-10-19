import React, { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import Game from './components/Game';
import { socket } from './net/socket';

export default function App() {
    const [gameState, setGameState] = useState('lobby');
    const [room, setRoom] = useState(null);
    const [player, setPlayer] = useState(null);
    const [connected, setConnected] = useState(socket.connected);

    useEffect(() => {
        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socket.on('roomUpdate', r => {
            setRoom(r);
            if (r.running && gameState === 'lobby') {
                setGameState('playing');
            }
        });

        socket.on('matchStart', () => {
            setGameState('playing');
        });

        return () => { socket.off(); };
    }, [gameState]);

    const handleBackToLobby = () => {
        setGameState('lobby');
        setRoom(null);
    };

    return (
        <div className="app">
            {gameState === 'lobby' && (
                <Lobby
                    room={room}
                    setRoom={setRoom}
                    setPlayer={setPlayer}
                    player={player}
                    connected={connected}
                />
            )}

            {gameState === 'playing' && (
                <Game
                    room={room}
                    player={player}
                    onBack={handleBackToLobby}
                />
            )}
        </div>
    );
}
