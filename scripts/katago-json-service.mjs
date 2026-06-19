import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const port = Number(process.env.KATAGO_SERVICE_PORT || 8719);
const katagoBin = process.env.KATAGO_BIN || 'katago';
const config = process.env.KATAGO_CONFIG;
const model = process.env.KATAGO_MODEL;
const extraArgs = process.env.KATAGO_EXTRA_ARGS?.split(' ').filter(Boolean) ?? [];

if (!config || !model) {
	console.error('KATAGO_CONFIG and KATAGO_MODEL are required.');
	process.exit(1);
}

const args = ['analysis', '-config', config, '-model', model, ...extraArgs];
const katago = spawn(katagoBin, args, {
	stdio: ['pipe', 'pipe', 'inherit']
});

const pending = new Map();

katago.on('exit', (code, signal) => {
	for (const { reject } of pending.values()) {
		reject(new Error(`KataGo exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}.`));
	}
	pending.clear();
	process.exit(code ?? 1);
});

createInterface({ input: katago.stdout }).on('line', (line) => {
	let payload;
	try {
		payload = JSON.parse(line);
	} catch {
		console.error(`Ignoring non-JSON KataGo output: ${line}`);
		return;
	}

	if (payload.warning) {
		console.warn(`KataGo warning: ${payload.warning}`);
	}

	const id = payload.id;
	if (!id || !pending.has(id)) return;
	if (payload.isDuringSearch === true) return;

	const { resolve, timeout } = pending.get(id);
	clearTimeout(timeout);
	pending.delete(id);
	resolve(payload);
});

const server = createServer(async (request, response) => {
	response.setHeader('access-control-allow-origin', '*');
	response.setHeader('access-control-allow-methods', 'POST, OPTIONS, GET');
	response.setHeader('access-control-allow-headers', 'content-type');

	if (request.method === 'OPTIONS') {
		response.writeHead(204);
		response.end();
		return;
	}

	if (request.method === 'GET' && request.url === '/health') {
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ ok: true }));
		return;
	}

	if (request.method !== 'POST' || request.url !== '/analyze') {
		response.writeHead(404, { 'content-type': 'application/json' });
		response.end(JSON.stringify({ error: 'Not found' }));
		return;
	}

	try {
		const query = await readJson(request);
		const result = await sendQuery(query);
		response.writeHead(200, { 'content-type': 'application/json' });
		response.end(JSON.stringify(result));
	} catch (error) {
		response.writeHead(500, { 'content-type': 'application/json' });
		response.end(
			JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown service error' })
		);
	}
});

server.listen(port, () => {
	console.log(`KataGo JSON bridge listening on http://localhost:${port}/analyze`);
});

function readJson(request) {
	return new Promise((resolve, reject) => {
		let body = '';
		request.setEncoding('utf8');
		request.on('data', (chunk) => {
			body += chunk;
			if (body.length > 2_000_000) {
				reject(new Error('Request body too large.'));
				request.destroy();
			}
		});
		request.on('end', () => {
			try {
				resolve(JSON.parse(body));
			} catch (error) {
				reject(error);
			}
		});
		request.on('error', reject);
	});
}

function sendQuery(query) {
	const id = typeof query.id === 'string' ? query.id : crypto.randomUUID();
	const payload = { ...query, id };

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			pending.delete(id);
			reject(new Error(`KataGo query ${id} timed out.`));
		}, Number(process.env.KATAGO_QUERY_TIMEOUT_MS || 120_000));

		pending.set(id, { resolve, reject, timeout });
		katago.stdin.write(`${JSON.stringify(payload)}\n`, 'utf8', (error) => {
			if (error) {
				clearTimeout(timeout);
				pending.delete(id);
				reject(error);
			}
		});
	});
}
