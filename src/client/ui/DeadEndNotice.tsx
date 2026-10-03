// The game cannot continue: the engine asked a player for a card that does not exist.
// Phones and the TV say so plainly; the game menu's "Abandon the game" opens a new lobby.
import {motion} from 'motion/react';
import {deadEndText} from '../../shared/deadend';
import {useNet} from '../net';

/** The current full game's dead end, or null. */
export function useDeadEnd() {
  return useNet((s) => (s.deadEnd && s.state?.mode === 'full' && s.state.full?.gameId === s.deadEnd.gameId && s.state.phase === 'full' ? s.deadEnd : null));
}

export function DeadEndNotice({tv}: {tv?: boolean}) {
  const d = useDeadEnd();
  if (!d) return null;
  const t = deadEndText(d);
  return (
    <motion.div role="alert" data-testid="dead-end" initial={{opacity: 0, y: -12}} animate={{opacity: 1, y: 0}} transition={{duration: 0.4}}
      style={tv
        ? {position: 'absolute', left: '50%', top: '4vh', transform: 'translateX(-50%)', zIndex: 60, width: '46vw', padding: '2vh 2vw', borderRadius: '1.2vw',
          background: 'rgba(20,8,5,.94)', boxShadow: '0 0 0 0.15vw var(--ember), 0 2vw 5vw rgba(0,0,0,.6)'}
        : {position: 'relative', zIndex: 30, margin: 'calc(10px + env(safe-area-inset-top)) 16px 0', padding: '12px 14px', borderRadius: 14,
          background: 'rgba(226,80,46,.16)', boxShadow: 'inset 0 0 0 1.5px var(--ember)'}}>
      <div style={{fontWeight: 800, fontSize: tv ? '2vw' : 18, color: '#FFB39E'}}>{t.title}</div>
      <div style={{marginTop: tv ? '0.6vh' : 4, fontSize: tv ? '1.3vw' : 15, lineHeight: 1.35}}>{t.line}</div>
    </motion.div>
  );
}
