// Two more personal phone settings beside Hints, stored the same way (on the profile, or beside the game for a seat
// without one): "Show VP changes" and "Confirm card purchases". Both are off unless the player turns them on.
import {motion} from 'motion/react';
import {createContext, useContext, useState} from 'react';
import type {GameState} from '../../shared/game';
import {useNet} from '../net';

export type PhonePrefs = {showVp: boolean; confirmBuy: boolean};

/** This seat's two settings. A profiled seat keeps them on the profile, others beside the game. */
export function usePhonePrefs(state: GameState | null | undefined, playerId: string | null | undefined): PhonePrefs {
  const profileId = state?.players.find((p) => p.id === playerId)?.profileId;
  const profile = useNet((s) => (profileId ? s.profiles.find((p) => p.id === profileId) : undefined));
  const seat = useNet((s) => (playerId ? s.seatPrefs[playerId] : undefined));
  const src = profileId ? profile : seat;
  return {showVp: !!src?.showVp, confirmBuy: !!src?.confirmBuy};
}

/** The seat's own settings for everything under the phone's game screen (the previews and the log read them from here). */
export const PhonePrefsContext = createContext<PhonePrefs>({showVp: false, confirmBuy: false});
export const usePrefsContext = () => useContext(PhonePrefsContext);

/** The VP-changes setting alone, for code that needs only that. */
export const useShowVp = (state: GameState | null | undefined, playerId: string | null | undefined) => usePhonePrefs(state, playerId).showVp;

const COPY = {
  showVp: {title: 'Show VP changes', text: 'Previews and the log add the VP an action gains or costs, for you and for others. Final award standings are marked as uncertain.'},
  confirmBuy: {title: 'Confirm card purchases', text: 'Before you buy or skip cards in research and the draft, the phone shows how many cards and what they cost, and asks you to confirm.'},
} as const;

export function PhonePrefPick({state, playerId, which}: {state: GameState; playerId: string; which: keyof PhonePrefs}) {
  const {updateProfile, setSeatFlags} = useNet();
  const prefs = usePhonePrefs(state, playerId);
  const profileId = state.players.find((p) => p.id === playerId)?.profileId;
  const on = prefs[which];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function toggle() {
    setBusy(true); setError(null);
    try {
      if (profileId) await updateProfile(profileId, {[which]: !on});
      else await setSeatFlags(playerId, {[which]: !on});
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div>
      <motion.button role="switch" aria-checked={on} data-pref={which} data-state={on ? 'on' : 'off'} whileTap={{scale: 0.98}} disabled={busy} onClick={toggle}
        style={{display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', padding: '4px 0'}}>
        <span style={{flex: 1}}>
          <strong style={{fontWeight: 650}}>{COPY[which].title}</strong>
          <span className="muted" style={{display: 'block', fontSize: 14}}>{COPY[which].text} {profileId ? 'Saved on your profile.' : 'Just for you.'}</span>
        </span>
        <span aria-hidden="true" style={{position: 'relative', width: 46, height: 28, borderRadius: 14, flex: 'none', background: on ? 'var(--tr)' : 'rgba(255,255,255,.14)', transition: 'background .2s'}}>
          <motion.span animate={{x: on ? 20 : 2}} transition={{type: 'spring', stiffness: 500, damping: 32}}
            style={{position: 'absolute', top: 3, left: 0, width: 22, height: 22, borderRadius: 11, background: on ? '#0E2E47' : 'var(--ice)'}} />
        </span>
      </motion.button>
      {error && <p role="alert" style={{margin: '6px 2px 0', color: 'var(--ember)', fontSize: 14}}>{error}</p>}
    </div>
  );
}
