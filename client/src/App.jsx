import React, { useState, useEffect } from 'react';
import Lobby from './components/Lobby';
import Game from './components/Game';
import { socket } from './net/socket';

export default function App() {
    const [gameState, setGameState] = useState('lobby'); // 'lobby', 'playing', 'gameover'
    const [room, setRoom] = useState(null);
    const [player, setPlayer] = useState(null);
    const [connected, setConnected] = useState(false);
    const [winner, setWinner] = useState(null);

    useEffect(() => {
        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));

        socket.on('roomUpdate', r => {
            setRoom(r);
            // If we are in lobby and room starts running, switch to playing
            if (r.running && gameState === 'lobby') {
                setGameState('playing');
            }
        });

        socket.on('matchStart', () => {
            setGameState('playing');
            setWinner(null);
        });

        socket.on('matchEnd', ({ winnerId, winnerName }) => {
            setGameState('gameover');
            setWinner({ id: winnerId, name: winnerName });
            // Optional: Auto-return to lobby after delay?
            // For now, we'll let them click "Back to Lobby"
        });

        return () => { socket.off(); }
    }, [gameState]);

    const handleBackToLobby = () => {
        setGameState('lobby');
        setWinner(null);
        // Optionally leave room or reset room state if needed
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

            {(gameState === 'playing' || gameState === 'gameover') && (
                <Game
                    room={room}
                    player={player}
                    gameState={gameState}
                    winner={winner}
                    onBack={handleBackToLobby}
                />
            )}
        </div>
    );
}
