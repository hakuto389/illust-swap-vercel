
export type Point = { x: number; y: number };

export type Stroke = {
  points: Point[];
  color: string;
  width: number;
};

export type Player = {
  id: string;
  name: string;
};

export type RoomState = {
  code: string;
  players: Player[];
  hostId: string;
  status: 'waiting' | 'playing' | 'finished';
  seconds: number;
  turnIndex: number;
  deadline: number | null;
  strokes: Stroke[];
  finishedPlayerIds: string[];
};

export type ClientMessage =
  | { type: 'create'; name: string; seconds: number }
  | { type: 'join'; code: string; name: string }
  | { type: 'start' }
  | { type: 'stroke'; stroke: Stroke }
  | { type: 'finishTurn' }
  | { type: 'complete' }
  | { type: 'clear' }
  | { type: 'leave' };

export type ServerMessage =
  | { type: 'state'; state: RoomState; selfId: string }
  | { type: 'error'; message: string };
