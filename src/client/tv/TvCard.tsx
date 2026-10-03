// A card shown big on the TV. It uses the lifted face at a pixel size: its art takes the free height and a facts
// panel spells out tags and points, so a card with one line of rules does not leave its lower half empty. The
// wrapper is the size container the face's cqw padding and corners resolve against; without one they resolve
// against the screen and the frame turns into an oversized pill.
import {useEffect, useState} from 'react';
import type {CardDef} from '../../shared/types';
import {CardFace} from '../ui/CardFace';

/** the card width the lifted face's pixel type is drawn for (a phone's lifted card) */
const REF_W = 340;

function useViewport() {
  const [v, setV] = useState(() => ({w: window.innerWidth, h: window.innerHeight}));
  useEffect(() => {
    const on = () => setV({w: window.innerWidth, h: window.innerHeight});
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

/** `vw`: the card's width as a share of the screen width; `maxVh`: a cap on its height as a share of the screen height. */
export function TvCard({card, vw, maxVh = 0.62, cost, resources}: {card: CardDef; vw: number; maxVh?: number; cost?: number; resources?: number}) {
  const {w, h} = useViewport();
  const width = Math.round(Math.min(w * vw / 100, h * maxVh * 63 / 88));
  // The lifted face sets its rules in phone pixels (17 to 24 px), right for a phone-sized card. On the TV the card is
  // laid out at that phone size and scaled up whole, so its text grows with it instead of staying phone-small.
  const k = Math.max(1, width / REF_W);
  const refW = Math.round(width / k), refH = Math.round(refW * 88 / 63);
  return (
    <div style={{width, height: Math.round(refH * k), margin: '0 auto', position: 'relative'}}>
      <div style={{containerType: 'inline-size', width: refW, position: 'absolute', left: 0, top: 0, transform: `scale(${k})`, transformOrigin: '0 0'}}>
        <CardFace card={card} variant="lifted" width={refW} height={refH} cost={cost} resources={resources} />
      </div>
    </div>
  );
}
