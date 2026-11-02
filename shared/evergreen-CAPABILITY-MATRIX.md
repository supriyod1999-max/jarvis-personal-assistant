# Evergreen ↔ JARVIS coverage matrix

Agent GPT · protocol v1 · local implementation, NOT live or complete all-module acceptance.

The API's GET /capabilities is the machine-readable inventory. All 21 requested domains remain in scope. “Yes” below means a UID/visibility-filtered projection is implemented, not that all legacy data is authorised or a real pilot connection exists. Reads/search/events require a separately approved read scope. Writes require that module's read AND write permissions plus exact reviewed confirmation.

**Personal-owner mode:** one protected UID connects independently; the partner's verification/grant is not required and their private data stays excluded. Explicitly selected shared modules may be read/changed within the same household. Purchase allocations may name only this owner, so partner/shared allocations and between-member repayments remain Evergreen workflows until a separately reviewed two-member policy is approved. Discovery and outbox do not query the partner's identity or private path. Unbound-member native edits are reconciled on later polls, not a complete event-history guarantee. The deployed-security gate is unchanged; personal mode is not a workaround for public rules.

## Per-domain operations and gaps

| Domain | Read/search/change feed | Reviewed record actions implemented | Explicit gaps and privacy conditions |
| --- | --- | --- | --- |
| tasks | Yes: native planner tasks | task.create, task.update, task.complete, task.delete | Existing edits need own UID ownership and current revision. Linked Study/Career/Family tasks must use the source workflow. No reinterpretation of an owner name. |
| planner/schedules | Yes: non-task planner rows, custom blocks, templates, UID-owned or explicitly shared sleep metadata | schedule.create, schedule.update, schedule.delete | Edit/delete only own JARVIS custom blocks. Templates, sleep/wake, native/linked schedule edits and overnight blocks need additional adapters. Academic class slots use study.class.save. |
| study/university | Yes: own UID university profile, courses, assessments, classes, topics, visible portal events and derived grades | study.course.save, study.assessment.save, study.class.save, study.topic.save, study.session.create | Preserves assessment tasks and class timetable format. Delete/archive, feed management/refresh, transcript comparison/override, university profile edits and resource/media imports remain native workflows. Feed secrets never returned. Name-keyed profiles withheld. |
| income | Yes: own UID income-map entries and UID-owned work/shifts/rentals/promotions | income.work.save, income.work.delete | Gross work-income records only. Base income-map mutation, shifts/rentals/promotions write adapters and ambiguous name-owned history remain open. No payroll, tax filing or bank action. |
| expenses | Yes: shared/own personal purchase lines and metadata | purchase.create | Up to 40 lines, per-line personal/equal/percentage/fixed allocations, existing quote/currency calculations and grocery inventory sync. Personal lines must belong to the connecting member. Existing purchase edit/delete/reversal not implemented. Legacy personal names withheld. |
| splits | Yes: allocated shared purchase rows | Created within purchase.create under expenses permissions | No independent split mutation. Cannot rewrite a saved allocation without a new reviewed purchase workflow. Minor-unit remainder calculation reused. |
| loans | Yes: own UID loans, including safe tracking/payment-history fields | loan.save, loan.delete | Existing edit preserves payment history; bank-verified schedules refused. Loan paid-month/part-payment/schedule mutation, import/comparison and calculated statement projections remain open. No lending or transfer execution. |
| repayments | Yes: household settlement ledger rows | repayment.record | Records a ledger entry ONLY; no bank transfer. Reversal/edit/delete and loan-payment-history actions remain open. Household currency required. |
| investments | Yes: own UID holdings, bank accounts, SIPs and goals | investment.holding.save/delete, investment.bank.save/delete, investment.sip.save/delete, investment.goal.save/delete | Tracking only, derived holding values retained. No broker trading, live provider refresh, auto debit or transfers. Name-owned legacy entries withheld. |
| pantry/inventory | Yes: safe stock records; excludes another member's personal purchase provenance | pantry.save, pantry.delete | Preserves sourceExpenseId; deletion records dismissal to prevent automatic re-add. Provider/nutrition lookup, multi-allocation and stock-consumption workflows need further adapters. |
| recipes | Yes: saved recipes and linked ingredients | recipe.save, recipe.delete | Prevents linked cycles, validates recipe references, removes eligible linked plans. Refuses deletion if another member has a private plan using the recipe. Extraction/provider lookup/nutrition enrichment not exposed. |
| meals | Yes: planned meals and eligible consumption/history rows | meal.plan, meal.delete | Native slot upsert preserves ID/servings; UID slots never collide by name. Planning does not consume stock. Consumption/history writes, nutrition targeting and inventory deduction need native transactional adapters. |
| shopping | Yes: canonical shared list plus readable legacy checklist rows | shopping.add, shopping.check, shopping.remove | Native reducer preserves automatic/manual provenance, source keys and duplicate prevention. Legacy checklist mutation and retailer/provider actions not implemented. |
| habits | Yes: own UID habits and explicitly UID-bound daily logs | habit.save, habit.delete, habit.check | An occupied name-keyed daily log without a UID binding is refused rather than claimed. Mindset logs, badges/settings, ambiguous old habits and ownership migration remain open. |
| health | Yes: own UID measurements, UID-owned training plans, own UID-bound intake settings/logs, explicitly owned/shared challenges | health.plan.save, health.plan.check, health.plan.delete, health.intake.record, health.intake.delete | Native pace/progress and intake calculators. No body-metric, target/challenge writes, medical advice, provider import or prescription actions. Name-keyed intake history refuses implicit migration. |
| running | Yes: own UID run summaries and derived statistics | run.record, run.rename, run.delete | Manual summary only, duplicate activity prevention. No raw GPX/GPS routes, file upload, provider/media access, challenge progress or automatic reward/badge mutation. |
| family/FamilySpace | Yes: eligible date ideas, travel plans/stops, milestones, media backlog, shared home wishlist, own UID wishlist | family.save, family.update, family.interest, family.save-stop, family.remove-stop, family.check, family.schedule | Native idea/travel/wishlist reducers and linked schedules. Media-backlog writes, long-distance configuration/time zones, polls and legacy bets/goals need adapters. Not every FamilySpace singleton is projected. |
| memories | Yes: explicit memory rows and milestone metadata | memory.milestone.save, memory.milestone.archive | Other memory editing/import and photo-linked album operations remain open. A milestone may appear in both FamilySpace and memories with separate domain IDs; these are views of one native record, not duplicate writes. |
| photos | **No** | **None** | Previous photo/storage activation remains on hold. No album/photo byte, thumbnail, signed URL, upload/download or provider call is exposed. A future media adapter needs its own member checks, scoped bytes/limits and approved activation. |
| notes | **Metadata only**: own UID or explicitly shared Evergreen notebook catalogue | notes.notebook.save, notes.notebook.delete | These adapters explicitly create/manage shared household notebook metadata. No TALP pages, strokes, text bodies, attachments or remote notebook content. Full notes require the TALP agent's authorised API and an extended contract. |
| Career | Yes: only the connecting member's separately stored profile, opportunities, stories, resume records and document metadata | career.saveOpportunity, career.archiveOpportunity, career.saveStory, career.saveResume, career.archiveResume, career.saveProfile, career.addPlannerTask | Existing service/revision/duplicate checks reused. No partner private path queried. File bytes/upload/download, AI drafting, recruiter/site credentials and legacy migration remain open. Native strict resume schema still applies. |

