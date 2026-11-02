# Evergreen JARVIS API/schema contract v1

Status: local implementation, real-data access disabled. Base when released: `https://evergreen.example.invalid/api/integrations/jarvis`.

The private upstream companion fixture is excluded from this source release. Synthetic test controls cannot establish production access.

All request objects reject unknown top-level fields. JSON POST bodies are streamed and limited to 100,000 bytes. HTTPS only in production; do not put credentials in query strings. Responses use private/no-store, Vary: Authorization, no-referrer and nosniff headers. Platform-generated errors may still be non-JSON: clients must handle this safely without displaying or logging raw bodies.

## Authentication and ownership

Settings endpoints use a current Firebase ID token, verified with revocation checks, for the member actually signed in. Application reads/writes use **only** `Authorization: Bearer ejv1.<grantId>.<serverSecret>`; a Firebase token is not an integration credential. `grantId` is 8–128 `[A-Za-z0-9_-]`, the secret 43–128 characters of the same alphabet. Generate at least 32 random bytes for secrets/verifiers.

There is no `householdId`, `uid`, `member`, `alias`, `mode`, database path or query expression that can choose access in request bodies. Authorities derive from the pinned protected policy, current Auth account, membership grant and matching profile. Finance share/from/to UIDs are record participants, not access grants, and must match the protected pilot participants: one owner in personal mode, two verified members in household mode. Names in results are presentation only.

Every grant is **one member**, one exact household and approved scopes. A household owner cannot consent to the partner's private Career/study/health/income/notes. A write scope requires the same module's read scope so changes can be reviewed. Changing server-approved permissions invalidates the old connection rather than silently broadening it.

Server-only `JARVIS_PILOT_MODE=personal` and protected policy `mode:"personal"` select the one-owner pilot. Absent mode retains the original `household` pilot. `/connection`, disabled candidates and visible grant metadata include `mode` (`personal` or `household`). Personal discovery checks only the nominated owner, without another member's Auth/profile or a household grant query. Another member's unverified account does not block this mode. The security migration/attestation gate still applies. Shared record access requires selected module scopes; private data remains bound only to the connecting UID. A personal grant cannot allocate expenses or repayments to a partner.

## Endpoints

| Method/path | Authentication | Input | Result |
| --- | --- | --- | --- |
| GET `/capabilities` | Public, no records | None | Version, 21-domain supported operations/gaps, configuration flag (not an activation certificate) |
| GET `/connection` | Firebase | None | Current member's Settings availability, verified pilot roster/scopes when enabled, own revocation metadata on hold |
| POST `/discover` | Nominated owner Firebase | `{confirm:true}` | Disabled candidate derived from protected grants: owner only in personal mode, exactly two active UIDs in household mode; no app records |
| POST `/pair` | Public, security gate + global limits | `{credentialHash,codeChallenge}` | Random pairing ID, ten-minute expiry, Settings instructions |
| POST `/approve` | Firebase member | `{pairingId,scopes,confirm:true}` | Bound member grant metadata only; previous own grant revoked |
| POST `/exchange` | Server pairing proof | `{pairingId,verifier,secret}` | Grant metadata, credential format with placeholder, replay flag; never returns a secret |
| GET `/status` | JARVIS | None | Binding/Auth/attestation health, expiry; not a provider-health claim |
| GET `/records` | JARVIS | `domain?,query?,after?,limit?,snapshotRevision?` query parameters | Page, snapshot fingerprint, next keyset ID, binding and gaps |
| POST `/changes` | JARVIS | `{cursor?:{grantId,sequence},limit?}` | Ordered record events/tombstones, next delivered cursor, hasMore, observedThrough, gaps |
| POST `/quote` | JARVIS expense/repayment write | `{currency,date}` | Server-derived household currency and immutable historical FX quote |
| POST `/prepare` | JARVIS module write+read | `{requestId,action}` | Immutable proposal/digest, reviewed before/after effects, ten-minute expiry |
| POST `/commit` | JARVIS | `{proposalId,digest,confirmed:true,confirmationId}` | Durable committed receipt or exact replay; no unconfirmed record write |
| GET `/receipt` | JARVIS | `proposalId` query parameter | Prepared/committed state, receipt or null, expiry flag |
| POST `/rotate` | Old JARVIS credential | `{newSecret,rotationId}` | Old secret revoked atomically; check `/status` with new secret after a lost response |
| POST `/revoke` | Firebase member | `{grantId,confirm:true}` | Own grant disabled immediately, pending commits blocked, purgeCache:true; works on a security hold |

