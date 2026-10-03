// A seated phone in full-game mode: this player's board, hand and table, and every decision the engine asks.
import {AnimatePresence, motion, useAnimate} from 'motion/react';
import {useEffect, useMemo, useRef, useState} from 'react';
import {LOG_DATA, messageText} from '../../../shared/full';
import type {CardModel, Color, FullView, Hover, InputResponse, LogLine, PlayerInputModel, PlayerViewModel, PublicPlayerModel} from '../../../shared/full';
import type {GameState, PlayerState} from '../../../shared/game';
import {PosterCard, summarize} from '../../ui/PosterCard';
import {GameMenuButton, GameMenu} from '../../ui/GameMenu';
import {ReactionsButton} from '../../ui/Reactions';
import {TabBar, TabPanels} from '../../ui/Tabs';
import {GameChip} from '../../ui/GameChip';
import {BotMarkFor} from '../../ui/BotMark';
import {DeadEndNotice} from '../../ui/DeadEndNotice';
import {VersionTag} from '../../ui/VersionTag';
import {TimedNotice, UndoNotice} from '../../ui/UndoNotice';
import {isRewind, questionIdentity, seenOf} from '../../../shared/sync';
import type {ViewVersion} from '../../../shared/sync';
import type {NetError} from '../../net';
import {soloGenerationText, soloStatus, soloVerdict} from '../../../shared/solo';
import {useNet} from '../../net';
import {NudgeButton, useSince} from '../Nudge';
import {PhoneClock} from '../../ui/ClockRing';
import {useTurnClock} from '../../ui/useTurnClock';
import {PLAYER_HEX, RES_COLOR, RES_LABEL, ResIcon} from '../../ui/Icons';
import {Rolling} from '../../ui/Rolling';
import {Sheet} from '../../ui/Sheet';
import {HandDeck, shortfall} from './Cards';
import {BackOut, InputView, PaymentAdjuster, undoMineLine} from './Decide';
import {CardViewer, type CardStatus, type ViewerNav} from '../../ui/deck/Viewer';
import {Piles, type Pile} from '../../ui/deck/Piles';
import {FullHintWorld} from '../../ui/deck/hintWorld';
import {useViewerCovered} from '../../ui/deck/cover';
import type {DeckItem} from '../../ui/deck/Deck';
import {HexBoard} from './Hex';
import {fullHints, NO_HINTS} from '../../../shared/hints';
import {cardSynergies, type Synergy} from '../../../shared/synergy';
import {findCard} from '../../../shared/cards';
import type {Hints} from '../../../shared/hints';
import {HintLine, useHintsOn} from '../../ui/Hints';
import {ProductionShowPhone, useHeldNumber, useShowDisplay, useTilePulse} from './Production';
import {HitStack, NoticeBell, NoticeLayer} from './Notices';
import {LogTab} from './LogTab';
import {DockReplayButton, OnTvPill} from './TvLinks';
import {OtherTable, TableBar} from './TableOf';
import {focusAfter, othersFrom} from './tableFocus';
import {cardDef, groupTableau, isTurnMenu, nameOf, optionKind, playableCards, prod, RES, stock, tagCounts} from './model';
import type {EnginePayment} from '../../../shared/full';
import {useRenderCount} from '../../perf/recorder';
import {dropPlan, planIsReady, usePlanSync} from './plan/store';
import {IntendedChip} from './plan/Tray';
import {PlanNotice} from './plan/PlanNotice';

type Tab = 'hand' | 'table' | 'mars' | 'log';

export function FullPhone({state, me}: {state: GameState; me: PlayerState}) {
  useRenderCount('FullPhone');
  const view = useNet((s) => s.fullView);
  if (!view || view.role !== 'player' || view.playerId !== me.id) {
    return (
      <div style={{height: '100svh', display: 'grid', placeItems: 'center', padding: 24, textAlign: 'center'}}>
        <div>
          <motion.div animate={{rotate: 360}} transition={{duration: 6, repeat: Infinity, ease: 'linear'}}
            style={{width: 64, height: 64, borderRadius: 32, margin: '0 auto 18px', background: 'radial-gradient(circle at 35% 35%, #F08A55, #C1502B 55%, #5A1F12)'}} />
          <div style={{fontWeight: 700, fontSize: 20, fontVariationSettings: "'wdth' 90"}}>Dealing your hand</div>
          <p className="muted">Connecting {state.players.find((p) => p.id === me.id)?.name ?? ''} to the game…</p>
        </div>
      </div>
    );
  }
  return <Seated model={view.model} logs={view.logs ?? []} me={me} state={state} version={view.v} lastMove={view.lastMove ?? null}
    back={view.back ?? null} undoMine={view.undoMine ?? null} />;
}

/** A refusal because the game changed under the answer (an undo, a question that moved on). */
const isStale = (e: unknown) => ['stale', 'undoWindow'].includes((e as NetError).code ?? '');

