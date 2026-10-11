import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export type BoardColumn = {
  _id: Id<"columns">;
  name: string;
  isDone: boolean;
  position: number;
  color?: string;
};

/** A product list's three goal columns, in display order. */
export async function columnsOfBoard(
  ctx: QueryCtx,
  boardId: Id<"boards">,
): Promise<BoardColumn[]> {
  const columns = await ctx.db
    .query("columns")
    .withIndex("by_board_position", (q) => q.eq("boardId", boardId))
    .collect();
  return columns.sort((a, b) => a.position - b.position);
}