JARVIS persists the original random secret and verifier securely **before** POST `/pair`. Hash = SHA-256 hex(secret); challenge = base64url(SHA-256(verifier bytes)). Use the same values on uncertain retries; never create a replacement secret just because `/exchange` lost its response. The exact approved exchange is replayable; an unexchanged pairing expires after ten minutes.

Settings approval is not sufficient to read records: `exchangeComplete` stays false until the original PKCE proof completes the exchange. Application access and outbox emission are denied while it is pending. Settings can revoke a pending approval. An expired pending approval must be revoked/replaced with a new pairing; it cannot be activated by bypassing exchange.

## Records, paging and changes

```json
{
  "id": "tasks:<base64url-native-key>",
  "domain": "tasks",
  "nativeId": "jarvis_example",
  "revision": "<64-character SHA-256 content fingerprint>",
  "visibility": "member",
  "ownerUid": "<verified-bound-member>",
  "data": {"title": "Review lecture", "type": "task"},
  "source": "evergreen",
  "deepLink": "/daily-planner?record=jarvis_example",
  "deleted": false
}
```

IDs use existing native IDs/map keys, prefixed by domain and base64url encoded; clients treat IDs as opaque and never invent them. Metadata-only singleton records have fixed keys such as `profile/<UID>`. Missing/duplicate legacy IDs or unbound ownership are not guessed by name. A deep link opens the module; not every native page focuses the `record` query parameter yet.

`revision` is a content fingerprint, not a monotonic counter. Feed `sequence` is monotonic per grant. Real Firestore document updateTime plus dependency fingerprints fence commits, including changes-and-restores after prepare. This is intentionally conservative: unrelated changes in a touched root document can require a fresh proposal.

Reads/search: query <=160 characters; limit 1–100 (default 50). First read returns `snapshotRevision`; send it on subsequent keyset pages. A changed snapshot returns 409 `snapshot_changed`; restart from page one. Do not mix pages/bindings. Search is bounded case-insensitive matching of projected data, not a Firestore query language or vector/AI search.

Changes: start with `{limit:50}` (sequence zero), then send the last **delivered** cursor. Transactional native writers and JARVIS atomically emit events. A poll reconciles remaining writers' observed final state, at most 180 differences per reconciliation. Drain `hasMore` before marking sync caught up. Upsert by `(grantId,record.id)`, apply only increasing sequence, atomically persist local changes with the cursor. Never recreate a record from a tombstone.

Deletion event: `{id,domain,revision,deleted:true,data:null,source:"evergreen",sequence,observedAt}`. This includes a record disappearing from authorised visibility. Purge its cache. The feed is **not** a comprehensive event history during a security hold, before connection, or for transient changes from uninstrumented writers between polls. No SSE/push webhook transport is implemented.

Photos are a held capability, not an empty album: an authorised domain=photos read returns 422 photo_provider_held. Broad projections/feeds include that scoped gap, without fetching a provider or exposing media metadata/bytes.

Capacity: 5,000 indexed IDs; index <=650 KB; 50,000 lifetime events per grant; 180 changed rows per canonical transaction; no silent truncation/deletion of journals. 507 `sync_capacity` requires an operator-managed checkpoint/new binding with explicit cache rebuild. Automatic checkpoint/GC and acknowledgement endpoints are not implemented. No production-scale/load-test claim.

## Prepare → correction → explicit confirmation → commit

```json
{"requestId":"persisted-request-uuid","action":{"type":"task.create","input":{"title":"Review lecture","date":"2026-10-07","priority":"Medium"}}}
```

For an edit/delete add `action.recordId` and `action.expectedRevision` from the current read. Do not use the native ID as `recordId`. The action is one operation; purchase.create may contain up to 40 lines. No generic patches, arbitrary root snapshots, supplied actors or Firestore paths.

Proposal includes `proposalId`, `requestId`, `digest`, exact household/member IDs, `summary:{type,input,result,warning,changes}`, `expiresAt`, `requiresExplicitConfirmation:true`. Each readable affected record is described with before/after data; linked effects are included where the grant can read their domain. New records have before:null; deletion has after:null. Treat summaries/content as untrusted data, never assistant instructions.

