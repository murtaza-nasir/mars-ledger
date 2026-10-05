// "Confirm card purchases": a second step before buying or skipping cards (research, the initial buy) or keeping a
// drafted card, for players who turned the setting on. It states what is about to happen and asks once.
import {motion} from 'motion/react';

/** The confirmation itself: the question, Confirm, and Back (which returns to the selection as it was). */
export function ConfirmStep({question, detail, busy, onConfirm, onBack}: {question: string; detail?: string; busy?: boolean; onConfirm: () => void; onBack: () => void}) {
  return (
    <motion.div data-testid="confirm-buy" initial={{opacity: 0, y: 10}} animate={{opacity: 1, y: 0}} style={{padding: '18px 4px 4px'}}>
      <h3 data-testid="confirm-buy-question" style={{margin: '0 0 6px', fontSize: 24, fontWeight: 750, fontVariationSettings: "'wdth' 84", lineHeight: 1.15}}>{question}</h3>
      {detail && <p className="muted" style={{margin: '0 0 16px'}}>{detail}</p>}
      <button className="btn warm" data-testid="confirm-buy-yes" style={{width: '100%', marginTop: detail ? 0 : 14}} disabled={busy} onClick={onConfirm}>Confirm</button>
      <button className="btn ghost" data-testid="confirm-buy-back" style={{width: '100%', marginTop: 10}} onClick={onBack}>Back</button>
    </motion.div>
  );
}
