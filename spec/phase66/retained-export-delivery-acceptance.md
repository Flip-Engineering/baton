# Phase 66 retained export delivery — focused acceptance contract

Status: acceptance-red. This is the bounded CE17 delivery slice retained by
`export-lifecycle-and-delivery-addendum.md`. It starts with an immutable completed
`directory-v1` receipt and does not change accepted-result, adoption, integration, or server-path
authority.

## RD1 — deterministic archive seam

`result-export.mjs` exposes a deployment-internal, testable
`deriveResultExportArchive({ exportRoot, receipt, maxArchiveBytes })` seam. It revalidates the
private export root and exact completed directory against the receipt and manifest before reading
transport bytes. It returns:

```text
{ descriptor, bytes }

descriptor = {
  schemaVersion: 1,
  format: "baton-export-tar-v1",
  mediaType: "application/x-tar",
  exportId,
  manifestDigest,
  archiveDigest,
  archiveBytes
}
```

The descriptor is closed and contains no path. `bytes` is bounded internal transport data and is
never included in MCP or a Run receipt.

`baton-export-tar-v1` is a bytewise-sorted USTAR stream containing only regular-file records for
`manifest.json` and `tree/<manifest path>`. Headers use uid/gid/mtime zero, empty owner/group names,
no link target, fixed modes from the verified export, and no PAX, GNU, xattr, ACL, sparse, link, or
special records. The stream ends with exactly the ordinary zero-block terminator. Repeated
derivation from an unchanged completed export is byte-identical. A changed root, receipt,
manifest, file, mode, inventory, or byte ceiling fails before returning an archive.

## RD2 — one-use authenticated Web delivery

`WebResultExportDelivery` is the sole ticket and active-stream authority. Its contract follows the
existing `WebEventStream` posture while additionally binding each short-lived ticket to one
repository, Run, completed export, user session, credential, and allowed origin. A ticket is random,
stored only as a digest, and consumed once. Issue and open both reauthorize the current completed
receipt and active Run. Authorization is checked again immediately before headers and between
bounded output chunks. Stop, session revocation, disconnect, or deployment shutdown aborts and
releases the registered Run delivery operation.

The HTTP adapter issues with authenticated `POST /v1/export-downloads` and downloads with
authenticated `GET /v1/exports/EXPORT_ID/archive` plus `x-baton-export-ticket`. Cookie issue
requests require the existing CSRF header. Download requests reject query strings, `Range`, path or
filename inputs, unexpected ticket forms, and mismatched repository/Run/export authority. Success
is `no-store`, has a generated fixed attachment filename, exact content length and content digest,
and never returns a server path. A refused request writes no archive headers.

## RD3 — absent-destination CLI extraction

`application-cli.mjs` exposes a testable
`extractResultExportArchive({ archiveBytes, descriptor, destination })` seam. `BatonWebClient` uses
the authenticated issue/download flow, and `runBatonCli` invokes it only after strict `run.export`
completion. Client destination data never enters a server command or download authorization.

The extractor requires an absent destination. It downloads/writes privately, verifies the archive
size and digest before parsing, validates the entire closed USTAR inventory before filesystem
effect, verifies the canonical manifest digest and every declared file/mode/size/digest, and rejects
absolute, traversing, duplicate, non-canonical, link, special, extra, missing, or malformed records.
It extracts under a private sibling temporary with create-new/no-follow semantics, re-proves every
output, and atomically publishes the absent destination with no-replace semantics. Failure leaves
the destination absent and removes only its proved client-owned temporary.

Existing empty destinations remain refused in this slice; supporting them requires a later explicit
ownership and completion protocol.

## RD4 — focused acceptance evidence

The red test slice proves deterministic archive equality and mutation refusal, one-use and
revocation behavior before headers and during streaming, strict HTTP routing and headers, hostile
archive preflight, absent-destination publication, and CLI orchestration without server-path
authority.
