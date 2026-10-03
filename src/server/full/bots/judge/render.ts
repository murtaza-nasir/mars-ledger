// The state text a decision model reads, at four depths:
//   c0  the decision and its options only (each option described by its concrete effect)
//   c1  + game state: generation, phase, globals with steps left, own economy, rivals, milestones and awards
//   c2  + board and cards: tiles by owner, free bonus spaces near own tiles, full text of the hand and own table,
//       and for each option the projected result (stock, production and TR after it)
//   c3  + a rules and strategy primer (c3t: the trimmed primer, for models with a short context)
import {findCard} from '../../../../shared/cards';
import {BONUS_NAME, TILE, TILE_NAME} from '../../../../shared/full';
import type {PublicPlayerModel, SpaceModel} from '../../../../shared/full';
import {neighbours} from '../board';
import {generationsLeft, stepsLeft, tagMap} from '../value';
import type {Ctx} from '../value';
import type {Candidate, Prompt} from './candidates';
import {RES, cardHeader, cardText, formatEffect} from './effects';
import {clockText, effectsText, evalText, historyText, planText, threatsText} from './facts';
import type {JudgeMemory, Part} from './facts';

export const CONTEXT_LEVELS = ['c0', 'c1', 'c2', 'c3', 'c3t'] as const;
export type ContextLevel = typeof CONTEXT_LEVELS[number];

const SHORT: Record<string, string> = {megacredits: 'M€', steel: 'steel', titanium: 'titanium', plants: 'plants', energy: 'energy', heat: 'heat'};
export const PROD_KEY: Record<string, string> = {megacredits: 'megacreditProduction', steel: 'steelProduction', titanium: 'titaniumProduction', plants: 'plantProduction', energy: 'energyProduction', heat: 'heatProduction'};

export const PRIMER_FULL = `RULES AND STRATEGY PRIMER (Terraforming Mars, base game + Corporate Era, Tharsis map)
End of game: the game ends at the end of the generation in which all three global parameters are maxed: temperature +8 °C (19 steps of 2 °C from -30 °C), oxygen 14% (14 steps), oceans 9. After that last production phase each player may still convert plants into greeneries; then the game is scored. With 3 players a game usually lasts 10 to 12 generations.
Scoring: 1 VP per terraform rating (TR); 5 VP per claimed milestone; for each funded award 5 VP to first place and 2 VP to second (players tied for first all get 5 and no second place is given); 1 VP per greenery tile; each city scores 1 VP per adjacent greenery (anyone's); plus VP printed on cards. M€ and resources left at the end score nothing.
TR: every step a player raises a global parameter gives that player +1 TR. TR is also income: in each production phase a player gains M€ equal to TR plus M€ production. So one TR is worth 1 VP plus 1 M€ for every production phase still to come.
Production phase: energy turns into heat, then every player gains their production of each resource.
Bonuses on the track: temperature -24 °C and -20 °C give +1 heat production; 0 °C lets the raiser place an ocean; oxygen 8% raises temperature one step.
Costs: research costs 3 M€ per card kept. Standard projects: Sell patents (discard cards for 1 M€ each), Power Plant 11 M€ (+1 energy production), Asteroid 14 M€ (+1 temperature step), Aquifer 18 M€ (place an ocean), Greenery 23 M€, City 25 M€ (city tile and +1 M€ production). Conversions: 8 plants become a greenery tile (raises oxygen one step while oxygen is below 14%); 8 heat raise temperature one step.
Paying: steel pays 2 M€ each, only for cards with a building tag; titanium pays 3 M€ each, only for cards with a space tag. Events are played once and their tags do not stay in play.
Tiles: placing a tile gives the bonus printed on the space and 2 M€ for each adjacent ocean. Oceans go only on ocean spaces. A greenery must go next to one of your own tiles when possible. Cities may not touch another city.
Milestones (Tharsis): claiming costs 8 M€ and scores 5 VP; at most 3 are claimed in a game; a player who meets the requirement must still spend an action and pay to claim it, and whoever claims first takes it. Terraformer: TR 35. Mayor: 3 cities. Gardener: 3 greeneries. Builder: 8 building tags. Planner: 16 cards in hand.
Awards (Tharsis): the first funded costs 8 M€, the second 14, the third 20; at most 3 are funded. They pay at the end to whoever leads then, not to the funder, so fund only what you will lead. Landlord: most tiles. Banker: highest M€ production. Scientist: most science tags. Thermalist: most heat. Miner: most steel and titanium.
Value of production by generation: 1 M€ of production returns about 1 M€ per generation left, so it is worth 6 to 8 M€ in generations 1 to 3, about 4 in the middle and close to nothing in the last two generations. Steel and titanium production pay off only with building and space cards to spend them on. Plant production feeds greeneries; heat production feeds temperature.
Strategy principles: build the economy early (M€ production, card draw, discounts, steel and titanium production with matching tags); switch to VP and TR as the end nears. Use the greenery loop: plants become greeneries, each greenery is +1 TR while oxygen is open and +1 VP, and more next to your own cities. Raise parameters when you are paid well for it, and remember every step brings the end closer. Deny rivals: claim milestones before they do, fund awards you clearly lead, keep greeneries away from rival cities, and take attack options against the leader. Do not hoard: cards you cannot afford or play before the end are wasted money. In the last generation convert everything you can into VP or TR: greeneries from plants, temperature from heat, standard projects with spare M€.`;