## Storage and identity map

| Native source | Use |
| --- | --- |
| users/<verified-household-ID> | Shared native module fields; legacy owner labels are NOT access grants |
| private_photo_memberships/<verified-member-UID> + users/<same-UID> | Protected active membership and matching account/profile; Auth account checked current and verified |
| private_household_secrets/<verified-household-ID>/career_members/<bound-UID> | Own private Career workspace only; never read the other member's path for the connection |
| private_household_secrets/jarvis/policy/pilot | Operator-owned exact two-member binding, per-member permitted scopes and security attestation |
| private_household_secrets/jarvis/members/<bound-UID> | Own connection ID; separate approval for each person |
| private_household_secrets/jarvis/grants/<grant-ID>/… | Private credential hash, proposals, confirmations, feed/index and durable receipts; client rules deny direct access |

This bridge's filtering does not retroactively make all old shared-root Study/health/work data private in the rest of Evergreen. That broader migration is a separate release gate.

## Synchronisation acceptance limits

Canonical workspace, purchases/settlements, Career/document metadata, legacy work, Joybot record actions, onboarding completion and bridge commits stage native change events transactionally. Other client/legacy writers are observed on the next poll. A transient change-and-delete between polls from an uninstrumented writer is not guaranteed to appear as history. Final authorised state converges; this is not yet a universal event journal.

Stable IDs use existing keys; revisions are content hashes; sequences are monotonically increasing per connection. Missing/duplicate IDs and unbound ownership are surfaced as gaps/errors, never silently invented. Restart/durable receipt and CAS tests passed on synthetic data; not yet signed-in production or cross-application acceptance.

## Remaining implementation order

1. Complete the separate household security release, exact owner/member nomination and two-person consent; do not enable this pilot against current public rules.
2. Have JARVIS implement the v1 server-only companion and synthetic end-to-end spoken review/receipt/cache tests.
3. Add transaction-backed existing-purchase edit/delete/split recalculation, loan-payment and income-map actions with reversal/provenance tests.
4. Complete Study deletes/profile/transcript/source workflows and planner sleep/templates/linked actions.
5. Add meal-consumption/inventory, health targets/measurements, mindset, FamilySpace settings/media and remaining memory adapters.
6. Coordinate TALP full-content access separately; keep photo-provider access held until approved.
7. Instrument remaining native writers, add bounded journal checkpoint/retention, and real signed-in desktop/mobile/companion acceptance before claiming full coverage.

Unsupported actions return 422; withheld data is not equivalent to “no records exist.” JARVIS should explain the gap and open the correct Evergreen module, not attempt an alternative Firebase query.

