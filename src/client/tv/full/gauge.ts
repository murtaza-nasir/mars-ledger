// The pure scale of the TV's temperature and oxygen tubes (Globals.tsx): where a value sits on the tube, for the
// fill and for the numbers and bonus marks beside it. One function serves both, so a label always sits exactly
// at the fill's top when the parameter reads that value.

/** The raised values: one tube segment per step, from the first step above the minimum to the maximum. */
export const TEMP_STEPS = Array.from({length: 19}, (_, i) => -28 + i * 2); // −28 … +8 (the minimum is −30)
export const OXY_STEPS = Array.from({length: 14}, (_, i) => i + 1); // 1 … 14 (the minimum is 0)

/** Height on the tube (0 = bottom, 1 = top) of a reading: the share of steps raised at that value. */
export function level(steps: number[], value: number): number {
  return steps.filter((s) => s <= value).length / steps.length;
}

/** The tube's extent inside the gauge box: its gap to the box's top and bottom (CSS lengths). */
export interface TubeInset {top: string; bottom: string}
export const THERMO_INSET: TubeInset = {top: '0vw', bottom: '1.1vw'};
export const TANK_INSET: TubeInset = {top: '1.1vw', bottom: '1.1vw'};

/** CSS `bottom` in the gauge box for a height on the tube, measured against the tube's own extent
 *  (the fill and the ticks live inside the tube, so a label must use the same span). */
export function tubeBottom(frac: number, inset: TubeInset): string {
  return `calc(${inset.bottom} + (100% - ${inset.bottom} - ${inset.top}) * ${frac})`;
}