function Seated({model, logs, me, state, version, lastMove, back, undoMine}: {model: PlayerViewModel; logs: LogLine[]; me: PlayerState; state: GameState;
  version?: ViewVersion; lastMove: {playerId: string; name: string} | null; back: FullView['back']; undoMine: FullView['undoMine']}) {
  useRenderCount('Seated');
  // Only the actions, never the whole store: a bare useNet() re-rendered the whole phone (deck and lifted card view
  // included) on every reaction, hover, narration or clock message.
  const input = useNet((s) => s.input);
  const rewind = useNet((s) => s.rewind);
  const hover = useNet((s) => s.hover);
  const flick = useNet((s) => s.flick);
  const cancelFlick = useNet((s) => s.cancelFlick);
  const [tab, setTab] = useState<Tab>('hand');
  const [open, setOpen] = useState(false);
  const [preselect, setPreselect] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flying, setFlying] = useState<string | null>(null);
  const [lifted, setLifted] = useState<CardModel | null>(null);
  // the hand in the order its deck shows it, for moving between cards in the lifted view
  const [handOrder, setHandOrder] = useState<string[]>([]);
  const payRef = useRef<EnginePayment | null>(null);
  const w = model.waitingFor;
  // Every answer names the view it was made against (this render's model and version); the server refuses it
  // when the game has changed since (an undo), and this phone then shows the new situation with the reason.
  const seen = seenOf(version, model);
  // test handle, like window.__hints: what this phone would send with an answer now
  useEffect(() => { (window as unknown as {__seen: unknown}).__seen = seen; });
  const [stale, setStale] = useState<{at: number; text: string} | null>(null);
  const undoNotice = useNet((s) => s.undoNotice);
  const [closedBy, setClosedBy] = useState<{id: string; line: string} | null>(null);
  const openRef = useRef(false);
  openRef.current = open;
  const staleFirst = !!stale && (!undoNotice || stale.at >= undoNotice.receivedAt);
  const undoReason = undoMine && !undoMine.ok ? undoMine.reason.replace(/, so .*$/, '')
    : lastMove && lastMove.playerId !== me.id ? `${lastMove.name} has already moved` : 'Nothing to undo in this turn yet';
  // after "Choose something else" the turn menu opens again by itself
  const reopenMenu = useRef(false);
  // The production show owns the screen while it plays; a research/draft question opens after it.
  const showing = useShowDisplay((s) => s.active);
  const menu = isTurnMenu(w);
  // Optional questions (e.g. "change your draft pick until everyone has picked") never pop up by themselves.
  const optional = !!w && !menu && !!w.optional;
  const forced = !!w && !menu && !optional;
  const playable = useMemo(() => playableCards(w), [w]);
  // Hand tools: how each hand card works with this player's cards in play (provable from the definitions only).
  const synergies = useMemo(() => {
    const inPlay = model.thisPlayer.tableau.map((c) => findCard(c.name)).filter((d) => !!d);
    const out = new Map<string, Synergy[]>();
    for (const c of model.cardsInHand) {
      const def = findCard(c.name);
      if (!def) continue;
      const s = cardSynergies(def, inPlay, c.calculatedCost);
      if (s.length) out.set(c.name, s);
    }
    return out;
  }, [model.thisPlayer.tableau, model.cardsInHand]);
  // Smart hints: only this player's own model, only when they turned hints on.
  const hintsOn = useHintsOn(state, me.id);
  const hints: Hints = useMemo(() => (hintsOn ? fullHints(model) : NO_HINTS), [hintsOn, model]);
  // Debug handle for tests (like window.__net): what this phone is showing, tied to the model it came from.
  useEffect(() => {
    (window as unknown as {__hints: unknown}).__hints = {on: hintsOn, age: model.game.gameAge, undo: model.game.undoCount, showing, ...hints};
  }, [hints, hintsOn, showing, model.game.gameAge, model.game.undoCount]);
  const active = model.players.find((p) => p.isActive);
  // Each new question decides the sheet: a follow-up (space, draft, research...) opens by itself, the turn
  // menu waits for a tap. The server pushes the next view before it acknowledges an answer, so the sheet is
  // driven by the question, never by the acknowledgement (that closed follow-ups as soon as they appeared).
  // The open question is keyed on its identity (type, title, the cards and options it offers), never on the view's
  // version: another player's move gives this phone a new view (during research gameAge moves with every purchase), and
  // what the player has ticked, stepped or scrolled in their own unchanged question must stay. It starts over when the
  // question changes, when the game went back (an undo, "Choose something else": a rewind), or when the player's own
  // answer brought the same question again (two turn menus alike).
  // private turn planning (plan/): re-checked on every view, kept on this phone only
  usePlanSync(model, state.full?.gameId, me.id);
  const rewinds = useRewinds(model.game);
  const [answered, setAnswered] = useState(0);
  const qid = useMemo(() => questionIdentity(w), [w]);
  const qidRef = useRef(qid);
  qidRef.current = qid;
  /** After an accepted answer: when the question now open looks like the one answered, it is a new one all the same. */
  const answeredFrom = (asked: string) => { if (qidRef.current === asked) setAnswered((n) => n + 1); };
  const wKey = `${qid}:${rewinds}:${answered}`;
  useEffect(() => {
    // Another player's undo took away the question this phone had open: say so under the undo notice.
    const n = useNet.getState().undoNotice;
    if (openRef.current && n && n.playerId !== me.id && Date.now() - n.receivedAt < 3000) {
      setClosedBy({id: n.id, line: forced ? 'Your question changed.' : 'Your open question closed.'});
    }
    setError(null);
    if (reopenMenu.current && isTurnMenu(w)) { reopenMenu.current = false; setOpen(true); setPreselect(undefined); return; }
    // the first action is done and a second one was planned: the menu opens with "Your planned move" on top
    if (isTurnMenu(w) && planIsReady(model)) { setOpen(true); setPreselect(undefined); return; }
    setOpen(forced);
    if (!forced) setPreselect(undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wKey]);

  /** The server refused an answer made against an older game: close what was open and show the new situation. */
  function refused(e: unknown): boolean {
    if (!isStale(e)) return false;
    setOpen(false); setPreselect(undefined);
    setStale({at: Date.now(), text: (e as Error).message});
    navigator.vibrate?.([30, 50, 30]);
    return true;
  }

  const sendHover = (spaceId: string | null, tile: Hover['tile']) => hover({playerId: me.id, color: model.color, spaceId, tile});

  async function submit(r: InputResponse) {
    setBusy(true); setError(null);
    const played = findPlayed(r);
    const asked = qid;
    try {
      if (played) setFlying(played);
      await input(me.id, r, seen);
      answeredFrom(asked);
      navigator.vibrate?.(15);
    } catch (e) {
      setFlying(null);
      if (!refused(e)) setError(cleanError((e as Error).message));
    } finally { setBusy(false); }
  }

  /**
   * Take a move back: 'back' leaves this move's follow-up questions (the game returns to just before it, so the card is in
   * the hand again and the cost refunded; the turn menu opens again), 'undo' takes back the last move together with the
   * bot moves after it. A card flicked to the TV for the move is called back.
   */
  async function takeBack(what: 'back' | 'undo') {
    setBusy(true); setError(null);
    if (what === 'back') { reopenMenu.current = true; dropPlan('You chose something else, so your plan was dropped.'); }
    try {
      await rewind(me.id, what, seen);
      navigator.vibrate?.(15);
      if (what === 'back') {
        const {flicks, cancelledFlicks} = useNet.getState();
        for (const f of flicks) if (f.playerId === me.id && Date.now() - f.at < 60_000 && !cancelledFlicks.includes(f.id)) cancelFlick(f.id, me.id);
        setFlying(null);
      }
    } catch (e) {
      reopenMenu.current = false;
      if (!refused(e)) setError(cleanError((e as Error).message));
    } finally { setBusy(false); }
  }
  const undoMineCtx = undoMine?.ok ? {bots: undoMine.bots, onUndo: () => void takeBack('undo')} : null;

  /** Use a blue card's (or the corporation's) action from the Table tab: the same answer the turn menu's
   *  "Use a card action" option sends. Resolves to an error message, or null once the engine accepted it;
   *  any follow-up question (targets, payment) then opens in the decision sheet as usual. */
  async function useAction(name: string): Promise<string | null> {
    const index = actionOption(w, name);
    if (index < 0) return 'This action is not available right now.';
    setBusy(true); setError(null);
    const asked = qid;
    try {
      await input(me.id, {type: 'or', index, response: {type: 'card', cards: [name]}}, seen);
      answeredFrom(asked);
      navigator.vibrate?.(15);
      return null;
    } catch (e) {
      refused(e);
      return cleanError((e as Error).message);
    } finally { setBusy(false); }
  }

  /** Play from the lifted card: resolves to an error message, or null once the engine accepted it. */
  async function sendPlay(name: string, pay: EnginePayment | null): Promise<string | null> {
    if (!pay) return 'Adjust the payment to cover the cost first.';
    const r = playResponse(w, name, pay);
    if (!r) return 'That card cannot be played right now.';
    setFlying(name);
    // The card leaves the phone now; the TV catches it and waits for the rules to accept it.
    const fid = flick(me.id, name);
    const asked = qid;
    try {
      await input(me.id, r, seen);
      answeredFrom(asked);
      navigator.vibrate?.(15);
      return null;
    } catch (e) {
      setFlying(null);
      cancelFlick(fid, me.id);
      refused(e);
      return cleanError((e as Error).message);
    }
  }

  const hand = model.cardsInHand;
  // whose clock runs changes once a turn; the ticking itself stays inside MyClock
  const clockMine = useNet((s) => s.turnClock?.clock.playerId === me.id);
  const tabs: Array<[Tab, string, number | null]> = [['hand', 'Hand', hand.length], ['table', 'Table', model.thisPlayer.tableau.length], ['mars', 'Mars', null], ['log', 'Log', null]];

  return (
    // the live game the lifted card view counts its hints from (cardHints.ts)
    <FullHintWorld model={model}>
    <div style={{minHeight: '100svh', display: 'flex', flexDirection: 'column',
      // the hint line sits above the dock on your turn: keep the page scrollable clear of it
      paddingBottom: `calc(${(menu && hints.turn.length > 0 ? 136 : 92) + (undoMine?.ok && !open ? 72 : 0)}px + env(safe-area-inset-bottom))`}}>
      <DeadEndNotice />
      <VersionTag />
      {/* the two never stack: the newer one shows (a refusal already names the undo that caused it) */}
      {staleFirst
        ? <TimedNotice at={stale?.at ?? null} text={stale?.text ?? ''} testId="stale-notice" />
        : <UndoNotice meId={me.id} line={closedBy && closedBy.id === undoNotice?.id ? closedBy.line : null} />}
      <PlanNotice />
      <Moments model={model} />
      <ProductionShowPhone playerId={me.id} color={model.color} />
      {/* table sense: hits, cards in and out, gifts (its own store slice; never re-renders the hand) */}
      <NoticeLayer playerId={me.id} decision={open && !!w && !showing} />
      {model.game.phase === 'end' && <Final model={model} state={state} playerId={me.id} />}
      {/* The page under the lifted card view: not painted on iPhones while the view covers it (styles.css). The
          wrapper takes no box (display: contents), so the column layout is unchanged. */}
      <div data-under-viewer style={{display: 'contents'}}>
      <Header model={model} state={state} playerId={me.id} />
      <HitStack playerId={me.id} />
      <div style={{position: 'sticky', top: 0, zIndex: 20, background: 'linear-gradient(180deg, var(--dusk-1) 70%, transparent)'}}>
        <TabBar tabs={tabs.map(([t, label, n]) => ({id: t, label: <>{label}{n !== null && <span className="num" style={{fontSize: 12, marginLeft: 5, opacity: 0.7}}>{n}</span>}</>}))}
          value={tab} onChange={setTab} style={{padding: '8px 20px 10px'}} />
      </div>
      <TabPanels value={tab} style={{padding: '0 16px', flex: 1}} panels={{
        hand: () => (
          <>
            <HandDeck tools={<IntendedChip model={model} myTurn={menu} />} model={model} cards={hand} playable={playable} menu={menu} hints={hints.cards} synergies={synergies} lineAbove={menu && hints.turn.length > 0} openKey={lifted?.name ?? null} onOpen={(c) => { payRef.current = null; setLifted(c); }} onOrder={setHandOrder} />
            <Recent model={model} logs={logs} />
          </>
        ),
        table: () => <Table model={model} w={w} menu={menu} onUseAction={useAction} shown={tab === 'table'} />,
        mars: () => <Mars model={model} />,
        log: () => <LogTab model={model} logs={logs} />,
      }} />

      <Dock model={model} menu={menu} forced={forced} optional={optional ? w : undefined} active={active} state={state} meId={me.id} hints={menu && !showing ? hints.turn : []} onOpen={() => { setPreselect(undefined); setOpen(true); }}
        undoMine={undoMineCtx && !open ? undoMineCtx : null} busy={busy} />
      </div>

      <Sheet open={open && !!w && !showing} onClose={() => { setOpen(false); setPreselect(undefined); sendHover(null, null); }} title={forced ? undefined : 'Your move'} tall
        aside={clockMine ? <MyClock playerId={me.id} /> : undefined}>
        {w && (
          <>
            <AnimatePresence>
              {error && (
                <motion.p role="alert" initial={{opacity: 0, height: 0}} animate={{opacity: 1, height: 'auto'}} exit={{opacity: 0, height: 0}}
                  style={{margin: '0 0 12px', padding: '10px 12px', borderRadius: 12, background: 'rgba(226,80,46,.16)', color: '#FFB39E', fontWeight: 600}}>{error}</motion.p>
              )}
            </AnimatePresence>
            <InputView key={wKey + (preselect ?? '')} input={w} ctx={{model, onHover: sendHover, busy, unusedActions: hints.unusedActions, undoReason, undoMine: undoMineCtx}} onSubmit={submit} preselect={preselect}
              onBack={preselect ? () => { setOpen(false); setPreselect(undefined); } : undefined} />
            {back && !menu && <BackOut what={back.ok ? back.what : null} reason={back.ok ? null : back.reason} busy={busy} onBack={() => { sendHover(null, null); void takeBack('back'); }} />}
          </>
        )}
      </Sheet>
      <LiftedCard model={model} card={lifted} menu={menu} playable={playable} w={w} busy={busy} synergy={lifted ? synergies.get(lifted.name) : undefined}
        onClose={() => setLifted(null)} sendPlay={sendPlay} payRef={payRef}
        nav={lifted && handOrder.includes(lifted.name) ? {index: handOrder.indexOf(lifted.name), count: handOrder.length, go: (d) => {
          const next = hand.find((c) => c.name === handOrder[handOrder.indexOf(lifted.name) + d]);
          if (next) { payRef.current = null; setLifted(next); }
        }, peek: (d) => {
          const c = hand.find((x) => x.name === handOrder[handOrder.indexOf(lifted.name) + d]);
          return c ? {card: cardDef(c.name), cost: playable.get(c.name) ?? c.calculatedCost} : null;
        }} : undefined} />
    </div>
    </FullHintWorld>
  );
}

