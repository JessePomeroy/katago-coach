import { movesToSgf, opponent, toGtpCoordinate } from './coordinates';
import type { GameRecord, GoMove, StoneColor } from './types';

const SGF_COLUMNS = 'abcdefghijklmnopqrstuvwxyz';

type SgfProperties = Record<string, string[]>;

export function parseSgfGame(input: string, id = crypto.randomUUID()): GameRecord {
	const sgf = input.trim();
	if (!sgf) {
		throw new Error('SGF is empty.');
	}

	const nodes = parseMainLineNodes(sgf);
	const root = nodes[0] ?? {};
	const boardSize = parseInt(root.SZ?.[0] ?? '19', 10) || 19;
	const komi = parseFloat(root.KM?.[0] ?? '7.5');
	const rules = root.RU?.[0] || 'Chinese';
	const moves = nodes.slice(1).flatMap((node, index) => nodeToMove(node, index + 1, boardSize));

	return {
		id,
		title: makeGameTitle(root),
		blackPlayer: root.PB?.[0],
		whitePlayer: root.PW?.[0],
		event: root.EV?.[0],
		date: root.DT?.[0],
		result: root.RE?.[0],
		source: root.SO?.[0],
		boardSize,
		komi: Number.isFinite(komi) ? komi : 7.5,
		rules,
		moves,
		sgf: movesToSgf(moves, boardSize, Number.isFinite(komi) ? komi : 7.5, rules)
	};
}

function parseMainLineNodes(sgf: string): SgfProperties[] {
	const nodes: SgfProperties[] = [];
	let depth = 0;
	let index = 0;

	while (index < sgf.length) {
		const char = sgf[index];

		if (char === '(') {
			depth += 1;
			index += 1;
			continue;
		}

		if (char === ')') {
			depth -= 1;
			index += 1;
			continue;
		}

		if (char === ';' && depth === 1) {
			const [node, nextIndex] = parseNode(sgf, index + 1);
			nodes.push(node);
			index = nextIndex;
			continue;
		}

		index += 1;
	}

	return nodes;
}

function parseNode(sgf: string, start: number): [SgfProperties, number] {
	const properties: SgfProperties = {};
	let index = start;

	while (index < sgf.length) {
		skipWhitespace();
		const char = sgf[index];
		if (char === ';' || char === '(' || char === ')') break;

		const nameStart = index;
		while (/[A-Za-z]/.test(sgf[index] ?? '')) index += 1;
		const name = sgf.slice(nameStart, index).toUpperCase();
		if (!name) {
			index += 1;
			continue;
		}

		const values: string[] = [];
		skipWhitespace();
		while (sgf[index] === '[') {
			const [value, nextIndex] = parsePropertyValue(sgf, index + 1);
			values.push(value);
			index = nextIndex;
			skipWhitespace();
		}

		properties[name] = values;
	}

	return [properties, index];

	function skipWhitespace() {
		while (/\s/.test(sgf[index] ?? '')) index += 1;
	}
}

function parsePropertyValue(sgf: string, start: number): [string, number] {
	let value = '';
	let index = start;

	while (index < sgf.length) {
		const char = sgf[index];

		if (char === '\\') {
			value += sgf[index + 1] ?? '';
			index += 2;
			continue;
		}

		if (char === ']') {
			return [value, index + 1];
		}

		value += char;
		index += 1;
	}

	throw new Error('Invalid SGF: unterminated property value.');
}

function nodeToMove(node: SgfProperties, moveNumber: number, boardSize: number): GoMove[] {
	const color: StoneColor | null = node.B ? 'B' : node.W ? 'W' : null;
	if (!color) return [];

	const sgf = (node[color]?.[0] ?? '').toLowerCase();
	const { x, y } = sgfToPoint(sgf);

	return [
		{
			color,
			x,
			y,
			moveNumber,
			gtp: toGtpCoordinate(x, y, boardSize),
			sgf
		}
	];
}

function sgfToPoint(value: string): { x: number; y: number } {
	if (value === '' || value.toLowerCase() === 'tt') {
		return { x: -1, y: -1 };
	}

	const x = SGF_COLUMNS.indexOf(value[0] ?? '');
	const y = SGF_COLUMNS.indexOf(value[1] ?? '');
	if (x < 0 || y < 0) {
		throw new Error(`Invalid SGF move coordinate: ${value}`);
	}

	return { x, y };
}

function makeGameTitle(root: SgfProperties): string {
	const event = root.EV?.[0];
	const black = root.PB?.[0] ?? 'Black';
	const white = root.PW?.[0] ?? 'White';
	const date = root.DT?.[0];
	const base = `${black} vs ${white}`;

	if (event && date) return `${event}: ${base} (${date})`;
	if (event) return `${event}: ${base}`;
	if (date) return `${base} (${date})`;
	return base;
}

export function positionMovesForTurn(game: GameRecord, turn: number): GoMove[] {
	return game.moves.slice(0, Math.max(0, Math.min(turn, game.moves.length))).map((move, index) => ({
		...move,
		moveNumber: index + 1
	}));
}

export function nextPlayerForMoves(moves: GoMove[]): StoneColor {
	return moves.at(-1) ? opponent(moves.at(-1)!.color) : 'B';
}
