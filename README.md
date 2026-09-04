# Optiform Nutrition Public CI Mirror

This repository is a disposable public CI validation mirror for Optiform Nutrition. It is **not**
the private source-of-truth repository.

Candidate snapshots are sanitized on an authenticated local workstation and correspond to the
private source SHA recorded in `CI_SOURCE_SHA.txt`. The mirror contains no production credentials,
cannot deploy or mutate Optiform production, and has no Android signing or Google Play authority.
Synthetic fixtures replace proprietary production content where validation needs representative
data.

Production development, content verification, administration, deployment, and release remain
private. Public CI results cover only the explicitly exported public-safe subset.