/** The sheet's turn clock. It ticks on its own, so the clock never re-renders the whole phone (and the deck and
 *  lifted card view with it) a few times a second. */
function MyClock({playerId}: {playerId: string}) {
  const live = useTurnClock();
  return live && live.clock.playerId === playerId ? <PhoneClock live={live} compact /> : null;
}

/**
 * How many times this phone has seen the game go back (an undo, a move taken back): the engine's undoCount changed or its
 * gameAge fell between two views. Kept as state from the previous render (React's derived-state pattern).
 */
function useRewinds(game: {gameAge: number; undoCount: number}): number {
  const [seen, setSeen] = useState({n: 0, gameAge: game.gameAge, undoCount: game.undoCount});
  if (seen.gameAge !== game.gameAge || seen.undoCount !== game.undoCount) {
    const next = {n: seen.n + (isRewind(seen, game) ? 1 : 0), gameAge: game.gameAge, undoCount: game.undoCount};
    setSeen(next);
    return next.n;
  }
  return seen.n;
}

function findPlayed(r: InputResponse): string | null {
  if (r.type === 'projectCard') return r.card;
  if (r.type === 'or') return findPlayed(r.response);
  return null;
}

function cleanError(raw: string): string {
  try { const j = JSON.parse(raw); return j.message ?? raw; } catch { return raw.replace(/^Error:\s*/, ''); }
}

