<script lang="ts">
	import { onMount } from 'svelte';
	import {
		Bot,
		Download,
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
		createEmptyPosition,
		formatScoreLead,
		formatWinrate,
		movesToSgf,
		opponent
	} from '$lib/go/coordinates';
	import type { AnalysisResult, ChatMessage, GoMove, GoPosition } from '$lib/go/types';

	const boardSize = 19;
	const komi = 7.5;
	const rules = 'Chinese';
	const defaultSettings = {
		llmProvider: 'ollama' as const,
		hasOpenAIKey: false,
		openaiModel: 'gpt-5.5',
		ollamaBaseUrl: 'http://127.0.0.1:11434',
		ollamaModel: 'gpt-oss:20b',
		katagoAnalysisUrl: 'http://localhost:8719/analyze',
		hasRuntimeSettings: false
	};

	type PublicSettings = typeof defaultSettings;
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
			url: string;
		};
	};

	let position = $state<GoPosition>(createEmptyPosition(boardSize, komi, rules));
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
	let boardKey = $state(0);
	let status = $state('');
	let settingsOpen = $state(false);
	let settingsSaving = $state(false);
	let settingsStatus = $state('');
	let engineBusy = $state(false);
	let engineStatusText = $state('');
	let engineStatus = $state<EngineStatus | null>(null);
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

	onMount(() => {
		void loadSettings();
		void loadEngineStatus();
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
		action: 'start-all' | 'start-katago' | 'start-ollama' | 'pull-ollama-model'
	) {
		engineBusy = true;
		engineStatusText = '';

		try {
			const response = await fetch('/api/local-engines', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action })
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
		}
	}

	async function runAnalysis() {
		analyzing = true;
		status = '';

		try {
			const response = await fetch('/api/analyze', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ position, maxVisits })
			});

			if (!response.ok) {
				throw new Error(await response.text());
			}

			analysis = (await response.json()) as AnalysisResult;
			status =
				analysis.source === 'katago'
					? `Analyzed ${position.moves.length} moves with ${analysis.rootInfo.visits ?? 0} visits.`
					: `KataGo unavailable: ${analysis.unavailableReason}`;
		} catch (error) {
			status = error instanceof Error ? error.message : 'Analysis failed.';
		} finally {
			analyzing = false;
		}
	}

	async function sendChat() {
		const content = chatInput.trim();
		if (!content || chatting) return;

		const nextMessages: ChatMessage[] = [...messages, { role: 'user', content }];
		messages = nextMessages;
		chatInput = '';
		chatting = true;

		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					message: content,
					position,
					analysis,
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

	function resetBoard() {
		position = createEmptyPosition(boardSize, komi, rules);
		analysis = null;
		status = '';
		boardKey += 1;
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
		replaceMoves([...position.moves, move]);
	}

	function replaceMoves(moves: GoMove[]) {
		position = {
			...position,
			moves,
			nextPlayer: moves.at(-1) ? opponent(moves.at(-1)!.color) : 'B',
			sgf: movesToSgf(moves, boardSize, komi, rules),
			lastMove: moves.at(-1)
		};
		analysis = null;
		status = '';
		boardKey += 1;
	}

	function stoneLabel(move: GoMove) {
		return `${move.moveNumber}. ${move.color} ${move.gtp}`;
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
								<span>{engineStatus?.ollama.model ?? 'gpt-oss:20b'}</span>
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
								title="Pull gpt-oss:20b"
								onclick={() => runEngineAction('pull-ollama-model')}
								disabled={engineBusy || engineStatus?.ollama.modelInstalled}
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
							<input id="ollama-model" type="text" bind:value={settingsForm.ollamaModel} />
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
		grid-template-columns: minmax(0, 1fr) minmax(300px, 430px);
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
		gap: 8px;
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