export const PRIMER_TRIM = `PRIMER: The game ends after the generation in which temperature (+8 °C), oxygen (14%) and oceans (9) are all maxed. VP = TR + milestones (5) + awards (5 first, 2 second) + greeneries (1 each) + 1 per greenery next to your cities + card VP. Each global step raised gives you +1 TR; TR also pays 1 M€ every production. Leftover M€ scores nothing. Steel pays 2 M€ on building cards, titanium 3 M€ on space cards. Standard projects: power plant 11, asteroid 14, aquifer 18, greenery 23, city 25 M€. 8 plants make a greenery; 8 heat raise temperature. Milestones cost 8 M€ for 5 VP (3 per game). Awards cost 8/14/20 M€ and pay whoever leads at the end. Production is worth a lot early and little late. Build economy early, then convert everything into VP and TR in the last generations; claim milestones and fund awards you lead; do not buy cards you cannot play.`;

const name = (ctx: Ctx, c: string | undefined) => ctx.model.players.find((p) => p.color === c)?.name ?? c ?? 'nobody';

function economy(p: PublicPlayerModel): string {
  return RES.map((r) => {
    const stock = (p as Record<string, unknown>)[r] as number;
    const prod = (p as Record<string, unknown>)[PROD_KEY[r]] as number;
    return `${SHORT[r]} ${stock} (+${prod})`;
  }).join(', ');
}

