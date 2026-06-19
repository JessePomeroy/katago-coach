import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { z } from 'zod';
import { colorName, formatScoreLead, formatWinrate, toGtpCoordinate } from '$lib/go/coordinates';
import { goPositionSchema } from '$lib/go/schemas';
import { getRuntimeSettings } from '$lib/server/runtime-settings';
import type { AnalysisResult } from '$lib/go/types';

const kataGoMoveInfoSchema = z.object({
	move: z.string(),
	order: z.number().optional(),
	visits: z.number().optional(),
	winrate: z.number().optional(),
	scoreLead: z.number().optional(),
	scoreMean: z.number().optional(),
	prior: z.number().optional(),
	pv: z.array(z.string()).optional()
});

const analysisResultSchema = z.object({
	id: z.string(),
	source: z.enum(['katago', 'fallback']),
	generatedAt: z.string(),
	rootInfo: z.record(z.string(), z.unknown()),
	moveInfos: z.array(kataGoMoveInfoSchema),
	unavailableReason: z.string().optional()
});

const chatRequestSchema = z.object({
	message: z.string().trim().min(1).max(2000),
	position: goPositionSchema,
	analysis: analysisResultSchema.nullable(),
	history: z
		.array(
			z.object({
				role: z.enum(['user', 'assistant']),
				content: z.string().max(4000)
			})
		)
		.max(8)
		.default([])
});

const coachSystemPrompt = [
	'You are a patient Go teacher for the board game Go, also called baduk or weiqi.',
	'KataGo analysis is the source of truth. Use only supplied KataGo facts for candidate moves, winrates, score leads, ownership, weak groups, and variations.',
	'Never use chess terms or chess concepts. Banned words include pawn, pawns, piece value, material balance, check, checkmate, rook, bishop, knight, queen, king, castle, fork, and pin.',
	'Use Go vocabulary: shape, liberties, territory, influence, thickness, weak group, cutting point, extension, invasion, reduction, sente, gote, ko, endgame, corner, side, center, moyo, joseki, fuseki.',
	'If the user asks whether the last move was good or bad, be precise: the supplied analysis is for the resulting current position, not a before-and-after comparison. Do not claim the last move caused a winrate or score change unless a comparison is supplied.',
	'When KataGo candidate moves or PVs are supplied, do not give a vague answer about lacking information. Explain what the numbers and candidate continuations imply, using cautious language where needed.',
	'If analysis is missing or fallback, say KataGo is not connected and avoid strategic claims.',
	'Keep answers concise, beginner-friendly, and concrete. Prefer coordinates, shape/territory/influence language, and short variations from KataGo PVs.',
	'Do not expose hidden reasoning. Give the useful teaching explanation directly.'
].join(' ');
const bannedCoachTerms =
	/\b(pawn|pawns|piece value|material balance|check|checkmate|rook|bishop|knight|queen|king|castle|fork|pin)\b/i;
const gtpColumns = 'ABCDEFGHJKLMNOPQRSTUVWXYZ';

export const POST: RequestHandler = async ({ request, cookies }) => {
	const parsed = chatRequestSchema.safeParse(await request.json());

	if (!parsed.success) {
		return json({ error: 'Invalid chat request.', details: parsed.error.flatten() }, { status: 400 });
	}

	const { message, position, analysis, history } = parsed.data;
	const settings = getRuntimeSettings(cookies);
	const openaiApiKey = settings.openaiApiKey || env.OPENAI_API_KEY;
	const coachPrompt = buildCoachPrompt(message, position, analysis as AnalysisResult | null);

	if (settings.llmProvider === 'openai' && openaiApiKey) {
		const openai = createOpenAI({ apiKey: openaiApiKey });

		const result = await generateText({
			model: openai(settings.openaiModel || 'gpt-5.5'),
			system: coachSystemPrompt,
			messages: [
				...historyForModel(history).map((entry) => ({
					role: entry.role,
					content: entry.content
				})),
				{
					role: 'user',
					content: coachPrompt
				}
			],
			maxOutputTokens: 700
		});

		if (!containsBannedCoachTerm(result.text)) {
			return json({ content: result.text, provider: 'openai' });
		}

		const retry = await generateText({
			model: openai(settings.openaiModel || 'gpt-5.5'),
			system: coachSystemPrompt,
			messages: [
				{
					role: 'user',
					content: `${coachPrompt}\n\nRewrite the answer using only Go vocabulary. Do not mention chess, pawns, material balance, or pieces.`
				}
			],
			maxOutputTokens: 700
		});

		return json({ content: retry.text, provider: 'openai' });
	}

	try {
		const content = await generateOllamaReply({
			baseUrl: settings.ollamaBaseUrl,
			model: settings.ollamaModel,
			history,
			prompt: coachPrompt
		});

		return json({ content, provider: 'ollama' });
	} catch (error) {
		return json({
			content: fallbackCoachReply(
				message,
				position,
				analysis as AnalysisResult | null,
				error instanceof Error ? error.message : 'Ollama request failed.'
			),
			provider: 'fallback'
		});
	}
};

