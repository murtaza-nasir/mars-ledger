// City (engine tile type 2), Detailed set: a dense Mars colony district. Terraced arcology, habitat stacks with
// balconies, glass-domed parks, a landing pad with a shuttle that lifts off, a maglev ring with moving pods, a crane
// on a construction edge, rooftop solar, traffic, signs and beacons. The build-in is a construction sequence:
// the foundation stamps, scaffolds rise, structures assemble, scaffolds fall away, then the lights cascade on.
// The model lives in CityDetailKit.ts (shared with the Capital); `lite` is the same tile with the small parts merged away.
import type {ModelMeta, ModelProps} from '../contract';
import {CityDetailModel} from './CityDetailKit';

export const meta: ModelMeta = {set: 'detailed', name: 'City', tileTypes: [2], kind: 'city', buildSeconds: 4.7};

export default function City(p: ModelProps) {
  return <CityDetailModel {...p} grand={false} />;
}
