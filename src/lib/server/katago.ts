import { env } from '$env/dynamic/private';
import type { AnalysisResult, GoPosition, KataGoQuery } from '$lib/go/types';
import type { RuntimeSettings } from '$lib/server/runtime-settings';

export function makeKataGoQuery(position: GoPosition, maxVisits: number): KataGoQuery {
	return {
		id: crypto.randomUUID(),
		moves: position.moves.map((move) => [move.color, move.gtp]),
		rules: position.rules.toLowerCase(),
		komi: position.komi,
		boardXSize: position.boardSize,
		boardYSize: position.boardSize,
		maxVisits,
		analysisPVLen: 12,
		includeOwnership: true,
		includePolicy: true
	};
}

export async function analyzeWithKataGo(
	position: GoPosition,
	maxVisits: number,
	settings?: RuntimeSettings
): Promise<AnalysisResult> {
	const request = makeKataGoQuery(position, maxVisits);
	const endpoint = settings?.katagoAnalysisUrl || env.KATAGO_ANALYSIS_URL;

	if (!endpoint) {
		return makeFallbackAnalysis(position, request, 'No KataGo analysis URL is configured.');
	}

	try {
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: JSON.stringify(request)
		});

		if (!response.ok) {
			const body = await response.text();
			return makeFallbackAnalysis(position, request, `KataGo service returned ${response.status}: ${body}`);
		}

		const payload = (await response.json()) as Partial<AnalysisResult>;

		return {
			id: typeof payload.id === 'string' ? payload.id : request.id,
			source: 'katago',
			generatedAt: new Date().toISOString(),
			rootInfo: payload.rootInfo ?? {},
			moveInfos: Array.isArray(payload.moveInfos) ? payload.moveInfos : [],
			ownership: Array.isArray(payload.ownership) ? payload.ownership : undefined,
			policy: Array.isArray(payload.policy) ? payload.policy : undefined,
			request
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Unknown KataGo service error.';
		return makeFallbackAnalysis(position, request, message);
	}
}

function makeFallbackAnalysis(
	position: GoPosition,
	request: KataGoQuery,
	unavailableReason: string
): AnalysisResult {
	return {
		id: request.id,
		source: 'fallback',
		generatedAt: new Date().toISOString(),
		rootInfo: {
			currentPlayer: position.nextPlayer,
			visits: 0
		},
		moveInfos: [],
		request,
		unavailableReason
	};
}
