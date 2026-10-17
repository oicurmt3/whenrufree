# Changelog

All notable changes to When RU Free, in reverse chronological order.

---

## 2026-10-17 - Reports for everyone, test users, profile actions

### Added
- **Reporting for every member:** the People list now has a flag on each person you can see. A report about another member goes to that calendar's organiser, who sees who reported and can **Dismiss** (silent), **Block**, **Remove** or **Send to super admin**. A report about the organiser goes straight to the super admin, because an organiser cannot decide a complaint about themselves. Waiting reports show as a count on a new **Reports** button in the calendar toolbar
- **Profile page actions:** organisers get **Delete calendar** on each calendar they organise, and members get **Leave calendar**, which removes their name and every choice they made. Both confirm first; the calendar stays for everyone else when you leave
- **Test users in the admin panel:** the Accounts tab can create up to 10 test accounts at a time (no sign-in method of their own), open one in this browser with **Open as**, and return with **Return to my account**. The same marker shows a banner on every tab
- **Template examples from the Setup tab:** an **Example** button can be attached to each template card on `ideas.html`, with its own link, label, icon and access emoji, instead of editing the page by hand

### Changed
- **Reports survive the right things:** member-to-member reports are deleted with their calendar, but reports about an organiser are kept after the calendar is gone, so deleting a calendar can never erase a complaint about the person who deleted it
- The organiser's **Manage person** menu still reports to the super admin, as before; a super admin's Reports tab now shows the reporter's name, the calendar title snapshot and which reports were escalated
- Profile page copy: **Your default name on calendars**, "Only you can see it; it is never shown on calendars", and an **empty Hubs** line that links to creating one
- Templates page heading for the sports card is now **Weekday Sports Tryouts**

### API
- New `report_user` (any joined member), `calendar_reports` and `decide_calendar_report` (organiser); `calendar_meta` adds `open_reports`
- New `account_leave_calendar` and `account_delete_calendar`; new `admin_test_users`, `admin_create_test_user`, `admin_delete_test_users`, `admin_impersonate` and `admin_impersonate_end`
- `migrations/015_admin_test_users.sql` adds `accounts.created_by_admin`; `migrations/016_report_audience.sql` adds `reports.audience`, `target_role`, `reporter_user_id`, `reporter_name`, `calendar_title` and `outcome`

---

## 2026-10-12 - Option controls on the create page, Hidden names opt-out

### Changed
- **Default option and un-answered colour now sit in the options list:** every status option row ends in a checkbox. Tick one to make it the **default option**, so each person's slots start on it and no slot is ever un-answered; leave them all unticked and slots start in the **No option** colour. Ticking a box hides the **No option** row, because nothing is left un-answered. The old **Default option / No default option** switch, the standalone un-answered colour field and the "default option" hint line are gone
- **The "No option" row:** a static row at the bottom of the options list, laid out like an option row but with no move or delete. Its colour picker offers the same five greys (black to white) and paints the row's fixed "No option" label. Not offered on booking calendars - their slots are free until somebody books them
- **Hidden names are a positive opt-out:** on Hidden calendars names are private by default and the checkbox now reads **Show everyone who has joined (but not their choices)**. Switching back to Hidden re-ticks it to the private default. Template URLs accept `names=visible` as well as `names=hidden`
- **Removed the un-answered colour and default option from Calendar settings:** both are fixed at creation, so the modal no longer offers them and the `set_null_color` / `set_slot_default` endpoints (and their rate-limit entries) are deleted
- **Hint wording:** privacy hints, the date filter hint ("Show all dates in the range.") and the Hub access emoji off-state ("Optional emoji for Hub access")

### API
- `create_calendar` accepts `null_color` (`#rrggbb`, one of five greys) and `default_status` (1..N option), both for availability calendars only; `calendar_meta` returns `null_color`, `null_color_available`, `default_status` and `default_status_available`
- `hide_names` is now the Hidden default: the create page sends `hide_names: 1` unless the organiser ticks **Show everyone who has joined (but not their choices)**

---

## 2026-10-10 - Invite only removed

