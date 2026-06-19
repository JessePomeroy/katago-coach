<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Bot,
		BookOpen,
		ChevronLeft,
		ChevronRight,
		ChevronsLeft,
		ChevronsRight,
		Download,
		FolderOpen,
		KeyRound,
		Power,
		RefreshCw,
		RotateCcw,
		Save,
		Search,
		Send,
		Settings,
		Trash2,
		Undo2,
		X
	} from '@lucide/svelte';
	import GoBoard from '$lib/components/GoBoard.svelte';
	import {
		colorName,
		createEmptyBoard,
		createEmptyPosition,
		formatScoreLead,
		formatWinrate,
		movesToSgf,
		opponent,
		toSgfCoordinate
	} from '$lib/go/coordinates';
	import type {
		AnalysisResult,
		BoardPoint,
		ChatMessage,
		GameRecord,
		GoMove,
		GoPosition,
		StoneColor
	} from '$lib/go/types';

	const defaultBoardSize = 19;
	const defaultKomi = 7.5;
	const defaultRules = 'Chinese';
	const defaultSettings = {
		llmProvider: 'ollama' as const,
		hasOpenAIKey: false,
		openaiModel: 'gpt-5.5',
		ollamaBaseUrl: 'http://127.0.0.1:11434',
		ollamaModel: 'llama3.2:3b',
		katagoAnalysisUrl: 'http://localhost:8719/analyze',
		hasRuntimeSettings: false
	};
	const ollamaModelPresets = [
		{ model: 'llama3.2:3b', label: 'Llama 3.2 3B', note: 'Fast default coach' },
		{ model: 'gemma3:4b', label: 'Gemma 3 4B', note: 'Clear explanations' },
		{ model: 'qwen3:4b', label: 'Qwen 3 4B', note: 'More reasoning' },
		{ model: 'phi4-mini', label: 'Phi-4 Mini', note: 'Compact reasoning' },
		{ model: 'gpt-oss:20b', label: 'GPT-OSS 20B', note: 'Slow, deeper' }
	];
	const gtpColumns = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

	type PublicSettings = typeof defaultSettings;
	type SgfLibraryItem = {
		id: string;
		path: string;
		name: string;
		source: string;
		title: string;
		blackPlayer?: string;
		whitePlayer?: string;
		event?: string;
		date?: string;
		result?: string;
		moveCount?: number;
	};
	type LoadedSgfGame = GameRecord & { path: string };
	type EngineStatus = {
		localOnly: boolean;
		katago: {
			running: boolean;
			url: string;
		};
		ollama: {
			running: boolean;
			modelInstalled: boolean;
			model: string;
			installedModels: string[];
			url: string;
		};
	};

	let boardSize = $state(defaultBoardSize);
	let komi = $state(defaultKomi);
	let rules = $state(defaultRules);
	let position = $state<GoPosition>(createEmptyPosition(defaultBoardSize, defaultKomi, defaultRules));
	let analysis = $state<AnalysisResult | null>(null);
	let messages = $state<ChatMessage[]>([
		{
			role: 'assistant',
			content: 'Run analysis after a move, then ask about direction, weak groups, or candidate moves.'
		}
	]);
	let chatInput = $state('Why was the last move good or bad?');
	let maxVisits = $state(300);
	let analyzing = $state(false);
	let chatting = $state(false);
	let aiOpponentEnabled = $state(false);
	let humanColor = $state<StoneColor>('B');
	let aiAutoCoach = $state(true);
	let aiBusy = $state(false);
	let aiStatus = $state('');
	let boardKey = $state(0);
	let status = $state('');
	let settingsOpen = $state(false);
	let settingsSaving = $state(false);
	let settingsStatus = $state('');
	let engineBusy = $state(false);
	let engineStatusText = $state('');
	let engineStatus = $state<EngineStatus | null>(null);
	let sgfSearch = $state('');
	let sgfSource = $state<'all' | 'cwi' | 'jgdb'>('cwi');
	let sgfLoading = $state(false);
	let sgfStatus = $state('');
	let sgfItems = $state<SgfLibraryItem[]>([]);
	let loadedGame = $state<LoadedSgfGame | null>(null);
	let loadedGameTurn = $state(0);
	let sgfSearchTimer: ReturnType<typeof setTimeout> | null = null;
	let sgfSearchRequestId = 0;
	let runtimeSettings = $state<PublicSettings>({ ...defaultSettings });
	let settingsForm = $state({
		llmProvider: defaultSettings.llmProvider as 'ollama' | 'openai',
		openaiApiKey: '',
		openaiModel: defaultSettings.openaiModel,
		ollamaBaseUrl: defaultSettings.ollamaBaseUrl,
		ollamaModel: defaultSettings.ollamaModel,
		katagoAnalysisUrl: defaultSettings.katagoAnalysisUrl
	});

	let rootWinrate = $derived(formatWinrate(analysis?.rootInfo.winrate));
	let rootLead = $derived(formatScoreLead(analysis?.rootInfo.scoreLead ?? analysis?.rootInfo.scoreMean));
	let topMoves = $derived(analysis?.moveInfos.slice(0, 6) ?? []);
	let loadedGameProgress = $derived(
		loadedGame ? `${loadedGameTurn} / ${loadedGame.moves.length}` : 'No game loaded'
	);
	let aiColor = $derived(opponent(humanColor));

	onMount(() => {
		void loadSettings();
		void loadEngineStatus();
		void searchSgfLibrary();
	});

	async function loadSettings() {
		try {
			const response = await fetch('/api/settings');

			if (!response.ok) {
				throw new Error(await response.text());
			}

			applyPublicSettings((await response.json()) as PublicSettings);
		} catch (error) {
			settingsStatus = error instanceof Error ? error.message : 'Could not load settings.';
		}
	}

	function applyPublicSettings(settings: PublicSettings) {
		runtimeSettings = settings;
		settingsForm.llmProvider = settings.llmProvider || defaultSettings.llmProvider;
		settingsForm.openaiModel = settings.openaiModel || defaultSettings.openaiModel;
		settingsForm.ollamaBaseUrl = settings.ollamaBaseUrl || defaultSettings.ollamaBaseUrl;
		settingsForm.ollamaModel = settings.ollamaModel || defaultSettings.ollamaModel;
		settingsForm.katagoAnalysisUrl =
			settings.katagoAnalysisUrl || defaultSettings.katagoAnalysisUrl;
		settingsForm.openaiApiKey = '';
	}

	async function saveSettings() {
		settingsSaving = true;
		settingsStatus = '';

		try {
			const response = await fetch('/api/settings', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					llmProvider: settingsForm.llmProvider,
					openaiApiKey: settingsForm.openaiApiKey,
					openaiModel: settingsForm.openaiModel,
					ollamaBaseUrl: settingsForm.ollamaBaseUrl,
					ollamaModel: settingsForm.ollamaModel,
					katagoAnalysisUrl: settingsForm.katagoAnalysisUrl
				})
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			applyPublicSettings((await response.json()) as PublicSettings);
			settingsStatus = 'Settings saved for this server session.';
			analysis = null;
			status = '';
		} catch (error) {
			settingsStatus = error instanceof Error ? error.message : 'Could not save settings.';
		} finally {
			settingsSaving = false;
		}
	}

	async function clearSettings() {
		settingsSaving = true;
		settingsStatus = '';

		try {
			const response = await fetch('/api/settings', {
				method: 'DELETE'
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			applyPublicSettings((await response.json()) as PublicSettings);
			settingsStatus = 'Runtime settings cleared.';
			analysis = null;
			status = '';
		} catch (error) {
			settingsStatus = error instanceof Error ? error.message : 'Could not clear settings.';
		} finally {
			settingsSaving = false;
		}
	}

	async function loadEngineStatus() {
		try {
			const response = await fetch('/api/local-engines');

			if (!response.ok) {
				engineStatus = null;
				return;
			}

			engineStatus = (await response.json()) as EngineStatus;
		} catch {
			engineStatus = null;
		}
	}

	async function runEngineAction(
		action: 'start-all' | 'start-katago' | 'start-ollama' | 'pull-ollama-model',
		model?: string
	) {
		engineBusy = true;
		engineStatusText = '';

		try {
			const response = await fetch('/api/local-engines', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action, model })
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as { messages: string[]; status: EngineStatus };
			engineStatus = payload.status;
			engineStatusText = payload.messages.join(' ');
		} catch (error) {
			engineStatusText = error instanceof Error ? error.message : 'Engine command failed.';
		} finally {
			engineBusy = false;
		}
	}

	function handlePositionChange(nextPosition: GoPosition) {
		const previousMoveCount = position.moves.length;
		position = nextPosition;
		if (nextPosition.moves.length !== previousMoveCount) {
			analysis = null;
			status = '';
			if (aiOpponentEnabled && nextPosition.nextPlayer === aiColor && !aiBusy) {
				setTimeout(() => {
					void playKataGoMove(nextPosition);
				}, 0);
			}
		}
	}

	async function requestAnalysis(targetPosition: GoPosition, visits = maxVisits) {
		const response = await fetch('/api/analyze', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ position: targetPosition, maxVisits: visits })
		});

		if (!response.ok) {
			throw new Error(await response.text());
		}

		return (await response.json()) as AnalysisResult;
	}

	function analysisStatusFor(targetPosition: GoPosition, result: AnalysisResult) {
		return result.source === 'katago'
			? `Analyzed ${targetPosition.moves.length} moves with ${result.rootInfo.visits ?? 0} visits.`
			: `KataGo unavailable: ${result.unavailableReason}`;
	}

	async function runAnalysis() {
		analyzing = true;
		status = '';

		try {
			const result = await requestAnalysis(position);
			analysis = result;
			status = analysisStatusFor(position, result);
		} catch (error) {
			status = error instanceof Error ? error.message : 'Analysis failed.';
		} finally {
			analyzing = false;
		}
	}

	async function toggleAiOpponent() {
		aiOpponentEnabled = !aiOpponentEnabled;
		aiStatus = aiOpponentEnabled
			? `KataGo will play ${colorName(aiColor)}.`
			: 'KataGo opponent stopped.';

		if (aiOpponentEnabled && position.nextPlayer === aiColor && !aiBusy) {
			await playKataGoMove(position);
		}
	}

	async function playKataGoMove(sourcePosition = position) {
		if (aiBusy) return;
		if (sourcePosition.nextPlayer !== aiColor) return;

		aiBusy = true;
		aiStatus = 'KataGo is choosing a move...';

		try {
			const preMoveAnalysis = await requestAnalysis(sourcePosition);

			if (preMoveAnalysis.source !== 'katago') {
				analysis = preMoveAnalysis;
				status = analysisStatusFor(sourcePosition, preMoveAnalysis);
				aiStatus = `KataGo unavailable: ${preMoveAnalysis.unavailableReason}`;
				return;
			}

			const candidate = preMoveAnalysis.moveInfos.find((move) => move.move);

			if (!candidate) {
				analysis = preMoveAnalysis;
				status = 'KataGo did not return a playable move.';
				aiStatus = status;
				return;
			}

			const aiMove = moveFromGtp(
				candidate.move,
				sourcePosition.nextPlayer,
				sourcePosition.moves.length + 1,
				sourcePosition.boardSize
			);
			const nextPosition = buildPositionFromMoves(
				[...sourcePosition.moves, aiMove],
				sourcePosition.boardSize,
				sourcePosition.komi,
				sourcePosition.rules
			);

			position = nextPosition;
			loadedGame = null;
			loadedGameTurn = 0;
			boardSize = nextPosition.boardSize;
			komi = nextPosition.komi;
			rules = nextPosition.rules;
			boardKey += 1;
			analysis = null;
			status = `KataGo played ${candidate.move}.`;
			aiStatus = `KataGo played ${candidate.move}.`;

			if (aiAutoCoach) {
				await requestCoachReply(
					`KataGo chose ${candidate.move} as its reply. Explain why this move is useful, what it aims at, and what I should learn from it.`,
					sourcePosition,
					preMoveAnalysis
				);
			}

			const postMoveAnalysis = await requestAnalysis(nextPosition);
			analysis = postMoveAnalysis;
			status =
				postMoveAnalysis.source === 'katago'
					? `KataGo played ${candidate.move}. ${analysisStatusFor(nextPosition, postMoveAnalysis)}`
					: analysisStatusFor(nextPosition, postMoveAnalysis);
		} catch (error) {
			aiStatus = error instanceof Error ? error.message : 'KataGo move failed.';
		} finally {
			aiBusy = false;
		}
	}

	async function sendChat() {
		const content = chatInput.trim();
		if (!content || chatting) return;
		chatInput = '';
		await requestCoachReply(content, position, analysis);
	}

	async function requestCoachReply(
		content: string,
		targetPosition: GoPosition,
		targetAnalysis: AnalysisResult | null
	) {
		const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
		messages = nextMessages;
		chatting = true;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					message: content,
					position: targetPosition,
					analysis: targetAnalysis,
					history: nextMessages.slice(-6)
				})
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as { content: string };
			messages = [...nextMessages, { role: 'assistant', content: payload.content }];
		} catch (error) {
			messages = [
				...nextMessages,
				{
					role: 'assistant',
					content: error instanceof Error ? error.message : 'Chat request failed.'
				}
			];
		} finally {
			chatting = false;
		}
	}

	async function searchSgfLibrary() {
		if (sgfSearchTimer) {
			clearTimeout(sgfSearchTimer);
			sgfSearchTimer = null;
		}

		const requestId = ++sgfSearchRequestId;
		sgfLoading = true;
		sgfStatus = '';

		try {
			const params = new URLSearchParams({
				source: sgfSource,
				q: sgfSearch,
				limit: '80'
			});
			const response = await fetch(`/api/sgf-library?${params}`);

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as {
				games: { items: SgfLibraryItem[]; truncated: boolean; visited: number };
			};

			if (requestId !== sgfSearchRequestId) return;

			sgfItems = payload.games.items;
			sgfStatus = payload.games.truncated
				? `Showing ${payload.games.items.length} matches from the first ${payload.games.visited.toLocaleString()} files scanned.`
				: `Showing ${payload.games.items.length} matches.`;
		} catch (error) {
			if (requestId !== sgfSearchRequestId) return;
			sgfStatus = error instanceof Error ? error.message : 'Could not search SGF library.';
		} finally {
			if (requestId === sgfSearchRequestId) {
				sgfLoading = false;
			}
		}
	}

	function scheduleSgfSearch(event: Event) {
		sgfSearch = (event.currentTarget as HTMLInputElement).value;

		if (sgfSearchTimer) {
			clearTimeout(sgfSearchTimer);
		}

		sgfSearchTimer = setTimeout(() => {
			sgfSearchTimer = null;
			void searchSgfLibrary();
		}, 300);
	}

	function handleSgfSourceChange(event: Event) {
		sgfSource = (event.currentTarget as HTMLSelectElement).value as typeof sgfSource;
		sgfItems = [];
		void searchSgfLibrary();
	}

	async function openSgfGame(path: string) {
		sgfLoading = true;
		sgfStatus = '';

		try {
			const params = new URLSearchParams({ path });
			const response = await fetch(`/api/sgf-library?${params}`);

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as { game: LoadedSgfGame };
			loadedGame = payload.game;
			goToLoadedGameTurn(0, payload.game);
			sgfStatus = `Loaded ${payload.game.title}.`;
		} catch (error) {
			sgfStatus = error instanceof Error ? error.message : 'Could not open SGF game.';
		} finally {
			sgfLoading = false;
		}
	}

	function goToLoadedGameTurn(turn: number, game = loadedGame) {
		if (!game) return;

		const nextTurn = Math.max(0, Math.min(turn, game.moves.length));
		const moves = game.moves.slice(0, nextTurn).map((move, index) => ({
			...move,
			moveNumber: index + 1
		}));

		boardSize = game.boardSize;
		komi = game.komi;
		rules = game.rules;
		loadedGameTurn = nextTurn;
		position = buildPositionFromMoves(moves, game.boardSize, game.komi, game.rules);
		analysis = null;
		status = '';
		aiOpponentEnabled = false;
		aiStatus = '';
		boardKey += 1;
	}

	function goToLoadedGameEnd() {
		if (!loadedGame) return;
		goToLoadedGameTurn(loadedGame.moves.length, loadedGame);
	}

	function gameListMeta(item: SgfLibraryItem) {
		return [
			item.event,
			item.date,
			item.result,
			typeof item.moveCount === 'number' ? `${item.moveCount} moves` : undefined
		]
			.filter(Boolean)
			.join(' · ');
	}

	function resetBoard() {
		boardSize = defaultBoardSize;
		komi = defaultKomi;
		rules = defaultRules;
		position = createEmptyPosition(boardSize, komi, rules);
		analysis = null;
		status = '';
		aiStatus = '';
		loadedGame = null;
		loadedGameTurn = 0;
		boardKey += 1;

		if (aiOpponentEnabled && position.nextPlayer === aiColor && !aiBusy) {
			setTimeout(() => {
				void playKataGoMove(position);
			}, 0);
		}
	}

	function undoMove() {
		if (position.moves.length === 0) return;
		replaceMoves(position.moves.slice(0, -1));
	}

	function passMove() {
		const move: GoMove = {
			color: position.nextPlayer,
			x: -1,
			y: -1,
			moveNumber: position.moves.length + 1,
			gtp: 'pass',
			sgf: ''
		};
		const nextPosition = replaceMoves([...position.moves, move]);
		if (aiOpponentEnabled && nextPosition.nextPlayer === aiColor && !aiBusy) {
			setTimeout(() => {
				void playKataGoMove(nextPosition);
			}, 0);
		}
	}

	function replaceMoves(moves: GoMove[]) {
		loadedGameTurn = loadedGame ? Math.min(moves.length, loadedGame.moves.length) : 0;
		const nextPosition = buildPositionFromMoves(moves, boardSize, komi, rules);
		position = nextPosition;
		analysis = null;
		status = '';
		aiStatus = '';
		boardKey += 1;
		return nextPosition;
	}

	function stoneLabel(move: GoMove) {
		return `${move.moveNumber}. ${move.color} ${move.gtp}`;
	}

	function moveFromGtp(gtp: string, color: StoneColor, moveNumber: number, size: number): GoMove {
		if (gtp.toLowerCase() === 'pass') {
			return {
				color,
				x: -1,
				y: -1,
				moveNumber,
				gtp: 'pass',
				sgf: ''
			};
		}

		const match = /^([A-Z])(\d+)$/i.exec(gtp);
		if (!match) {
			throw new Error(`KataGo returned unsupported move "${gtp}".`);
		}

		const x = gtpColumns.indexOf(match[1].toUpperCase());
		const y = size - Number(match[2]);

		if (x < 0 || y < 0 || y >= size) {
			throw new Error(`KataGo returned out-of-board move "${gtp}".`);
		}

		return {
			color,
			x,
			y,
			moveNumber,
			gtp,
			sgf: toSgfCoordinate(x, y)
		};
	}

	function buildPositionFromMoves(
		moves: GoMove[],
		size = boardSize,
		positionKomi = komi,
		positionRules = rules
	): GoPosition {
		const board = createEmptyBoard(size).map((row) => [...row]) as BoardPoint[][];

		for (const move of moves) {
			applyMoveToBoard(board, move);
		}

		return {
			boardSize: size,
			komi: positionKomi,
			rules: positionRules,
			moves,
			board,
			nextPlayer: moves.at(-1) ? opponent(moves.at(-1)!.color) : 'B',
			sgf: movesToSgf(moves, size, positionKomi, positionRules),
			lastMove: moves.at(-1)
		};
	}

	function applyMoveToBoard(board: BoardPoint[][], move: GoMove) {
		if (move.x < 0 || move.y < 0) return;
		if (!board[move.y]?.[move.x]) {
			board[move.y][move.x] = move.color === 'B' ? 1 : 2;
		}

		const opponentValue = move.color === 'B' ? 2 : 1;
		for (const [x, y] of neighbors(move.x, move.y, board.length)) {
			if (board[y][x] === opponentValue) {
				const group = collectGroup(board, x, y);
				if (!group.hasLiberty) {
					for (const stone of group.stones) {
						board[stone.y][stone.x] = 0;
					}
				}
			}
		}

		const ownGroup = collectGroup(board, move.x, move.y);
		if (!ownGroup.hasLiberty) {
			for (const stone of ownGroup.stones) {
				board[stone.y][stone.x] = 0;
			}
		}
	}

	function collectGroup(board: BoardPoint[][], startX: number, startY: number) {
		const color = board[startY]?.[startX];
		const stones: Array<{ x: number; y: number }> = [];
		const visited = new Set<string>();
		const stack = [{ x: startX, y: startY }];
		let hasLiberty = false;

		while (stack.length) {
			const point = stack.pop()!;
			const key = `${point.x},${point.y}`;
			if (visited.has(key)) continue;
			visited.add(key);
			stones.push(point);

			for (const [x, y] of neighbors(point.x, point.y, board.length)) {
				if (board[y][x] === 0) {
					hasLiberty = true;
				} else if (board[y][x] === color) {
					stack.push({ x, y });
				}
			}
		}

		return { stones, hasLiberty };
	}

	function neighbors(x: number, y: number, size: number): Array<[number, number]> {
		return [
			[x - 1, y],
			[x + 1, y],
			[x, y - 1],
			[x, y + 1]
		].filter(
			([nextX, nextY]) => nextX >= 0 && nextY >= 0 && nextX < size && nextY < size
		) as Array<[number, number]>;
	}