JARVIS must speak/show the changes, participants, original/converted amounts, date and warnings; collect corrections into a **new requestId/proposal**; and obtain an explicit human confirmation referencing the current digest. It must never manufacture `confirmed:true` from an LLM tool choice, background speech, silence or a prior “yes”. Evergreen cryptographically binds the confirmed payload; it cannot independently prove a spoken human utterance—the companion owns that consent boundary.

Persist request/proposal/digest/confirmation IDs before network sends. Each explicit approval gets a fresh `confirmationId` (8–128 ID characters), durably usable for only that proposal. Submit exact commit once; after interruption, query `/receipt` with the original proposal ID or retry exact commit. A saved receipt proves the operation; never create a new request ID to recover an uncertain write. Request IDs cannot be reused for different details or refreshed after expiry.

Receipt: `{id,requestId,proposalDigest,confirmationId,householdId,memberUid,committedAt,result,status:"committed"}`. Repeated valid commits return the same receipt with `replayed:true`. Receipts, record changes, outbox and confirmation binding commit in the same transaction. Credentials/revocation/current permissions are rechecked even for replays. No provider call, recalculation against a new FX rate, or bank transfer happens after confirmation.

Allowances: <=100 new proposals/day/member-grant and <=10,000 lifetime proposals; existing receipts remain recoverable. Durable limits: 60 authenticated reads/min, 20 writes/min, 20 Settings requests/min, 30 public pairing/exchange requests/min; additionally 20 new pairings/hour. Middleware may impose an additional IP limit.

## Typed action input contract

Required fields listed below. Optional/default fields are marked `?`; all figures finite, all dates ISO `YYYY-MM-DD`, times `HH:mm`. No user-supplied ownerUid/createdBy/source/schema/authority fields. Authoritative validations live in `jarvisActions.js`, `jarvisDomainActions.js`, `jarvisWellbeing.js` and reused domain services. Deletions normally take `{}` plus recordId/revision.