### Removed
- **Invite only is gone.** The link is the only access control again: anyone signed in with it can open and join a calendar or Hub. Nothing else changed about who can see what
  - Deleted endpoints: `request_access`, `cancel_access_request`, `access_requests` and `decide_access_request`. Deleted columns: `calendars.invite_only` and `groups.invite_only`. Deleted table: `access_requests`. Deleted error codes: 403 `INVITE_ONLY` and 403 `REQUEST_DECLINED`, plus the 10/hour `rqa` request rate limit. Deleted log events: `ACCESS_REQUESTED` and `ACCESS_REQUEST_DECIDED`
  - Deleted UI: the **Who can join** toggle on the calendar create page and the Hub create page, the **Request access** / **Waiting for approval** panels, the organiser request lists and count badges (People, Hub page, admin), and the admin "Invite only" badges
  - **Kept:** `calendars.hide_names` and `users.blocked`, which were never about invites. **Hide names too** and **Block** (with the blocked panel, the Manage person menu and the "Blocked" profile tag) work exactly as before. The Hub-wide block, which only existed for Invite only Hubs, is gone
  - `get_site_config` replaces `features.invite_only` with `features.hide_names`; `calendar_meta` drops `invite_only`, `invite_via_hub` and `pending_requests`; `group_meta` drops `invite_only` and `pending_requests`; `account_memberships` drops `pending_requests` and `requests`; `create_calendar` / `create_group` no longer accept `invite_only`
  - `migrations/014_drop_invite_only.sql` drops the `invite_only` columns and the `access_requests` table. cleanup.php no longer has a request-pruning step, so the reports step is now step 11
  - `includes/members.php` keeps only `membersGate()` (calendar block), `membersCalendarBlocked()` and `membersNamesHidden()`

---

## 2026-10-10

### Added
- **Manage person menu:** the People list's separate block and delete buttons are replaced by one `more_vert` control per person, which opens a **Manage person** window: a two-way **Block / Unblock** toggle that opens on the person's current status, a **Delete this person** checkbox, and a **Report** dropdown with optional details. **Confirm choices** opens a review step listing exactly what will happen, with **Back** to change it and **Apply** to go ahead. The Apply button turns red when a delete is included
- **Reporting to the super admin:** organisers can report a person (with a reason and up to 200 characters of detail) on its own or alongside a block or delete. Reports appear in the admin **Reports** tab (`admin_reports`, `admin_report_decide`), where the super admin dismisses a report or deletes the account. Needs `migrations/011_report_users.sql`; until it runs the Report dropdown is hidden
- **Private usernames:** accounts get a fixed, auto-assigned username (`user######`) at sign-up, visible only to the super admin (and organisers, for reporting). Usernames are no longer editable; the profile name is what appears on calendars

### Changed
- **API:** `set_user_blocked`, `report_user` and `delete_user` are replaced by one `manage_calendar_user` action, which applies the choices in a fixed order - the report first (while the name and account still exist), then the block, then the delete - so a report sent alongside a delete is never lost. Sensitive POST list now carries `manage_calendar_user` and `admin_report_decide`
- **Blocking is called blocking:** the profile tag, blocked panel and People list row now read "Blocked" instead of "Access paused", and the 403 body reads "The organiser has blocked you from this calendar" / "...from this Hub"
- **Reports tab wording:** the admin intro now says reports come from the Manage person menu, not from blocking alone

---

## 2026-10-09

### Added
- **See someone's calendar (read only):** in the **People** list, tap the eye button beside a name to show their answers in the grid; tap it again (`visibility_off`) to hide them. A bar above the calendar reads "Viewing NAME"; its close button or Escape also goes back to yours. Taps on slots only show a message, your own unsaved changes are kept, and the organiser's coloured edge still shows unless you are viewing the organiser. Follows the Best Match names rule: joined people on Open calendars, the organiser on Hidden calendars, nobody on Blind calendars. Not on booking calendars or for blocked people. No server change: the page only draws answers the server already sends
- **Organiser's coloured edge is optional:** on Open calendars the organiser can untick **Show my answers on everyone's calendar** in Calendar settings (gear) so people aren't steered towards their choices. On by default. API: new `set_organiser_marks`; `calendar_meta` adds `organiser_marks` and `organiser_marks_available`. New `migrations/010_organiser_marks.sql` adds `calendars.show_organiser_marks`; until it runs the edge always shows and the setting is hidden. The gear now shows for organisers of Open calendars even without the access emoji
- **Home page while signed out:** the create page is visible instead of hidden behind the sign-in panel. The header shows a **Sign in** button, and tapping anything in the form opens the sign-in panel, which can now be closed (X, Escape or tapping outside). Hub links (`?g=`) and unfinished account set-up still go straight to the sign-in panel. Creating still needs an account on the server

