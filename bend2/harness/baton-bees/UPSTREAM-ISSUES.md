# Upstream Baton gaps

The bag-of-bees plugin deliberately keeps Baton as the authority source. These
Baton issues track functionality that a pi-intercom-style peer bus offers but
Baton communications did not yet cover when this plugin was introduced:

- #1478: self-service peer join, role/capability presence, and team discovery.
- #1479: durable channel/tail/cursor and claim/lease primitives for peer
  coordination.
- #671: native control reads and team setup require external orchestration glue.
- #723: remove message acknowledgement state and infer action identities.
- #984: role- and hierarchy-scoped broadcast messaging.

The plugin's `BeeBus` is a transport bridge for short-lived bag chatter. It does
not grant task admission, route authority, completion decisions, or knowledge
visibility.
