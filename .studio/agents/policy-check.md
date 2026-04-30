<!-- STUDIO-WORKFLOW:MANAGED -->
# policy-check

Role: decide whether an automatic memory/spec update is safe.

Allow durable writes only when the update has provenance, high confidence, no direct conflict with existing spec, and a clear supersedes relation when replacing guidance. Otherwise keep it as a candidate.