### Changed
- **Rename moved into People:** the separate **Your name** (`person_edit`) toolbar button is gone. Your own line in the People list (listed first) now has a `person_edit` button, the only way to open the rename window. Tapping your line shows your own Slots again. The People button's tooltip reads "People and your name" once you have joined
- **Calendar header:** removed the name label after the title (`#currentUserDisplay`), which repeated the account badge. When you organise the calendar, the account badge turns dark (like the organiser's avatar in People) with an `admin_panel_settings` icon; its label adds "organiser of this calendar"
- **Account badge on narrow screens:** beside the home page title, the **Sign in** / profile badge shrinks to just its icon instead of wrapping under the title, and returns to full size when there is room
- **Templates page:** cards can set **Privacy** and **Who can join**. Template links accept `privacy=open|hidden|blind` and `join=invite` (plus the existing `names=hidden`); booking templates fall back from Blind to Hidden. Showcase uses Hidden with Hide names too and Invite only; interview and parent-teacher bookings use Hidden with Hide names too; Yes/No Decision uses Blind; Babysitting Roster and Party RSVP use Invite only. New tips cover the organiser's coloured edge, Invite only Hubs and seeing one person's calendar. Demo links point to the emoji-guarded example calendar
- **Privacy page:** fixed a missing section wrapper that made the page too wide
- **Home page wording:** new intro ("...or create a bookings calendar... plan events and take bookings. Sign in with Google, Facebook or a passkey."). Sign-in panel: "You need a free account to open, join or create calendars and Hubs." Organiser name hint: "Leave blank to use your profile name. You manage the calendar from this account." Private names hint: "People only see their own name, organiser name (yours), and how many have joined."
- **Save-your-link warnings:** removed the home page "cannot be recovered if lost" warning. The Hub save panel and Hub text file now say the link is the invite and that the Hub is also listed on your profile page
- **Inactivity default is 40 days everywhere:** admin Setup and the `admin_save_config` fallback used 30 while `cleanup.php` used 40. Saved site settings are unchanged
- Organiser's coloured edge: documented as Open calendars only (on Hidden calendars members never receive the organiser's answers, so it only ever showed there for the organiser)

---

## 2026-10-08

### Added
- **Invite only:** a new **Who can join** setting on the create page and Hub create page: **Direct link** (default, as before) or **Invite only**. Set only when creating; it can't be changed later
  - People with the link see a **Request access** panel (after the access emoji, if there is one). The organiser approves or declines in the **People** list (count badge on the People button; **Approve all**; a collapsed Declined list) or, for Hubs, on the Hub page (Requests, Approved and Declined lists). Approved people then join with their own name as usual and skip the emoji
  - Invite only Hubs: one approval opens every calendar in the Hub, calendars created inside it are always Invite only (the create page shows a note instead of the toggle), and requests go to the Hub organiser
  - Declined people can't ask again, but can still be approved later. Pending requests expire after 30 days. No notifications: counts show on the People button, Hub page, profile page ("N requests waiting") and admin panel
  - Profile page: a **Waiting for approval** list of your own pending and declined requests
  - Link previews (`share.php`) are unchanged
- **Block:** organisers can pause anyone on a calendar from the People list (`block` icon; **undo** restores). They see "The organiser has paused your access"; their answers are left out of the calendar, Best Match and totals, but bookings still hold their places. Nothing is deleted. On Invite only Hubs the organiser can also block an approved person Hub-wide. Admin shows " - Blocked" on their name
- **Hide names too:** Hidden calendars can also keep names private (checkbox under Privacy Mode; template `names=hidden`). Blind calendars now always keep names private. Members then see only themselves, the organisers and "Names are private on this calendar. N people have joined." The organiser still sees everyone
- API: new `request_access`, `cancel_access_request`, `access_requests`, `decide_access_request`, `set_user_blocked`; 403 `INVITE_ONLY`, `BLOCKED`, `REQUEST_DECLINED`. `create_calendar` takes `invite_only` / `hide_names`, `create_group` takes `invite_only`; `calendar_meta` adds `invite_only`, `invite_via_hub`, `hide_names`, `names_private`, `pending_requests`; `group_meta` adds `invite_only`, `pending_requests`; `users` adds `blocked` (organiser), `total`, `names_hidden`; `account_memberships` adds `blocked`, `pending_requests` and `requests`; `get_site_config` adds `features.invite_only`. Security log: `ACCESS_REQUESTED`, `ACCESS_REQUEST_DECIDED`, `USER_BLOCKED`
- New files: `includes/members.php`, `migrations/009_invite_only.sql` (adds `calendars.invite_only`, `calendars.hide_names`, `groups.invite_only`, `users.blocked` and the `access_requests` table). cleanup.php step 11 deletes expired and orphaned requests
- FAQ, guide and privacy policy cover Invite only, blocking and private names
- **Admin sign-in with your account:** accounts listed in `config.php` `admin.account_ids` open the admin panel without the password. `admin.html` tries it silently on load (not again in a tab after **Logout**) and has a **Use my When RU Free account** button. The password login stays as a fallback. API: new `admin_login_account` (403 `ADMIN_ACCOUNT_OFF` / `NOT_ADMIN`, 401 `ACCOUNT_REQUIRED`); security log `ADMIN_ACCOUNT_DENIED`, and `ADMIN_LOGIN_SUCCESS` records `method`

