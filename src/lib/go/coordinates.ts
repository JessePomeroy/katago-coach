import type { GoMove, GoPosition, StoneColor } from './types';

const GTP_COLUMNS = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';
const SGF_COLUMNS = 'abcdefghijklmnopqrstuvwxyz';

export function opponent(color: StoneColor): StoneColor {
	return color === 'B' ? 'W' : 'B';
}

export function toGtpCoordinate(x: number, y: number, boardSize: number): string {
	if (x < 0 || y < 0) return 'pass';

	const column = GTP_COLUMNS[x];
	if (!column) {
		throw new Error(`Unsupported board coordinate x=${x}`);
	}

	return `${column}${boardSize - y}`;
}

export function toSgfCoordinate(x: number, y: number): string {
	if (x < 0 || y < 0) return '';

	const column = SGF_COLUMNS[x];
	const row = SGF_COLUMNS[y];
	if (!column || !row) {
		throw new Error(`Unsupported SGF coordinate (${x}, ${y})`);
	}

	return `${column}${row}`;
}

export function colorName(color: StoneColor): string {
	return color === 'B' ? 'Black' : 'White';
}

function escapeSgfText(value: string): string {
	return value.replace(/\\/g, '\\\\').replace(/\]/g, '\\]');
}

export function movesToSgf(moves: GoMove[], boardSize = 19, komi = 7.5, rules = 'Chinese'): string {
	const body = moves.map((move) => `;${move.color}[${move.sgf}]`).join('');
	return `(;GM[1]FF[4]CA[UTF-8]AP[KataGo Coach]SZ[${boardSize}]KM[${komi}]RU[${escapeSgfText(rules)}]${body})`;
}

export function createEmptyBoard(boardSize: number): GoPosition['board'] {
	return Array.from({ length: boardSize }, () => Array.from({ length: boardSize }, () => 0 as const));
}

export function createEmptyPosition(boardSize = 19, komi = 7.5, rules = 'Chinese'): GoPosition {
	return {
		boardSize,
		komi,
		rules,
		nextPlayer: 'B',
		moves: [],
		board: createEmptyBoard(boardSize),
		sgf: movesToSgf([], boardSize, komi, rules)
	};
}

export function formatWinrate(value: number | undefined): string {
	if (typeof value !== 'number') return 'n/a';
	return `${(value * 100).toFixed(1)}%`;
}

export function formatScoreLead(value: number | undefined): string {
	if (typeof value !== 'number') return 'n/a';
	const sign = value > 0 ? '+' : '';
	return `${sign}${value.toFixed(1)}`;
}
