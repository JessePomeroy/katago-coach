import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import { goPositionSchema } from '$lib/go/schemas';
import { analyzeWithKataGo } from '$lib/server/katago';
import { getRuntimeSettings } from '$lib/server/runtime-settings';

const analyzeRequestSchema = z.object({
	position: goPositionSchema,
	maxVisits: z.number().int().min(1).max(5000).default(300)
});

export const POST: RequestHandler = async ({ request, cookies }) => {
	const parsed = analyzeRequestSchema.safeParse(await request.json());

	if (!parsed.success) {
		return json({ error: 'Invalid analysis request.', details: parsed.error.flatten() }, { status: 400 });
	}

	const result = await analyzeWithKataGo(
		parsed.data.position,
		parsed.data.maxVisits,
		getRuntimeSettings(cookies)
	);
	return json(result);
};
