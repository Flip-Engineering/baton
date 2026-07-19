const observed = {
  home: process.env.HOME ?? null,
  runtimeOnly: process.env.BATON_RUNTIME_ONLY ?? null,
  adapterOnly: process.env.BATON_ADAPTER_ONLY ?? null,
  ambientPoison: process.env.BATON_AMBIENT_POISON ?? null,
};

process.stdout.write(`${JSON.stringify({
  type: 'result', subtype: 'success', is_error: false,
  result: JSON.stringify(observed), usage: { input_tokens: 1, output_tokens: 1 },
})}\n`);
