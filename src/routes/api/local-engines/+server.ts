import { dev } from '$app/environment';
import { json, type RequestHandler } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import { z } from 'zod';

const ollamaBaseUrl = 'http://127.0.0.1:11434';
const katagoBaseUrl = 'http://127.0.0.1:8719';
const defaultOllamaModel = 'llama3.2:3b';
const supportedOllamaModels = ['llama3.2:3b', 'gemma3:4b', 'qwen3:4b', 'phi4-mini', 'gpt-oss:20b'] as const;

let katagoStarting = false;
const ollamaPulling = new Set<string>();

const actionSchema = z.object({
	action: z.enum(['status', 'start-all', 'start-katago', 'start-ollama', 'pull-ollama-model']),
	model: z.enum(supportedOllamaModels).optional()
});

export const GET: RequestHandler = async () => {
	if (!dev) {
		return json({ error: 'Local engine controls are only available in development.' }, { status: 403 });
	}

	return json(await getStatus());
};

export const POST: RequestHandler = async ({ request }) => {
	if (!dev) {
		return json({ error: 'Local engine controls are only available in development.' }, { status: 403 });
	}

	const parsed = actionSchema.safeParse(await request.json());

	if (!parsed.success) {
		return json({ error: 'Invalid local engine action.' }, { status: 400 });
	}

	const messages: string[] = [];

	if (parsed.data.action === 'start-katago' || parsed.data.action === 'start-all') {
		messages.push(await startKataGo());
	}

	if (parsed.data.action === 'start-ollama' || parsed.data.action === 'start-all') {
		messages.push(await startOllama());
	}

	if (parsed.data.action === 'pull-ollama-model' || parsed.data.action === 'start-all') {
		messages.push(await ensureOllamaModel(parsed.data.model ?? defaultOllamaModel));
	}

	return json({
		messages,
		status: await getStatus()
	});
};

async function getStatus() {
	const [katago, ollama] = await Promise.all([checkKataGo(), checkOllama()]);

	return {
		localOnly: true,
		katago,
		ollama
	};
}

async function checkKataGo() {
	try {
		const response = await fetch(`${katagoBaseUrl}/health`, {
			signal: AbortSignal.timeout(1500)
		});

		return {
			running: response.ok,
			url: `${katagoBaseUrl}/analyze`
		};
	} catch {
		return {
			running: false,
			url: `${katagoBaseUrl}/analyze`
		};
	}
}

async function checkOllama() {
	try {
		const response = await fetch(`${ollamaBaseUrl}/api/tags`, {
			signal: AbortSignal.timeout(1500)
		});

		if (!response.ok) {
			return {
				running: false,
				modelInstalled: false,
				model: defaultOllamaModel,
				installedModels: [],
				url: ollamaBaseUrl
			};
		}

		const payload = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
		const models = payload.models ?? [];
		const installedModels = supportedOllamaModels.filter((candidate) =>
			models.some((model) => model.name === candidate || model.model === candidate)
		);

		return {
			running: true,
			modelInstalled: installedModels.includes(defaultOllamaModel),
			model: defaultOllamaModel,
			installedModels,
			url: ollamaBaseUrl
		};
	} catch {
		return {
			running: false,
			modelInstalled: false,
			model: defaultOllamaModel,
			installedModels: [],
			url: ollamaBaseUrl
		};
	}
}

async function startKataGo(): Promise<string> {
	if ((await checkKataGo()).running) {
		return 'KataGo bridge is already running.';
	}

	if (katagoStarting) {
		return 'KataGo bridge is already starting.';
	}

	katagoStarting = true;

	try {
		const child = spawn(process.execPath, ['scripts/katago-json-service.mjs'], {
			cwd: process.cwd(),
			detached: true,
			stdio: 'ignore',
			env: process.env
		});
		child.unref();

		const ready = await waitFor(async () => (await checkKataGo()).running, 20_000);
		return ready ? 'KataGo bridge started.' : 'KataGo bridge start command ran, but health check is still pending.';
	} finally {
		katagoStarting = false;
	}
}

async function startOllama(): Promise<string> {
	if ((await checkOllama()).running) {
		return 'Ollama is already running.';
	}

	try {
		await runCommand('brew', ['services', 'start', 'ollama'], 20_000);
	} catch {
		const child = spawn('ollama', ['serve'], {
			cwd: process.cwd(),
			detached: true,
			stdio: 'ignore',
			env: process.env
		});
		child.unref();
	}

	const ready = await waitFor(async () => (await checkOllama()).running, 20_000);
	return ready ? 'Ollama started.' : 'Ollama start command ran, but health check is still pending.';
}

async function ensureOllamaModel(model: (typeof supportedOllamaModels)[number]): Promise<string> {
	const status = await checkOllama();

	if (!status.running) {
		return 'Ollama is not running, so the model pull did not start.';
	}

	if (status.installedModels.includes(model)) {
		return `${model} is already installed.`;
	}

	if (ollamaPulling.has(model)) {
		return `${model} pull is already running.`;
	}

	ollamaPulling.add(model);
	const child = spawn('ollama', ['pull', model], {
		cwd: process.cwd(),
		detached: true,
		stdio: 'ignore',
		env: process.env
	});
	child.unref();
	child.on('exit', () => {
		ollamaPulling.delete(model);
	});

	return `Started pulling ${model}. This can take several minutes.`;
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, args, {
			cwd: process.cwd(),
			stdio: 'ignore',
			env: process.env
		});
		const timeout = setTimeout(() => {
			child.kill();
			reject(new Error(`${command} timed out.`));
		}, timeoutMs);

		child.on('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.on('exit', (code) => {
			clearTimeout(timeout);
			code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}.`));
		});
	});
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (await check()) return true;
		await new Promise((resolve) => setTimeout(resolve, 750));
	}

	return false;
}