function buildCoachPrompt(
	message: string,
	position: z.infer<typeof goPositionSchema>,
	analysis: AnalysisResult | null
): string {
	const rootWinrate = asNumber(analysis?.rootInfo.winrate);
	const rootLead = asNumber(analysis?.rootInfo.scoreLead ?? analysis?.rootInfo.scoreMean);
	const analysisPlayer =
		typeof analysis?.rootInfo.currentPlayer === 'string'
			? colorName(analysis.rootInfo.currentPlayer === 'W' ? 'W' : 'B')
			: colorName(position.nextPlayer);
	const topMoves = analysis?.moveInfos.slice(0, 8).map((move) => ({
		move: move.move,
		area: describeMoveArea(move.move, position.boardSize),
		order: move.order,
		visits: move.visits,
		winrate: formatWinrate(move.winrate),
		scoreLead: formatScoreLead(move.scoreLead ?? move.scoreMean),
		pv: move.pv?.slice(0, 5)
	}));
	const recentMoves = position.moves.slice(-12).map((move) => ({
		number: move.moveNumber,
		color: colorName(move.color),
		move: move.gtp
	}));
	const boardStones = summarizeBoardStones(position);
	const lastMove = position.lastMove
		? `${position.lastMove.moveNumber}. ${colorName(position.lastMove.color)} ${position.lastMove.gtp} (${describeMoveArea(position.lastMove.gtp, position.boardSize)})`
		: 'none';

	return [
		`User question: ${message}`,
		'',
		'Answer requirements:',
		'- Speak only about Go. Do not use chess analogies or chess vocabulary.',
		'- Explain what the KataGo numbers suggest in plain language.',
		'- If asked about the last move, say whether current analysis supports it, but do not pretend to know the before/after swing.',
		'- Do not say you lack information if KataGo candidate moves and PVs are present. Give the best teaching explanation supported by the data.',
		'- Structure the answer as: verdict, main Go purpose, candidate comparison, one short continuation or beginner takeaway.',
		'- Use 2-4 short paragraphs or bullets. Include one concrete continuation if KataGo supplied a PV.',
		'',
		'Current position:',
		`- Board: ${position.boardSize}x${position.boardSize}, ${position.rules}, komi ${position.komi}`,
		`- Move count: ${position.moves.length}`,
		`- Last move: ${lastMove}`,
		`- To play now: ${colorName(position.nextPlayer)}`,
		`- Recent moves: ${recentMoves.map((move) => `${move.number}. ${move.color} ${move.move}`).join(', ') || 'none'}`,
		`- Current Black stones: ${boardStones.black || 'none'}`,
		`- Current White stones: ${boardStones.white || 'none'}`,
		'',
		analysis
			? [
					'KataGo analysis:',
					`- Source: ${analysis.source}`,
					analysis.unavailableReason ? `- Unavailable reason: ${analysis.unavailableReason}` : undefined,
					`- Analysis perspective: ${analysisPlayer} to play in the current position`,
					`- Root visits: ${analysis.rootInfo.visits ?? 'n/a'}`,
					`- Root winrate for analysis perspective: ${formatWinrate(rootWinrate)}`,
					`- Root score lead for analysis perspective: ${formatScoreLead(rootLead)}`,
					`- Top candidate moves: ${JSON.stringify(topMoves ?? [], null, 2)}`
				]
					.filter(Boolean)
					.join('\n')
			: 'KataGo analysis: none'
	].join('\n');
}

