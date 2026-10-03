// Capital (engine tile type 3), Detailed set: the colony district crowned by a grand central spire with a sky-garden
// ring, gold belts, a crown of prongs and flare, a paved plaza with banners, flying buttresses and strolling people.
import type {ModelMeta, ModelProps} from '../contract';
import {CityDetailModel} from './CityDetailKit';

export const meta: ModelMeta = {set: 'detailed', name: 'Capital', tileTypes: [3], kind: 'city', buildSeconds: 5.4};

export default function Capital(p: ModelProps) {
  return <CityDetailModel {...p} grand />;
}