| Actions | `input` fields and rules |
| --- | --- |
| task.create | title<=160, date, priority High/Medium/Low; existing Joybot task schema |
| task.update / complete / delete | update: title?, date?, priority?, completed?; complete: completed boolean; delete:{}; own UID non-linked tasks only |
| schedule.create / update / delete | title, date, startTime, endTime, category? personal/work/education/fitness/food/family, recurringDays? full weekday names. End>start; split overnight blocks. Edit/delete only own JARVIS custom blocks |
| purchase.create | date, currency, householdCurrency, exact server quote, items[1..40], allowDuplicate? false. Each item: name<=120, category<=60, amountMinor positive integer<=100M, split personal/equal/percentage/amount, shares[{uid,value}]. Percentage values are basis points summing 10,000; fixed amounts sum item amountMinor; personal requires the connecting member's one UID. Existing largest-remainder calculation preserves every minor unit |
| repayment.record | date, currency==householdCurrency, server quote, amountMinor, fromUid!=toUid. Ledger settlement only; no transfer |
| pantry.save / delete | name, genericCategory, stockGrams 0..100M, stockUnit g/ml/units, brand?; edit preserves expense provenance; deletion dismisses sourced expense to prevent resurrection |
| recipe.save / delete | name, servings 1..100, link?, mealType? array Breakfast/Lunch/Snacks/Dinner; ingredients<=100 [{tag,grams,unit?,group?}], linkedRecipes?<=20 [{recipeId,servings}]. Saved linked recipes only, no cycles; deletion checks parent references and removes linked planned meals |
| meal.plan / delete | recipeId, dateStr, mealType, servings 1..100. Same recipe/owned slot updates servings using native reducer, retains ID; no inventory consumption |
| shopping.add / check / remove | add name, quantity?, category?; check checked boolean; remove:{}. Existing targets come from recordId; native reducer preserves auto/manual provenance and duplicate prevention |
| habit.save / delete / check | save name, category, frequencyType daily/weekdays/weekends/custom_days/interval/times_per_week; customDays? short weekday names, intervalDays? 1..365, targetPerWeek? 1..7, timeOfDay? morning/afternoon/evening/anytime. check:date,completed; stores UID logOwners binding; an occupied unbound legacy daily log is refused, not claimed |
| loan.save / delete | name,nativeCurrency,interestRate 0..100,repaymentMonths 1..1200,moratoriumMonths 0..1200,moratoriumEmi,firstStatementDate,disbursements<=100 [{date,amount>0}]. Preserves paidMonths/part-payment history; verified bank schedule edits refuse |
| investment.holding.save/delete | name,symbol?,category,nativeCurrency,market?,platform?,units,buyPrice,currentPrice,notes?; derive investedAmount/currentValue, cap 100M |
| investment.bank.save/delete | bankName,accountName,accountType,balance,currency,interestRateApy 0..100 |
| investment.sip.save/delete | holdingName,amount,currency,frequency Weekly/Monthly,dayOfMonth 1..28,platform?,isActive; tracking only |
| investment.goal.save/delete | name,targetAmount,targetCurrency,targetDate? ISO or empty,category |
| study.course.save | code<=40,name,credits 0..1000,semester?,syllabusLink? HTTP(S); unique code in own UID study profile |
| study.assessment.save | courseId,name,weight 0..100,score? null or 0..100,dueDate? ISO or empty,completed? false. Total course weight<=100; native assessment/planner link preserved; only reviewed assessment changes completion |
| study.class.save | courseId,label,weekday 0=Sunday..6,startTime,endTime,location?,startDate?,endDate?; valid term range, no repeated identical class slot; native timetable expansion |
| study.topic.save | courseId,title,nextReview,notes?; own saved course only |
| study.session.create | courseId,title,date,startTime,duration 0.25..12 hours; must end by midnight; UID-owned academic study planner task |
| health.plan.save/check/delete | save title,description?,sessions[1..120] [{date,type,description?,distance,targetTime,targetPace M:SS}]; completed-plan replacement refused. check sessionIndex 0..119,distance>0,minutes>0,difficulty 1..10; derives pace/progress |
| health.intake.record/delete | record kind=alcohol:date,name,category,volumeMl>0<=10,000,abvPct 0..100,cost,notes?; or kind=tobacco:date,type cigarettes/vape/pouches/cigars,quantity 1..10,000,cost,notes?. Derived ethanol/standard-drinks use native calculators. Delete takes kind and reviewed log. New UID profile creation refuses unbound legacy logs; no target change/recommendation |
| run.record/rename/delete | record title,ISO offset-aware datetime,distanceKm>0<=1000,movingTimeMs,elapsedTimeMs positive integers<=30 days,elapsed>=moving; UID/date/distance/time duplicate check. rename:title. No GPX/GPS |
| income.work.save/delete | role,company,type Hourly/Salary,hourlyRate,wageAmount,wageFrequency Weekly/Fortnightly/Monthly/Yearly,weeklyHours,weeklyHoursGoal (0..168). Native validated landedJobs with bound UID; gross tracking, not payroll |
| family.save/update/interest/save-stop/remove-stop/check/schedule | collection milestones/dateIdeas/wishlists/travelPlans; item/id, owner? home or own UID. save item uses existing family validator; update field archived/completed/favourite + boolean value; interest date idea + value; stop saved travel id + stop/stopId; check key transport/booking/packing/weather+value. schedule id,collection,date,startTime,endTime,remove?; native linked planner service. Existing collection/ID/wishlist owner must match reviewed target |
| memory.milestone.save/archive | save title,description?,date,category,anniversaryReminder boolean; archive archived boolean. Native shared milestone reducer; no photo bytes |
| notes.notebook.save/delete | title,description?,paperTemplate cornell/ruled/grid/dot/dark-grid/blank,tags<=10,linkedSubjectCode?,visibility:"household" explicit; metadata only; no TALP document body action |
| career.* | input `{record,baseVersion?}`. saveOpportunity/archiveOpportunity/saveStory/saveResume/archiveResume/saveProfile/addPlannerTask reuse native private Career validators. Edits need top-level recordId/revision and matching record.id; archives require review. Profile record:{experience<=16k,skills<=4k}; native per-record baseVersion CAS. addPlannerTask record:{opportunityId,id,title,date,time,duration>=0.25<=12}; own saved opportunity only. Full opportunity/story/resume shapes are native `careerWorkspace.js`, `careerResume.js`; never import legacy/another member by supplied name |

Supported currencies: AUD, INR, USD, EUR, GBP, NZD, CAD, SGD, JPY. JPY has zero fractional digits; others two. Quote: `{currency,householdCurrency,requestedDate,date,toAud,toHousehold,source}`; source identity or `Frankfurter / ECB`. Provider credentials stay Evergreen-side. A changed rate/currency returns conflict before creating a proposal; a replay uses its original saved proposal.

## Errors and cache handling

### Private Career record shapes for companion clients

