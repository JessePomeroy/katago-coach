import { env } from '$env/dynamic/private';
import { json, type RequestHandler } from '@sveltejs/kit';
import { createOpenAI } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { z } from 'zod';
import { colorName, formatScoreLead, formatWinrate } from '$lib/go/coordinates';
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

export const POST: RequestHandler = async ({ request, cookies }) => {
	const parsed = chatRequestSchema.safeParse(await request.json());

	if (!parsed.success) {
		return json({ error: 'Invalid chat request.', details: parsed.error.flatten() }, { status: 400 });
	}

	const { message, position, analysis, history } = parsed.data;
	const settings = getRuntimeSettings(cookies);
	const openaiApiKey = settings.openaiApiKey || env.OPENAI_API_KEY;

	if (!openaiApiKey) {
		return json({
			content: fallbackCoachReply(message, position, analysis as AnalysisResult | null)
		});
	}

	const openai = createOpenAI({ apiKey: openaiApiKey });

	const result = await generateText({
		model: openai(settings.openaiModel || 'gpt-5.5'),
		system: [
			'You are a Go teacher explaining KataGo analysis.',
			'KataGo analysis is the source of truth. Do not invent candidate moves, winrates, score leads, ownership, or weak groups that are not supported by the supplied analysis.',
			'If the analysis source is fallback or missing, say that KataGo is not connected and limit yourself to explaining the visible move history and setup steps.',
			'Keep answers concise, beginner-friendly, and concrete. Prefer coordinates and short variations from KataGo PVs.'
		].join(' '),
		messages: [
			...history.map((entry) => ({
				role: entry.role,
				content: entry.content
			})),
			{
				role: 'user',
				content: buildCoachPrompt(message, position, analysis as AnalysisResult | null)
			}
		],
		maxOutputTokens: 700
	});

	return json({ content: result.text });
};

function buildCoachPrompt(
	message: string,
	position: z.infer<typeof goPositionSchema>,
	analysis: AnalysisResult | null
): string {
	const topMoves = analysis?.moveInfos.slice(0, 8).map((move) => ({
		move: move.move,
		order: move.order,
		visits: move.visits,
		winrate: move.winrate,
		scoreLead: move.scoreLead ?? move.scoreMean,
		pv: move.pv?.slice(0, 8)
	}));

	return JSON.stringify(
		{
			userQuestion: message,
			position: {
				boardSize: position.boardSize,
				komi: position.komi,
				rules: position.rules,
				nextPlayer: position.nextPlayer,
				moveCount: position.moves.length,
				lastMove: position.lastMove,
				sgf: position.sgf
			},
			analysis: analysis
				? {
						source: analysis.source,
						unavailableReason: analysis.unavailableReason,
						rootInfo: analysis.rootInfo,
						topMoves
					}
				: null
		},
		null,
		2
	);
}

function fallbackCoachReply(
	message: string,
	position: z.infer<typeof goPositionSchema>,
	analysis: AnalysisResult | null
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
			`KataGo is not connected, so I should not claim that ${topMoveText} is a real engine recommendation.`,
			`Current position: ${position.moves.length} moves, last move ${lastMove}, ${colorName(position.nextPlayer)} to play.`,
			'Set `KATAGO_ANALYSIS_URL` to a running KataGo bridge and run analysis again; then I can explain winrate, score lead, candidate moves, and PVs from KataGo.'
		].join('\n\n');
	}

	const best = analysis.moveInfos[0];
	const root = analysis.rootInfo;
	const answer = [
		`KataGo has ${colorName(position.nextPlayer)} to play. Root winrate is ${formatWinrate(root.winrate)} and score lead is ${formatScoreLead(root.scoreLead ?? root.scoreMean)}.`,
		best
			? `Top candidate: ${best.move}, with ${best.visits ?? 0} visits, ${formatWinrate(best.winrate)} winrate, and score lead ${formatScoreLead(best.scoreLead ?? best.scoreMean)}.`
			: 'KataGo did not return candidate moves.',
		`Question: ${message}`
	];

	return answer.join('\n\n');
}