### Changed
- **Reserved usernames** (`admin`, `whenrufree`, `wruf` and others) now get their own message, "That username is reserved" (400 `USERNAME_RESERVED`), instead of the general format error. Admin accounts may use them
- **Profile page:** **Add sign-in with Google / Facebook** is hidden once that provider is linked and comes back if it's removed. **Add a passkey on this device** always shows, since each device can have its own (the browser refuses a second one on the same device)
- **Deployment guide:** sample `admin` config uses `password` (as the code does, not `user` / `pass`) and documents `account_ids`; the Facebook steps now cover the Login settings, skipping Meta's JavaScript SDK quick-start, and the Basic settings Meta checks before going Live

---

## 2026-09-27

### Added
- **Accounts (no PINs):** everyone now signs in to open, join or create calendars and Hubs, with **Google** (scope `openid` only), **Facebook** (`public_profile`, only the user ID is read) or a **passkey** (fingerprint, face or screen lock, usernameless). No email, real name or photo is requested or stored; provider IDs are kept only as HMAC-SHA-256 hashes keyed by a server secret
  - Each account has a private unique **username** and a **profile name** used on calendars by default, with a per-calendar override (**Use my profile name** switches back). Changing the profile name updates every calendar that follows it
  - New **profile page** (`account.html`): edit your name and username, see all your calendars and Hubs, add or remove sign-in methods (never the last one), sign out, delete your account (type your username; removes the calendars and Hubs you organise, your names elsewhere and all sign-in data)
  - Sessions: HttpOnly `wruf_account` cookie, 30 days, renewed on use, stored as SHA-256. Google / Facebook round trips use a signed 10-minute `wruf_oauth` cookie with state, OIDC nonce and PKCE
  - The unique link is the invite; the access emoji is an invite confirmation asked once per account (remembered on all devices) and never for organisers or people who already joined
  - **Claiming:** names and Hubs from before accounts can be claimed once with their old PIN (People list > "Tap to claim it"; Hub > **Claim this Hub**). The PIN is then deleted. The escalating lockout now only guards claims
  - Admin: new **Accounts** tab (provider status, totals, unclaimed names and Hubs, username search, delete account); unclaimed names show dashed with "not claimed"
  - cleanup.php step 10: expired account sessions, abandoned passkey sign-ups, emoji picks for deleted calendars/Hubs, and accounts unused for `accounts.inactive_days` (default 730) with no calendars or Hubs
  - Privacy policy, terms, FAQ, guide and templates rewritten for accounts (Meta data-deletion instructions at `privacy.html#delete-account`)
  - API: new `account_me`, `account_update`, `account_logout`, `account_methods`, `account_remove_method`, `account_memberships`, `account_delete_preview`, `account_delete`, `account_passkey_signup|add|login_begin|finish`, `oauth_start`, `oauth_google`, `oauth_facebook`, `join_calendar`, `claim_name`, `claim_hub`, `admin_accounts`, `admin_delete_account`. `rename_user` takes `use_profile`; `create_calendar` / `create_group` names are optional; `calendar_meta` returns `account: {profile_name, me, claimable}`; `group_meta` returns `organiser_name`, `is_organiser`, `claimable`; `users` returns `mine` / `claimable`. Every calendar and Hub action needs a signed-in account (401 `ACCOUNT_REQUIRED`, 403 `ACCOUNT_SETUP`, 403 `NOT_JOINED`)
  - New files: `includes/accounts.php`, `includes/oauth.php`, `account.html`, `account.js`, `account-core.js`, `account.css`, `admin-accounts.js`, `migrations/007_accounts.sql`, `migrations/008_drop_pins.sql` (draft, run about 90 days later)
  - Config: new required `accounts` block in `config.php` (`pepper`, `base_url`, Google and Facebook keys, `inactive_days`); PHP needs the cURL extension
- **Hub Poster button:** a logged-in Hub organiser now gets a **Poster** button in the Hub link bar (same poster as the post-create save panel, including the access emoji). To make room, Share and Email are icon-only buttons (with tooltips and screen-reader labels)

### Removed
- **PINs and per-calendar logins:** `add_user`, `auth_user`, `auth_group` and the six `passkey_*` actions; the `X-Auth-Token` / `X-Group-Auth-Token` headers; organiser, participant and Hub PIN fields; the logout buttons, per-calendar passkey windows and cached logins in the browser. `passkey.js` keeps only what account sign-in needs. The old session and passkey tables are no longer used (migration 008 drops them)