All Career action inputs wrap a native record as {record,baseVersion}. A create uses baseVersion=0 and a server-selected record ID. An edit/archive uses the current data.version as baseVersion plus the current opaque recordId/expectedRevision; do not pass the workspace revision as the record version. New inner section/requirement/item IDs are local record identifiers, never household access selectors. Native IDs allow 1–120 letters/digits/underscore/hyphen.

- saveOpportunity record: role/company required (160 characters each); stage Saved/Preparing/Applied/Interview/Offer/Closed (default Saved); location<=200; employmentType<=60; link HTTP(S), no embedded username/password, <=1800; description<=12000; notes<=6000; deadline/appliedDate/followUpDate/interviewDate optional valid ISO dates or empty; interviewTime HH:mm or empty (needs interviewDate); interviewLocation<=500; duration 0.25–12 hours (default 1); valid IANA timeZone (default Australia/Sydney); shareSchedule boolean; submittedDocumentIds<=10 ready document IDs owned by this member; coverLetter<=12000; prepNotes<=6000; requirements<=20; offerPay 0–10,000,000; offerHours 0–168; offerTravel 0–100,000; offerBenefits<=3000; offerCurrency AUD/INR/USD/EUR/GBP/NZD/CAD/SGD. Optional text defaults empty and optional numeric offer fields default zero.
- Each requirement: unique id, text required<=600, note<=1000, status not_reviewed/evidence/gap/question; storyIds array<=4 from this member's saved experience bank. Marking evidence requires at least one saved story.
- archiveOpportunity / archiveResume record: id and archived boolean; choose a currently read own record and its baseVersion.
- saveStory record: title required<=160; situation<=2000, task<=2000, action<=3000, result<=2000, evidence<=1000. This is factual member-supplied content, not a generated/verified achievement claim.
- saveProfile record: experience<=16000, skills<=4000. Use the current profile's own version. No household/partner import selector.
- addPlannerTask record: existing own non-archived opportunityId, id for the native preparation task, title required<=160, date required ISO, time optional HH:mm, duration 0.25–12 hours (native default 0.5). The linked task includes no private documents or preparation notes.
- saveResume record: title required<=120; template classic/modern/editorial; pageSize a4/letter; accent forest/slate/ink; fontSize number 9–12; basics object; sections array<=10. Total serialized native resume<=30,000 bytes and <=60 entries.
- Resume basics: name required<=100; headline<=160; email<=254 (email format if provided), phone<=60, location<=200, website<=1800 (safe HTTP(S)), summary<=2000.
- Resume section: unique id; type experience/education/projects/skills/certifications/languages/custom; title required<=100; hidden boolean; items array<=12.
- Resume item: globally unique id within resume; title required<=160; subtitle<=200; period<=100; body<=2000; sourceStoryId optional own saved story ID. A source story can appear only once per resume. Defaults for optional text are empty.

The native workspace limits are 200 opportunities (including archived), 100 stories and 10 resumes; whole private workspace<=650 KB. Save uses existing native parsers, per-record CAS and own-document/story reference checks. Unknown native fields are not persisted by those parsers. No arbitrary patch or private file upload/download is added by this contract.

### FamilySpace record input notes

family.save carries collection and item; updates carry collection/id/field/value, with own UID or home wishlist selector where needed. The native reducer accepts only its saved idea/travel/milestone/wishlist fields and rejects unsupported collections/relationships. Read the current record first for edits rather than sending a complete FamilySpace root. Save-stop/remove-stop acts on the reviewed travel plan; it does not fetch or book a place. family.schedule is a linked planner record action, not a booking/purchase. Native record shapes are returned by bounded /records, and user corrections always create a new proposal.

`{error:{code,message,retryable},purgeCache}`. 400/413/415: correct input, never retry blindly. 401/403: stop all access and purge that member/grant cache. 409: read current records and obtain fresh explicit approval, never auto-merge/auto-confirm. 410: fresh review/new request ID. 422: unsupported capability, surface the gap. 429: back off. 503: security hold/provider/Auth unavailable; suspend writes, preserve draft; do not fall back to Firebase or another household. 507: checkpoint needed, no dropped changes.

Private-cache key includes memberUid, householdId, grantId and record ID. Partition Owner's and Partner's approvals/caches; a shared device or voice session does not imply partner consent. A revoke cannot recall copies already downloaded: JARVIS must immediately stop serving/purge its local cache when denied or explicitly disconnected, and must support local deletion even offline. Audit provider/platform request logging before release; never log Authorization, pairing material, sensitive search or proposal bodies.