// ---- header: the player board ----------------------------------------------------------------
function Header({model, state, playerId}: {model: PlayerViewModel; state: GameState; playerId: string}) {
  const me = model.thisPlayer;
  const g = model.game;
  const corp = me.tableau[0]?.name;
  // Solo: the engine's generation limit is the clock the player plays against.
  const solo = soloStatus(model.players.length, g);
  return (
    <header style={{padding: 'calc(12px + env(safe-area-inset-top)) 16px 4px'}}>
      <div style={{display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10}}>
        <span style={{width: 12, height: 12, borderRadius: 3, background: PLAYER_HEX[model.color]}} />
        <div style={{flex: 1, minWidth: 0}}>
          <div style={{fontWeight: 750, fontSize: 18, fontVariationSettings: "'wdth' 86", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{corp ?? me.name}</div>
          <div style={{display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 8, rowGap: 4, minWidth: 0}}>
            {/* the generation number never truncates; on narrow phones the game chip wraps onto its own line rather than
                running under the TR block; the phase after it gives way to the game chip first */}
            <span className="faint" data-testid="generation" style={{fontSize: 12.5, flex: 'none', whiteSpace: 'nowrap'}}>{solo ? soloGenerationText(solo) : `Generation ${g.generation}`}</span>
            <span className="faint" style={{fontSize: 12.5, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0, flex: '0 100 auto', marginLeft: -4}}>· {phaseText(model)}</span>
            <span style={{minWidth: 30, maxWidth: '100%', flex: '0 1 auto', display: 'flex'}}>
              <GameChip state={state} generation={g.generation}
                seats={state.order.map((id) => state.players.find((p) => p.id === id)).filter((p) => !!p).map((p) => {
                  const seat = state.full?.players[p!.id];
                  const pm = seat ? model.players.find((x) => x.color === seat.color) : undefined;
                  return {name: p!.name, color: seat?.color ?? p!.color, corporation: pm?.tableau[0]?.name ?? null};
                })} />
            </span>
          </div>
        </div>
        <div aria-label={`Terraform rating ${me.terraformRating}`} style={{position: 'relative', width: 56, height: 56, flex: 'none', display: 'grid', placeItems: 'center'}}>
          <svg viewBox="0 0 70 70" width="56" height="56" style={{position: 'absolute', inset: 0}}><path d="M35 4 62 19.5v31L35 66 8 50.5v-31z" fill="rgba(111,184,232,.14)" stroke="var(--tr)" strokeWidth="2.4" /></svg>
          <span style={{position: 'relative', textAlign: 'center'}}>
            <Rolling value={me.terraformRating} className="num" style={{fontSize: 21}} />
            <div className="cond" style={{fontSize: 10, color: 'var(--tr)', marginTop: -1}}>TR</div>
          </span>
        </div>
        <NoticeBell />
        <ReactionsButton playerId={playerId} />
        <GameMenuButton state={state} playerId={playerId} />
      </div>
      {/* equal columns unless a long number needs more: a column then widens only as far as its content asks */}
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, minmax(min-content, 1fr))', gap: 5, containerType: 'inline-size'}}>
        {RES.map((r, i) => <ResTile key={r} r={r} p={me} i={i} />)}
      </div>
    </header>
  );
}

/** Is the table choosing cards? In generation 1 the engine keeps reporting 'research' after setup, while the first
 *  player acts (always so when everyone plays the Beginner Corporation). Setup is over once every player has a
 *  corporation on the table; `needsToResearch` cannot tell, because the engine resets it for everyone. */
function choosingCards(model: PlayerViewModel): boolean {
  const ph = model.game.phase;
  if (ph === 'drafting') return true;
  if (ph !== 'research') return false;
  return model.game.generation > 1 || model.players.some((p) => p.tableau.length === 0);
}

function phaseText(model: PlayerViewModel) {
  const p = model.game.phase === 'research' && !choosingCards(model) ? 'action' : model.game.phase;
  return ({research: 'Research', drafting: 'Draft', action: 'Actions', production: 'Production', end: 'Game over'} as Record<string, string>)[p] ?? p;
}

function ResTile({r, p, i}: {r: typeof RES[number]; p: PublicPlayerModel; i: number}) {
  const n = prod(p, r);
  // During the production show the number holds at the pre-production value and ticks up as tokens land.
  const held = useHeldNumber(r);
  const pulse = useTilePulse(r);
  const [scope, animate] = useAnimate();
  useEffect(() => {
    if (pulse && scope.current) animate(scope.current, {scale: [1.2, 1]}, {type: 'spring', stiffness: 520, damping: 13});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);
  const sign = n > 0 ? '+' : n < 0 ? '\u2212' : '';
  // a negative M€ production reads as a warning; zero production fades back
  const ink = n < 0 ? 'var(--ember)' : RES_COLOR[r];
  // A long stock beside a long production (128 and -5, 104 and +12) shrinks the chip a little on narrow phones only.
  const digits = String(Math.abs(held ?? stock(p, r))).length;
  const crowded = digits + `${sign}${Math.abs(n)}`.length >= (digits >= 3 ? 5 : 6);
  return (
    <motion.div data-res-tile={r} initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} transition={{delay: i * 0.03}}
      style={{position: 'relative', overflow: 'hidden', borderRadius: 12, padding: '5px 6px 4px',
        background: `linear-gradient(160deg, color-mix(in oklab, ${RES_COLOR[r]} 15%, var(--dusk-2)), var(--dusk-1))`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${RES_COLOR[r]} 30%, transparent)`}}>
      {pulse > 0 && (
        <motion.div key={pulse} initial={{opacity: 0.85, scale: 0.6}} animate={{opacity: 0, scale: 1.4}} transition={{duration: 0.5, ease: 'easeOut'}}
          style={{position: 'absolute', inset: 0, borderRadius: 12, background: `radial-gradient(60% 60% at 50% 62%, color-mix(in oklab, ${RES_COLOR[r]} 70%, transparent), transparent 70%)`}} />
      )}
      <div style={{position: 'relative', display: 'flex', alignItems: 'center', gap: 4, height: 14}}>
        <ResIcon r={r} size={14} />
        <span className="cond" style={{fontSize: 12, lineHeight: 1, color: 'var(--ice-dim)', whiteSpace: 'nowrap'}}>{RES_LABEL[r]}</span>
      </div>
      {/* the stock and its production side by side; the number's line box is trimmed to the digits' height */}
      <div style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: crowded ? 3 : 5, marginTop: 1}}>
        <div ref={scope} style={{transformOrigin: 'left center', margin: '-3px 0 -4px'}}>
          <Rolling value={held ?? stock(p, r)} className="num" style={{fontSize: 27}} showDelta={held === undefined} deltaTop="0.32em" />
        </div>
        <span className="num" data-res-prod={r} aria-label={`production ${n}`}
          style={{flex: 'none', fontSize: crowded ? 'clamp(13px, 3.9cqw, 15.5px)' : 15.5, padding: crowded ? '3px 3.5px 2px' : '3px 6px 2px', borderRadius: 7, whiteSpace: 'nowrap', color: ink,
            background: n === 0 ? 'transparent' : `color-mix(in oklab, ${ink} 18%, transparent)`,
            boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${ink} ${n === 0 ? 22 : 45}%, transparent)`, opacity: n === 0 ? 0.45 : 1}}>
          {sign}{Math.abs(n)}
        </span>
      </div>
    </motion.div>
  );
}