### Changed
- **Google and Facebook buttons** now show the real brand logos (inline SVG, no external requests). The Google button is Google's official HTML button (`gsi-material-button` markup and CSS from the [Sign in with Google branding guidelines](https://developers.google.com/identity/branding-guidelines) configurator, which Google app verification requires), raised from 40px to 44px for touch. The Facebook and passkey buttons use the same size, shape, font and layout (icon 12px from the left, label centred), as Google asks for equal prominence. Buttons now use the page font instead of the browser default. The profile page buttons read **Add sign-in with Google / Facebook**, because Google's rules don't allow "Google" on its own as the action
- **Split the three largest files** so each part is easier to find, review and edit. Pure moves: no behaviour changes, no build step, no modules.
  - `api.php` keeps every endpoint (~2,200 lines, was ~3,000). Its helpers moved to `includes/http.php` (responses, request parsing, config, client IP, secure session, CSRF), `includes/data.php` (normalise / validate, `MESSAGE_MAX_LEN`, availability summary), `includes/security.php` (DB connection, security log, rate limiting, admin login lockout and `requireAdminSession()`, PIN hashing and lockout wrappers), `includes/sessions.php` (user and Hub sessions, passkey subject) and `includes/hubs.php` (Hub limits, lookup, activity, lockout wrappers)
  - `calendar.js` became six classic scripts sharing global scope, loaded in order by `calendar.html`: `calendar-core.js`, `calendar-users.js`, `calendar-grid.js`, `calendar-rank.js`, `calendar-booking.js`, `calendar-main.js`
  - `admin.js` lost its IIFE wrapper and became `admin-core.js`, `admin-calendars.js`, `admin-hubs.js`, `admin-setup.js`, loaded in order by `admin.html`. `checkExistingSession()` now runs on `DOMContentLoaded`, after all four have loaded
  - Deploying: upload the new files and delete `calendar.js` and `admin.js` from the server
  - `js_functions.md` now lists each calendar function as `file:line`

## 2026-09-26

### Added
- **Booking mode:** a calendar can limit how many people take each slot, first come, first served (like a booking form).
  - Create page, Slots section: **People per slot** - No limit (default, normal availability poll) / 1 / 2 / More (stepper 3-20). With a limit, **Bookings per person** appears below it - how many slots each person can book per day: No limit / 1 (default) / 2 / More
  - With a limit, the Options section is hidden and a **Booking label** (default "Booked") with a colour appears under Bookings per person. No weights or Score Method. Blind privacy is hidden (Open: everyone sees who booked; Hidden: only the organiser sees names)
  - Calendar page: tapping a cell toggles Booked / not booked and saves like a normal calendar (auto-save after 4.5 s, or Submit; unsaved taps are kept on the device). The Bookings card's Book / Cancel buttons save straight away. Cells show Free (white) / your booking (booking colour, check and the booking label) / partly booked by others (orange) / Full (red). Names are never shown in cells (no room); they are on the Bookings card rows when privacy allows. A full slot says "This slot is taken"; at the per-person limit: "You can book 1 slot per day - cancel it to pick another."
  - **Bookings** card replaces Best Match, with rows styled like Best Match cards (tap to View / Hide actions and names): "N of M booked", a Booked / Free toggle (organiser defaults to Booked, others to Free), date order, Cancel on your own bookings, Add to Google Calendar, Book on free slots, and a per-person Remove for the organiser. The 2 / 10 / All limit stays (default 2)
  - Organiser **Close bookings** (replaces Choose / Reopen): a "Bookings closed" banner with Reopen; participants can no longer book or cancel, the organiser can still remove bookings
  - The grid refreshes on tab focus and every 30 seconds. "Reset my availability" becomes "Cancel my bookings"
  - Server: each booking save locks the calendar row (`SELECT ... FOR UPDATE`), checks the day is in range and the slot exists, runs cancellations before bookings, enforces capacity and the per-person limit (organiser exempt from the per-person limit) and returns `rejected` slots ("Just taken by someone else")
  - "Book a slot" wording in the share text, email, poster and .txt file; "Booking" tag in the Hub list and admin panel
  - Template links: `cap=` (people per slot) and `per=` (bookings per person per day, 0 = no limit)
  - Templates page (`ideas.html`): new **Interview / Appointment Slots** and **Class / Workshop Sign-up** booking templates; **Gym / Facility Booking**, **Holiday House Bookings**, **Shared Car Booking** and **Meeting Room Booking** are now real booking forms (1 per slot, single "Booked" option). Cards with "People per slot" / "Bookings per person" rows get `cap` / `per` in their Use This Template link
  - New columns `calendars.slot_capacity`, `max_per_user`, `bookings_closed`. Migration: `migrations/004_booking.sql` (option hidden until it runs)
  - API: `slot_capacity` / `max_per_user` on `create_calendar`; booking fields on `calendar_meta`; `slot_capacity` on `group_meta` calendars and `admin_calendars`; `rejected` on `save`; new `set_bookings_closed`; `features.booking` on `get_site_config`. New file `includes/booking.php`
  - Security events: `BOOKINGS_CLOSED`, `BOOKINGS_REOPENED`
