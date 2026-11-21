
import { experimental_upgradeWebSocket, type WebSocketData } from '@vercel/functions';
import type { ClientMessage, Player, RoomState, ServerMessage } from '@/lib/protocol';

export const runtime = 'nodejs';

type Socket = {
  send: (data: string) => void;
  close: () => void;
  on: (event: string, cb: (data?: WebSocketData) => void) => void;
};

type Member = { id: string; name: string; ws: Socket };

type Room = {
  state: RoomState;
  members: Map<string, Member>;
  timer?: ReturnType<typeof setTimeout>;
};

const rooms = new Map<string, Room>();
const socketIds = new WeakMap<object, { id: string; code: string | null }>();

function send(ws: Socket, message: ServerMessage) {
  try { ws.send(JSON.stringify(message)); } catch {}
}

function broadcast(room: Room) {
  for (const member of room.members.values()) {
    send(member.ws, {
      type: 'state',
      state: room.state,
      selfId: member.id
    });
  }
}

function roomCode() {
  for (let i = 0; i < 80; i++) {
    const code = String(Math.floor(1000 + Math.random() * 9000));
    if (!rooms.has(code)) return code;
  }
  return '';
}

function publicPlayers(room: Room): Player[] {
  return room.state.players;
}

function finish(room: Room) {
  room.state.status = 'finished';
  room.state.deadline = null;
  if (room.timer) clearTimeout(room.timer);
  broadcast(room);
}

function findNextPlayer(room: Room, start: number): number {
  const players = room.state.players;

  for (let i = 0; i < players.length; i++) {
    const index = (start + i) % players.length;
    if (!room.state.finishedPlayerIds.includes(players[index].id)) {
      return index;
    }
  }

  return -1;
}

function advanceTurn(room: Room) {
  if (room.state.status !== 'playing') return;

  const next = findNextPlayer(room, room.state.turnIndex + 1);

  if (next === -1) {
    finish(room);
    return;
  }

  room.state.turnIndex = next;
  room.state.deadline = Date.now() + room.state.seconds * 1000;
  scheduleFinish(room);
  broadcast(room);
}

function scheduleFinish(room: Room) {
  if (room.timer) clearTimeout(room.timer);

  const deadline = room.state.deadline;
  if (!deadline) return;

  room.timer = setTimeout(() => {
    if (room.state.status !== 'playing') return;
    advanceTurn(room);
  }, Math.max(0, deadline - Date.now()));
}

function leave(ws: Socket) {
  const info = socketIds.get(ws as object);
  if (!info?.code) return;

  const room = rooms.get(info.code);
  if (!room) return;

  room.members.delete(info.id);
  room.state.players = publicPlayers(room).filter(p => p.id !== info.id);
  room.state.finishedPlayerIds =
    room.state.finishedPlayerIds.filter(id => id !== info.id);

  if (room.state.players.length === 0) {
    if (room.timer) clearTimeout(room.timer);
    rooms.delete(info.code);
  } else {
    if (room.state.hostId === info.id) {
      room.state.hostId = room.state.players[0].id;
    }

    if (room.state.turnIndex >= room.state.players.length) {
      room.state.turnIndex = 0;
    }

    if (
      room.state.status === 'playing' &&
      room.state.finishedPlayerIds.length >= room.state.players.length
    ) {
      finish(room);
    } else {
      broadcast(room);
    }
  }

  socketIds.set(ws as object, { ...info, code: null });
}

