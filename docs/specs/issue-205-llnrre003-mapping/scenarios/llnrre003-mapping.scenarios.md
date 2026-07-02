---
name: llnrre003-mapping
created_by: pabloandi
created_at: 2026-07-02T00:00:00Z
---

# Issue #205 — map Localiza warning LLNRRE003 (one-way distance not registered)

Context: Localiza returns the OTA warning `LLNRRE003`
("Distância entre cidades não cadastrada") when it can't compute the one-way
return fee for an unregistered inter-branch distance. The dashboard proxy
currently has no entry for it, so `buildLocalizaWarning` falls back to
`unknown_error` / HTTP 500, tumbando toda la búsqueda one-way. This maps it to a
stable semantic code with a 422, while preserving the block behavior (still
throws → never returns a price without the return fee).

## SCEN-001: one-way distance-not-registered warning → semantic 422, not unknown_error/500
**Given**: Localiza rejects a one-way availability query with warning ShortText `LLNRRE003`
**When**: the proxy builds the warning via `buildLocalizaWarning("LLNRRE003")`
**Then**: the resulting `LocalizaWarningError` has `code === "one_way_distance_not_registered"` and `httpStatus === 422` (NOT `unknown_error` / 500)
**Evidence**: `buildLocalizaWarning("LLNRRE003")` return object fields (`code`, `httpStatus`)

## SCEN-002: shortText preserved verbatim so rentacar-web keying keeps working
**Given**: rentacar-web PR #271 keys its `classifyOneWayDistanceError` helper on `shortText === "LLNRRE003"`
**When**: the proxy serializes the mapped warning via `.toJSON()`
**Then**: the body is exactly `{ error: "one_way_distance_not_registered", message: <clear Spanish one-way-unavailable text>, shortText: "LLNRRE003" }` — `shortText` unchanged
**Evidence**: `buildLocalizaWarning("LLNRRE003").toJSON()` object

## SCEN-003: genuinely unmapped codes still fall back to unknown_error/500 (regression guard)
**Given**: Localiza returns a ShortText the map does NOT recognize (e.g. `LLNRAG999`)
**When**: the proxy builds the warning via `buildLocalizaWarning("LLNRAG999")`
**Then**: `code === "unknown_error"`, `httpStatus === 500`, `shortText === "LLNRAG999"`, and a `localiza_warning_unmapped` WARN line is emitted — behavior for truly-unknown codes is unchanged
**Evidence**: `buildLocalizaWarning("LLNRAG999")` return fields + captured `console.warn` JSON line