- **Booking colours and names:** under the Booking label, organisers can now pick the colour and rename **Partly booked** (default orange) and **Full** (default red), just like the Booked label and normal options (same label rules, no duplicates). Partly booked is hidden when People per slot is 1. Cell text switches between black and white for contrast. The Full name shows in the legend and on full cells (including one-person slots booked by someone else); Partly booked names the legend colour
  - New columns `calendars.partial_color`, `full_color`, `partial_label`, `full_label` (NULL = defaults). Migration: `migrations/006_booking_styles.sql` (settings hidden until it runs; existing calendars keep the defaults)
  - API: `partial_color` / `full_color` / `partial_label` / `full_label` on `create_calendar` and `calendar_meta`; `features.booking_styles` on `get_site_config`
- **Bookings card: Mine / Free.** Participants now toggle **Mine** (only their own bookings, with a count such as "Mine (2)" or "Mine (1 of 1)" for In total limits) and **Free**. The organiser keeps **Booked / Free**. The card always opens on Mine / Booked with the 2-row limit. The separate "You've booked N of M" line is replaced by the count on the Mine button
- **Templates page (`ideas.html`):** seven more booking examples, each showing a different setup - Parent-Teacher Interviews (1 in total over 2 evenings), Volunteer Shift Roster (3 per shift, 4 in total), Tennis Court Hire (1 per day), Open Day Tours (15 per tour, 1 in total), Hot Desk Booking (desks as slots, 1 per day), Pet or Plant Care Roster (No limit) and School Run Seats (3 seats, 2 per day). A new "Which limit?" tip explains when to use In total, Per day or No limit
- **Bookings card:** Share now only appears (with Add and Download) on your own bookings; other people's booked rows and Free rows no longer have it.
- **Booking count in cells:** when People per slot is 2 or more, every booking cell starts with an "N/M" count of people booked so far (e.g. "0/8 Free", "1/2 booked", "2/2 Full", tick + "1/2 Booked" for yours), in every privacy mode. Cells never show names. The legend's partly-taken colour now reads "Partly booked".
- **Bookings per person: Per day / In total.** With a per-person limit set, a new toggle under Bookings per person chooses whether it counts each day (default, e.g. court hire) or the whole calendar (e.g. one interview per candidate).
  - "In total" calendars show "Mine (N of M)" on the Bookings card toggle, and the limit toast says "in total"
  - Template links: `total=1`. The Interview and Workshop templates now use 1 in total; Gym stays 2 per day
  - New column `calendars.per_user_total`. Migration: `migrations/005_booking_total.sql` (toggle hidden until it runs; existing calendars stay per day)
  - API: `per_user_total` on `create_calendar` and `calendar_meta`; `features.booking_total` on `get_site_config`
- **Access emoji:** an optional second barrier on top of the secret link. The organiser picks 1 of 35 emoji (5 columns x 7 rows); anyone opening the calendar or Hub must pick the same emoji first.
  - Create page: **Access emoji** switch above Privacy Mode opens a fullscreen picker. Hub create form: the same switch below the PIN
  - A calendar in a Hub uses the Hub's emoji unless it has its own; a right pick on the Hub opens all its calendars
  - Organiser **Settings** (gear) window on the calendar and the Hub to turn the emoji on, change it or turn it off. Changing or removing it signs out every browser that had access
  - The emoji is included in the copied link text, share, email, poster and .txt file on both save panels and in the organiser Share / toolbar buttons
  - Throttling: 3 wrong picks lock that IP out of that calendar/Hub for 5 minutes, then 15 minutes, 2 hours, 2 days; max 20 wrong picks and 30 unknown calendar/Hub codes per IP per hour
  - The right pick gives the browser a 30-day grant (stored as a SHA-256 hash, sent in `X-Access-Grant`); the emoji itself never reaches visitors, and link previews for guarded calendars show no title
  - Admin panel shows an emoji badge and a **Remove emoji** button (key_off) for calendars and Hubs
  - New columns `calendars.access_emoji`, `groups.access_emoji`; new tables `access_grants`, `access_attempts`. Migration: `migrations/003_access_emoji.sql` (feature hidden until it runs)
  - API: `access_check`, `access_settings`, `set_access_emoji`, `set_group_access_emoji`, `admin_set_access_emoji`; `access_emoji` on `create_calendar` / `create_group`; `access` on `calendar_meta` / `group_meta`; `features.access_emoji` on `get_site_config`
  - New files: `includes/access.php`, `emoji.js`, `emoji.css`; optional config `access_emoji`; `cleanup.php` step 9
  - Security events: `ACCESS_FAILED`, `ACCESS_LOCKED`, `ACCESS_GRANTED`, `ACCESS_EMOJI_CHANGED`, `ADMIN_ACCESS_EMOJI_CLEARED`, `NOT_FOUND_THROTTLED`