// ---- dock ------------------------------------------------------------------------------------
function Dock({model, menu, forced, optional, active, state, meId, hints, onOpen, undoMine, busy}: {model: PlayerViewModel; menu: boolean; forced: boolean; optional?: PlayerInputModel;
  active?: PublicPlayerModel; state: GameState; meId: string; hints: Hints['turn']; onOpen: () => void;
  /** only bots moved since this player's last move: take it back with theirs */
  undoMine?: {bots: number; onUndo: () => void} | null; busy?: boolean}) {
  const passed = model.game.passedPlayers.includes(model.color);
  // "Your move" appears at once but lets go only after the turn has really moved on: while a move is processed a
  // refresh can briefly show no question, and the button would otherwise blink to "Waiting" and back.
  const go = useHeld(menu || forced, 600);
  const live = useTurnClock();
  // under the open lifted card view the dock's pulses hold still
  const still = useViewerCovered();
  const pulse = (a: Record<string, number[]>, t: {duration: number}) => (still
    ? {animate: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, v[0]])), transition: {duration: 0}}
    : {animate: a, transition: {...t, repeat: Infinity}});
  const mine = live && live.clock.playerId === meId ? live : null;
  // a TV at the table: the waiting row keeps room at both ends for "Show last move on the TV"
  const tvLink = useNet((s) => s.tvs > 0);
  // Anyone may nudge the active player once they have been deciding a while; any move resets the clock.
  const since = useSince(`${active?.color ?? ''}:${model.game.gameAge}:${model.game.undoCount}`);
  const target = active && active.color !== model.color ? state.players.find((p) => p.color === active.color) : undefined;
  const others = choosingCards(model)
    ? 'Others are choosing cards'
    : active && active.color !== model.color ? `${active.name} is playing` : passed ? 'You passed. Waiting for the others' : 'Waiting for the table';
  return (
    <div style={{position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30, padding: '12px 14px calc(14px + env(safe-area-inset-bottom))',
      background: 'linear-gradient(180deg, transparent, rgba(20,9,6,.94) 35%)'}}>
      {menu && hints.length > 0 && <HintLine hints={hints} rightInset={mine ? 104 : 0} />}
      {/* "On the TV now": the card this player just played, while the TV presents it (left of the clock chip) */}
      <OnTvPill color={model.color} />
      <AnimatePresence>
        {undoMine && (
          <motion.button key="undo-mine" data-testid="dock-undo-mine" disabled={busy} onClick={undoMine.onUndo}
            initial={{opacity: 0, y: 8}} animate={{opacity: 1, y: 0}} exit={{opacity: 0, y: 8}} transition={{type: 'spring', stiffness: 360, damping: 28}}
            style={{display: 'flex', alignItems: 'center', gap: 10, width: mine && (menu || forced) ? 'calc(100% - 112px)' : '100%', marginBottom: 8, padding: '8px 14px', borderRadius: 14, textAlign: 'left',
              background: 'rgba(30,14,10,.94)', backdropFilter: 'blur(10px)', boxShadow: 'inset 0 0 0 1.5px var(--rim-strong)'}}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden style={{flex: 'none', color: 'var(--ice-dim)'}}><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            <span style={{flex: 1, minWidth: 0}}>
              <span style={{display: 'block', fontWeight: 650, fontSize: 15.5}}>Undo my last move</span>
              <span className="muted" style={{display: 'block', fontSize: 12.5}}>{undoMineLine(undoMine.bots)}</span>
            </span>
          </motion.button>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {mine && (menu || forced) && (
          <motion.div key="clock" initial={{opacity: 0, y: 8, scale: 0.92}} animate={{opacity: 1, y: 0, scale: 1}} exit={{opacity: 0, y: 8}}
            transition={{type: 'spring', stiffness: 360, damping: 26}}
            style={{position: 'absolute', right: 16, top: -34, padding: '5px 12px 5px 6px', borderRadius: 999, background: 'rgba(30,14,10,.94)',
              backdropFilter: 'blur(10px)', boxShadow: 'inset 0 0 0 1px var(--rim-strong), 0 6px 18px rgba(0,0,0,.35)'}}>
            <PhoneClock live={mine} compact />
          </motion.div>
        )}
      </AnimatePresence>
      {/* popLayout: the new state comes in while the old one leaves (pinned in place), so the dock is never empty for a
          frame between them; "wait" left one dark frame on every turn change */}
      <AnimatePresence mode="popLayout" initial={false}>
        {go ? (
          <motion.button key="go" data-testid="dock-go" className="btn warm" onClick={onOpen} initial={{y: 30, opacity: 0}} animate={{y: 0, opacity: 1}} exit={{y: 30, opacity: 0}}
            transition={{type: 'spring', stiffness: 320, damping: 26}} style={{width: '100%', minHeight: 58, fontSize: 19}}>
            <motion.span {...pulse({scale: [1, 1.25, 1]}, {duration: 1.6})} style={{width: 9, height: 9, borderRadius: 5, background: '#2A1A04'}} />
            {forced ? 'Answer the question' : model.thisPlayer.actionsTakenThisRound ? 'Your move · one more action' : 'Your move'}
          </motion.button>
        ) : optional ? (
          <motion.div key="optional" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} role="status"
            style={{display: 'flex', alignItems: 'center', gap: 10, minHeight: 58, padding: '0 8px 0 16px', borderRadius: 16, background: 'rgba(30,14,10,.94)', backdropFilter: 'blur(10px)', boxShadow: 'inset 0 0 0 1.5px var(--rim)', color: 'var(--ice-dim)', fontWeight: 600}}>
            <motion.span {...pulse({opacity: [0.3, 1, 0.3]}, {duration: 2.2})} style={{width: 9, height: 9, borderRadius: 5, background: 'var(--ice-faint)'}} />
            <span style={{flex: 1}}>Waiting for the others</span>
            <button data-testid="dock-optional" className="btn ghost" style={{minHeight: 42, padding: '0 14px', fontSize: 15}} onClick={onOpen}>
              {/select|pick|card/i.test(messageText(optional.title)) ? 'Change your pick' : optional.buttonLabel || 'Change'}
            </button>
          </motion.div>
        ) : (
          <motion.div key="wait" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}} role="status"
            style={{position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 58, borderRadius: 16, padding: tvLink ? '0 54px' : undefined, background: 'rgba(30,14,10,.94)', backdropFilter: 'blur(10px)', boxShadow: 'inset 0 0 0 1.5px var(--rim)', color: 'var(--ice-dim)', fontWeight: 600}}>
            <motion.span {...pulse({opacity: [0.3, 1, 0.3]}, {duration: 2.2})}
              style={{width: 9, height: 9, borderRadius: 5, background: active ? PLAYER_HEX[active.color] : 'var(--ice-faint)'}} />
            {others}
            {target && <NudgeButton from={meId} to={target.id} toName={target.name} toColor={target.color} since={since}
              overTime={!!live && live.clock.playerId === target.id && live.reading.overTime} />}
            {/* "Show last move on the TV": discreet, at the row's end */}
            <span style={{position: 'absolute', right: 9}}><DockReplayButton /></span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// ---- lifted card -----------------------------------------------------------------------------
function playOption(w: PlayerInputModel | undefined, name: string): number {
  if (!w || w.type !== 'or') return -1;
  return (w.options as PlayerInputModel[]).findIndex((o) => o.type === 'projectCard' && optionKind(o) === 'play' &&
    (o as {cards: CardModel[]}).cards.some((c) => c.name === name && !c.isDisabled));
}

/** Index of the turn menu's "use a card action" option when it offers this card's action now, else -1. */
function actionOption(w: PlayerInputModel | undefined, name: string): number {
  if (!w || w.type !== 'or') return -1;
  return (w.options as PlayerInputModel[]).findIndex((o) => optionKind(o) === 'action' &&
    ((o as {cards?: CardModel[]}).cards ?? []).some((c) => c.name === name && !c.isDisabled));
}

function playResponse(w: PlayerInputModel | undefined, name: string, pay: EnginePayment): InputResponse | null {
  const index = playOption(w, name);
  return index < 0 ? null : {type: 'or', index, response: {type: 'projectCard', card: name, payment: pay}};
}

function LiftedCard({model, card, menu, playable, w, busy, onClose, sendPlay, payRef, synergy, nav}: {
  model: PlayerViewModel; card: CardModel | null; menu: boolean; playable: Map<string, number>; w: PlayerInputModel | undefined; busy: boolean;
  synergy?: Synergy[]; nav?: ViewerNav;
  onClose: () => void; sendPlay: (name: string, pay: EnginePayment | null) => Promise<string | null>; payRef: React.MutableRefObject<EnginePayment | null>;
}) {
  const def = card ? cardDef(card.name) : null;
  const can = !!card && menu && playable.has(card.name);
  const opt = card ? playOption(w, card.name) : -1;
  const heat = opt >= 0 && !!((w as {options: Array<{paymentOptions?: {heat?: boolean}}>}).options[opt].paymentOptions?.heat);
  const cost = card ? playable.get(card.name) ?? card.calculatedCost : undefined;
  const short = card ? shortfall(model, card) : 0;
  const why = !card || can ? undefined : !menu ? 'You can play cards on your turn.' : short > 0 ? `${short} M€ short of playing this.` : 'Its requirements are not met yet.';
  const note = why || synergy?.length ? (
    <>
      {why && <div>{why}</div>}
      {synergy?.length ? <SynergyNote items={synergy} /> : null}
    </>
  ) : undefined;
  return (
    <CardViewer card={def} cost={cost} layoutId={card ? `hand-${card.name}` : undefined} onClose={onClose}
      canPlay={can} swipePlay={card ? () => sendPlay(card.name, payRef.current) : undefined} note={note} backLabel="Back to your hand" nav={nav}>
      {can && card && def ? (fly) => (
        <PaymentAdjuster model={model} cost={cost ?? 0} steel={def.tags.includes('building')} titanium={def.tags.includes('space')} heat={heat}
          label={`Play ${def.name}`} busy={busy} onChange={(p) => { payRef.current = p; }}
          onPay={(p) => { payRef.current = p; void fly(() => sendPlay(card.name, p)); }} />
      ) : undefined}
    </CardViewer>
  );
}

// ---- table -----------------------------------------------------------------------------------
function Table({model, w, menu, onUseAction, shown}: {model: PlayerViewModel; w: PlayerInputModel | undefined; menu: boolean;
  onUseAction: (name: string) => Promise<string | null>; shown: boolean}) {
  const me = model.thisPlayer;
  // Whose table is shown: null is mine. Back to mine when I leave the tab or my turn starts (never act while
  // looking at someone else's table).
  const [focus, setFocus] = useState<Color | null>(null);
  const myTurn = !!w && (menu || !w.optional);
  const others = othersFrom(model.players, model.color);
  useEffect(() => { setFocus((f) => focusAfter(f, {tableShown: shown, turnStarted: myTurn, colors: others.map((p) => p.color)})); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [shown, myTurn]);
  const focused = focus ? others.find((p) => p.color === focus) : undefined;
  const g = groupTableau(me.tableau);
  const used = new Set(me.actionsThisGeneration);
  const tags = tagCounts(me);
  const [lifted, setLifted] = useState<{pile: string; card: CardModel} | null>(null);
  const item = (c: CardModel, ready?: boolean): DeckItem => {
    const def = cardDef(c.name);
    const action = def.text.some((t) => /^Action:/i.test(t));
    return {key: c.name, card: def, resources: c.resources, glow: ready ? 'ready' : undefined, dim: action && used.has(c.name),
      note: action ? (used.has(c.name) ? <span className="faint">Action used this generation</span> : <span style={{color: '#6FB8E8', fontWeight: 650}}>Action ready</span>) : undefined};
  };
  const hasAction = (c: CardModel) => cardDef(c.name).text.some((t) => /^Action:/i.test(t));
  // The engine decides what is usable: only actions its turn menu offers right now get the button.
  const usable = (c: CardModel) => menu && actionOption(w, c.name) >= 0;
  const actionNote = (c: CardModel) => used.has(c.name) ? 'Its action is used for this generation.'
    : !menu ? 'You can use its action on your turn.'
      : 'Its action is not available right now: its cost or condition is not met.';
  const status = (c: CardModel): CardStatus | undefined => (hasAction(c) ? (used.has(c.name) ? 'used' : 'ready') : undefined);
  const readyIn = (cs: CardModel[]) => cs.filter((c) => hasAction(c) && !used.has(c.name)).length;
  const piles: Pile[] = [
    {key: 'corp', label: 'Corporation', items: g.corporation.map((c) => item(c, hasAction(c) && !used.has(c.name))), ready: readyIn(g.corporation)},
    {key: 'prelude', label: 'Preludes', items: g.prelude.map((c) => item(c))},
    {key: 'active', label: 'Active', items: g.active.map((c) => item(c, hasAction(c) && !used.has(c.name))), ready: readyIn(g.active)},
    {key: 'automated', label: 'Automated', items: [...g.automated, ...g.other].map((c) => item(c))},
    {key: 'events', label: 'Events', items: g.event.map((c) => item(c)), faceDown: true},
  ];
  const all = [...g.corporation, ...g.prelude, ...g.active, ...g.automated, ...g.other, ...g.event];
  // moving between cards of the opened pile in the lifted view
  const pileKeys = lifted ? piles.find((p) => p.key === lifted.pile)?.items.map((i) => i.key) ?? [] : [];
  const pileNav: ViewerNav | undefined = lifted && pileKeys.length > 1 ? {index: pileKeys.indexOf(lifted.card.name), count: pileKeys.length, go: (d) => {
    const c = all.find((x) => x.name === pileKeys[pileKeys.indexOf(lifted.card.name) + d]);
    if (c) setLifted({pile: lifted.pile, card: c});
  }, peek: (d) => {
    const c = all.find((x) => x.name === pileKeys[pileKeys.indexOf(lifted.card.name) + d]);
    return c ? {card: cardDef(c.name), resources: c.resources, status: status(c)} : null;
  }} : undefined;
  return (
    <div className="tm-table" style={{position: 'relative'}}>
      {/* one row: whose table (a menu of every seat) and that player's tags */}
      <TableBar me={me} others={others} focus={focused ? focus : null} onPick={setFocus} tags={focused ? tagCounts(focused) : tags} />
      {focused && <OtherTable key={focused.color} p={focused} passed={model.game.passedPlayers.includes(focused.color)} />}
      {/* my table stays mounted while I look at another one, so coming back never re-decodes card art */}
      <div data-testid="my-table" aria-hidden={focused ? true : undefined}
        style={focused ? {position: 'absolute', left: 0, right: 0, top: 0, height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none'} : undefined}>
      <Piles piles={piles} openKey={lifted?.card.name ?? null}
        onOpen={(pile, k) => { const c = all.find((x) => x.name === k); if (c) setLifted({pile, card: c}); }} />
      <h3 className="cond" style={{margin: '26px 2px 8px', fontWeight: 600, color: 'var(--ice-dim)', fontSize: 15}}>Around the table</h3>
      <div style={{display: 'grid', gap: 8}}>
        {model.players.filter((p) => p.color !== model.color).map((p) => <Rival key={p.color} p={p} passed={model.game.passedPlayers.includes(p.color)} />)}
      </div>
      </div>
      <CardViewer card={lifted ? cardDef(lifted.card.name) : null} resources={lifted?.card.resources} status={lifted ? status(lifted.card) : undefined} layoutId={lifted ? `pile-${lifted.pile}-${lifted.card.name}` : undefined}
        onClose={() => setLifted(null)} nav={pileNav}
        note={lifted && hasAction(lifted.card) && !usable(lifted.card) ? actionNote(lifted.card) : undefined}>
        {lifted && usable(lifted.card) ? () => (
          <UseActionButton name={lifted.card.name} onUse={async () => {
            const err = await onUseAction(lifted.card.name);
            if (!err) setLifted(null);
            return err;
          }} />
        ) : undefined}
      </CardViewer>
    </div>
  );
}

/** Why a hand card works with what is already in play: one line per reason, in the synergy marker's colour. */
function SynergyNote({items}: {items: Synergy[]}) {
  return (
    <div data-testid="synergy-note" style={{display: 'grid', gap: 5, margin: '6px auto 0', maxWidth: 340, textAlign: 'left'}}>
      {items.map((x, i) => (
        <motion.div key={x.kind + x.source} initial={{opacity: 0, y: 6}} animate={{opacity: 1, y: 0}} transition={{delay: 0.15 + i * 0.06}}
          style={{display: 'flex', gap: 8, alignItems: 'flex-start', padding: '7px 10px', borderRadius: 12, background: 'rgba(18,40,34,.7)',
            boxShadow: 'inset 0 0 0 1px rgba(127,209,185,.35)', color: 'var(--ice)', fontSize: 14}}>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true" style={{flex: 'none', marginTop: 3}}><circle cx="5.6" cy="8" r="3.6" fill="none" stroke="#7FD1B9" strokeWidth="1.8" />
            <circle cx="10.4" cy="8" r="3.6" fill="none" stroke="#7FD1B9" strokeWidth="1.8" /></svg>
          <span>{x.reason}</span>
        </motion.div>
      ))}
    </div>
  );
}

function UseActionButton({name, onUse}: {name: string; onUse: () => Promise<string | null>}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <motion.button className="btn warm" style={{width: '100%'}} disabled={busy} whileTap={{scale: 0.97}} data-testid="use-action"
        onClick={async () => { setBusy(true); setError(null); const e = await onUse(); setBusy(false); if (e) setError(e); }}>
        {busy ? 'Using…' : `Use ${name}`}
      </motion.button>
      {error && <p role="alert" style={{color: 'var(--ember)', margin: '8px 2px 0', fontSize: 14.5}}>{error}</p>}
    </div>
  );
}

function Rival({p, passed}: {p: PublicPlayerModel; passed: boolean}) {
  return (
    <div style={{padding: '10px 12px', borderRadius: 14, background: 'rgba(255,255,255,.04)', boxShadow: `inset 3px 0 0 ${PLAYER_HEX[p.color]}`, opacity: passed ? 0.6 : 1}}>
      <div style={{display: 'flex', alignItems: 'baseline', gap: 8}}>
        <span style={{fontWeight: 700, flex: 1}}>{p.name}<BotMarkFor color={p.color} />{p.isActive && <span style={{color: 'var(--mc)', fontSize: 13}}> · playing</span>}{passed && <span className="faint" style={{fontSize: 13}}> · passed</span>}</span>
        <span className="faint" style={{fontSize: 13}}>{p.cardsInHandNbr} in hand</span>
        <span className="num" style={{color: 'var(--tr)', fontSize: 18}}>{p.terraformRating}</span>
      </div>
      <div style={{display: 'flex', justifyContent: 'space-between', marginTop: 6}}>
        {RES.map((r) => (
          <span key={r} style={{display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 13}}>
            <ResIcon r={r} size={14} /><span className="num">{stock(p, r)}</span><span className="faint">/{prod(p, r)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ---- mars ------------------------------------------------------------------------------------
function Mars({model}: {model: PlayerViewModel}) {
  const g = model.game;
  const hovers = useNet((s) => s.hovers);
  const items = [
    {label: 'Temperature', v: g.temperature, unit: '°C', pct: (g.temperature + 30) / 38, c: 'linear-gradient(90deg, #6FB8E8, #F0643A)'},
    {label: 'Oxygen', v: g.oxygenLevel, unit: '%', pct: g.oxygenLevel / 14, c: 'var(--plants)'},
    {label: 'Oceans', v: g.oceans, unit: '/9', pct: g.oceans / 9, c: 'var(--ocean)'},
  ];
  return (
    <div>
      <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 12}}>
        {items.map((it) => (
          <div key={it.label} style={{padding: '8px 10px', borderRadius: 12, background: 'rgba(255,255,255,.04)'}}>
            <div className="cond faint" style={{fontSize: 12}}>{it.label}</div>
            <div><Rolling value={it.v} className="num" style={{fontSize: 22}} /><span className="faint" style={{fontSize: 12}}> {it.unit}</span></div>
            <div style={{height: 4, borderRadius: 2, background: 'rgba(255,255,255,.08)', marginTop: 6, overflow: 'hidden'}}>
              <motion.div initial={false} animate={{width: `${Math.max(0, Math.min(1, it.pct)) * 100}%`}} style={{height: '100%', background: it.c}} />
            </div>
          </div>
        ))}
      </div>
      <div style={{borderRadius: 18, padding: 6, background: 'radial-gradient(90% 80% at 50% 40%, #3A1B12, #1A0D0A)'}}>
        <HexBoard spaces={g.spaces} hovers={Object.values(hovers).filter((h) => h.color !== model.color)} />
      </div>
      <h3 className="cond" style={{margin: '18px 2px 8px', fontWeight: 600, color: 'var(--ice-dim)', fontSize: 15}}>Milestones and awards</h3>
      <div style={{display: 'grid', gap: 4, fontSize: 14.5}}>
        {[...g.milestones.map((m) => ({...m, kind: 'Milestone'})), ...g.awards.map((a) => ({...a, kind: 'Award'}))].map((m) => {
          const mine = m.scores.find((s) => s.color === model.color)?.score;
          return (
            <div key={m.kind + m.name} style={{display: 'flex', gap: 8, padding: '6px 2px', borderBottom: '1px solid var(--rim)'}}>
              <span style={{flex: 1, color: m.color ? PLAYER_HEX[m.color] : 'var(--ice)'}}>{m.name}</span>
              <span className="faint">{m.color ? `${m.kind === 'Award' ? 'funded' : 'claimed'} by ${m.playerName ?? nameOf(model, m.color)}` : `you: ${mine ?? 0}`}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- log -------------------------------------------------------------------------------------
function logText(model: PlayerViewModel, l: LogLine): {text: string; color?: string} {
  let color: string | undefined;
  const text = l.message.replace(/\$\{(\d+)\}/g, (_, i) => {
    const d = l.data[Number(i)];
    if (!d) return '';
    // The engine sends card lists (type 14) as arrays despite the declared string type.
    const v = d.value as unknown;
    if (Array.isArray(v)) return v.join(', ');
    if (d.type === LOG_DATA.PLAYER) { color ??= String(v); return nameOf(model, v as PublicPlayerModel['color']); }
    return d.type === LOG_DATA.CARDS ? String(v).split(',').join(', ') : String(v);
  });
  return {text, color};
}

// ---- moments ---------------------------------------------------------------------------------
function Moments({model}: {model: PlayerViewModel}) {
  // "Your turn" fires when this player becomes the active player in the action phase, not whenever the
  // turn menu reappears (it comes back after every follow-up question).
  const myTurn = model.game.phase === 'action' && model.thisPlayer.isActive;
  const gen = model.game.generation;
  const ended = model.game.phase === 'end';
  const prevTurn = useRef(myTurn);
  const prevGen = useRef(gen);
  const [m, setM] = useState<{k: number; text: string; color: string} | null>(null);
  useEffect(() => {
    let next: typeof m = null;
    // A new generation is announced by the production show (Production.tsx).
    if (myTurn && !prevTurn.current && gen === prevGen.current) next = {k: Date.now(), text: 'Your turn', color: 'var(--tr)'};
    prevTurn.current = myTurn; prevGen.current = gen;
    if (!next || ended) return;
    setM(next);
    navigator.vibrate?.(50);
  }, [myTurn, gen, ended]);
  // Clear each moment on its own timer; a later model change must not cancel it (it once stuck on screen).
  useEffect(() => {
    if (!m) return;
    const t = setTimeout(() => setM(null), 1600);
    return () => clearTimeout(t);
  }, [m]);
  useEffect(() => { if (ended) setM(null); }, [ended]);
  return (
    <AnimatePresence>
      {m && (
        <motion.div key={m.k} role="status" aria-live="polite" initial={{opacity: 0}} animate={{opacity: 1}} exit={{opacity: 0}}
          style={{position: 'fixed', inset: 0, zIndex: 80, pointerEvents: 'none', display: 'grid', placeItems: 'center',
            background: `radial-gradient(60% 40% at 50% 45%, color-mix(in oklab, ${m.color} 30%, transparent), transparent 70%)`}}>
          <motion.div initial={{scale: 0.6, opacity: 0, letterSpacing: '0.3em'}} animate={{scale: 1, opacity: 1, letterSpacing: '0em'}} exit={{scale: 1.15, opacity: 0}}
            transition={{type: 'spring', stiffness: 260, damping: 20}}
            style={{fontSize: 52, fontWeight: 850, fontVariationSettings: "'wdth' 120", color: m.color, textShadow: '0 4px 30px rgba(0,0,0,.6)'}}>{m.text}</motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ---- recent events under the hand ------------------------------------------------------------
function Recent({model, logs}: {model: PlayerViewModel; logs: LogLine[]}) {
  const lines = logs.filter((l) => l.type !== 1).slice(-4).reverse();
  if (!lines.length) return null;
  return (
    <div style={{marginTop: 22}}>
      <h3 className="cond" style={{margin: '0 2px 6px', fontWeight: 600, color: 'var(--ice-dim)', fontSize: 15}}>Just now</h3>
      <AnimatePresence initial={false}>
        {lines.map((l, i) => {
          const {text, color} = logText(model, l);
          return (
            <motion.div key={`${l.timestamp}-${l.message}-${i}`} layout initial={{opacity: 0, x: -14}} animate={{opacity: 1 - i * 0.18, x: 0}} exit={{opacity: 0}}
              style={{padding: '6px 0 6px 10px', borderLeft: `3px solid ${color ? PLAYER_HEX[color] : 'var(--rim)'}`, fontSize: 14.5, marginBottom: 2}}>
              {text}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

// ---- final score -----------------------------------------------------------------------------
function Final({model, state, playerId}: {model: PlayerViewModel; state: GameState; playerId: string}) {
  const rows = [...model.players].map((p) => ({p, v: p.victoryPointsBreakdown})).sort((a, b) => (b.v?.total ?? 0) - (a.v?.total ?? 0));
  const cols: Array<[string, keyof NonNullable<PublicPlayerModel['victoryPointsBreakdown']>]> = [
    ['TR', 'terraformRating'], ['Milestones', 'milestones'], ['Awards', 'awards'], ['Greenery', 'greenery'], ['Cities', 'city'], ['Cards', 'victoryPoints'],
  ];
  const solo = soloStatus(model.players.length, model.game);
  const verdict = solo ? soloVerdict(solo) : null;
  return (
    <motion.div data-testid="final-score" initial={{opacity: 0}} animate={{opacity: 1}} transition={{duration: 0.8}}
      style={{position: 'fixed', inset: 0, zIndex: 70, overflowY: 'auto', padding: 'calc(28px + env(safe-area-inset-top)) 18px 40px',
        background: 'radial-gradient(120% 70% at 50% 0%, #2F4A3A, var(--dusk-1) 70%)'}}>
      <div style={{position: 'absolute', top: 'calc(14px + env(safe-area-inset-top))', right: 16}}><ReactionsButton playerId={playerId} /></div>
      <h1 style={{margin: '0 0 4px', fontSize: 40, fontWeight: 850, fontVariationSettings: "'wdth' 118"}}>{verdict?.title ?? 'Mars is alive'}</h1>
      {verdict && <p data-testid="solo-result" data-result={solo!.result} style={{margin: '0 0 6px', fontWeight: 650, fontSize: 17, color: solo!.result === 'won' ? 'var(--plants)' : 'var(--mc)'}}>{verdict.line}</p>}
      <p className="muted" style={{margin: '0 0 22px'}}>Final score after generation {model.game.generation}.</p>
      <div style={{display: 'grid', gap: 12}}>
        {rows.map(({p, v}, i) => (
          <motion.div key={p.color} initial={{opacity: 0, y: 24}} animate={{opacity: 1, y: 0}} transition={{delay: 0.3 + (rows.length - i) * 0.35, type: 'spring', stiffness: 120}}
            style={{padding: '14px 16px', borderRadius: 18, background: 'rgba(0,0,0,.3)', boxShadow: `inset 4px 0 0 ${PLAYER_HEX[p.color]}`}}>
            <div style={{display: 'flex', alignItems: 'baseline', gap: 10}}>
              {!solo && <span className="num" style={{fontSize: 24, width: 26, color: rows.filter((x) => (x.v?.total ?? 0) > (v?.total ?? 0)).length === 0 ? 'var(--mc)' : undefined}}>{1 + rows.filter((x) => (x.v?.total ?? 0) > (v?.total ?? 0)).length}</span>}
              <span style={{flex: 1, fontWeight: 750, fontSize: 20}}>{p.name}<BotMarkFor color={p.color} />{p.color === model.color && <span className="faint" style={{fontSize: 14}}> · you</span>}</span>
              <span className="num" style={{fontSize: 36}}>{v?.total ?? 0}</span>
            </div>
            {v && (
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6, marginTop: 10}}>
                {cols.map(([label, k]) => (
                  <div key={k}><div className="cond faint" style={{fontSize: 12}}>{label}</div><div className="num" style={{fontSize: 18}}>{v[k]}</div></div>
                ))}
              </div>
            )}
          </motion.div>
        ))}
      </div>
      <PosterCard gameId={state.full?.gameId} summary={summarize(rows.map(({p, v}) => ({name: p.name, color: p.color, vp: v?.total ?? 0, place: 1 + rows.filter((x) => (x.v?.total ?? 0) > (v?.total ?? 0)).length})))} />
      <div style={{marginTop: 28}}><GameMenu state={state} playerId={playerId} gameOver onDone={() => {}} /></div>
    </motion.div>
  );
}

/** `on`, held for `ms` after it turns false (it turns true at once): rides out a momentary gap in the server's state. */
function useHeld(on: boolean, ms: number): boolean {
  const [held, setHeld] = useState(on);
  useEffect(() => {
    if (on) { setHeld(true); return; }
    const t = setTimeout(() => setHeld(false), ms);
    return () => clearTimeout(t);
  }, [on, ms]);
  return on || held;
}
