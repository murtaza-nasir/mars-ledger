// The fan-project notice, on the TV lobby, the phone's join screen and the game menu.
import type {CSSProperties} from 'react';
import {useNet} from '../net';
import {DEFAULT_SOURCE_URL, sourceLabel} from '../../shared/source';

export const UNOFFICIAL_NOTICE = 'Mars Ledger is an unofficial fan-made companion for the Terraforming Mars board game. '
  + 'It is not affiliated with or endorsed by FryxGames, Stronghold Games or Asmodee. '
  + 'Terraforming Mars is a trademark of FryxGames. You need a copy of the board game to play.';

export function Unofficial({style}: {style?: CSSProperties}) {
  return <p className="faint" data-unofficial="" style={{margin: 0, fontSize: 12, lineHeight: 1.4, ...style}}>{UNOFFICIAL_NOTICE}</p>;
}

/** "Source code": a link on the phone, the address as text on the TV (`plain`). */
export function SourceLink({style, plain}: {style?: CSSProperties; plain?: boolean}) {
  const url = useNet((s) => s.config?.sourceUrl) ?? DEFAULT_SOURCE_URL;
  return (
    <p className="faint" data-source-link="" style={{margin: 0, fontSize: 12, lineHeight: 1.4, ...style}}>
      {plain ? <>Source code: {sourceLabel(url)}</> : <a href={url} target="_blank" rel="noopener noreferrer" style={{color: 'inherit'}}>Source code</a>}
    </p>
  );
}