- **Fingerprint / face unlock (passkeys):** Calendar users, calendar organisers and Hub organisers can unlock with their device's fingerprint, face or screen lock. The 4-digit PIN stays as the backup.
  - After a successful PIN login (or adding your name), the app offers "Turn on" once per device; "Not now" is remembered on that device
  - PIN modal shows a "Use Passkey" button (fingerprint / face / pattern icons, full description in `aria-label`) on enrolled devices; the device prompt opens only when that button is pressed (never automatically)
  - One **Passkeys** window (calendar: fingerprint icon next to your name; Hub: organiser **Passkey** button; also opens once after a PIN login). On a device without a passkey it shows "Set up a passkey?" (fingerprint / face / pattern icons, Touch ID / Face ID / Windows Hello / phone PIN or pattern, **Not now** / **Set up passkey**) plus any passkeys on other devices with **Remove**. Once this device has one it lists every device with its name and added / last used dates, each removable (e.g. a lost phone)
  - User-facing wording uses "Passkey" throughout (buttons, window titles, messages), with "fingerprint, face or screen lock" as the explanation
  - New tables: `user_passkeys`, `group_passkeys` (FK cascade, `device_label`). Migration: `migrations/001_passkeys.sql`
  - API: `passkey_register_begin`, `passkey_register_finish`, `passkey_login_begin`, `passkey_login_finish`, `passkey_list`, `passkey_remove`; `calendar_meta` and `group_meta` report `passkeys`
  - New files: `includes/webauthn.php` (dependency-free WebAuthn verifier, ES256 + RS256), `includes/.htaccess`, `passkey.js`
  - Optional config: `webauthn.rp_id`, `webauthn.origin`
  - Security events: `PASSKEY_ADDED`, `PASSKEY_LOGIN`, `PASSKEY_REMOVED`, `PASSKEY_COUNTER_REPLAY`
- **Escalating PIN lockout** (calendar users, organisers and Hub organisers): 5 wrong PINs in a row lock for 5 minutes, then 15 minutes, then 2 hours, then 2 days (repeats). Replaces the flat 15-minute lock.
  - The 5th wrong PIN now says straight away how long the lock lasts ("Too many wrong PINs. This name is locked for 15 minutes."); while locked: "Try again in 2 hours."
  - Escalation resets on a correct PIN, a passkey login, a super admin Unlock, or after 30 days without a lockout (`cleanup.php` step 8)
  - Admin panel: amber **Unlock** pill on locked users; lock_open button on locked Hubs. API: `admin_unlock_user`, `admin_unlock_group`; `admin_list_users` and `admin_groups` report `locked_seconds`
  - New columns `lockout_level`, `last_locked_at` on `users` and `groups`. Migration: `migrations/002_escalating_lockout.sql` (flat 15-minute lock until it runs)
  - New file `includes/lockout.php`; optional config `pin_lockout` (`max_attempts`, `schedule_minutes`, `reset_after_days`)
  - Security events: `GROUP_LOCKED`, `ADMIN_UNLOCK_USER`, `ADMIN_UNLOCK_GROUP`; `ACCOUNT_LOCKED` now includes `minutes`
  - Super admin password login keeps its separate per-IP lockout

### Fixed
- Calendar grid lost its colours (and the Decided highlight) after unlocking with a PIN / passkey or switching name: the values were painted and then the grid was rebuilt with blank cells. `renderDateRangeSkeleton()` now repaints its own cells (`refreshCalendarValues()` + `applyFrozenState()`).
- Hub "add calendar" rate limits (5 per IP per Hub per hour, 15 per IP per hour) were never enforced: their keys (`hub_cal_{id}_{YYYYMMDDHH}`, 21+ chars) did not fit the `CHAR(16)` `api_rate_limit.minute_key` column, so MySQL either truncated them (the count query then never matched) or, in strict mode, rejected the insert. Keys are now `hg{YYYYMMDDHH}{id base 36}` / `hi{YYYYMMDDHH}`, and `enforceActionRateLimit()` hashes any key longer than 16 chars (`rateLimitKey()`).
- Organiser could not change a decided date without refreshing: the Decided banner's **Reopen** button was only evaluated at page load, so logging in as the organiser afterwards (PIN, fingerprint, or switching name) left it hidden. `updateUserUI()` now refreshes the banner, and Reopen requires an authenticated organiser session (`canReopenCalendar()`).

### Changed
- Hub organiser PIN, "Set up a passkey?" and Passkeys windows now use the same modal design as the calendar (indigo title, grey Cancel on the left, indigo confirm on the right, PIN show/hide eye, error hidden until needed)
- The separate "Set up a passkey?" and "Passkeys" popups are merged into one window with two states (calendar and Hub); the Hub uses the same wording as the calendar
- `.htaccess` now blocks direct access to `*.sql` files
- A successful passkey login clears PIN failed attempts / lockout
- `calendar.css`, `hub.css`, `passkey.js`, `calendar.js`, `hub.js` links carry `?v=20260926*` cache-busters; `admin.css` / `admin.js` now carry `?v=20260926a`

