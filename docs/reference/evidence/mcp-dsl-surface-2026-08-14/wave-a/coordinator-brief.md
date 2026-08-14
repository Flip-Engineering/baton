# COORDINATOR BRIEF — mcp-dsl-surface-2026-08-14 wave-a (#227)

Four implementation rows; issue #227 is the contract. You verify the rows' deliverables and
write verify-notes.md carrying MCP-DSL-SURFACE-VERIFY v1. Acceptance: each row's red-first
pin green at HEAD; mcp-packaging/mcp-profile-parity batteries unchanged; adapter batteries
green. The acceptance proof for the WHOLE wave: a descriptor-configured stdio server drives
doctor → waves_run(specDsl) → waves_progress → decision_answer with zero harness-side proxy
code (the omp bridge .baton/mcp-server.mjs is the debt being retired — its function must be
absorbable into the shipped surface).
