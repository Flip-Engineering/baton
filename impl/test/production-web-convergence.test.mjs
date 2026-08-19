import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebNorthbound } from '../src/web-northbound.mjs';
import { installProductionWebConvergence } from '../src/production-web-convergence.mjs';

const rawExecute = WebNorthbound.prototype.execute;
assert.equal(installProductionWebConvergence(), false);
assert.equal(WebNorthbound.prototype.execute, rawExecute);
assert.equal(installProductionWebConvergence({ global: true }), true);

function coordinationAuthority() {
  const commands = new Map();
  return {
    snapshot() { return { schemaVersion: 1, workers: [], events: [] }; },
    events() { return []; },
    admitWebCommand(input) { const command={...input,status:'admitted',admittedAt:new Date().toISOString()}; commands.set(input.commandId,command); return {ok:true,result:'admitted',command}; },
    completeWebCommand(commandId,outcome) { const command=commands.get(commandId); Object.assign(command,{status:'completed',outcome,completedAt:new Date().toISOString()}); return command; },
    failWebCommand(commandId,outcome) { const command=commands.get(commandId); Object.assign(command,{status:'failed',outcome,completedAt:new Date().toISOString()}); return command; },
    recordWebAudit() { return {ok:true}; },
    webCommand(commandId) { return commands.get(commandId)??null; },
  };
}
const ctx=Object.freeze({origin:'https://operator.test',transport:'https',principal:Object.freeze({userId:'operator',sessionId:'session:1',credentialId:'credential:1',authMethod:'bearer',expiresAt:'2099-01-01T00:00:00.000Z',capabilities:Object.freeze(['control','observe']),repoIds:Object.freeze(['repo'])})});

test('effectful WebNorthbound request returns 202 once admission is durable while provider work remains blocked',async()=>{
  let release; const coordination=coordinationAuthority(); const coordinator={spawn(){return new Promise((resolve)=>{release=()=>resolve({workerId:'worker:1',fence:1});});}};
  const northbound=new WebNorthbound({coordinator,coordination,allowedOrigins:['https://operator.test'],repoIds:['repo']});
  const envelope={schemaVersion:1,commandId:'cmd:web-nonblocking',idempotencyKey:'idem:web-nonblocking',command:'spawn',args:{harness:'fake',brief:{}},repoId:'repo',origin:'https://operator.test'};
  const response=await Promise.race([northbound.execute(ctx,envelope),new Promise((_,reject)=>setTimeout(()=>reject(new Error('web command remained coupled to provider await')),250))]);
  assert.equal(response.status,202); assert.equal(response.body.status,'admitted'); assert.equal(coordination.webCommand(envelope.commandId).status,'admitted');
  release(); for(let i=0;i<20&&coordination.webCommand(envelope.commandId).status==='admitted';i+=1) await new Promise((resolve)=>setTimeout(resolve,0));
  assert.equal(coordination.webCommand(envelope.commandId).status,'completed');
});

test('read-only WebNorthbound observations retain their synchronous response contract',async()=>{
  const coordination=coordinationAuthority(); const northbound=new WebNorthbound({coordinator:{list:()=>[{workerId:'worker:1'}]},coordination,allowedOrigins:['https://operator.test'],repoIds:['repo']});
  const response=await northbound.execute(ctx,{schemaVersion:1,commandId:'cmd:web-read',idempotencyKey:'idem:web-read',command:'list',args:{},repoId:'repo',origin:'https://operator.test'});
  assert.equal(response.status,200); assert.equal(response.body.ok,true);
});

test('authenticated Web attention authorizes the real operator then derives the existing viewer', async () => {
  const seen = [];
  const application = {
    async authorizeReplay(command, args, principal, context) {
      seen.push({ stage: 'authorize', command, args, principal, context });
      assert.equal(command, 'run.inspect');
      assert.equal(args.runId, 'run:a');
      assert.equal(principal.principalId, 'operator');
    },
    async attentionWatch(args, principal) {
      seen.push({ stage: 'attention', args, principal });
      assert.equal(principal.principalId, 'wave-owner');
      return {
        schemaVersion: 1, runId: args.runId, afterCursor: args.cursor,
        throughCursor: 14, reasons: [{ kind: 'answer_question', requiredAction: 'answer' }],
      };
    },
    async command(name, args, principal, context) {
      assert.equal(name, 'run.attention.watch');
      return this.attentionWatch(args, principal, context);
    },
    async authorizeReplayFallback() { return true; },
  };
  const coordination = coordinationAuthority();
  const northbound = new WebNorthbound({
    coordinator: {}, coordination, allowedOrigins: ['https://operator.test'], repoIds: ['repo'],
  });
  northbound.application = application;
  const response = await northbound.execute(ctx, {
    schemaVersion: 1,
    commandId: 'cmd:web-attention',
    idempotencyKey: 'idem:web-attention',
    command: 'run_attention_watch',
    args: { runId: 'run:a', cursor: 7 },
    repoId: 'repo',
    runId: 'run:a',
    origin: 'https://operator.test',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.result.throughCursor, 14);
  assert.deepEqual(response.body.result.reasons, [
    { kind: 'answer_question', requiredAction: 'answer' },
  ]);
  assert.deepEqual(seen.map((entry) => entry.stage), ['authorize', 'attention']);
});
