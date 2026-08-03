# Leone User Acceptance Testing

Use this checklist for owner-led acceptance of the deployed beta at
`https://bots.leonorekingdom.xyz`. Record the tester, timestamp, evidence link,
actual result, and Pass/Fail for every case. Do not use real sensitive reports or
private relationship labels as test data.

## Test accounts and prerequisites

- Owner account: guild owner with the expected admin capabilities.
- Staff account: mapped to one or more explicit capability role IDs.
- Member account: guild member without administrative capabilities.
- Optional outsider account: not a member of Leonore's Kingdom.
- Two consenting member accounts for Bonds tests.
- A private test channel where Leone can view, send, embed links, and mention only
  the approved opt-in greeting role.
- `GREETINGS_SCHEDULER_ENABLED=false` until the scheduler cases are explicitly run.

Before starting, confirm `/healthz` returns HTTP 200 with
`{"status":"healthy"}` and the Discord Developer Portal shows the production
Interactions Endpoint URL.

## A. Deployment and security boundary

| ID | Actor | Action | Expected result |
|---|---|---|---|
| A-01 | Anyone | Open `/` | React dashboard shell loads over HTTPS; no secret appears in page source or browser storage. |
| A-02 | Anyone | Open `/healthz` | HTTP 200 and only `{"status":"healthy"}` is returned. |
| A-03 | Anyone | GET `/api/discord/interactions` | Express returns 404; the route exists but accepts POST interactions only. |
| A-04 | Tester | POST an unsigned or incorrectly signed payload to `/api/discord/interactions` | HTTP 401 with `INVALID_SIGNATURE`; no command executes. |
| A-05 | Owner | Check Vercel logs after A-04 | A signature-rejection event exists without token, request body, or message content. |
| A-06 | Member | Run `/ping` | Leone responds once through the HTTP interaction endpoint. |

## B. Kingdom and help commands

| ID | Actor | Action | Expected result |
|---|---|---|---|
| B-01 | Member | Run `/help` | Commands are grouped by area and include Kingdom, Relationships, Recommendations, and Automation. |
| B-02 | Member | Run `/about` | Copy reflects the approved palace/safe-haven identity, Leonore as male, and Leanne as female. |
| B-03 | Member | Run `/staff` | Leonore and `@leannexyz` are mentioned from Discord IDs under Supreme Royalty; Admin and Moderator members are current. |
| B-04 | Member | Run `/rules` | Rules and navigation are readable and do not create unauthorized mentions. |
| B-05 | Member | Run `/server` | Live server details render without leaking private channels. |
| B-06 | Owner | Run `/server-map` | All visible channels are paginated and no embed exceeds Discord's 6,000-character aggregate limit. |
| B-07 | Member | Run `/server-map` | Only channels the member can view appear; result succeeds with no permission error. |

## C. Leone Bonds and family tree

Use disposable labels and remove every test bond when finished.

| ID | Actor | Action | Expected result |
|---|---|---|---|
| C-01 | Member A | Request a bond with Member B using `/bonds request` | Private confirmation appears; no relationship exists before acceptance. |
| C-02 | Member B | Accept with requester mention and type | The request is accepted without exposing an internal request UUID. |
| C-03 | Member A | Submit the same bond again | Duplicate request/bond is rejected safely. |
| C-04 | Member A/B | Attempt self-link or a parent/mentor cycle | Request is rejected and the graph remains unchanged. |
| C-05 | Member B | Create two pending types from Member A, then accept without type | Leone asks for the relationship type instead of accepting an ambiguous request. |
| C-06 | Member A | Set family privacy to private | A third member cannot retrieve the protected edges. |
| C-07 | Member A | Open `/family/<member-id>` after OAuth login | React Flow renders permitted nodes/edges with usable zoom, fit, and labels. |
| C-08 | Member A | Export Bonds data | Export contains only the member's guild-scoped data. |
| C-09 | Member A | Delete Bonds data and confirm | Profile, requests, blocks, and edges for that member are removed; another guild is unaffected. |
| C-10 | Member A/B | Unlink test bonds | Both members' trees update and no Discord roles/permissions change. |

## D. Movie recommendations

