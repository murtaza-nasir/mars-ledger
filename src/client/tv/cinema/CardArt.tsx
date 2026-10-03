// Card illustration (public/cards/<number>.webp) with a type-coloured fallback while art is missing.
import {useState} from 'react';
import {findCard} from '../../../shared/cards';
import {TagIcon} from '../../ui/Icons';

// Card-type colours (kept here so the TV does not depend on the phone's card design).
const TYPE_COLOR: Record<string, string> = {automated: '#3E8C4A', active: '#2F6FB8', event: '#B8402A', corporation: '#8A7A55', prelude: '#C98A2E'};

export function artUrl(name: string): string | null {
  const n = findCard(name)?.number;
  return n ? `/cards/${n.replace(/^#/, '')}.webp` : null;
}

export function CardArt({name, style}: {name: string; style?: React.CSSProperties}) {
  const def = findCard(name);
  const url = artUrl(name);
  const [failed, setFailed] = useState(false);
  const band = TYPE_COLOR[def?.type ?? 'corporation'] ?? '#6B6F7C';
  return (
    <div style={{position: 'relative', overflow: 'hidden', background: `radial-gradient(120% 90% at 30% 20%, color-mix(in oklab, ${band} 55%, #4A2218), #1A0D0A)`, ...style}}>
      {(failed || !url) && (
        <div style={{position: 'absolute', inset: 0, display: 'flex', flexWrap: 'wrap', gap: '8%', padding: '10%', opacity: 0.18, alignContent: 'center', justifyContent: 'center'}}>
          {Array.from({length: 9}, (_, i) => <TagIcon key={i} tag={def?.tags[i % Math.max(1, def.tags.length)] ?? 'space'} size={40} />)}
        </div>
      )}
      {url && !failed && <img src={url} alt="" onError={() => setFailed(true)} decoding="async"
        style={{position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover'}} />}
    </div>
  );
}
