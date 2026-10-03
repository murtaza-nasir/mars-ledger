// Capital (engine tile type 3): the same colony family, crowned by a lit arcology with a ring platform and a spire.
import type {ModelMeta, ModelProps} from './contract';
import {CityModel} from './CityKit';

export const meta: ModelMeta = {name: 'Capital', tileTypes: [3], kind: 'city', buildSeconds: 2.4};

export default function Capital(p: ModelProps) {
  return <CityModel {...p} grand />;
}
