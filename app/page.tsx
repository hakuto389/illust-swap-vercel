'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomState, ServerMessage, Stroke, Point } from '@/lib/protocol';

const palette = [
  '#202124', '#757575', '#bdbdbd', '#ffffff',
  '#e53935', '#ff5252', '#f06292', '#9c27b0',
  '#673ab7', '#3f51b5', '#2196f3', '#03a9f4',
  '#00bcd4', '#009688', '#4caf50', '#8bc34a',
  '#cddc39', '#ffeb3b', '#ffc107', '#ff9800',
  '#ff5722', '#795548', '#a1887f', '#000000'
];

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
  const [tool, setTool] = useState('pen');
  const [remaining, setRemaining] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const current = useRef<Point[]>([]);

  const send = useCallback((data: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  useEffect(() => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      setError('サーバーとの接続が切れました。ページを再読み込みしてください');
    };
    ws.onerror = () => setError('通信エラーが発生しました');

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data) as ServerMessage;
      if (data.type === 'error') {
        setError(data.message);
      } else {
        setError('');
        setRoom(data.state);
        setSelfId(data.selfId);
      }
    };

    return () => ws.close();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of room?.strokes ?? []) {
      if (!stroke.points.length) continue;

      ctx.beginPath();
      ctx.strokeStyle = stroke.color;
      ctx.lineWidth = stroke.width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.moveTo(stroke.points[0].x * canvas.width, stroke.points[0].y * canvas.height);

      for (const p of stroke.points.slice(1)) {
        ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
      }

      if (stroke.points.length === 1) {
        ctx.lineTo(stroke.points[0].x * canvas.width + 0.1, stroke.points[0].y * canvas.height + 0.1);
      }

      ctx.stroke();
    }
  }, [room]);

  useEffect(() => {
    if (!room?.deadline || room.status !== 'playing') {
      setRemaining(0);
      return;
    }

    const tick = () => setRemaining(Math.max(0, Math.ceil((room.deadline! - Date.now()) / 1000)));

    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [room?.deadline, room?.status]);

  const active = !!room &&
    room.status === 'playing' &&
    room.players[room.turnIndex]?.id === selfId &&
    !room.finishedPlayerIds.includes(selfId);

  const completed = room?.finishedPlayerIds.includes(selfId) ?? false;

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = e.currentTarget.getBoundingClientRect();

    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
    };
  };

  const pointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!active) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    current.current = [getPoint(e)];
  };

  const pointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !active) return;

    const p = getPoint(e);
    current.current.push(p);

    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const pts = current.current;

    ctx.beginPath();
    ctx.strokeStyle = tool === 'eraser' ? '#ffffff' : color;
ctx.lineWidth =
  tool === 'pencil' ? brush * 0.6 :
  tool === 'marker' ? brush * 2 :
  tool === 'eraser' ? brush * 3 :
  tool === 'brush' ? brush * 1.5 :
  brush;

ctx.globalAlpha =
  tool === 'pencil' ? 0.65 :
  tool === 'marker' ? 0.4 :
  1;

