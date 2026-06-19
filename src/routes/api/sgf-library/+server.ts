import { json, type RequestHandler } from '@sveltejs/kit';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { parseSgfGame } from '$lib/go/sgf';

const libraryRoot = path.resolve(process.cwd(), 'data/sgf');
const maxResults = 200;
const maxVisitedFiles = 75_000;

const sourceRoots = {
	all: libraryRoot,
	cwi: path.join(libraryRoot, 'cwi'),
	jgdb: path.join(libraryRoot, 'jgdb')
} as const;

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

const querySchema = z.object({
	q: z.string().trim().max(200).optional().default(''),
	source: z.enum(['all', 'cwi', 'jgdb']).optional().default('all'),
	limit: z.coerce.number().int().min(1).max(maxResults).optional().default(80),
	path: z.string().trim().max(1000).optional()
});

export const GET: RequestHandler = async ({ url }) => {
	const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams));

	if (!parsed.success) {
		return json({ error: 'Invalid SGF library request.', details: parsed.error.flatten() }, { status: 400 });
	}

	const { path: requestedPath } = parsed.data;

	if (requestedPath) {
		try {
			return json({ game: await loadGame(requestedPath) });
		} catch (error) {
			return json(
				{ error: error instanceof Error ? error.message : 'Could not load SGF game.' },
				{ status: 400 }
			);
		}
	}

	const games = await listGames(parsed.data);
	return json({ games });
};

async function listGames({
	q,
	source,
	limit
}: {
	q: string;
	source: keyof typeof sourceRoots;
	limit: number;
}) {
	const root = sourceRoots[source];
	const normalizedQuery = q.toLowerCase();
	const files: SgfLibraryItem[] = [];
	let visited = 0;

	async function walk(directory: string): Promise<void> {
		if (files.length >= limit || visited >= maxVisitedFiles) return;

		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}

		entries.sort((a, b) => a.name.localeCompare(b.name));

		for (const entry of entries) {
			if (files.length >= limit || visited >= maxVisitedFiles) return;

			const fullPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				await walk(fullPath);
				continue;
			}

			if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.sgf')) continue;

			visited += 1;
			const relativePath = toLibraryRelativePath(fullPath);
			if (normalizedQuery && !relativePath.toLowerCase().includes(normalizedQuery)) continue;

			files.push(await summarizeGame(fullPath, relativePath, entry.name));
		}
	}

	await walk(root);

	return {
		items: files,
		truncated: visited >= maxVisitedFiles,
		visited
	};
}

async function summarizeGame(fullPath: string, relativePath: string, name: string): Promise<SgfLibraryItem> {
	const source = relativePath.startsWith('cwi/') ? 'CWI' : relativePath.startsWith('jgdb/') ? 'JGDB' : 'Local';

	try {
		const contents = await readFile(fullPath, 'utf8');
		const game = parseSgfGame(contents, relativePath);

		return {
			id: relativePath,
			path: relativePath,
			name,
			source,
			title: game.title,
			blackPlayer: game.blackPlayer,
			whitePlayer: game.whitePlayer,
			event: game.event,
			date: game.date,
			result: game.result,
			moveCount: game.moves.length
		};
	} catch {
		return {
			id: relativePath,
			path: relativePath,
			name,
			source,
			title: name
		};
	}
}

async function loadGame(relativePath: string) {
	const fullPath = resolveLibraryPath(relativePath);
	const fileStat = await stat(fullPath);

	if (!fileStat.isFile() || !fullPath.toLowerCase().endsWith('.sgf')) {
		throw new Error('Requested path is not an SGF file.');
	}

	const contents = await readFile(fullPath, 'utf8');
	const game = parseSgfGame(contents, relativePath);

	return {
		...game,
		path: relativePath
	};
}

function resolveLibraryPath(relativePath: string): string {
	const fullPath = path.resolve(libraryRoot, relativePath);

	if (!fullPath.startsWith(`${libraryRoot}${path.sep}`)) {
		throw new Error('SGF path is outside the local library.');
	}

	return fullPath;
}

function toLibraryRelativePath(fullPath: string): string {
	return path.relative(libraryRoot, fullPath).split(path.sep).join('/');
}
