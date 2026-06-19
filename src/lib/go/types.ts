export type StoneColor = 'B' | 'W';
export type BoardPoint = 0 | 1 | 2;
export type AnalysisSource = 'katago' | 'fallback';

export interface GoMove {
	color: StoneColor;
	x: number;
	y: number;
	moveNumber: number;
	gtp: string;
	sgf: string;
}

export interface GoPosition {
	boardSize: number;
	komi: number;
	rules: string;
	nextPlayer: StoneColor;
	moves: GoMove[];
	board: BoardPoint[][];
	sgf: string;
	lastMove?: GoMove;
}

export interface KataGoMoveInfo {
	move: string;
	order?: number;
	visits?: number;
	winrate?: number;
	scoreLead?: number;
	scoreMean?: number;
	prior?: number;
	lcb?: number;
	pv?: string[];
	ownership?: number[];
	[key: string]: unknown;
}

export interface KataGoRootInfo {
	currentPlayer?: StoneColor;
	visits?: number;
	winrate?: number;
	scoreLead?: number;
	scoreMean?: number;
	rawWinrate?: number;
	rawLead?: number;
	[key: string]: unknown;
}

export interface KataGoQuery {
	id: string;
	moves: [StoneColor, string][];
	rules: string;
	komi: number;
	boardXSize: number;
	boardYSize: number;
	maxVisits: number;
	analysisPVLen: number;
	includeOwnership: boolean;
	includePolicy: boolean;
}

export interface AnalysisResult {
	id: string;
	source: AnalysisSource;
	generatedAt: string;
	rootInfo: KataGoRootInfo;
	moveInfos: KataGoMoveInfo[];
	ownership?: number[];
	policy?: number[];
	request: KataGoQuery;
	unavailableReason?: string;
}

export interface ChatMessage {
	role: 'user' | 'assistant';
	content: string;
}

export interface GameRecord {
	id: string;
	title: string;
	blackPlayer?: string;
	whitePlayer?: string;
	event?: string;
	date?: string;
	result?: string;
	source?: string;
	boardSize: number;
	komi: number;
	rules: string;
	moves: GoMove[];
	sgf: string;
}
