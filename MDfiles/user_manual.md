# User Manual

A guide for organisers and participants using When RU Free.

---

## For Organisers

### Creating a Calendar

1. Go to [whenrufree.net](https://whenrufree.net) (or sandgroper.net)
2. Fill in the form:
   - **Title** (optional): Give your calendar a name, e.g. "Dinner with the team"
   - **Category** (optional): Pick up to 3 icons that represent your event type
   - **Slots**: The time options participants will choose between (e.g. "Morning", "Lunch", "Evening"). You get 1-6 slots. Use the quick-add chips or type your own.
   - **People per slot**: Leave on **No limit** for a normal availability poll. Pick **1**, **2** or **More** (up to 20) to make a booking calendar - see Booking Calendars below.
   - **Statuses**: The response options (default: Yes / Maybe / No). You can customise labels, colours, and scoring weights. Up to 5 statuses.
   - **Date range**: The start and end dates. Maximum 360 days.
   - **Exclude weekends**: Tick this to hide Saturdays and Sundays.
   - **Date filter mode**: Choose whether participants see all dates, only dates you select, or all dates except ones you exclude.
   - **Access emoji** (optional): Turn the switch on and pick one of 35 emoji. Anyone opening the link must pick the same emoji first. Creating inside a Hub that already has an emoji? The calendar uses the Hub's emoji unless you pick its own.
   - **Privacy mode**: Open (everyone sees all choices), Hidden (only you see individual choices), or Blind (nobody sees individual choices).
3. Enter **your name** and a **4-digit PIN**. This is your organiser account.
4. Tap **Create Calendar**.
5. You will be taken to your new calendar, already logged in.

### Sharing Your Calendar

- Tap the **Share** icon in the header to copy or share the calendar link.
- The link looks like: `whenrufree.net/calendar.html?c=3PNpKJTs`
- Anyone with the link can view the calendar and add their name.
- If you set an access emoji, it is added to the copied, shared, emailed and printed link so people know which one to pick.

### Access Emoji

- As the organiser, tap the **Settings** (gear) icon in the calendar header to turn the emoji on, change it or turn it off.
- Changing or removing the emoji means everyone has to pick the new one next time (their browsers forget the old one).
- Forgot the emoji? Log in as the organiser on a device that already opened the calendar and look in Settings, or ask the site admin to remove it.
- Too many wrong picks lock that device's internet connection out of the calendar for 5 minutes, then longer.

### Managing Your Calendar

As the organiser, you can:

- **Add a message**: Tap the message area below the rankings to leave a note for participants (max 250 characters).
- **Change sort order**: Toggle between "By Match" (highest score first) and "By Date" (chronological) in the analysis panel. Your choice is saved as the default for all users.
- **Filter dates**: If you chose "only" or "except" mode, tap date column headers to select/deselect which dates participants can see. Changes auto-save.
- **Delete users**: Open the user selection panel and tap the delete icon next to a participant's name.
- **Reset availability**: Use the delete icon to clear your own selections, or the warning icon to reset ALL users (requires typing "RESET" to confirm).
- **Rename**: Tap the edit icon to change your display name.

### Choosing a Final Slot

Once enough people have responded, you can lock in a decision:

1. Expand a rank card by tapping "View"
2. Tap the green **Choose** button
3. Confirm the choice in the dialog

This will:
- Display a green "Decided" banner showing the chosen date and slot
- Highlight the chosen slot in the calendar grid with a green outline
- Dim all other slots
- Prevent anyone from changing their availability
- Hide the save button

To undo this, tap the **Reopen** button in the decided banner.

### Booking Calendars

Use a booking calendar when each slot can only be taken by a set number of people - interviews, appointments, rosters, parent-teacher nights.

- **Setting up:** under Slots, set **People per slot** to 1, 2 or More (3-20). **Bookings per person** then appears below it: how many slots each person can book (No limit / 1 / 2 / More; default 1). With a limit, choose how it is counted: **Per day** (default) or **In total**. With 1 per day, someone can book one time on Monday and another on Tuesday, but not two times on Monday - good for court or room hire. With 1 in total, each person gets one slot in the whole calendar - good for interviews or workshop sign-ups; people see "You've booked 1 of 1" on the Bookings card. Below that, set the **Booking label** (default "Booked") and its colour. The Options section is hidden, because bookings use this one label. Blind privacy is not available - Open shows everyone who booked each slot; Hidden shows names only to you, and others just see which slots are taken.
- **Booking settings cannot be changed** after the calendar is created.
- **How people book:** they add their name and PIN, then tap a free slot to mark it Booked; tapping it again un-books it. Like a normal calendar, changes auto-save after a few seconds, or tap **Submit** to save now. The **Book** / **Cancel** buttons on the Bookings card save straight away. A full slot shows "This slot is taken", and the per-person limit counts unsaved taps too. If two people tap the last place at the same moment, only the first gets it; the other sees "Just taken by someone else".
- **Bookings card** (instead of Best Match): shows "N of M booked" and a **Booked / Free** toggle. Booked lists every booked slot in date order; Free lists the slots still open. Each row looks like a Best Match card: tap **View** to see who booked it (as privacy allows) and the buttons - **Book** on free slots, **Add** / **Download** / **Cancel** on yours.
- **As the organiser** you can book as many slots as you like (to block times off), remove anyone's booking with the x next to their name (tap View on the row), and tap **Close bookings** to stop all changes. A "Bookings closed" banner then shows for everyone; tap **Reopen** in it to allow changes again.
- The calendar refreshes itself every 30 seconds while it is open, and whenever you come back to the tab.

### Template Links

You can create pre-configured calendar links from the Ideas page. These pre-fill the creation form with your chosen settings. The URL format is:

```
index.html?template=1&title=...&category=...&slots=...&statuses=...&range=1week
```

Add `&cap=1` (people per slot, 1-20) to make a booking calendar, and optionally `&per=2` (bookings per person, counted per day; `0` = no limit, default 1) and `&total=1` (count `per` across the whole calendar instead). With `cap`, the first `statuses` label becomes the booking label. The Templates page has ready-made booking examples (interviews, workshops, gym, holiday house, shared car, meeting room) in its Bookings section.

### Calendar Hubs

A **Hub** gives your group one link to find all related calendars (e.g. club fixtures, team dinners, committee meetings).

**Creating a Hub**

1. Open **Create a Hub** from the home page footer or `hub.html?create=1`
2. Enter Hub name, your name, and a 4-digit organiser PIN
3. Optional: turn on **Access emoji** (below the PIN) and pick one. It guards the Hub and every calendar in it that has no emoji of its own
4. Save your Hub link from the mandatory save panel (copy, download, Share, Email, or Poster)
5. Tap **Continue to Hub**

**Managing a Hub (organiser PIN required)**

- **Organiser login** on the Hub page for: Share, Email, Download, and removing calendars from the Hub
- **Passkey** button (after logging in) opens the **Passkeys** window: on a device without a passkey it asks **Set up a passkey?** and lists any passkeys on other devices so you can remove them; once this device has one it lists every device's passkey. PIN remains the backup
- **Settings** button (after logging in) to turn the Hub's access emoji on, change it or turn it off
- **Logout** on shared computers when finished managing
- Your organiser PIN is not stored in the download file - remember it separately

**Adding calendars to a Hub**

- **New calendar:** Anyone with the Hub link can tap **Create new calendar in this Hub** (no Hub PIN needed)
- **Existing calendar:** Log in as that calendar's organiser, open the Hub bar on the calendar page, and enter the Hub code or link

**Removing a calendar from a Hub**

- Hub organiser (logged in on Hub page), or the calendar's own organiser (from the calendar page Hub bar)

### Go to code or link

Use **Go to code** (`go/`) to open a calendar or Hub when you have a code or full link:

1. Choose **Calendar** or **Hub**
2. Paste the code (e.g. `3PNpKJTs`) or full URL
3. Tap **Go**

---

## For Participants

### Joining via a Hub

1. Open the Hub link shared by the organiser (`hub.html?g=...`)
2. Pick the calendar you need from the list
3. Add your name and PIN as usual on the calendar page

### Picking the Access Emoji

If the organiser set an emoji, a grid of 35 emoji appears before the calendar or Hub opens. Pick the one the organiser gave you (it is usually written next to the link) and tap **Open**. Your browser remembers it for 30 days. Three wrong picks lock you out for a few minutes, then longer. If you do not know it, ask the organiser.

### Joining a Calendar

1. Open the calendar link shared by the organiser (pick the access emoji if asked)
2. Tap the **person icon** in the header, or tap "Add Your Name"
3. Enter your name and a 4-digit PIN
4. Tap **Save**

Your PIN is private -- it protects your selections from being changed by others. Do not share it. If you forget it, the organiser cannot recover it.

### Marking Your Availability

1. After adding your name, you are automatically logged in
2. Tap any time slot in the calendar grid to cycle through statuses (e.g. Yes -> Maybe -> No -> clear)
3. The colour legend at the top shows what each colour means
4. Changes auto-save after 4.5 seconds of inactivity, or tap the save icon manually
5. A coloured left border on slots shows the organiser's choice (except in Blind mode)

### Returning Later

- Open the same calendar link
- If your session is still active (24 hours), you will be automatically logged in
- Otherwise, tap the person icon, select your name, and enter your PIN (or tap **Use Passkey**, if you have added one on this device)

### Passkeys (Fingerprint / Face Unlock)

On phones, tablets and laptops that support it (fingerprint, Face ID, Windows Hello or a device screen lock), you can add a passkey and skip typing your PIN:

1. Log in with your PIN (or add your name). The app asks **Set up a passkey?** and explains you can use your fingerprint, face or screen lock
2. Tap **Set up passkey** and confirm with your fingerprint, face or screen lock
3. Next time, select your name and tap **Use Passkey** (or press Enter)

Good to know:
- A passkey works per device and per calendar. Add one separately on each phone or computer you use
- Your PIN always still works. If the passkey prompt fails or is cancelled, just type your PIN
- Your fingerprint or face never leaves your device. The site only stores a public key

**Managing your passkeys:** open the user list and tap the fingerprint icon next to your name (green = passkey on this device). This opens the same **Passkeys** window:
- If the device you are holding has no passkey, it shows **Set up a passkey?** again (handy if you tapped **Not now** earlier), with any passkeys on your other devices listed underneath
- If it has one, it lists every device with a passkey for your name, when it was added and last used
- **Remove** deletes the passkey for that device. Lost your phone? Log in with your PIN on another device and remove it here

Hub organisers get the same options: after logging in on the Hub page, use the **Passkey** button in the organiser toolbar.

### Viewing Results

- The **Best Match** panel at the top shows ranked date+slot combinations
- Tap "View" on a rank card to see who responded and their statuses
- You can add the date to Google Calendar or download an ICS file from expanded cards
- If the organiser has locked in a choice, you will see a green "Decided" banner

### Privacy Modes

Your calendar may be in one of three privacy modes:

- **Open**: You can see everyone's choices (after logging in)
- **Hidden**: Only the organiser can see individual choices. You see aggregated counts only.
- **Blind**: Nobody can see individual choices, not even the organiser. True anonymity.

The privacy mode is shown by an icon next to the calendar title (eye, hidden eye, or lock).

---

## Tips

- PINs are 4 digits only. Choose something you will remember but others will not guess.
- After 5 wrong PINs in a row your name is locked for 5 minutes. Each further lockout is longer: 15 minutes, then 2 hours, then 2 days. A correct PIN resets this, and so does unlocking with a passkey (which works even while locked). The site admin can also unlock you.
- The calendar cleans up automatically after 40 days of inactivity (no saves by anyone). The organiser can ask the site admin to make it permanent.
- Slot names support letters, numbers, spaces, hyphens, and periods. Max 20 characters.
- Display names support letters, numbers, spaces, apostrophes, and hyphens. Max 40 characters.
