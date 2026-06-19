import { env } from '$env/dynamic/private';
import type { Cookies } from '@sveltejs/kit';

const settingsCookie = 'kgc_settings_session';
const oneWeek = 60 * 60 * 24 * 7;

export interface RuntimeSettingsInput {
	llmProvider?: 'ollama' | 'openai';
	openaiApiKey?: string;
	openaiModel?: string;
	ollamaBaseUrl?: string;
	ollamaModel?: string;
	katagoAnalysisUrl?: string;
}

export interface RuntimeSettings {
	llmProvider: 'ollama' | 'openai';
	openaiApiKey?: string;
	openaiModel: string;
	ollamaBaseUrl: string;
	ollamaModel: string;
	katagoAnalysisUrl?: string;
	hasRuntimeSettings: boolean;
}

export interface PublicRuntimeSettings {
	llmProvider: 'ollama' | 'openai';
	hasOpenAIKey: boolean;
	openaiModel: string;
	ollamaBaseUrl: string;
	ollamaModel: string;
	katagoAnalysisUrl: string;
	hasRuntimeSettings: boolean;
}

const sessionSettings = new Map<string, RuntimeSettingsInput>();

export function getRuntimeSettings(cookies: Cookies): RuntimeSettings {
	const sessionId = cookies.get(settingsCookie);
	const stored = sessionId ? sessionSettings.get(sessionId) : undefined;
	const openaiApiKey = stored?.openaiApiKey || env.OPENAI_API_KEY || undefined;
	const llmProvider =
		stored?.llmProvider ||
		(env.LLM_PROVIDER === 'openai' || env.LLM_PROVIDER === 'ollama' ? env.LLM_PROVIDER : undefined) ||
		(openaiApiKey ? 'openai' : 'ollama');

	return {
		llmProvider,
		openaiApiKey,
		openaiModel: stored?.openaiModel || env.OPENAI_MODEL || 'gpt-5.5',
		ollamaBaseUrl: stored?.ollamaBaseUrl || env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
		ollamaModel: stored?.ollamaModel || env.OLLAMA_MODEL || 'gpt-oss:20b',
		katagoAnalysisUrl: stored?.katagoAnalysisUrl || env.KATAGO_ANALYSIS_URL || undefined,
		hasRuntimeSettings: Boolean(stored)
	};
}

export function getPublicRuntimeSettings(cookies: Cookies): PublicRuntimeSettings {
	const settings = getRuntimeSettings(cookies);

	return {
		llmProvider: settings.llmProvider,
		hasOpenAIKey: Boolean(settings.openaiApiKey),
		openaiModel: settings.openaiModel,
		ollamaBaseUrl: settings.ollamaBaseUrl,
		ollamaModel: settings.ollamaModel,
		katagoAnalysisUrl: settings.katagoAnalysisUrl || '',
		hasRuntimeSettings: settings.hasRuntimeSettings
	};
}

export function saveRuntimeSettings(cookies: Cookies, input: RuntimeSettingsInput): RuntimeSettings {
	const sessionId = getOrCreateSessionId(cookies);
	const current = sessionSettings.get(sessionId) ?? {};
	const next: RuntimeSettingsInput = {
		...current
	};

	if (input.llmProvider !== undefined) {
		next.llmProvider = input.llmProvider;
	}

	if (input.openaiApiKey !== undefined) {
		const trimmed = input.openaiApiKey.trim();
		if (trimmed) {
			next.openaiApiKey = trimmed;
		}
	}

	if (input.openaiModel !== undefined) {
		const trimmed = input.openaiModel.trim();
		if (trimmed) {
			next.openaiModel = trimmed;
		}
	}

	if (input.ollamaBaseUrl !== undefined) {
		const trimmed = input.ollamaBaseUrl.trim();
		if (trimmed) {
			next.ollamaBaseUrl = trimmed.replace(/\/+$/, '');
		}
	}

	if (input.ollamaModel !== undefined) {
		const trimmed = input.ollamaModel.trim();
		if (trimmed) {
			next.ollamaModel = trimmed;
		}
	}

	if (input.katagoAnalysisUrl !== undefined) {
		const trimmed = input.katagoAnalysisUrl.trim();
		if (trimmed) {
			next.katagoAnalysisUrl = trimmed;
		}
	}

	sessionSettings.set(sessionId, next);
	return getRuntimeSettings(cookies);
}

export function clearRuntimeSettings(cookies: Cookies): RuntimeSettings {
	const sessionId = cookies.get(settingsCookie);

	if (sessionId) {
		sessionSettings.delete(sessionId);
	}

	cookies.delete(settingsCookie, { path: '/' });
	return getRuntimeSettings(cookies);
}

function getOrCreateSessionId(cookies: Cookies): string {
	const existing = cookies.get(settingsCookie);

	if (existing) {
		return existing;
	}

	const sessionId = crypto.randomUUID();
	cookies.set(settingsCookie, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		maxAge: oneWeek
	});

	return sessionId;
}
