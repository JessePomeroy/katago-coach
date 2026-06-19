import { z } from 'zod';

export const stoneColorSchema = z.enum(['B', 'W']);

export const goMoveSchema = z.object({
	color: stoneColorSchema,
	x: z.number().int(),
	y: z.number().int(),
	moveNumber: z.number().int().positive(),
	gtp: z.string(),
	sgf: z.string()
});

export const goPositionSchema = z.object({
	boardSize: z.number().int().min(2).max(25),
	komi: z.number(),
	rules: z.string().min(1),
	nextPlayer: stoneColorSchema,
	moves: z.array(goMoveSchema),
	board: z.array(z.array(z.union([z.literal(0), z.literal(1), z.literal(2)]))),
	sgf: z.string(),
	lastMove: goMoveSchema.optional()
});