function handle(ws: Socket, raw: WebSocketData) {
  let msg: ClientMessage;

  try {
    msg = JSON.parse(String(raw)) as ClientMessage;
  } catch {
    send(ws, { type: 'error', message: '送信内容を読み取れませんでした' });
    return;
  }

  const info = socketIds.get(ws as object);
  if (!info) return;

  if (msg.type === 'create') {
    leave(ws);

    const code = roomCode();
    if (!code) {
      send(ws, { type: 'error', message: '部屋を作れませんでした。もう一度お試しください' });
      return;
    }

    const id = info.id;
    const player = {
      id,
      name: msg.name.trim().slice(0, 16) || 'プレイヤー'
    };

    const room: Room = {
      state: {
        code,
        players: [player],
        hostId: id,
        status: 'waiting',
        seconds: [60, 120, 180, 300, 600].includes(msg.seconds) ? msg.seconds : 60,
        turnIndex: 0,
        deadline: null,
        strokes: [],
        finishedPlayerIds: []
      },
      members: new Map()
    };

    room.members.set(id, { ...player, ws });
    rooms.set(code, room);
    socketIds.set(ws as object, { id, code });
    broadcast(room);
    return;
  }

  if (msg.type === 'join') {
    leave(ws);

    const code = String(msg.code ?? '').replace(/\D/g, '').slice(0, 4);

    if (code.length !== 4) {
      send(ws, { type: 'error', message: '4桁の部屋番号を入力してください' });
      return;
    }

    const room = rooms.get(code);

    if (!room) {
      send(ws, { type: 'error', message: 'その部屋は見つかりません。番号を確認してください' });
      return;
    }

    if (room.state.status !== 'waiting') {
      send(ws, { type: 'error', message: 'この部屋はすでにゲーム中です' });
      return;
    }

    if (room.state.players.length >= 4) {
      send(ws, { type: 'error', message: 'この部屋は満員です（最大4人）' });
      return;
    }

    const id = info.id;
    const player = {
      id,
      name: msg.name.trim().slice(0, 16) || 'プレイヤー'
    };

    room.state.players.push(player);
    room.members.set(id, { ...player, ws });
    socketIds.set(ws as object, { id, code });
    broadcast(room);
    return;
  }

  if (!info.code) return;

  const room = rooms.get(info.code);
  if (!room) return;

  if (msg.type === 'start') {
    if (
      room.state.hostId !== info.id ||
      room.state.players.length < 2 ||
      room.state.status !== 'waiting'
    ) return;

    room.state.status = 'playing';
    room.state.turnIndex = 0;
    room.state.finishedPlayerIds = [];
    room.state.deadline = Date.now() + room.state.seconds * 1000;

    scheduleFinish(room);
    broadcast(room);
    return;
  }

  if (msg.type === 'stroke') {
    if (
      room.state.status !== 'playing' ||
      room.state.players[room.state.turnIndex]?.id !== info.id ||
      room.state.finishedPlayerIds.includes(info.id)
    ) return;

    if (msg.stroke.points.length > 600) return;

    room.state.strokes.push(msg.stroke);
    broadcast(room);
    return;
  }

  if (msg.type === 'clear') {
    if (
      room.state.status === 'playing' &&
      room.state.players[room.state.turnIndex]?.id === info.id &&
      !room.state.finishedPlayerIds.includes(info.id)
    ) {
      room.state.strokes = [];
      broadcast(room);
    }
    return;
  }

  if (msg.type === 'finishTurn') {
    if (
      room.state.status !== 'playing' ||
      room.state.players[room.state.turnIndex]?.id !== info.id ||
      room.state.finishedPlayerIds.includes(info.id)
    ) return;

    advanceTurn(room);
    return;
  }

  if (msg.type === 'complete') {
    if (
      room.state.status !== 'playing' ||
      room.state.players[room.state.turnIndex]?.id !== info.id ||
      room.state.finishedPlayerIds.includes(info.id)
    ) return;

    room.state.finishedPlayerIds.push(info.id);

    if (room.state.finishedPlayerIds.length >= room.state.players.length) {
      finish(room);
    } else {
      advanceTurn(room);
    }
    return;
  }

  if (msg.type === 'leave') {
    leave(ws);
  }
}

export function GET() {
  return experimental_upgradeWebSocket((ws) => {
    const id = crypto.randomUUID();

    socketIds.set(ws as object, { id, code: null });

    ws.on('message', (data: WebSocketData) => {
      handle(ws as unknown as Socket, data);
    });

    ws.on('close', () => {
      leave(ws as unknown as Socket);
    });
  });
}