</script>

<svelte:head>
	<title>KataGo Coach</title>
	<meta
		name="description"
		content="A SvelteKit Go board with KataGo-backed analysis and an LLM teaching panel."
	/>
</svelte:head>

<main class="app-shell">
	<section class="board-area">
		<header class="topbar">
			<div>
				<h1>KataGo Coach</h1>
				<p>{position.moves.length} moves · {colorName(position.nextPlayer)} to play · {rules} {komi}</p>
			</div>
			<div class="toolbar" aria-label="Board controls">
				{#if loadedGame}
					<div class="replay-toolbar" aria-label="Game replay controls">
						<button type="button" class="icon-button" title="First move" onclick={() => goToLoadedGameTurn(0)}>
							<ChevronsLeft size={16} />
						</button>
						<button
							type="button"
							class="icon-button"
							title="Previous move"
							onclick={() => goToLoadedGameTurn(loadedGameTurn - 1)}
							disabled={loadedGameTurn <= 0}
						>
							<ChevronLeft size={16} />
						</button>
						<span>{loadedGameProgress}</span>
						<button
							type="button"
							class="icon-button"
							title="Next move"
							onclick={() => goToLoadedGameTurn(loadedGameTurn + 1)}
							disabled={loadedGameTurn >= loadedGame.moves.length}
						>
							<ChevronRight size={16} />
						</button>
						<button
							type="button"
							class="icon-button"
							title="Last move"
							onclick={goToLoadedGameEnd}
							disabled={loadedGameTurn >= loadedGame.moves.length}
						>
							<ChevronsRight size={16} />
						</button>
					</div>
				{/if}
				<button type="button" class="icon-button" title="Settings" onclick={() => (settingsOpen = true)}>
					<Settings size={18} />
				</button>
				<button type="button" class="icon-button" title="Undo move" onclick={undoMove} disabled={!position.moves.length}>
					<Undo2 size={18} />
				</button>
				<button type="button" class="text-button" onclick={passMove}>Pass</button>
				<button type="button" class="icon-button" title="Reset board" onclick={resetBoard}>
					<RotateCcw size={18} />
				</button>
			</div>
		</header>

		{#if settingsOpen}
			<div class="settings-backdrop" role="presentation">
				<section class="settings-modal" aria-label="API settings">
					<div class="panel-heading">
						<div>
							<h2>Settings</h2>
							<p>Configure this browser session without editing `.env`.</p>
						</div>
						<button type="button" class="icon-button" title="Close settings" onclick={() => (settingsOpen = false)}>
							<X size={18} />
						</button>
					</div>

					<section class="engine-controls" aria-label="Local engine controls">
						<div>
							<h3>Local Engines</h3>
							<p>Development-only controls for this MacBook.</p>
						</div>

						<div class="engine-status-grid">
							<div>
								<span>KataGo</span>
								<strong class:ready={engineStatus?.katago.running}>
									{engineStatus?.katago.running ? 'Running' : 'Stopped'}
								</strong>
							</div>
							<div>
								<span>Ollama</span>
								<strong class:ready={engineStatus?.ollama.running}>
									{engineStatus?.ollama.running ? 'Running' : 'Stopped'}
								</strong>
							</div>
							<div>
								<span>{engineStatus?.ollama.model ?? defaultSettings.ollamaModel}</span>
								<strong class:ready={engineStatus?.ollama.modelInstalled}>
									{engineStatus?.ollama.modelInstalled ? 'Installed' : 'Missing'}
								</strong>
							</div>
						</div>

						{#if engineStatusText}
							<p class="status">{engineStatusText}</p>
						{/if}

						<div class="engine-actions">
							<button type="button" class="primary-button" onclick={() => runEngineAction('start-all')} disabled={engineBusy}>
								<Power size={16} />
								Start Engines
							</button>
							<button type="button" class="text-button" onclick={() => runEngineAction('start-katago')} disabled={engineBusy}>
								KataGo
							</button>
							<button type="button" class="text-button" onclick={() => runEngineAction('start-ollama')} disabled={engineBusy}>
								Ollama
							</button>
							<button type="button" class="icon-button" title="Refresh engine status" onclick={loadEngineStatus} disabled={engineBusy}>
								<RefreshCw size={16} class={engineBusy ? 'spin' : ''} />
							</button>
							<button
								type="button"
								class="icon-button"
								title={`Pull ${settingsForm.ollamaModel}`}
								onclick={() => runEngineAction('pull-ollama-model', settingsForm.ollamaModel)}
								disabled={engineBusy || engineStatus?.ollama.installedModels.includes(settingsForm.ollamaModel)}
							>
								<Download size={16} />
							</button>
						</div>
					</section>

					<form
						class="settings-form"
						onsubmit={(event) => {
							event.preventDefault();
							void saveSettings();
						}}
					>
						<label class="settings-field" for="llm-provider">
							<span>LLM provider</span>
							<select id="llm-provider" bind:value={settingsForm.llmProvider}>
								<option value="ollama">Ollama local</option>
								<option value="openai">OpenAI API</option>
							</select>
							<small>Ollama keeps chat local on your MacBook; OpenAI uses API billing.</small>
						</label>

						<label class="settings-field" for="ollama-url">
							<span>Ollama URL</span>
							<input id="ollama-url" type="url" bind:value={settingsForm.ollamaBaseUrl} />
						</label>

						<label class="settings-field" for="ollama-model">
							<span>Ollama model</span>
							<select id="ollama-model" bind:value={settingsForm.ollamaModel}>
								{#each ollamaModelPresets as preset}
									<option value={preset.model}>{preset.label} - {preset.note}</option>
								{/each}
							</select>
							<small>
								{engineStatus?.ollama.installedModels.includes(settingsForm.ollamaModel)
									? 'Installed locally.'
									: 'Not installed locally yet. Use the download button above.'}
							</small>
						</label>

						<label class="settings-field" for="openai-key">
							<span><KeyRound size={16} /> OpenAI API key</span>
							<input
								id="openai-key"
								type="password"
								autocomplete="off"
								placeholder={runtimeSettings.hasOpenAIKey ? 'Saved key is active' : 'sk-...'}
								bind:value={settingsForm.openaiApiKey}
							/>
							<small>{runtimeSettings.hasOpenAIKey ? 'A key is configured on the server.' : 'No OpenAI key configured yet.'}</small>
						</label>

						<label class="settings-field" for="openai-model">
							<span>OpenAI model</span>
							<input id="openai-model" type="text" bind:value={settingsForm.openaiModel} />
						</label>

						<label class="settings-field" for="katago-url">
							<span>KataGo analysis URL</span>
							<input id="katago-url" type="url" bind:value={settingsForm.katagoAnalysisUrl} />
						</label>

						{#if settingsStatus}
							<p class="status">{settingsStatus}</p>
						{/if}

						<div class="settings-actions">
							<button type="button" class="text-button danger-button" onclick={clearSettings} disabled={settingsSaving}>
								<Trash2 size={16} />
								Clear
							</button>
							<button type="submit" class="primary-button" disabled={settingsSaving}>
								<Save size={16} />
								Save
							</button>
						</div>
					</form>
				</section>
			</div>
		{/if}

		<div class="board-frame">
			{#key boardKey}
				<GoBoard
					{boardSize}
					{komi}
					{rules}
					moves={position.moves}
					disabled={aiBusy}
					onPositionChange={handlePositionChange}
				/>
			{/key}
		</div>
	</section>

	<aside class="side-panel">
		<section class="panel analysis-panel">
			<div class="panel-heading">
				<div>
					<h2>Analysis</h2>
					<p>{analysis?.source === 'katago' ? 'KataGo' : 'Engine pending'}</p>
				</div>
				<button type="button" class="primary-button" onclick={runAnalysis} disabled={analyzing}>
					{#if analyzing}
						<RefreshCw size={16} class="spin" />
					{:else}
						<Search size={16} />
					{/if}
					Analyze
				</button>
			</div>

			<div class="visit-row">
				<label for="visits">Visits</label>
				<input id="visits" type="number" min="1" max="5000" bind:value={maxVisits} />
			</div>

			<section class="ai-opponent" aria-label="KataGo opponent controls">
				<div>
					<strong>KataGo Opponent</strong>
					<span>{aiOpponentEnabled ? `You play ${colorName(humanColor)}` : 'Off'}</span>
				</div>
				<div class="ai-controls">
					<select aria-label="Your color" bind:value={humanColor} disabled={aiOpponentEnabled || aiBusy}>
						<option value="B">You: Black</option>
						<option value="W">You: White</option>
					</select>
					<label>
						<input type="checkbox" bind:checked={aiAutoCoach} />
						Coach
					</label>
					<button type="button" class="text-button" onclick={toggleAiOpponent} disabled={aiBusy}>
						<Bot size={16} />
						{aiOpponentEnabled ? 'Stop' : 'Play'}
					</button>
				</div>
				{#if aiStatus}
					<p class="status">{aiStatus}</p>
				{/if}
			</section>

			{#if status}
				<p class:warning={analysis?.source === 'fallback'} class="status">{status}</p>
			{/if}

			<div class="metrics">
				<div>
					<span>Winrate</span>
					<strong>{rootWinrate}</strong>
				</div>
				<div>
					<span>Lead</span>
					<strong>{rootLead}</strong>
				</div>
			</div>

			<div class="move-list">
				{#each topMoves as move}
					<article class="move-row">
						<strong>{move.move}</strong>
						<span>{formatWinrate(move.winrate)}</span>
						<span>{formatScoreLead(move.scoreLead ?? move.scoreMean)}</span>
						<small>{move.pv?.slice(0, 5).join(' ') || `${move.visits ?? 0} visits`}</small>
					</article>
				{:else}
					<p class="empty">No engine result yet.</p>
				{/each}
			</div>
		</section>

		<section class="panel chat-panel">
			<div class="panel-heading">
				<div>
					<h2>Coach</h2>
					<p>{analysis?.source === 'katago' ? 'Grounded in current analysis' : 'Awaiting KataGo'}</p>
				</div>
				<Bot size={20} />
			</div>

			<div class="messages" aria-live="polite">
				{#each messages as message}
					<div class:user={message.role === 'user'} class="message">
						{message.content}
					</div>
				{/each}
				{#if chatting}
					<div class="message typing-message" aria-label="Coach is thinking">
						<span></span>
						<span></span>
						<span></span>
					</div>
				{/if}
			</div>

			<form
				class="chat-form"
				onsubmit={(event) => {
					event.preventDefault();
					void sendChat();
				}}
			>
				<textarea bind:value={chatInput} rows="3"></textarea>
				<button type="submit" class="icon-button send-button" title="Send" disabled={chatting || !chatInput.trim()}>
					<Send size={18} />
				</button>
			</form>
		</section>
	</aside>

	<section class="bottom-panel">
		<div class="panel library-panel">
			<div class="panel-heading">
				<div>
					<h2>Game Library</h2>
					<p>{loadedGame ? loadedGameProgress : 'Browse local SGF files'}</p>
				</div>
				<BookOpen size={20} />
			</div>

			<form
				class="library-search"
				onsubmit={(event) => {
					event.preventDefault();
					void searchSgfLibrary();
				}}
			>
				<select aria-label="SGF source" bind:value={sgfSource} onchange={handleSgfSourceChange}>
					<option value="cwi">CWI</option>
					<option value="jgdb">JGDB</option>
					<option value="all">All</option>
				</select>
				<input
					aria-label="Search SGF files"
					type="search"
					placeholder="Search file path..."
					bind:value={sgfSearch}
					oninput={scheduleSgfSearch}
				/>
				<button type="submit" class="icon-button" title="Search games" disabled={sgfLoading}>
					{#if sgfLoading}
						<RefreshCw size={16} class="spin" />
					{:else}
						<Search size={16} />
					{/if}
				</button>
			</form>

			{#if sgfStatus}
				<p class="status">{sgfStatus}</p>
			{/if}

			{#if loadedGame}
				<section class="loaded-game" aria-label="Loaded SGF game">
					<strong>{loadedGame.title}</strong>
					<span>
						{loadedGame.blackPlayer ?? 'Black'} vs {loadedGame.whitePlayer ?? 'White'}
					</span>
					<small>
						{loadedGame.event ? `${loadedGame.event} · ` : ''}{loadedGame.date ?? 'Unknown date'} ·
						{loadedGame.result ?? 'No result'}
					</small>
				</section>
			{/if}

			<div class="game-list">
				{#each sgfItems as item}
					<button type="button" onclick={() => openSgfGame(item.path)}>
						<FolderOpen size={16} />
						<span>
							<strong>{item.title}</strong>
							<em>{item.blackPlayer ?? 'Black'} vs {item.whitePlayer ?? 'White'}</em>
							<small>{gameListMeta(item) || item.path}</small>
						</span>
						<small>{item.source}</small>
					</button>
				{:else}
					<p class="empty">No SGF files found.</p>
				{/each}
			</div>
		</div>

		<div class="panel history-panel">
			<h2>Moves</h2>
			<div class="history-grid">
				{#each position.moves as move}
					<span>{stoneLabel(move)}</span>
				{:else}
					<span class="empty">Empty board</span>
				{/each}
			</div>
		</div>

		<div class="panel sgf-panel">
			<h2>SGF</h2>
			<textarea readonly value={position.sgf}></textarea>
		</div>
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		background: #f4f1ea;
		color: #1f2933;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}

	:global(*) {
		box-sizing: border-box;
	}

	.app-shell {
		display: grid;
		grid-template-columns: minmax(480px, 1fr) minmax(360px, 440px);
		grid-template-rows: minmax(0, 1fr) auto;
		gap: 16px;
		min-height: 100vh;
		padding: 16px;
	}

	.board-area,
	.side-panel,
	.bottom-panel {
		min-width: 0;
	}

	.topbar,
	.panel-heading,
	.toolbar,
	.metrics,
	.chat-form,
	.visit-row {
		display: flex;
		align-items: center;
	}

	.topbar {
		justify-content: space-between;
		gap: 16px;
		margin-bottom: 12px;
	}

	h1,
	h3,
	h2,
	p {
		margin: 0;
	}

	h1 {
		font-size: 1.35rem;
		font-weight: 740;
	}

	h2 {
		font-size: 0.92rem;
		font-weight: 720;
	}

	h3 {
		font-size: 0.84rem;
		font-weight: 720;
	}

	p {
		color: #667085;
		font-size: 0.86rem;
		line-height: 1.4;
	}

	.board-frame {
		display: grid;
		place-items: center;
		min-height: calc(100vh - 104px);
		padding: 12px;
		border: 1px solid #d8d0c2;
		border-radius: 8px;
		background: #ede7dc;
	}

	.side-panel {
		display: grid;
		grid-template-rows: minmax(260px, 0.9fr) minmax(340px, 1.1fr);
		gap: 16px;
		min-height: 0;
	}

	.bottom-panel {
		grid-column: 1 / -1;
		display: grid;
		grid-template-columns: minmax(340px, 0.9fr) minmax(0, 1fr) minmax(300px, 430px);
		gap: 16px;
	}

	.panel {
		min-height: 0;
		padding: 14px;
		border: 1px solid #d7dce2;
		border-radius: 8px;
		background: #ffffff;
		box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
	}

	.analysis-panel,
	.chat-panel,
	.library-panel,
	.history-panel,
	.sgf-panel {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.panel-heading {
		justify-content: space-between;
		gap: 12px;
	}

	.toolbar {
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
	}

	.replay-toolbar {
		display: grid;
		grid-template-columns: 36px 36px minmax(68px, auto) 36px 36px;
		gap: 6px;
		align-items: center;
		padding: 4px;
		border: 1px solid #d7dce2;
		border-radius: 8px;
		background: #f8fafb;
	}

	.replay-toolbar span {
		padding: 0 4px;
		text-align: center;
		color: #314254;
		font-size: 0.82rem;
		font-weight: 750;
		white-space: nowrap;
	}

	button,
	input,
	select,
	textarea {
		font: inherit;
	}

	button {
		border: 0;
		cursor: pointer;
	}

	button:disabled {
		cursor: not-allowed;
		opacity: 0.5;
	}

	.icon-button,
	.text-button,
	.primary-button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 36px;
		border-radius: 8px;
		transition:
			background 120ms ease,
			color 120ms ease,
			border-color 120ms ease;
	}

	.icon-button {
		width: 36px;
		border: 1px solid #ccd5dd;
		background: #ffffff;
		color: #24313f;
	}

	.text-button {
		gap: 8px;
		padding: 0 14px;
		border: 1px solid #ccd5dd;
		background: #ffffff;
		color: #24313f;
	}

	.primary-button {
		gap: 8px;
		padding: 0 14px;
		background: #256f6c;
		color: #ffffff;
	}

	.icon-button:hover:not(:disabled),
	.text-button:hover:not(:disabled) {
		background: #eef3f6;
	}

	.primary-button:hover:not(:disabled) {
		background: #1d5d5a;
	}

	.danger-button {
		color: #9b2c2c;
	}

	.settings-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		display: grid;
		place-items: center;
		padding: 16px;
		background: rgba(15, 23, 42, 0.36);
	}

	.settings-modal {
		display: flex;
		flex-direction: column;
		gap: 16px;
		width: min(560px, 100%);
		max-height: calc(100vh - 32px);
		overflow: auto;
		padding: 16px;
		border: 1px solid #d7dce2;
		border-radius: 8px;
		background: #ffffff;
		box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
	}

	.settings-form {
		display: grid;
		gap: 14px;
	}

	.engine-controls {
		display: grid;
		gap: 12px;
		padding: 12px;
		border: 1px solid #d7dce2;
		border-radius: 8px;
		background: #f8fafb;
	}

	.engine-status-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}

	.engine-status-grid > div {
		min-width: 0;
		padding: 9px;
		border: 1px solid #dfe6ec;
		border-radius: 8px;
		background: #ffffff;
	}

	.engine-status-grid span,
	.engine-status-grid strong {
		display: block;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.engine-status-grid span {
		color: #667085;
		font-size: 0.76rem;
	}

	.engine-status-grid strong {
		margin-top: 3px;
		color: #8a3d1f;
		font-size: 0.86rem;
	}

	.engine-status-grid strong.ready {
		color: #28614f;
	}

	.engine-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}

	.settings-field {
		display: grid;
		gap: 7px;
		color: #314254;
	}

	.settings-field span {
		display: inline-flex;
		align-items: center;
		gap: 8px;
	}

	.settings-field input,
	.settings-field select {
		width: 100%;
	}

	.settings-field small {
		color: #667085;
		font-size: 0.78rem;
		font-weight: 500;
	}

	.settings-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
	}

	.visit-row {
		justify-content: space-between;
		gap: 10px;
	}

	.ai-opponent {
		display: grid;
		gap: 10px;
		padding: 10px;
		border: 1px solid #d7dce2;
		border-radius: 8px;
		background: #f8fafb;
	}

	.ai-opponent > div:first-child {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.ai-opponent strong {
		font-size: 0.88rem;
	}

	.ai-opponent span {
		color: #667085;
		font-size: 0.8rem;
		font-weight: 650;
	}

	.ai-controls {
		display: grid;
		grid-template-columns: minmax(120px, 1fr) auto auto;
		gap: 8px;
		align-items: center;
	}

	.ai-controls select {
		width: 100%;
	}

	.ai-controls label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		white-space: nowrap;
	}

	.ai-controls input[type='checkbox'] {
		width: 16px;
		height: 16px;
		padding: 0;
	}

	label {
		color: #4d5b68;
		font-size: 0.82rem;
		font-weight: 650;
	}

	input,
	select,
	textarea {
		border: 1px solid #ccd5dd;
		border-radius: 8px;
		background: #fbfcfd;
		color: #1f2933;
	}

	input,
	select {
		width: 110px;
		padding: 7px 9px;
	}

	textarea {
		width: 100%;
		resize: vertical;
		padding: 10px;
		line-height: 1.35;
	}

	.status {
		padding: 9px 10px;
		border-radius: 8px;
		background: #eef8f4;
		color: #28614f;
	}

	.status.warning {
		background: #fff4d8;
		color: #815b00;
	}

	.metrics {
		gap: 10px;
	}

	.metrics > div {
		flex: 1;
		padding: 10px;
		border: 1px solid #d7dce2;
		border-radius: 8px;
		background: #f8fafb;
	}

	.metrics span,
	.move-row span,
	.move-row small {
		display: block;
		color: #667085;
		font-size: 0.78rem;
	}

	.metrics strong {
		display: block;
		margin-top: 4px;
		font-size: 1rem;
	}

	.move-list {
		display: grid;
		gap: 8px;
		overflow: auto;
	}

	.move-row {
		display: grid;
		grid-template-columns: 52px 72px 72px minmax(0, 1fr);
		align-items: center;
		gap: 8px;
		min-height: 42px;
		padding: 8px 10px;
		border: 1px solid #e1e6eb;
		border-radius: 8px;
		background: #ffffff;
	}

	.move-row small {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.library-search {
		display: grid;
		grid-template-columns: 88px minmax(0, 1fr) 36px;
		gap: 8px;
		align-items: center;
	}

	.library-search input,
	.library-search select {
		width: 100%;
		min-width: 0;
	}

	.loaded-game {
		display: grid;
		gap: 4px;
		padding: 10px;
		border: 1px solid #d7dce2;
		border-radius: 8px;
		background: #f8fafb;
	}

	.loaded-game strong,
	.loaded-game span,
	.loaded-game small {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.loaded-game span,
	.loaded-game small {
		color: #667085;
		font-size: 0.78rem;
	}

	.game-list {
		display: grid;
		gap: 6px;
		overflow: auto;
		max-height: 260px;
		padding-right: 2px;
	}

	.game-list button {
		display: grid;
		grid-template-columns: 20px minmax(0, 1fr) auto;
		gap: 8px;
		align-items: start;
		min-height: 58px;
		padding: 9px 10px;
		border: 1px solid #e1e6eb;
		border-radius: 8px;
		background: #ffffff;
		color: #24313f;
		text-align: left;
	}

	.game-list button:hover {
		background: #eef3f6;
	}

	.game-list span {
		display: grid;
		gap: 3px;
		min-width: 0;
	}

	.game-list strong,
	.game-list em,
	.game-list span small {
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}

	.game-list strong {
		color: #22313f;
		font-size: 0.84rem;
		line-height: 1.2;
	}

	.game-list em {
		color: #526174;
		font-size: 0.8rem;
		font-style: normal;
	}

	.game-list small,
	.game-list span small {
		color: #667085;
		font-size: 0.72rem;
		font-weight: 700;
	}

	.messages {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 10px;
		overflow: auto;
		padding-right: 2px;
	}

	.message {
		max-width: 92%;
		white-space: pre-wrap;
		align-self: flex-start;
		padding: 10px 11px;
		border-radius: 8px;
		background: #edf3f7;
		color: #22313f;
		font-size: 0.9rem;
		line-height: 1.42;
	}

	.message.user {
		align-self: flex-end;
		background: #e9f7ef;
	}

	.typing-message {
		display: inline-flex;
		gap: 5px;
		width: auto;
		min-width: 54px;
		align-items: center;
		white-space: normal;
	}

	.typing-message span {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: #667085;
		animation: typing-bounce 1.15s ease-in-out infinite;
	}

	.typing-message span:nth-child(2) {
		animation-delay: 140ms;
	}

	.typing-message span:nth-child(3) {
		animation-delay: 280ms;
	}

	.chat-form {
		gap: 8px;
		align-items: stretch;
	}

	.send-button {
		align-self: flex-end;
		flex: 0 0 36px;
	}

	.history-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(92px, 1fr));
		gap: 6px;
		overflow: auto;
		max-height: 150px;
	}

	.history-grid span {
		padding: 6px 8px;
		border-radius: 7px;
		background: #f2f5f7;
		color: #344454;
		font-size: 0.82rem;
	}

	.sgf-panel textarea {
		min-height: 116px;
		flex: 1;
		font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
		font-size: 0.78rem;
	}

	.empty {
		color: #7a8793;
	}

	:global(.spin) {
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes typing-bounce {
		0%,
		80%,
		100% {
			opacity: 0.45;
			transform: translateY(0);
		}

		40% {
			opacity: 1;
			transform: translateY(-4px);
		}
	}

	@media (max-width: 980px) {
		.app-shell {
			grid-template-columns: 1fr;
			grid-template-rows: auto;
		}

		.side-panel,
		.bottom-panel {
			grid-column: 1;
			grid-template-columns: 1fr;
			grid-template-rows: auto;
		}

		.board-frame {
			min-height: auto;
		}
	}

	@media (max-width: 560px) {
		.app-shell {
			padding: 10px;
			gap: 10px;
		}

		.topbar {
			align-items: flex-start;
			flex-direction: column;
		}

		.board-frame,
		.panel {
			padding: 10px;
		}

		.move-row {
			grid-template-columns: 44px 1fr 1fr;
		}

		.move-row small {
			grid-column: 1 / -1;
		}

		.settings-actions {
			justify-content: stretch;
		}

		.settings-actions button,
		.engine-actions button {
			flex: 1;
		}

		.engine-status-grid {
			grid-template-columns: 1fr;
		}
	}
</style>
