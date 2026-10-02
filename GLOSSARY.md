# Baton2 terminology

| Name | Meaning |
| --- | --- |
| Principal Conductor | The main orchestrator. |
| Associate Conductor | A suborchestrator. |
| Ensemble | A coordinated team. |
| Section | A capability-specific subgroup. |
| Player | An individual agent. |
| Orchestra | The whole coordinated system. |

The [terminology guide](docs/bend2/terminology.md) describes responsibilities,
stored roles, group membership and shared knowledge scopes. `players` includes
both Conductor responsibilities, `section` records a capability-specific group,
and `orchestra` reads the coordinated state. Example session IDs `root`, `lead`
and `worker` remain valid.

A logical session ID associates parentage, messages and workspaces. A native
session ID identifies the harness conversation. A receive endpoint is the
registered command that delivers retained input to that conversation.

[Messaging](docs/bend2/messaging.md) defines hierarchy and Ensemble routes.
[Shared knowledge](docs/bend2/knowledge-context-2026-10-01.md) describes evidence
review, visibility, promotion and destination-owner notification.

The [original glossary](https://github.com/Flip-Engineering/baton/blob/f85647ccd6990d19b0aabdb2c834cab203d9b91d/GLOSSARY.md)
remains available at its recorded historical revision.
