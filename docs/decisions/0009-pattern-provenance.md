# ADR 0009: Pattern provenance from structural fingerprints, not embeddings

Status: Accepted, 2026-10-10

## Context

Question 4 of the brief: when a new or modified pattern appears, is it justified? A new pattern must not be rejected for being new. We found no tool that classifies each changed component per pull request ([prior-art-and-governance.md](../research/prior-art-and-governance.md)). The brief asks to use source relationships, metadata and repository search before embeddings or a vector database.

## Decision

- Index top-level PascalCase functions that render JSX: declarations, arrows, and `memo` or `forwardRef` wrappers.
- Each component's fingerprint is the set of what it renders:
  - `ds:<Component>`, resolved through imports from the policy's design-system import sources, including aliased and namespace imports;
  - `component:<Name>`;
  - `html:<element>`, ignoring structureless elements (`div`, `span`, `p`).
- References are the policy's reference patterns plus components in unchanged, non-design-system files.
- Classification of each changed component:
  - Existed before (read from the merge base): **established** if its fingerprint is unchanged, **modified** otherwise.
  - Fewer than `minElements` elements, or mostly dynamic structure (spread props, computed tags, `createElement`): **insufficient-evidence**.
  - Otherwise, by the best similarity to a reference: ≥ 0.6 **established**, ≥ 0.3 **modified**, else **novel**. Similarity was Jaccard over composition at first; since B15 it is the lower of composition and tree shape (see Consequences).
- Records always appear in the report. The `pattern-provenance` check turns the classes into findings according to policy options (`review`, `notice` or `off` per class). The demo reviews novel patterns and only notes the others. Origin is `heuristic`.
- Separately, the `duplicate-component` check flags components whose name matches a registered component or alias (pill, chip, banner and so on) without using it.

## Consequences

- Cheap, explainable and deterministic. The report shows the nearest precedent and its similarity score.
- Ignored tree shape and props at first. Tree shape was added later (backlog B15) as a second signal: similarity is the lower of composition (Jaccard) and shape (Zhang-Shasha tree edit distance over the nesting, normalized like the composition: generic elements dropped, adjacent identical subtrees counted once). On the 11 scenarios every classification stayed the same, while new unit cases show the gain: a rearranged component is `modified`, and the same components in a different layout are no longer `established`. Props are still ignored; embeddings were not needed. Trees over 300 nodes are compared by composition only, because the edit distance grows with the product of the tree sizes (about 4 s for a pair of 1,100-node trees). A reference file changed by the pull request is read as it was in the base, so editing a reference cannot vouch for new code.
- Thresholds are calibrated only on the demo corpus so far.