| ID | Actor | Action | Expected result |
|---|---|---|---|
| D-01 | Member | Run `/recommend movie` with mood/genre/runtime filters | Up to three relevant TMDB results include a concise reason and attribution. |
| D-02 | Member | Request adult content or provide invalid ranges | Adult results remain excluded and invalid input is rejected. |
| D-03 | Member | Repeat a query while TMDB is unavailable or rate limited | Leone returns a safe provider error/retry message and exposes no API credential. |

## E. Greetings manual flow

Run in the private test channel with a self-assignable opt-in role; do not use
`@Citizen` for beta testing.

| ID | Actor | Action | Expected result |
|---|---|---|---|
| E-01 | Member | Run `/greetings preview` | Request is rejected as unauthorized. |
| E-02 | Owner/staff | Preview a morning/evening/occasion template | Response is private and does not ping a role. |
| E-03 | Owner/staff | Send the approved preview to the test channel | Exactly one public message is sent and only the approved role can be mentioned. |
| E-04 | Owner/staff | Preview with missing/unavailable BMKG data | A weather-neutral greeting is produced. |
| E-05 | Owner/staff | Repeat the same deterministic daily quote inputs | The quote remains stable for the Jakarta date. |

## F. OAuth and admin dashboard

Do not run this section until `DISCORD_CLIENT_SECRET` is present in Vercel and
the exact Discord redirect URI is saved.

| ID | Actor | Action | Expected result |
|---|---|---|---|
| F-01 | Outsider | Start Discord login | Login is denied because the account is not a guild member. |
| F-02 | Member | Log in with Discord | Session cookie is Secure, HttpOnly, SameSite=Lax; member APIs work but admin pages return 403. |
| F-03 | Owner | Log in with Discord | Overview, integration health, configuration, greetings, schedules, runs, and audit pages load. |
| F-04 | Staff | Open dashboard with one mapped role | Only capabilities mapped to that role are allowed. |
| F-05 | Admin | Submit a state-changing request without CSRF token | Request is rejected. |
| F-06 | Owner | Change a safe configuration value | Change is validated, guild-scoped, and appended to the audit log without secret values. |
| F-07 | Staff | Remove the capability role, then start a new session | Access is revoked. Verify again after the maximum 24-hour session lifetime. |
| F-08 | Member | Log out | Session is invalidated and protected APIs return 401. |

## G. Opt-in scheduler soak test

Run only after the owner explicitly enables scheduling and completes the Vault
steps in `Deploy.md`.

| ID | Actor | Action | Expected result |
|---|---|---|---|
| G-01 | Owner | Create a disabled schedule | Schedule is stored but no message is dispatched. |
| G-02 | Owner | Enable one test schedule for the opt-in role/channel | The next due run sends exactly one greeting. |
| G-03 | Owner | Invoke dispatcher twice for the same due slot | The stable nonce/run key prevents a duplicate message. |
| G-04 | Owner | Set `GREETINGS_SCHEDULER_ENABLED=false` | Dispatcher performs no sends while previews/manual sends remain available. |
| G-05 | Owner | Re-enable within the 15-minute grace window | One eligible missed run is recovered; older runs are not replayed. |
| G-06 | Owner | Leave the schedule running for seven days | Zero duplicates, unauthorized mentions, or unexplained missed runs. |

## H. Rollback and recovery

| ID | Actor | Action | Expected result |
|---|---|---|---|
| H-01 | Maintainer | Promote the prior Vercel production deployment in a rehearsal | Domain returns to the prior healthy build without a DNS change. |
| H-02 | Maintainer | Restore a `pg_dump` into an isolated Supabase/local database | Migrations, row counts, constraints, privacy tests, and sample tree queries pass. |
| H-03 | Maintainer | Re-run the JSON importer | Existing checksum is reported as already imported; no duplicate data is created. |

## Acceptance record

- Build/test baseline: 35 automated tests passing and Vite production build passing.
- Production URL: `https://bots.leonorekingdom.xyz`
- Production deployment: `dpl_4toHu9Kkt2qqHe7HWdTtRpZ9A3tw`
- Discord application: `1532088865035124946`
- Supabase project: `buzixaugbqtcmiwpwuem`
- 2026-08-03 smoke evidence: A-02 passed; logged-out `/api/v1/me` returned
  401; OAuth redirected with the exact callback; owner authorization reached
  `/admin`. Complete the remaining F-series cases with the listed test accounts.
- UAT owner approval: ____________________
- Date: ____________________
- Open defects/exceptions: ____________________
