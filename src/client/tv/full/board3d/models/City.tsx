// City (engine tile type 2): a Mars colony of glass domes, lit towers, tubes, a landing pad and a circling shuttle.
// The model itself lives in CityKit.ts (shared with the Capital).
import type {ModelMeta, ModelProps} from './contract';
import {CityModel} from './CityKit';

export const meta: ModelMeta = {name: 'City', tileTypes: [2], kind: 'city', buildSeconds: 2.2};

export default function City(p: ModelProps) {
  return <CityModel {...p} grand={false} />;
}
