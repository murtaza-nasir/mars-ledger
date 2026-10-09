// A menu row's two texts on one line (a .btn with justify-content: space-between). Both may shrink (min-width 0), so
// neither a long name nor a long hint widens the row past its sheet; the secondary text's large shrink factor makes it
// give way first and end in an ellipsis while the label keeps its room.
import type {CSSProperties} from 'react';

export const rowMain: CSSProperties = {minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'};
export const rowAside: CSSProperties = {...rowMain, flexShrink: 10000, fontSize: 14};
