<script lang="ts">
	import { onMount } from 'svelte';
	import 'goban/build/Goban.css';
	import {
		createEmptyBoard,
		movesToSgf,
		toGtpCoordinate,
		toSgfCoordinate
	} from '$lib/go/coordinates';
	import type { BoardPoint, GoMove, GoPosition, StoneColor } from '$lib/go/types';

	type GobanInstance = {
		engine: {
			board: number[][];
			cur_move: MoveNode;
			place: (x: number, y: number, ...args: unknown[]) => number;
			colorToMove: () => 'black' | 'white';
		};
		on: (event: string, callback: () => void) => void;
		off: (event: string, callback: () => void) => void;
		destroy: () => void;
		redraw: (force?: boolean) => void;
		setAnalyzeTool?: (tool: string, subtool?: string | null) => void;
		setSquareSizeBasedOnDisplayWidth?: (width: number, suppressRedraw?: boolean) => void;
	};

	type MoveNode = {
		x: number;
		y: number;
		player: number;
		move_number: number;
		parent: MoveNode | null;
	};

	let {
		boardSize = 19,
		komi = 7.5,
		rules = 'Chinese',
		moves = [],
		disabled = false,
		onPositionChange
	}: {
		boardSize?: number;
		komi?: number;
		rules?: string;
		moves?: GoMove[];
		disabled?: boolean;
		onPositionChange: (position: GoPosition) => void;
	} = $props();

	let boardElement: HTMLDivElement;
	let errorMessage = $state('');
	let goban: GobanInstance | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let hydrating = false;

	onMount(() => {
		let destroyed = false;

		async function boot() {
			const { createGoban, setGobanCallbacks, setGobanRenderer } = await import('goban');
			if (destroyed) return;

			setGobanRenderer('canvas');
			setGobanCallbacks({
				getSelectedThemes: () => ({
					board: 'Plain',
					black: 'Plain',
					white: 'Plain',
					'removal-graphic': 'square',
					'removal-scale': 1,
					'stone-shadows': 'low'
				}),
				watchSelectedThemes: () => ({ remove: () => undefined })
			});

			goban = createGoban({
				board_div: boardElement,
				width: boardSize,
				height: boardSize,
				komi,
				rules: normalizeRules(rules),
				interactive: true,
				mode: 'analyze',
				square_size: 'auto',
				display_width: Math.floor(boardElement.clientWidth),
				draw_top_labels: true,
				draw_left_labels: true,
				draw_right_labels: true,
				draw_bottom_labels: true,
				players: {
					black: { id: 1, username: 'Black' },
					white: { id: 2, username: 'White' }
				},
				onError: (error: Error) => {
					errorMessage = error.message;
				}
			}) as GobanInstance;

			goban.setAnalyzeTool?.('stone', 'alternate');
			replayMoves(moves);
			goban.on('update', syncFromEngine);

			resizeObserver = new ResizeObserver(([entry]) => {
				const width = Math.floor(entry.contentRect.width);
				if (width > 0) {
					goban?.setSquareSizeBasedOnDisplayWidth?.(width);
					goban?.redraw(true);
				}
			});
			resizeObserver.observe(boardElement);
			syncFromEngine();
		}

		boot().catch((error) => {
			errorMessage = error instanceof Error ? error.message : 'Unable to initialize the board.';
		});

		return () => {
			destroyed = true;
			resizeObserver?.disconnect();
			if (goban) {
				goban.off('update', syncFromEngine);
				goban.destroy();
			}
		};
	});

	function replayMoves(sourceMoves: GoMove[]) {
		if (!goban || sourceMoves.length === 0) return;

		hydrating = true;
		try {
			for (const move of sourceMoves) {
				goban.engine.place(move.x, move.y, true, true, undefined, undefined, true);
			}
			goban.redraw(true);
		} finally {
			hydrating = false;
		}
	}

	function syncFromEngine() {
		if (!goban || hydrating) return;

		const nextPlayer = goban.engine.colorToMove() === 'black' ? 'B' : 'W';
		const syncedMoves = collectMoves(goban.engine.cur_move);
		const board = normalizeBoard(goban.engine.board, boardSize);

		onPositionChange({
			boardSize,
			komi,
			rules,
			nextPlayer,
			moves: syncedMoves,
			board,
			sgf: movesToSgf(syncedMoves, boardSize, komi, rules),
			lastMove: syncedMoves.at(-1)
		});
		errorMessage = '';
	}

	function collectMoves(node: MoveNode | null): GoMove[] {
		const reversed: GoMove[] = [];
		let cursor = node;

		while (cursor?.parent) {
			const color: StoneColor = cursor.player === 1 ? 'B' : 'W';
			reversed.push({
				color,
				x: cursor.x,
				y: cursor.y,
				moveNumber: cursor.move_number,
				gtp: toGtpCoordinate(cursor.x, cursor.y, boardSize),
				sgf: toSgfCoordinate(cursor.x, cursor.y)
			});
			cursor = cursor.parent;
		}

		return reversed.reverse();
	}

	function normalizeBoard(board: number[][], size: number): BoardPoint[][] {
		const fallback = createEmptyBoard(size);

		return fallback.map((row, y) =>
			row.map((_, x) => {
				const value = board[y]?.[x];
				return value === 1 || value === 2 ? value : 0;
			})
		);
	}

	function normalizeRules(value: string): 'chinese' | 'aga' | 'japanese' | 'korean' | 'ing' | 'nz' {
		const normalized = value.toLowerCase();
		if (
			normalized === 'aga' ||
			normalized === 'japanese' ||
			normalized === 'korean' ||
			normalized === 'ing' ||
			normalized === 'nz'
		) {
			return normalized;
		}

		return 'chinese';
	}

</script>

<div class="board-shell">
	<div
		bind:this={boardElement}
		class:disabled
		class="goban-host"
		aria-label="Interactive Go board"
	></div>
	{#if errorMessage}
		<p class="board-error">{errorMessage}</p>
	{/if}
</div>

<style>
	.board-shell {
		width: min(100%, calc(100vh - 140px));
		min-width: 300px;
		aspect-ratio: 1;
	}

	.goban-host {
		--goban-shadow: none;
		--goban-shadow-borderless: none;
		--z-goban-shadow-layer: 1;
		--z-goban-stone-layer: 2;
		--z-goban-pen-layer: 3;
		--z-goban-message: 4;
		width: 100%;
		height: 100%;
		min-height: 300px;
	}

	.goban-host.disabled {
		pointer-events: none;
	}

	.board-error {
		margin: 8px 0 0;
		padding: 8px 10px;
		border-radius: 8px;
		background: #fff4d8;
		color: #815b00;
		font-size: 0.84rem;
	}

	:global(.Goban) {
		max-width: 100%;
	}

	@media (max-width: 980px) {
		.board-shell {
			width: min(100%, 720px);
		}
	}

	@media (max-width: 420px) {
		.board-shell,
		.goban-host {
			min-width: 0;
			min-height: 260px;
		}
	}
</style>
