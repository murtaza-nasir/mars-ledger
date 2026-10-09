import {describe, expect, it} from 'vitest';
import {level, OXY_STEPS, TANK_INSET, TEMP_STEPS, THERMO_INSET, tubeBottom} from '../src/client/tv/full/gauge';

describe('TV gauge scale', () => {
  it('has one step per raise: 19 for temperature, 14 for oxygen', () => {
    expect(TEMP_STEPS).toHaveLength(19);
    expect(TEMP_STEPS[0]).toBe(-28);
    expect(TEMP_STEPS.at(-1)).toBe(8);
    expect(OXY_STEPS).toHaveLength(14);
    expect(OXY_STEPS[0]).toBe(1);
    expect(OXY_STEPS.at(-1)).toBe(14);
  });

  it('places temperature readings linearly from −30 (empty) to +8 (full)', () => {
    for (let t = -30; t <= 8; t += 2) expect(level(TEMP_STEPS, t)).toBeCloseTo((t + 30) / 38, 12);
    expect(level(TEMP_STEPS, -30)).toBe(0);
    expect(level(TEMP_STEPS, -24)).toBeCloseTo(3 / 19, 12);
    expect(level(TEMP_STEPS, -20)).toBeCloseTo(5 / 19, 12);
    expect(level(TEMP_STEPS, -2)).toBeCloseTo(14 / 19, 12);
    expect(level(TEMP_STEPS, 0)).toBeCloseTo(15 / 19, 12);
    expect(level(TEMP_STEPS, 8)).toBe(1);
  });

  it('places oxygen readings linearly from 0 (empty) to 14 (full)', () => {
    for (let o = 0; o <= 14; o++) expect(level(OXY_STEPS, o)).toBeCloseTo(o / 14, 12);
    expect(level(OXY_STEPS, 0)).toBe(0);
    expect(level(OXY_STEPS, 8)).toBeCloseTo(8 / 14, 12);
    expect(level(OXY_STEPS, 14)).toBe(1);
  });

  it('puts the fill top exactly on the label of the current value, one step below the next label', () => {
    // the owner's photo: −2 °C must stop one step under the "0" label, not reach it
    expect(level(TEMP_STEPS, -2)).toBeLessThan(level(TEMP_STEPS, 0));
    expect(level(TEMP_STEPS, 0) - level(TEMP_STEPS, -2)).toBeCloseTo(1 / 19, 12);
    expect(level(OXY_STEPS, 11)).toBeLessThan(level(OXY_STEPS, 12));
  });

  it('positions labels against the same span as the fill (the tube, not a shorter one)', () => {
    expect(tubeBottom(0, THERMO_INSET)).toBe('calc(1.1vw + (100% - 1.1vw - 0vw) * 0)');
    expect(tubeBottom(1, TANK_INSET)).toBe('calc(1.1vw + (100% - 1.1vw - 1.1vw) * 1)');
    // evaluate the calc for a 600px box at 1vw = 19.2px and check it against the tube's own geometry
    const vw = 19.2, box = 600;
    const px = (frac: number, inset: typeof THERMO_INSET) => {
      const top = parseFloat(inset.top) * vw, bottom = parseFloat(inset.bottom) * vw;
      return bottom + (box - bottom - top) * frac;
    };
    const tubeH = box - 1.1 * vw; // the thermometer's tube: top 0, bottom 1.1vw
    expect(px(level(TEMP_STEPS, 0), THERMO_INSET)).toBeCloseTo(1.1 * vw + tubeH * (15 / 19), 9);
    const tankH = box - 2.2 * vw; // the tank: 1.1vw valve above, 1.1vw foot below
    expect(px(level(OXY_STEPS, 14), TANK_INSET)).toBeCloseTo(1.1 * vw + tankH, 9);
  });
});
