// The small "bot" mark beside a bot seat's name, on phones and the TV. Sized in em, so it follows
// the name it sits next to (phone rows in px, TV strips in vw).
import type {CSSProperties} from 'react';
import {botColors} from '../../shared/bots';
import type {Color} from '../../shared/full';
import {useNet} from '../net';

export function BotMark({style}: {style?: CSSProperties}) {
  return (
    <span className="cond" aria-label="bot" title="Played by the server"
      style={{display: 'inline-flex', alignItems: 'center', gap: '0.25em', verticalAlign: '0.12em', marginLeft: '0.45em', padding: '0.08em 0.5em 0.1em',
        borderRadius: 999, fontSize: '0.62em', fontWeight: 700, letterSpacing: '0.04em', lineHeight: 1.25, whiteSpace: 'nowrap',
        color: 'var(--ice-dim)', boxShadow: 'inset 0 0 0 1.2px var(--ice-faint)', ...style}}>
      <svg viewBox="0 0 12 12" width="0.95em" height="0.95em" aria-hidden="true">
        <rect x="2" y="3.6" width="8" height="6.4" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
        <circle cx="4.6" cy="6.8" r="0.9" fill="currentColor" /><circle cx="7.4" cy="6.8" r="0.9" fill="currentColor" />
        <path d="M6 3.6V1.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      bot
    </span>
  );
}

/** Is the seat with this engine colour a bot? (full games; false when the table has no bots) */
export function useIsBotColor(color: Color | string | undefined): boolean {
  return useNet((s) => !!color && !!s.state && botColors(s.state).has(color as Color));
}

/** The mark when the seat with this engine colour is a bot, else nothing. */
export function BotMarkFor({color, style}: {color: Color | string | undefined; style?: CSSProperties}) {
  return useIsBotColor(color) ? <BotMark style={style} /> : null;
}
