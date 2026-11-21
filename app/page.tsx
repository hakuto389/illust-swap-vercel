'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomState, ServerMessage, Stroke, Point } from '@/lib/protocol';

type Tool = 'pencil' | 'pen' | 'brush' | 'marker' | 'eraser';

const palette = [
  '#202124', '#757575', '#bdbdbd', '#ffffff',
  '#e53935', '#ff5252', '#f06292', '#9c27b0',
  '#673ab7', '#3f51b5', '#2196f3', '#03a9f4',
  '#00bcd4', '#009688', '#4caf50', '#8bc34a',
  '#cddc39', '#ffeb3b', '#ffc107', '#ff9800',
  '#ff5722', '#795548', '#a1887f', '#000000'
];

const toolChoices: { id: Tool; label: string }[] = [
  { id: 'pencil', label: '✏️ 鉛筆' },
  { id: 'pen', label: '🖊️ ペン' },
  { id: 'brush', label: '🖌️ 筆' },
  { id: 'marker', label: '🖍️ マーカー' },
  { id: 'eraser', label: '🧽 消しゴム' }
];

const canvasWidth = 900;
const canvasHeight = 600;

function getStrokeStyle(stroke: Stroke) {
  return {
    color: stroke.tool === 'eraser' ? '#ffffff' : stroke.color,
    width:
      stroke.tool === 'pencil' ? stroke.width * 0.6 :
      stroke.tool === 'marker' ? stroke.width * 2 :
      stroke.tool === 'eraser' ? stroke.width * 3 :
      stroke.tool === 'brush' ? stroke.width * 1.5 :
      stroke.width,
    alpha:
      stroke.tool === 'pencil' ? 0.65 :
      stroke.tool === 'marker' ? 0.4 :
      1
  };
}

