# Calibration data

## `rpp-replication.csv`

One row per study from the **Reproducibility Project: Psychology** (Open Science
Collaboration, 2015, *Science* 349, aac4716) for which both the original result and the
replication outcome are available (96 of the 100 replications).

| Column | Meaning |
|---|---|
| `id` | Row id in the project's published data |
| `discipline` | `Cognitive` or `Social` |
| `p_original` | The original study's p-value for the key test |
| `n_original` | The original study's sample size |
| `r_original` | Absolute effect size of the original, as a correlation |
| `replicated` | 1 if the project coded the replication as successful ("yes"), else 0 |

Source: <https://github.com/CenterForOpenScience/rpp> (`data_allformats/RPPdataConverted.csv`,
retrieved 2026-10-14), reduced to the columns above. The original data are the
Open Science Collaboration's; see the repository and <https://osf.io/fgjvw/> for the
full dataset and terms.

Scope: psychology (cognitive and social) experiments. It says how well original
statistics predict replication *there*, not in other fields.

## `../cases.json`

A small hand-built set of historical results (held up vs refuted) used as a smoke test
for the claim score. See `DESIGN.md` §4 and `npm run calibrate`.
