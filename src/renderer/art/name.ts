import type { Game, GameArt } from '@shared/types';

/**
 * Best display name: the title from the disc header when the format has one;
 * otherwise (Switch, XBLA) the matched artwork's game name beats the filename.
 */
export function gameName(game: Game, art?: GameArt): string {
  if (game.title) return game.displayTitle;
  return art?.sourceName ?? game.displayTitle;
}
