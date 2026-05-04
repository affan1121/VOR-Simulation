# VOR simulator: accuracy vs. standard references

This document maps behaviors in this project to **public, non-proprietary** sources (FAA, common training materials). It is a **training aid**: the sim uses idealized flat‑earth geometry, not a full radio‑field model.

**Tests:** `npm test` (Vitest) — all passing, including exhaustive intercept-grid coverage in `src/utils/vorMath.test.ts`.

## CDI / needle — “fly toward the needle”

- **Reference:** Standard VOR procedure is to **turn toward the course needle** to rejoin the selected course (e.g. discussion of CDI use and tracking in IFR training texts and the AIM navigation aids section on VOR use).
- **This sim:** `vorCdiNeedleFromCourseError` is the **negation** of linear deflection from signed course error so the displayed needle matches cockpit **“fly toward the needle”** sense (`src/utils/vorMath.ts`). Course error uses `vorToFromGeometry` (position only) so the TO/FR **flag** may still flicker in the cone or differ near abeam, but the **needle** does not follow that flag. Teaching strings in `src/teaching.ts` match the rule.

## Full scale and dots

- **Reference:** A very common VOR CDI presentation is **±10°** full-scale lateral deviation, with **2° per dot** (five dots each side to full scale). *Individual panel markings can vary; always use the installed equipment’s plate or POH.*
- **This sim:** `VOR_CDI_FULL_SCALE_DEG = 10`, `VOR_CDI_DOT_STEP_DEG = 2` in `src/utils/vorMath.ts`, and the `VorIndicator` omits the inner 2° dot to match a typical “4 dots per side to 10°” training layout.

## TO / FROM flag

- **Reference:** The TO/FROM indication answers whether the **selected course** (OBS) leads **toward** or **away from** the station for your **position**; it is **not** your aircraft heading. The “split” is the course line through the station and the **perpendiculars** (the abeam / 90°–270° to course context in training). See AIM and training articles on VOR TO/FROM and station passage.
- **This sim:** `vorToFrom` uses the dot product of the **station→aircraft** radial with the **OBS outbound** direction: same half-plane as outbound OBS ⇒ **FROM**, opposite ⇒ **TO** (`src/utils/vorMath.ts`). That matches the usual “which side of the station along the course” picture for a VOR-style hemispheric flag.

## Centering the CDI (VOT-style check)

- **Reference (AIM):** With a VOT (or equivalent) and the CDI **centered**, a common check is **OBS 000° with a FROM indication** (or **OBS 180° with a TO indication**) — the receiver should show no deviation on that test geometry.
- **This sim:** For **FROM**, on-course is **radial = OBS**; for **TO**, on-course is **radial = reciprocal(OBS)** (`referenceRadialForCdi`). A dedicated test encodes the **000 FROM / 180 TO** centering case in `src/utils/vorMath.test.ts`.

## Intercept headings

- **Reference:** Intercept techniques use a **lead angle** and a turn **toward** the course; the correct **inbound** heading on a given radial is the **reciprocal** of the radial, and **outbound** is the radial itself.
- **This sim:** `recommendedInterceptHeading` picks the **±lead** heading (inbound or outbound) that **reduces** |cross-track| to the **infinite course line** via `pickInterceptHeadingTowardRadialLine` (`src/utils/vorMath.ts`) — avoiding the classic trap of a fixed “left always” rule when two mathematical solutions exist (e.g. 180° vs 360° on the same line).

## Intentional simplifications (not bugs)

| Topic | Simplification |
|--------|----------------|
| Earth | Flat NM grid; magnetic = map north. |
| VOR signal | No multipath, siting, or prop modulation (AIM notes roughness/oscillation can occur in reality). |
| Cone of confusion | Modeled with distance threshold + synthetic jitter/flags, not a 3‑D field. |
| Abeam line | `vorOnToFromHemisphereBoundary` uses a **tight** degree window so OFF/flags match “on the line” training without a wide fuzzy band. |
| Reverse sensing | Real panels: **correct OBS** gives “fly toward needle.” If the **wrong** course is selected, the needle still indicates the **selected** — which can feel “reversed” relative to your **intended** track. The sim always shows deviation from the **current OBS**; it does not second-guess the pilot’s intent. |

## Citation starting points (read the linked sections in full)

- [FAA Instrument Procedures Handbook (IPH) – publications index](https://www.faa.gov/regulations_policies/handbooks_manuals/aviation/instrument_procedures_handbook/) — en route VOR use, CDI, intercept language in context of IFR structure.
- [FAA AIM – Navigation Aids (e.g. VOR accuracy, VOT-style checks, to/from context in the VOR discussion)](https://www.faa.gov/air_traffic/publications/) — use the current **AIM** PDF from the FAA site; chapter numbering changes over time; search “VOR,” “CDI,” “VOT.”
- AOPA / training articles (e.g. *VOR orientation*, *ABCs of VORs*) — secondary plain-language backup for TO/FROM and CDI use.

If you need **regulatory or checkride word-for-word** answers, use the **current** FAA ACS for your certificate level and the **current** AIM as published on [faa.gov](https://www.faa.gov).
