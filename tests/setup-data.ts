// Vitest global setup: stop with a clear message when the card and board data have not been fetched.
import {dataProblem} from '../tools/check-data.mjs';

export default function setup() {
  const problem = dataProblem();
  if (problem) throw new Error(`\n${problem}\n`);
}
