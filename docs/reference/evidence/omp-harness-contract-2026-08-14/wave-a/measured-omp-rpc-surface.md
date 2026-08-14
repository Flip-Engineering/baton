# MEASURED — omp RPC surface probe (2026-08-14, v17.3.4)

Live probe: `omp --mode rpc --no-extensions --no-lsp --no-skills --no-rules --no-title --cwd /tmp`
- ready {protocolVersion:1, supported:[1,2], maxFrameBytes:1048576, maxReassembled:67108864}
- prompt '/help' → ack → agent_start/turn_start/message_start/message_end → stdin close → exit 0
- ANOMALY: extension_ui_request emitted despite --no-extensions (adapter must tolerate UI frames; timeout resolves default per rpc.md)
- Event mapping: tool_execution_* → baton tool events; agent_end.isTerminal=false → NOT terminal (quiescence analogue); steer/follow_up/abort → BD3 lane 1:1
- Containment: --tools allowlist, --approval-mode, --session-dir/--no-session, --profile, --cwd
- Host tools: set_host_tools gives members baton verbs without member-side MCP (#74 lane)
- Open: MCP notification consumption (omp-side #208 posture); get_session_stats/contextUsage as usage-seal source

Full issue-comment form: github.com/wahargis/baton/issues/228
