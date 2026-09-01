# Research: Cross-Language Metadata Fallback via Original Title

## Fallback Trigger

- **Decision**: Attempt one original-title lookup only when the field is non-empty and either categories are absent/empty or the current slug has no usable cover, unless the title equals the stored title.
- **Rationale**: This matches FR-003, avoids unnecessary API calls after a complete primary result, and makes reruns stable after categories and cover are filled.
- **Alternatives considered**: Always perform the fallback; rejected because it wastes calls and can introduce needless cross-language data.

## Result Merge

- **Decision**: Treat fallback metadata as a restricted result: append its categories and cover URLs to the primary candidates, but discard its description and do not replace existing non-empty categories without `--force`.
- **Rationale**: The existing `pickBestCover` remains the single image selector while the description language boundary is enforced structurally.
- **Alternatives considered**: Replace the primary result; rejected because it could overwrite curated data and bypass ISBN cover candidates.

## Failure Isolation

- **Decision**: Distinguish fallback miss, API/network failure, and success in the enrichment report; on failure or empty result, retain the current entry and continue the run.
- **Rationale**: Operators need to know whether no record exists or the service failed, while best-effort enrichment must not damage the archive.
- **Alternatives considered**: Treat all failures as not found; rejected because rate limits and outages need different remediation.

## Shared Deployment

- **Decision**: Implement the behavior in the repository metadata module and synchronize the equivalent Azure shared module using the existing `azure/scripts/sync-shared.mjs` workflow.
- **Rationale**: Both ingestion paths already share this boundary, reducing divergence and satisfying FR-009.
- **Alternatives considered**: Implement only in the CLI; rejected because serverless ingest would silently lack the feature.

## Serialization

- **Decision**: Add `originalTitle` after the existing identity fields only when it is a non-empty string; omit it otherwise.
- **Rationale**: This preserves hand editing and compact output while making records without the field unchanged in content and layout.
- **Alternatives considered**: Persist `null` for every record; rejected because FR-008 requires omission when absent.
