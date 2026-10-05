// Diagnostic entrypoint: node diagnose/run.mjs [--only id,id]
//
// Runs the exact-defect diagnostics against the captured producer tree.
// Exit 0 means every selected diagnostic REPRODUCED its historically
// observed defect exactly (diagnostic completion on those bytes). Exit 1
// means a diagnostic no longer reproduces (the defect is fixed or the shape
// changed) or errored. This mode is evidence about captured bytes only and
// never counts toward suite acceptance.

import { loadProducer } from '../lib/producer.mjs';
import { runDiagnoses } from './DIAGNOSES.mjs';

const args = process.argv.slice(2);
let selected = null;
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--only') {
    const value = args[index + 1];
    if (value === undefined || value.trim() === '') {
      console.log(JSON.stringify({ refusal: 'onlyRequiresNonemptyIdList' }));
      process.exit(64);
    }
    selected = value.split(',').map(id => id.trim()).filter(id => id.length > 0);
    if (selected.length === 0) {
      console.log(JSON.stringify({ refusal: 'emptySelection' }));
      process.exit(64);
    }
    index += 1;
    continue;
  }
  console.log(JSON.stringify({ refusal: 'unknownArgument', argument: args[index] }));
  process.exit(64);
}

const outcomes = await runDiagnoses(loadProducer, selected);
console.log(JSON.stringify({ diagnose: 'context-models-production-critic', producerRoot: process.env.CTX_PRODUCER_ROOT ?? 'default-sibling', outcomes }, null, 2));
const complete = outcomes.length > 0 && outcomes.every(entry => entry.reproduced === true);
process.exit(complete ? 0 : 1);