function tagsText(p: PublicPlayerModel): string {
  const t = tagMap(p);
  const list = Object.entries(t).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`);
  return list.length ? list.join(', ') : 'none';
}

function vpText(p: PublicPlayerModel): string {
  const b = p.victoryPointsBreakdown;
  if (!b) return `TR ${p.terraformRating}`;
  return `${b.total} VP now (TR ${b.terraformRating}, cards ${b.victoryPoints}, greeneries ${b.greenery}, cities ${b.city}, milestones ${b.milestones}, awards ${b.awards})`;
}

/** c1: the game state. */
export function stateText(ctx: Ctx): string {
  const m = ctx.model;
  const g = m.game;
  const left = stepsLeft(g);
  const me = ctx.me;
  const lines: string[] = [];
  lines.push(`Generation ${g.generation}, ${g.phase} phase. ${m.players.length} players. About ${generationsLeft(m)} generation(s) left including this one.`);
  lines.push(`Global parameters: temperature ${g.temperature} °C (${left.temperature} steps left to +8), oxygen ${g.oxygenLevel}% (${left.oxygen} steps left to 14), oceans ${g.oceans}/9 (${left.oceans} left). ${left.total} of 42 steps remain.`);
  lines.push(`You are ${me.name} (${me.color}). TR ${me.terraformRating}. ${vpText(me)}.`);
  lines.push(`Your resources (production): ${economy(me)}. Cards in hand ${m.cardsInHand.length}. Cities ${me.citiesCount}. Tags: ${tagsText(me)}.${g.passedPlayers.includes(me.color) ? ' You have passed.' : ''}`);
  for (const p of m.players) {
    if (p.color === me.color) continue;
    lines.push(`Rival ${p.name} (${p.color}): ${vpText(p)}; ${economy(p)}; hand ${p.cardsInHandNbr}; cities ${p.citiesCount}; tags: ${tagsText(p)}${g.passedPlayers.includes(p.color) ? '; has passed' : ''}.`);
  }
  const claimed = g.milestones.filter((x) => x.color).length;
  lines.push(`Milestones (8 M€ to claim, 5 VP; ${claimed} of 3 claimed): ` + g.milestones.map((x) => x.color
    ? `${x.name} claimed by ${name(ctx, x.color)}`
    : `${x.name} [${milestoneGoal(x.name)}] ${x.scores.map((s) => `${name(ctx, s.color)} ${s.score}`).join(', ')}`).join('; ') + '.');
  const funded = g.awards.filter((x) => x.color).length;
  const nextCost = [8, 14, 20][funded] ?? null;
  lines.push(`Awards (${funded} of 3 funded${nextCost ? `; next costs ${nextCost} M€` : ''}; 5 VP first, 2 VP second): ` + g.awards.map((x) =>
    `${x.name}${x.color ? ` (funded by ${name(ctx, x.color)})` : ''} ${x.scores.map((s) => `${name(ctx, s.color)} ${s.score}`).join(', ')}`).join('; ') + '.');
  return lines.join('\n');
}

function milestoneGoal(n: string): string {
  return ({Terraformer: 'TR 35', Mayor: '3 cities', Gardener: '3 greeneries', Builder: '8 building tags', Planner: '16 cards in hand'} as Record<string, string>)[n] ?? 'see rules';
}

/** c2: the board and the cards. */
export function boardText(ctx: Ctx): string {
  const spaces = ctx.model.game.spaces;
  const adj = neighbours(spaces);
  const lines: string[] = ['BOARD'];
  const owners = new Map<string, SpaceModel[]>();
  for (const s of spaces) if (s.tileType !== undefined && s.tileType !== TILE.OCEAN) {
    const k = s.color ?? 'neutral';
    owners.set(k, [...(owners.get(k) ?? []), s]);
  }
  for (const p of ctx.model.players) {
    const mine = owners.get(p.color) ?? [];
    const cities = mine.filter((s) => s.tileType === TILE.CITY || s.tileType === TILE.CAPITAL)
      .map((s) => `${s.id} (${(adj.get(s.id) ?? []).filter((n) => n.tileType === TILE.GREENERY).length} greeneries adjacent)`);
    const green = mine.filter((s) => s.tileType === TILE.GREENERY).map((s) => s.id);
    const special = mine.filter((s) => s.tileType !== TILE.GREENERY && s.tileType !== TILE.CITY && s.tileType !== TILE.CAPITAL).map((s) => `${TILE_NAME[s.tileType!] ?? 'special'} ${s.id}`);
    lines.push(`${p.name}${p.color === ctx.me.color ? ' (you)' : ''}: cities ${cities.join(', ') || 'none'}; greeneries ${green.join(', ') || 'none'}${special.length ? `; special ${special.join(', ')}` : ''}.`);
  }
  const oceans = spaces.filter((s) => s.tileType === TILE.OCEAN).map((s) => s.id);
  lines.push(`Oceans placed: ${oceans.join(', ') || 'none'}.`);
  // Free land next to your own tiles (where your greeneries can go), with what the space pays.
  const myIds = new Set(spaces.filter((s) => s.color === ctx.me.color).map((s) => s.id));
  const near = spaces.filter((s) => s.tileType === undefined && s.spaceType === 'land' && (adj.get(s.id) ?? []).some((n) => myIds.has(n.id)));
  const describe = (s: SpaceModel) => {
    const b = (s.bonus ?? []).map((x) => BONUS_NAME[x]).filter(Boolean);
    const o = (adj.get(s.id) ?? []).filter((n) => n.tileType === TILE.OCEAN).length;
    return `${s.id}${b.length ? ` (${b.join('+')})` : ''}${o ? ` [${o} ocean adj]` : ''}`;
  };
  lines.push(`Free land next to your tiles: ${near.map(describe).join(', ') || 'none'}.`);
  const bonusFree = spaces.filter((s) => s.tileType === undefined && s.spaceType === 'land' && (s.bonus ?? []).some((b) => b === 0 || b === 1 || b === 3 || b === 2));
  const tally: Record<string, number> = {};
  for (const s of bonusFree) for (const b of s.bonus) { const k = BONUS_NAME[b]; if (k) tally[k] = (tally[k] ?? 0) + 1; }
  lines.push(`Free land spaces with bonuses: ${Object.entries(tally).map(([k, n]) => `${k} on ${n}`).join(', ') || 'none'}.`);
  lines.push('YOUR HAND');
  for (const c of ctx.model.cardsInHand) {
    const def = findCard(c.name);
    lines.push(`- ${cardHeader(c.name, c.calculatedCost)}: ${def ? cardText(def) : ''}${def?.victoryPoints !== null && def?.victoryPoints !== undefined && typeof def.victoryPoints === 'number' ? ` (${def.victoryPoints} VP)` : ''}`);
  }
  if (!ctx.model.cardsInHand.length) lines.push('- (empty)');
  lines.push('YOUR TABLE');
  for (const c of ctx.me.tableau) {
    const def = findCard(c.name);
    if (!def) continue;
    const text = def.type === 'event' ? '(event)' : cardText(def);
    lines.push(`- ${c.name}${c.resources ? ` [${c.resources} resources]` : ''}: ${text}`);
  }
  return lines.join('\n');
}

/** After this option: own stock, production and TR (c2). */
export function projected(ctx: Ctx, c: Candidate): string {
  const me = ctx.me as unknown as Record<string, number>;
  const parts: string[] = [];
  for (const r of RES) {
    const ds = c.effect.stock[r] ?? 0;
    const dp = c.effect.prod[r] ?? 0;
    if (!ds && !dp) continue;
    const stock = me[r] + ds;
    const prodKey = PROD_KEY[r];
    parts.push(`${SHORT[r]} ${stock}${dp ? ` (production ${me[prodKey]}→${me[prodKey] + dp})` : ''}`);
  }
  if (c.effect.tr) parts.push(`TR ${ctx.me.terraformRating}→${ctx.me.terraformRating + c.effect.tr}`);
  return parts.length ? `after: ${parts.join(', ')}` : 'after: no change to your stock, production or TR';
}

/** One option's text for the criteria; with `evals`, Normal's valuation of it (its rank among `legal` options). */
export function optionText(ctx: Ctx, c: Candidate, level: ContextLevel, evals?: {rank: number; legal: number}): string {
  const base = `${c.label}: ${formatEffect(c.effect)}`;
  const text = level === 'c0' || level === 'c1' ? base : `${base}. ${projected(ctx, c)}`;
  return evals ? `${text} ${evalText(ctx, c, evals.rank, evals.legal)}` : text;
}

/** The whole state string for a level plus the derived parts (facts.ts); the options go in the question's criteria. */
export function renderState(ctx: Ctx, prompt: Pick<Prompt, 'ask' | 'title'>, level: ContextLevel, extra: readonly Part[] = [], mem?: JudgeMemory): string {
  const parts = ['You are playing Terraforming Mars and want to finish with the most victory points.', `Decision: ${prompt.ask}`];
  if (level !== 'c0') parts.push('GAME STATE\n' + stateText(ctx));
  if (extra.includes('clock')) parts.push(clockText(ctx, mem));
  if (extra.includes('plan')) parts.push(planText(ctx, mem));
  if (extra.includes('threats')) parts.push(threatsText(ctx, mem));
  if (extra.includes('history')) parts.push(historyText(ctx, mem));
  if (level === 'c2' || level === 'c3' || level === 'c3t') parts.push(boardText(ctx));
  if (extra.includes('effects')) parts.push(effectsText(ctx));
  if (level === 'c3') parts.push(PRIMER_FULL);
  if (level === 'c3t') parts.push(PRIMER_TRIM);
  return parts.join('\n\n');
}
