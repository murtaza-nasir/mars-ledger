// The light of a Martian day across each generation: warm dusk at its first turn, night in the middle,
// rose-gold dawn when everyone has passed. Two pieces: the sky behind everything, and the light falling on
// the planet disc, which sits beneath the hex field so the board's text and tiles are never tinted.
// Only opacity changes, slowly, so the compositor does the work.
import type {SkyLight} from './sky';

const FADE = 'opacity 7s ease-in-out';
const FILL: React.CSSProperties = {position: 'absolute', inset: 0, pointerEvents: 'none'};

// Stars, drawn once as a background pattern: they show only as night falls.
const STARS = [
  'radial-gradient(1.4px 1.4px at 12% 18%, rgba(234,242,244,.9), transparent)',
  'radial-gradient(1.2px 1.2px at 27% 42%, rgba(234,242,244,.7), transparent)',
  'radial-gradient(1.6px 1.6px at 41% 12%, rgba(234,242,244,.85), transparent)',
  'radial-gradient(1.1px 1.1px at 63% 27%, rgba(234,242,244,.7), transparent)',
  'radial-gradient(1.5px 1.5px at 78% 9%, rgba(234,242,244,.9), transparent)',
  'radial-gradient(1.2px 1.2px at 88% 36%, rgba(234,242,244,.75), transparent)',
  'radial-gradient(1.3px 1.3px at 54% 6%, rgba(234,242,244,.8), transparent)',
  'radial-gradient(1px 1px at 6% 61%, rgba(234,242,244,.6), transparent)',
  'radial-gradient(1.2px 1.2px at 94% 71%, rgba(234,242,244,.6), transparent)',
  'radial-gradient(1px 1px at 33% 76%, rgba(234,242,244,.5), transparent)',
].join(',');

/** Behind the whole TV: the sky's colour over the backdrop. */
export function SkyLayer({light}: {light: SkyLight}) {
  return (
    <div data-sky="" aria-hidden="true" style={FILL}>
      <div style={{...FILL, transition: FADE, opacity: light.dusk,
        background: 'linear-gradient(to top, rgba(226,108,52,.30) 0%, rgba(150,62,40,.14) 32%, transparent 62%), radial-gradient(60% 45% at 18% 100%, rgba(240,128,64,.22), transparent 70%)'}} />
      <div style={{...FILL, transition: FADE, opacity: light.night,
        background: 'radial-gradient(75% 85% at 45% 45%, rgba(6,8,26,.12), rgba(3,4,16,.62)), linear-gradient(rgba(16,24,64,.16), rgba(16,24,64,.16))'}} />
      <div style={{...FILL, transition: FADE, opacity: light.night * 0.55, background: STARS, backgroundSize: '100% 100%'}} />
      <div style={{...FILL, transition: FADE, opacity: light.dawn,
        background: 'linear-gradient(to top, rgba(242,172,112,.28) 0%, rgba(176,122,150,.13) 36%, transparent 64%), radial-gradient(55% 40% at 84% 100%, rgba(255,196,140,.22), transparent 70%)'}} />
    </div>
  );
}

/** On the planet disc, beneath the hexes: the day's light from one side, shade at night. `clip` is the disc. */
export function DiscLight({light, clip}: {light: SkyLight; clip: string}) {
  return (
    <div data-disc-light="" aria-hidden="true" style={{...FILL, clipPath: clip}}>
      <div style={{...FILL, transition: FADE, opacity: light.dusk,
        background: 'linear-gradient(115deg, rgba(255,138,72,.26) 0%, rgba(255,138,72,.08) 34%, transparent 58%)'}} />
      <div style={{...FILL, transition: FADE, opacity: light.night,
        background: 'radial-gradient(circle at 62% 30%, rgba(10,14,44,.12), rgba(4,6,24,.5) 78%)'}} />
      <div style={{...FILL, transition: FADE, opacity: light.dawn,
        background: 'linear-gradient(245deg, rgba(255,192,140,.26) 0%, rgba(255,192,140,.08) 34%, transparent 58%)'}} />
    </div>
  );
}
