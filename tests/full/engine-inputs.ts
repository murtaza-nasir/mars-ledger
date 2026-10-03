// Round-trips phone-built responses through the engine's own input classes, for input types a base-game
// deck never raises (productionToLose, resource, resources, and) plus player/amount/payment.
//   (cd vendor/tm && cp ../../tests/full/engine-inputs.ts . && npx tsx engine-inputs.ts dump out.json)
//   (cd vendor/tm && npx tsx engine-inputs.ts check out.json responses.json)
// Run inside vendor/tm: it imports the engine and its test helpers directly. tests/full/ui-inputs.py drives both steps.
import * as fs from 'fs';
import './tests/testing/setup';
import {testGame} from './tests/TestGame';
import {AndOptions} from './src/server/inputs/AndOptions';
import {SelectAmount} from './src/server/inputs/SelectAmount';
import {SelectPayment} from './src/server/inputs/SelectPayment';
import {SelectPlayer} from './src/server/inputs/SelectPlayer';
import {SelectProductionToLose} from './src/server/inputs/SelectProductionToLose';
import {SelectResource} from './src/server/inputs/SelectResource';
import {SelectResources} from './src/server/inputs/SelectResources';

function build() {
  const [, player, other] = testGame(2);
  player.production.override({megacredits: 2, steel: 1, titanium: 0, plants: 1, energy: 1, heat: 2});
  player.stock.override({megacredits: 20, steel: 0, titanium: 0, plants: 0, energy: 0, heat: 10});
  player.canUseHeatAsMegaCredits = true;
  const seen: Record<string, unknown> = {};
  const inputs = {
    player: new SelectPlayer([player, other], 'Select player to decrease plant production').andThen((p) => { seen.player = p.color; return undefined; }),
    amount: new SelectAmount('Select amount of heat production to decrease', 'Decrease', 1, 2).andThen((n) => { seen.amount = n; return undefined; }),
    payment: new SelectPayment('Select how to pay for award', 8, {heat: true}).andThen((p) => { seen.payment = p; return undefined; }),
    productionToLose: new SelectProductionToLose('Choose 2 units of production to lose', 2, player).andThen((u) => { seen.productionToLose = u; return undefined; }),
    resource: new SelectResource('Gain 1 standard resource').andThen((r) => { seen.resource = r; return undefined; }),
    resources: new SelectResources('Gain 3 resources', 3).andThen((u) => { seen.resources = u; return undefined; }),
    and: (() => {
      const got: Record<string, number> = {};
      return new AndOptions(
        new SelectAmount('Birds', '', 0, 3).andThen((n) => { got.Birds = n; return undefined; }),
        new SelectAmount('Fish', '', 0, 3).andThen((n) => { got.Fish = n; return undefined; }),
      ).andThen(() => {
        if ((got.Birds ?? 0) + (got.Fish ?? 0) !== 3) throw new Error(`Expecting 3 resources distributed, got ${(got.Birds ?? 0) + (got.Fish ?? 0)}.`);
        seen.and = got; return undefined;
      });
    })(),
  };
  return {player, inputs, seen};
}

const [mode, out, respFile] = process.argv.slice(2);
const {player, inputs, seen} = build();
if (mode === 'dump') {
  const models = Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, v.toModel(player)]));
  fs.writeFileSync(out, JSON.stringify(models, null, 1));
  console.log('dumped', Object.keys(models).join(', '));
} else {
  const responses = JSON.parse(fs.readFileSync(respFile, 'utf8')) as Record<string, unknown>;
  let bad = 0;
  for (const [k, input] of Object.entries(inputs)) {
    const r = responses[k];
    if (!r) { console.log(`MISSING ${k}`); bad++; continue; }
    try {
      // AndOptions.process drives its children and then its own callback.
      const next = (input as {process: (r: unknown, p: unknown) => unknown}).process(r, player);
      if (next && typeof (next as {cb?: unknown}) === 'object' && 'cb' in (next as object)) void 0;
      console.log(`OK ${k}: ${JSON.stringify(r)} -> ${JSON.stringify(seen[k])}`);
    } catch (e) {
      console.log(`REJECTED ${k}: ${JSON.stringify(r)} :: ${(e as Error).message}`); bad++;
    }
  }
  process.exitCode = bad ? 1 : 0;
}