export default function Home() {
  const [name, setName] = useState('');
  const [seconds, setSeconds] = useState(60);
  const [codeInput, setCodeInput] = useState('');
  const [room, setRoom] = useState<RoomState | null>(null);
  const [selfId, setSelfId] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [color, setColor] = useState('#202124');
  const [brush, setBrush] = useState(5);
  const [tool, setTool] = useState<Tool>('pen');
  const [remaining, setRemaining] = useState(0);
  const [draft, setDraft] = useState<Stroke | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  const send = useCallback((message: object) => {
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    } else {
      setError('サーバーに接続されていません。ページを再読み込みしてください。');
    }
  }, []);

  useEffect(() => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true);
      setError('');
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as ServerMessage;

        if (message.type === 'state') {
          setRoom(message.state);
          setSelfId(message.selfId);
          setError('');
        } else if (message.type === 'error') {
          setError(message.message);
        }
      } catch {
        setError('サーバーからのデータを読み取れませんでした。');
      }
    };

    ws.onclose = () => {
      setConnected(false);
    };

    ws.onerror = () => {
      setError('サーバーとの接続に失敗しました。');
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!room || room.status !== 'playing' || !room.deadline) {
      setRemaining(0);
      return;
    }

    const update = () => {
      setRemaining(Math.max(0, Math.ceil((room.deadline! - Date.now()) / 1000)));
    };

    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [room?.deadline, room?.status, room]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    const allStrokes = draft
      ? [...(room?.strokes ?? []), draft]
      : room?.strokes ?? [];

    for (const stroke of allStrokes) {
      if (!stroke.points.length) continue;

      const style = getStrokeStyle(stroke);
      ctx.save();
      ctx.strokeStyle = style.color;
      ctx.fillStyle = style.color;
      ctx.lineWidth = style.width;
      ctx.globalAlpha = style.alpha;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      if (stroke.points.length === 1) {
        ctx.beginPath();
        ctx.arc(
          stroke.points[0].x,
          stroke.points[0].y,
          style.width / 2,
          0,
          Math.PI * 2
        );
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(stroke.points[0].x, stroke.points[0].y);

        for (let i = 1; i < stroke.points.length; i++) {
          ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
        }

        ctx.stroke();
      }

      ctx.restore();
    }
  }, [room?.strokes, draft]);

  const isMyTurn =
    !!room &&
    room.status === 'playing' &&
    room.players[room.turnIndex]?.id === selfId &&
    !room.finishedPlayerIds.includes(selfId);

  const myPlayer = room?.players.find(player => player.id === selfId);

  const getPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();

    return {
      x: ((event.clientX - rect.left) / rect.width) * canvasWidth,
      y: ((event.clientY - rect.top) / rect.height) * canvasHeight
    };
  };

  const pointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isMyTurn) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drawingRef.current = true;

    setDraft({
      points: [getPoint(event)],
      color,
      width: brush,
      tool: tool as Stroke['tool']
    });
  };

  const pointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !isMyTurn) return;

    event.preventDefault();
    const point = getPoint(event);

    setDraft(previous => {
      if (!previous) return previous;
      return {
        ...previous,
        points: [...previous.points, point]
      };
    });
  };

  const pointerUp = () => {
    if (!drawingRef.current) return;

    drawingRef.current = false;

    setDraft(previous => {
      if (previous && previous.points.length > 0) {
        send({ type: 'stroke', stroke: previous });
      }
      return null;
    });
  };

  const createRoom = () => {
    if (!name.trim()) {
      setError('名前を入力してください');
      return;
    }

    send({ type: 'create', name, seconds });
  };

  const joinRoom = () => {
    if (!name.trim()) {
      setError('名前を入力してください');
      return;
    }

    if (codeInput.length !== 4) {
      setError('4桁の部屋番号を入力してください');
      return;
    }

    send({ type: 'join', code: codeInput, name });
  };

  const leaveRoom = () => {
    send({ type: 'leave' });
    setRoom(null);
    setSelfId('');
    setDraft(null);
  };

  const startGame = () => {
    send({ type: 'start' });
  };

  const completeGame = () => {
    if (window.confirm('完成にしますか？完成すると、もう描けなくなります。')) {
      send({ type: 'complete' });
    }
  };

  const clearCanvas = () => {
    if (window.confirm('キャンバスを白紙にしますか？')) {
      send({ type: 'clear' });
    }
  };

  const formatTime = (value: number) => {
    const minutes = Math.floor(value / 60);
    const secs = value % 60;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  };

  const styles = `
    * { box-sizing: border-box; }
    .page { min-height: 100vh; background: #f3f4f6; color: #202124; padding: 20px 14px 40px; font-family: Arial, sans-serif; }
    .container { max-width: 900px; margin: 0 auto; }
    .title { text-align: center; font-size: 30px; font-weight: 800; margin: 12px 0 8px; }
    .subtitle { text-align: center; color: #666; margin-bottom: 22px; }
    .panel { background: white; border-radius: 16px; padding: 20px; margin: 14px 0; box-shadow: 0 2px 8px #0000000d; }
    .field { width: 100%; padding: 13px; border: 1px solid #ccc; border-radius: 9px; font-size: 16px; margin: 8px 0 14px; }
    .button { border: 0; border-radius: 9px; padding: 12px 16px; font-size: 16px; font-weight: 700; cursor: pointer; }
    .primary { background: #2563eb; color: white; }
    .secondary { background: #e5e7eb; color: #202124; }
    .danger { background: #dc2626; color: white; }
    .button:disabled { opacity: .4; cursor: not-allowed; }
    .row { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .grow { flex: 1; }
    .room-code { font-size: 34px; font-weight: 800; letter-spacing: 8px; text-align: center; padding: 12px; }
    .players { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 8px; }
    .player { padding: 12px; border-radius: 9px; background: #f3f4f6; }
    .active-player { background: #dbeafe; outline: 2px solid #2563eb; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
    .tool-button { padding: 9px 11px; border: 1px solid #ddd; background: white; border-radius: 8px; cursor: pointer; }
    .tool-selected { border: 2px solid #2563eb; background: #eff6ff; }
    .palette { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); gap: 7px; margin: 12px 0; }
    .swatch { width: 100%; aspect-ratio: 1; border: 2px solid #ddd; border-radius: 7px; cursor: pointer; }
    .swatch-selected { outline: 3px solid #2563eb; outline-offset: 2px; }
    .canvas-wrap { width: 100%; background: white; border: 2px solid #d1d5db; border-radius: 10px; overflow: hidden; touch-action: none; }
    .canvas { display: block; width: 100%; height: auto; touch-action: none; cursor: crosshair; }
    .timer { font-size: 30px; font-weight: 800; text-align: center; }
    .error { color: #dc2626; text-align: center; font-weight: 700; margin: 12px 0; }
    .status { text-align: center; font-weight: 700; margin: 12px 0; }
    @media (max-width: 500px) {
      .page { padding: 12px 9px 30px; }
      .panel { padding: 14px; }
      .title { font-size: 25px; }
      .palette { grid-template-columns: repeat(8, minmax(0, 1fr)); }
      .room-code { font-size: 28px; }
    }
  `;

  return (
    <main className="page">
      <style>{styles}</style>
      <div className="container">
        <h1 className="title">🎨 イラスト交換ゲーム</h1>
        <p className="subtitle">みんなで絵をつないで完成させよう！</p>

        <div className="status">
          {connected ? '🟢 サーバーに接続中' : '🔴 接続していません'}
        </div>

        {error && <p className="error">{error}</p>}

        {!room && (
          <section className="panel">
            <h2>ゲームに参加</h2>

            <label htmlFor="player-name">プレイヤー名</label>
            <input
              id="player-name"
              className="field"
              value={name}
              onChange={event => setName(event.target.value)}
              maxLength={16}
              placeholder="名前を入力"
            />

            <h3>部屋を作る</h3>
            <label htmlFor="time-select">1人あたりのお絵描き時間</label>
            <select
              id="time-select"
              className="field"
              value={seconds}
              onChange={event => setSeconds(Number(event.target.value))}
            >
              <option value={60}>1分</option>
              <option value={120}>2分</option>
              <option value={180}>3分</option>
              <option value={300}>5分</option>
              <option value={600}>10分</option>
            </select>

            <button className="button primary grow" onClick={createRoom} disabled={!connected}>
              部屋を作成する
            </button>

            <hr style={{ margin: '22px 0', border: 0, borderTop: '1px solid #ddd' }} />

            <h3>部屋番号で参加</h3>
            <input
              className="field"
              value={codeInput}
              onChange={event => setCodeInput(event.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="4桁の部屋番号"
              inputMode="numeric"
              maxLength={4}
            />
            <button
              className="button primary"
              onClick={joinRoom}
              disabled={!connected || codeInput.length !== 4}
              style={{ width: '100%' }}
            >
              部屋に入る
            </button>
          </section>
        )}

        {room && (
          <>
            <section className="panel">
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>部屋番号</strong>
                <button className="button secondary" onClick={leaveRoom}>退出する</button>
              </div>

              <div className="room-code">{room.code}</div>
              <p style={{ textAlign: 'center', color: '#666' }}>
                この番号を友達に教えてね！
              </p>

              <h3>参加プレイヤー（{room.players.length}/4人）</h3>
              <div className="players">
                {room.players.map((player, index) => (
                  <div
                    key={player.id}
                    className={`player ${room.status === 'playing' && room.players[room.turnIndex]?.id === player.id ? 'active-player' : ''}`}
                  >
                    <strong>{player.name}</strong>
                    {player.id === room.hostId && <span> 👑</span>}
                    {player.id === selfId && <span>（自分）</span>}
                    {room.finishedPlayerIds.includes(player.id) && <div>✅ 完成</div>}
                    {room.status === 'playing' && room.players[room.turnIndex]?.id === player.id && <div>✏️ 描画中</div>}
                  </div>
                ))}
              </div>

              {room.status === 'waiting' && (
                <div style={{ textAlign: 'center', marginTop: 20 }}>
                  <p>制限時間：{room.seconds / 60}分</p>
                  {room.hostId === selfId ? (
                    <button
                      className="button primary"
                      onClick={startGame}
                      disabled={room.players.length < 2}
                    >
                      ゲーム開始（2人以上）
                    </button>
                  ) : (
                    <p>ホストがゲームを開始するまで待ってね！</p>
                  )}
                </div>
              )}
            </section>

            {room.status === 'playing' && (
              <>
                <section className="panel">
                  <div className="timer">⏱ {formatTime(remaining)}</div>
                  <p className="status">
                    {isMyTurn
                      ? 'あなたの番です！絵を描こう！'
                      : room.finishedPlayerIds.includes(selfId)
                        ? 'あなたは完成済みです。みんなの完成を待とう！'
                        : `${room.players[room.turnIndex]?.name ?? ''} さんがお絵描き中`}
                  </p>
                </section>

                <section className="panel">
                  <h3>ペンの種類</h3>
                  <div className="toolbar">
                    {toolChoices.map(choice => (
                      <button
                        key={choice.id}
                        className={`tool-button ${tool === choice.id ? 'tool-selected' : ''}`}
                        onClick={() => setTool(choice.id)}
                        disabled={!isMyTurn}
                      >
                        {choice.label}
                      </button>
                    ))}
                  </div>

                  <h3>色</h3>
                  <div className="palette">
                    {palette.map(item => (
                      <button
                        key={item}
                        title={item}
                        aria-label={`色 ${item}`}
                        className={`swatch ${color === item ? 'swatch-selected' : ''}`}
                        style={{ background: item }}
                        onClick={() => setColor(item)}
                        disabled={!isMyTurn}
                      />
                    ))}
                  </div>

                  <div className="row">
                    <label htmlFor="brush-size">線の太さ：{brush}</label>
                    <input
                      id="brush-size"
                      type="range"
                      min="1"
                      max="20"
                      value={brush}
                      onChange={event => setBrush(Number(event.target.value))}
                      disabled={!isMyTurn}
                      className="grow"
                    />
                  </div>

                  <div className="canvas-wrap" style={{ marginTop: 16 }}>
                    <canvas
                      ref={canvasRef}
                      className="canvas"
                      width={canvasWidth}
                      height={canvasHeight}
                      onPointerDown={pointerDown}
                      onPointerMove={pointerMove}
                      onPointerUp={pointerUp}
                      onPointerCancel={pointerUp}
                      onLostPointerCapture={pointerUp}
                    />
                  </div>

                  <div className="row" style={{ marginTop: 14 }}>
                    <button
                      className="button secondary grow"
                      onClick={clearCanvas}
                      disabled={!isMyTurn}
                    >
                      キャンバスを白紙にする
                    </button>
                    <button
                      className="button primary grow"
                      onClick={completeGame}
                      disabled={!isMyTurn}
                    >
                      完成！
                    </button>
                  </div>
                </section>
              </>
            )}

            {room.status === 'finished' && (
              <section className="panel" style={{ textAlign: 'center' }}>
                <h2>🎉 ゲーム終了！</h2>
                <p>みんなで絵を完成させたよ！</p>
                <div className="canvas-wrap" style={{ margin: '16px 0' }}>
                  <canvas
                    ref={canvasRef}
                    className="canvas"
                    width={canvasWidth}
                    height={canvasHeight}
                  />
                </div>
                <button className="button secondary" onClick={leaveRoom}>
                  部屋を退出する
                </button>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}
