# COORDINATOR BRIEF — member-harvest-2026-08-14 wave-a (C2 harvest leg)

One implementation row: retain the member forensic record at settle. You verify the row's
deliverable and write verify-notes.md carrying MEMBER-HARVEST-VERIFY v1. Acceptance: the
row's red-first pin green at HEAD; coordinator/wave-driver batteries unchanged.

Measured (2026-08-14): dead members' runtime dirs DO NOT EXIST post-settle (reaped with the
worker: w-544/545/546/554/555/557 all absent after the 18:07Z cluster), and live members'
dirs carry full artifacts (w-564: config/, home/ caches, tmp/) that vanish at reap. Every
member death is log archaeology because the record is deleted at the exact moment it becomes
evidence. DEPENDENCY: ride AFTER #225's terminal-event enrichment (the cert data source);
if #225 is unlanded at your start, pin the harvest of whatever the terminal events DO carry
and note the dependency.
