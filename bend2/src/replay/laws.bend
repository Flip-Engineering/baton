# CLAIM: this module states no operative law.
#
# It previously bound four M-5 obligations, one M-7 obligation and three M-8
# obligations to functions in bend2/src/replay. The coordinator's entry graph
# does not import bend2/src/replay: those modules are the earlier replay
# experiments, each with its own main and its own frozen corpus. A law stated
# over them therefore verified a prototype rather than the coordinator's own
# implementation of the entry.
#
# git10's review of 12c050a8 named those eight laws, and the root directed that
# they be bound to the coordinator's own implementations and implemented where
# the coordinator has none. Those bindings now live in
# bend2/src/coordinator/laws.bend, over the store's command SQL, the wake read,
# the pending-input read and the message ordering the coordinator serves. The
# replay modules themselves are unchanged, and git keeps the laws this module
# used to carry.
#
# Policies: docs/bend2/laws-proposed.md. Reference: docs/bend2/reference/README.md, bend 2.0.25.
