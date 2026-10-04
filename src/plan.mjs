// Next-run planning: which features to validate next, ranked.
import { LEVELS } from './schema.mjs';

const idx = l => LEVELS.indexOf(l);

/** Bonus that puts a feature with a fixed-but-unverified issue near the top. */
export const REVERIFY_BONUS = 10;

/**
 * nextRunPlan({ features }) → [{ id, name, weight, gap, score, reason }]
 * Score is weight × levels-below-target, plus REVERIFY_BONUS when a linked
 * issue was fixed and needs re-checking. Features at target are left out.
 */
export function nextRunPlan({ features = [] }) {
  return features
    .map(f => {
      const gap = Math.max(0, idx(f.target_level) - idx(f.current_level));
      const reasons = [];
      if (gap > 0) reasons.push(`${gap} level(s) below target ${f.target_level}`);
      if (f.reverify) reasons.push('re-verify fixed issue');
      return { id: f.id, name: f.name, weight: f.weight, gap, score: f.weight * gap + (f.reverify ? REVERIFY_BONUS : 0), reason: reasons.join('; ') };
    })
    .filter(p => p.score > 0)
    .sort((a, b) => b.score - a.score);
}