function fallbackCoachReply(
	message: string,
	position: z.infer<typeof goPositionSchema>,
	analysis: AnalysisResult | null,
	providerError?: string
): string {
	const lastMove = position.lastMove
		? `${colorName(position.lastMove.color)} ${position.lastMove.gtp}`
		: 'no move yet';
	const topMoveText =
		analysis?.moveInfos
			.slice(0, 3)
			.map((move) => move.move)
			.join(', ') || 'none';

	if (!analysis || analysis.source !== 'katago') {
		return [
			providerError ? `LLM provider unavailable: ${providerError}` : undefined,
			`KataGo is not connected, so I should not claim that ${topMoveText} is a real engine recommendation.`,
			`Current position: ${position.moves.length} moves, last move ${lastMove}, ${colorName(position.nextPlayer)} to play.`,
			'Set `KATAGO_ANALYSIS_URL` to a running KataGo bridge and run analysis again; then I can explain winrate, score lead, candidate moves, and PVs from KataGo.'
		]
			.filter(Boolean)
			.join('\n\n');
	}

	const best = analysis.moveInfos[0];
	const root = analysis.rootInfo;
	const answer = [
		providerError ? `LLM provider unavailable: ${providerError}` : undefined,
		`KataGo has ${colorName(position.nextPlayer)} to play. Root winrate is ${formatWinrate(root.winrate)} and score lead is ${formatScoreLead(root.scoreLead ?? root.scoreMean)}.`,
		best
			? `Top candidate: ${best.move}, with ${best.visits ?? 0} visits, ${formatWinrate(best.winrate)} winrate, and score lead ${formatScoreLead(best.scoreLead ?? best.scoreMean)}.`
			: 'KataGo did not return candidate moves.',
		`Question: ${message}`
	];

	return answer.filter(Boolean).join('\n\n');
}

type ChatHistory = z.infer<typeof chatRequestSchema>['history'];

function historyForModel(history: ChatHistory): ChatHistory {
	return history.filter((entry) => entry.role === 'user').slice(-4);
}

function asNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function summarizeBoardStones(position: z.infer<typeof goPositionSchema>): { black: string; white: string } {
	const black: string[] = [];
	const white: string[] = [];

	position.board.forEach((row, y) => {
		row.forEach((point, x) => {
			if (point === 1) {
				black.push(toGtpCoordinate(x, y, position.boardSize));
			} else if (point === 2) {
				white.push(toGtpCoordinate(x, y, position.boardSize));
			}
		});
	});

	return {
		black: black.join(', '),
		white: white.join(', ')
	};
}

function describeMoveArea(move: string, boardSize: number): string {
	if (!move || move.toLowerCase() === 'pass') return 'pass';

	const match = /^([A-Z])(\d+)$/i.exec(move);
	if (!match) return 'unknown area';

	const x = gtpColumns.indexOf(match[1].toUpperCase());
	const row = Number(match[2]);

	if (x < 0 || !Number.isFinite(row)) return 'unknown area';

	const leftEdge = Math.floor(boardSize / 3);
	const rightEdge = boardSize - leftEdge - 1;
	const lowerRows = Math.floor(boardSize / 3);
	const upperRows = boardSize - lowerRows + 1;

	const horizontal = x <= leftEdge ? 'left' : x >= rightEdge ? 'right' : 'center';
	const vertical = row <= lowerRows ? 'lower' : row >= upperRows ? 'upper' : 'middle';

	if (horizontal === 'center' && vertical === 'middle') return 'center';
	if (horizontal === 'center') return `${vertical} side`;
	if (vertical === 'middle') return `${horizontal} side`;
	return `${vertical} ${horizontal}`;
}

function containsBannedCoachTerm(value: string): boolean {
	return bannedCoachTerms.test(value);
}

async function generateOllamaReply({
	baseUrl,
	model,
	history,
	prompt
}: {
	baseUrl: string;
	model: string;
	history: ChatHistory;
	prompt: string;
}): Promise<string> {
	const messages = [
		{ role: 'system', content: coachSystemPrompt },
		...historyForModel(history).map((entry) => ({
			role: entry.role,
			content: entry.content
		})),
		{ role: 'user', content: prompt }
	];
	const content = await requestOllamaChat({ baseUrl, model, messages });

	if (!containsBannedCoachTerm(content)) {
		return content;
	}

	return requestOllamaChat({
		baseUrl,
		model,
		messages: [
			{ role: 'system', content: coachSystemPrompt },
			{
				role: 'user',
				content: `${prompt}\n\nRewrite the answer using only Go vocabulary. Do not mention chess, pawns, material balance, or pieces.`
			}
		]
	});
}

async function requestOllamaChat({
	baseUrl,
	model,
	messages
}: {
	baseUrl: string;
	model: string;
	messages: Array<{ role: string; content: string }>;
}): Promise<string> {
	const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/chat`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			model,
			stream: false,
			think: model.startsWith('gpt-oss') ? 'low' : false,
			messages,
			options: {
				temperature: 0.2,
				num_ctx: 8192,
				num_predict: 280
			}
		}),
		signal: AbortSignal.timeout(120000)
	});

	if (!response.ok) {
		throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
	}

	const payload = (await response.json()) as { message?: { content?: string }; error?: string };
	const content = payload.message?.content?.trim();

	if (!content) {
		throw new Error(payload.error || 'Ollama returned an empty response.');
	}

	return content;
}