---

## 2026-06-27

### Added
- **Calendar Hubs:** One private link (`hub.html?g=TOKEN`) lists multiple calendars for participant entry.
  - New tables: `groups`, `group_sessions`; `calendars.group_id` FK
  - API: `create_group`, `group_meta`, `auth_group`, `add_calendar_to_group`, `remove_calendar_from_group`
  - Hub create flow with mandatory save panel: auto copy, auto `.txt` download, Share, Email, Poster, acknowledgement checkbox
  - Open Hub contribution: anyone with Hub link can create/attach calendars (Hub code in URL); rate limits on server
  - Hub page: public copy Hub code/link, Create new calendar in this Hub
  - Organiser PIN: remove calendars from Hub, Share/Email/Download, Logout on shared computers
  - Go page (`go/`): Calendar or Hub mode; accepts code or full URL
  - Migration: `migrations/add_groups.sql`

### Changed
- Hub create via `index.html?g=TOKEN` no longer requires Hub organiser PIN
- Hub link bar visible without organiser login; Share, Email, Download remain organiser-only
- Hub link toolbar: icon-only on small screens; `link_2` for link copy, `content_copy` for code copy
- Attach existing calendar: calendar organiser only, from calendar page Hub bar (not from Hub page)
- Save panel: Poster popup; plain-ASCII share/download text (`toPlainAscii`)

### Removed
- **Saved on this browser** (Go page Hub shortcuts in localStorage) - archived in `MDfiles/archived/saved-hubs-browser-storage.md`
- **Add existing calendar** button on Hub page (use calendar page attach flow instead)

---

## 2026-04-04

### Added
- **Choose/Freeze feature:** Organiser can lock in a chosen date+slot from the rank card analysis panel. Freezes the calendar -- participants can still view but cannot change availability. Organiser sees a "Reopen" button to undo.
  - New API endpoints: `choose_slot`, `unchoose_slot`
  - Server-side enforcement: `save` endpoint returns 403 when calendar is frozen
  - New DB columns: `calendars.chosen_date`, `calendars.chosen_slot`
  - Green "Decided" banner with check icon at top of analysis section
  - Chosen slot highlighted with green outline in calendar grid
  - Non-chosen slots dimmed to 35% opacity with pointer events disabled
  - Chosen rank card pinned to top with green border treatment
  - "Choose" button appears in expanded rank card actions (organiser only, when not frozen)
  - Confirmation dialogs on both choose and reopen actions
  - Security events logged: `CHOOSE_SLOT`, `UNCHOOSE_SLOT`
- **Month abbreviations in date headers:** Calendar grid now shows "4 Apr", "15 Jul" etc. instead of just the day number. Three-letter month appended to `.date-num` element.

### Changed
- `formatDayHeader()` now returns `monthAbbr` alongside `dayNum` and `dayName`
- Submit button hidden when calendar is frozen
- `calendar_meta` response now includes `chosen_date` and `chosen_slot` fields

---

## 2026-04-03

### Added
- Multi-category support: calendars can have up to 3 category icons
- NY Team Availabilities demo calendar

---

## 2026-03-22

### Added
- Kings Park walking group calendar with Facebook integration in organiser message
- Date filter "only" mode with specific date selections

---

## 2026-03-08

### Added
- Organiser message feature: editable inline note visible to all participants
- Rank sort order toggle: "By Match" (score) vs "By Date" (chronological)
- Rank limit toggle: 2 / 10 / All cards shown
- Auto-save with configurable delay (4.5s default)
- Google Calendar and ICS export from rank cards
- Share button on rank cards with roster summary

### Changed
- Shorter 8-character calendar tokens for cleaner URLs
- Token validation widened to 8-64 chars for backward compatibility

---

## 2026-02-28

### Added
- Date filter system: organiser can show/hide specific dates for participants
- Date filter modes: "all", "only", "except"
- Date filter save status indicator (Unsaved/Saving/Saved)

---

## 2026-02-23

### Added
- Custom status options with configurable colours and weights (1-5 statuses)
- Strength palette system for auto-colouring
- WCAG contrast calculation for status text colours
- Privacy modes: Open, Hidden, Blind
- Organiser dots (left border indicators) showing organiser's choices
- Mood Tracker demo calendar

---

## 2026-02-22

### Added
- Sports Tryouts demo calendar with 4-status system
- Weekend exclusion option
- Template URL system for pre-configured calendars from Ideas page
- Scoring mode toggle: Rank vs Weights

---

## 2026-02-19

### Added
- Initial release
- Calendar creation with custom slots
- PIN-based authentication with lockout
- Availability grid with tap-to-cycle statuses
- Ranked "Best Match" analysis
- User management (add, rename, delete)
- CSRF protection
- Per-IP rate limiting
- Security event logging
- Automatic cleanup via cron
- Super admin panel
