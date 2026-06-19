import { json, type RequestHandler } from '@sveltejs/kit';
import { z } from 'zod';
import {
	clearRuntimeSettings,
	getPublicRuntimeSettings,
	saveRuntimeSettings
} from '$lib/server/runtime-settings';

const settingsRequestSchema = z.object({
	llmProvider: z.enum(['ollama', 'openai']).optional(),
	openaiApiKey: z.string().max(300).optional(),
	openaiModel: z.string().trim().max(120).optional(),
	ollamaBaseUrl: z
		.string()
		.trim()
		.max(500)
		.refine((value) => !value || URL.canParse(value), 'Ollama URL must be a valid URL.')
		.optional(),
	ollamaModel: z.string().trim().max(120).optional(),
	katagoAnalysisUrl: z
		.string()
		.trim()
		.max(500)
		.refine((value) => !value || URL.canParse(value), 'KataGo analysis URL must be a valid URL.')
		.optional()
});

export const GET: RequestHandler = async ({ cookies }) => {
	return json(getPublicRuntimeSettings(cookies));
};

export const POST: RequestHandler = async ({ request, cookies }) => {
	const parsed = settingsRequestSchema.safeParse(await request.json());

	if (!parsed.success) {
		return json({ error: 'Invalid settings.', details: parsed.error.flatten() }, { status: 400 });
	}

	saveRuntimeSettings(cookies, parsed.data);
	return json(getPublicRuntimeSettings(cookies));
};

export const DELETE: RequestHandler = async ({ cookies }) => {
	clearRuntimeSettings(cookies);
	return json(getPublicRuntimeSettings(cookies));
};