ctx.lineCap = 'round';
ctx.lineJoin = 'round';

    if (pts.length === 1) {
      ctx.arc(p.x * 900, p.y * 520, brush / 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.moveTo(pts[pts.length - 2].x * 900, pts[pts.length - 2].y * 520);
      ctx.lineTo(p.x * 900, p.y * 520);
      ctx.stroke();
    }
  };

  const pointerUp = () => {
    if (!drawing.current) return;

    drawing.current = false;

    if (current.current.length) {
      send({
        type: 'stroke',
        stroke: {
          points: current.current,
          color,
          width: brush
        } satisfies Stroke
      });
    }

    current.current = [];
  };

  const create = () => {
    if (!name.trim()) {
      setError('先に名前を入力してください');
      return;
    }

    send({ type: 'create', name: name.trim(), seconds });
  };

  const join = () => {
    if (!name.trim()) {
      setError('先に名前を入力してください');
      return;
    }

    if (!/^\d{4}$/.test(codeInput)) {
      setError('4桁の部屋番号を入力してください');
      return;
    }

    send({ type: 'join', name: name.trim(), code: codeInput });
  };

  const leave = () => {
    send({ type: 'leave' });
    setRoom(null);
  };

  return <main className="page">
    <header className="top">
      <div className="logo">✏️</div>
      <div>
        <h1>おえかきリレー</h1>
        <p>みんなで1枚の絵をつなごう！</p>
      </div>
      <span className={`connection ${connected ? 'on' : ''}`}>
        {connected ? '接続中' : '接続中...'}
      </span>
    </header>

    {error && <div className="error">{error}</div>}

    {!room ? (
      <section className="lobby card">
        <div className="intro">
          <div className="heroIcon">🎨</div>
          <h2>友達とおえかきリレー！</h2>
          <p>部屋を作って、4桁の番号を友達に教えよう。</p>
        </div>

        <label>
          あなたの名前
          <input value={name} onChange={e => setName(e.target.value)} maxLength={16} placeholder="名前を入力" />
        </label>

        <div className="createBox">
          <h3>部屋を作る</h3>
          <label>
            1人あたりの制限時間
            <select value={seconds} onChange={e => setSeconds(Number(e.target.value))}>
              <option value={60}>1分</option>
              <option value={120}>2分</option>
              <option value={180}>3分</option>
              <option value={300}>5分</option>
              <option value={600}>10分</option>
            </select>
          </label>
          <button className="primary" onClick={create} disabled={!connected}>部屋を作成する</button>
        </div>

        <div className="joinBox">
          <h3>友達の部屋に参加する</h3>
          <p className="muted">部屋を作った人から4桁の番号を教えてもらってね。</p>
          <input
            className="codeInput"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={4}
            value={codeInput}
            onChange={e => setCodeInput(e.target.value.replace(/\D/g, '').slice(0, 4))}
            placeholder="例：1234"
            aria-label="4桁の部屋番号"
          />
          <button
            className="secondary"
            onClick={join}
            disabled={!connected || codeInput.length !== 4 || !name.trim()}
          >
            この番号の部屋に入る
          </button>
        </div>

        <p className="smallNote">最大4人・ランダムマッチングなし</p>
      </section>
    ) : (
      <section className="game">
        <div className="roomBar card">
          <div>
            <span className="muted">部屋番号</span>
            <strong className="roomCode">{room.code}</strong>
          </div>
          <button className="copy" onClick={() => navigator.clipboard?.writeText(room.code)}>番号をコピー</button>
          <button className="leave" onClick={leave}>退出</button>
        </div>

        <div className="card players">
          <div className="playersTitle">
            <h2>参加メンバー</h2>
            <span>{room.players.length}/4人</span>
          </div>

          <div className="playerList">
            {room.players.map((p, i) => (
              <div className={`player ${room.status === 'playing' && i === room.turnIndex ? 'turn' : ''}`} key={p.id}>
                <span className="playerNum">{i + 1}</span>
                <span>
                  {p.name}
                  {p.id === room.hostId ? ' 👑' : ''}
                  {p.id === selfId ? '（あなた）' : ''}
                </span>
                {room.finishedPlayerIds.includes(p.id) && <b>完成済み ✓</b>}
                {room.status === 'playing' && i === room.turnIndex && !room.finishedPlayerIds.includes(p.id) && <b>描く番！</b>}
              </div>
            ))}
          </div>
        </div>

        {room.status === 'waiting' && (
          <div className="card waiting">
            <div className="waitIcon">🖍️</div>
            <h2>友達を待っています</h2>
            <p>部屋番号 <b>{room.code}</b> を友達に教えてね。</p>
            {room.hostId === selfId ? (
              <button className="primary" disabled={room.players.length < 2} onClick={() => send({ type: 'start' })}>
                ゲームスタート
              </button>
            ) : (
              <p className="muted">部屋の作成者がゲームを開始します</p>
            )}
            {room.players.length < 2 && <small>あと1人参加すると開始できます</small>}
          </div>
        )}

        {room.status !== 'waiting' && (
          <>
            <div className="turnInfo card">
              <div>
                <span className="muted">
                  {room.status === 'finished' ? 'ゲーム終了' : `${room.turnIndex + 1}人目のターン`}
                </span>
                <strong>
                  {room.status === 'finished'
                    ? '完成！'
                    : completed
                      ? 'あなたは完成済み！'
                      : `${room.players[room.turnIndex]?.name} さん`}
                </strong>
              </div>

              <div className="time">{room.status === 'finished' ? '🎉' : `${remaining}秒`}</div>

              {active && (
                <>
                  <button className="secondary smallButton" onClick={() => send({ type: 'finishTurn' })}>
                    次の人へ
                  </button>
                  <button className="primary smallButton" onClick={() => send({ type: 'complete' })}>
                    🎉 完成！
                  </button>
                </>
              )}
              {completed && <span>完成済み ✓</span>}
            </div>

            <div className="card canvasCard">
              <div className="canvasHead">
                <strong>
                  {active
                    ? 'あなたの番です！描いてね'
                    : room.status === 'finished'
                      ? 'みんなの絵が完成！'
                      : completed
                        ? 'あなたは完成しました！'
                        : 'ほかの人が描いています'}
                </strong>
                <span>前の人の絵に重ねて描こう</span>
              </div>

              <canvas
                ref={canvasRef}
                width={900}
                height={520}
                className={!active ? 'canvas disabledCanvas' : 'canvas'}
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
              />

              {active && (
                <div className="tools">
                  <div className="colors">
                    {palette.map(c => (
                      <button
                        key={c}
                        aria-label={c}
                        className={`swatch ${color === c ? 'selected' : ''}`}
                        style={{ background: c }}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                  <label className="brushLabel">
                    太さ
                    <input type="range" min="2" max="18" value={brush} onChange={e => setBrush(Number(e.target.value))} />
                  </label>
                  <button className="undo" onClick={() => send({ type: 'clear' })}>全部消す</button>
                </div>
              )}

              {room.status === 'finished' && (
                <button className="primary" onClick={leave}>ロビーに戻る</button>
              )}
            </div>
          </>
        )}
      </section>
    )}

    <footer>おえかきリレー · 試作版</footer>
  </main>;
}
