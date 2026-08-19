# Eval sweep — read-out (draft)

Three runs beat the shipped baseline on exact match. My read:

- **run-c-cosine+ema** is the candidate: best exact match (79.2%) at a val loss
  within noise of run-a's best checkpoint.
- The 15ms p50 regression comes from the EMA weights, not the schedule — run-c
  without EMA sits at 195ms too.
- run-b diverges after epoch 18; not worth another sweep at lr 1e-3.

**Open question for you:** is 15ms of p50 an acceptable price for +0.3pt exact
match, or should I re-run the candidate with EMA disabled at inference?

_Take a pen to this — anything you write here I read back before the next sweep._
