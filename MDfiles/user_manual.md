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
   - **Statuses**: The response options (default: Yes / Maybe / No). You can customise labels, colours, and scoring weights. Up to 5 statuses.
   - **Date range**: The start and end dates. Maximum 360 days.
   - **Exclude weekends**: Tick this to hide Saturdays and Sundays.
   - **Date filter mode**: Choose whether participants see all dates, only dates you select, or all dates except ones you exclude.
   - **Privacy mode**: Open (everyone sees all choices), Hidden (only you see individual choices), or Blind (nobody sees individual choices).
3. Enter **your name** and a **4-digit PIN**. This is your organiser account.
4. Tap **Create Calendar**.
5. You will be taken to your new calendar, already logged in.

### Sharing Your Calendar

- Tap the **Share** icon in the header to copy or share the calendar link.
- The link looks like: `whenrufree.net/calendar.html?c=3PNpKJTs`
- Anyone with the link can view the calendar and add their name.

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

### Template Links

You can create pre-configured calendar links from the Ideas page. These pre-fill the creation form with your chosen settings. The URL format is:

```
index.html?template=1&title=...&category=...&slots=...&statuses=...&range=1week
```

### Calendar Hubs

A **Hub** gives your group one link to find all related calendars (e.g. club fixtures, team dinners, committee meetings).

**Creating a Hub**

1. Open **Create a Hub** from the home page footer or `hub.html?create=1`
2. Enter Hub name, your name, and a 4-digit organiser PIN
3. Save your Hub link from the mandatory save panel (copy, download, Share, Email, or Poster)
4. Tap **Continue to Hub**

**Managing a Hub (organiser PIN required)**

- **Organiser login** on the Hub page for: Share, Email, Download, and removing calendars from the Hub
- **Logout** on shared computers when finished managing
- Your organiser PIN is not stored in the download file — remember it separately

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

### Joining a Calendar

1. Open the calendar link shared by the organiser
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
- Otherwise, tap the person icon, select your name, and enter your PIN

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
- If your account is locked after 5 wrong PIN attempts, wait 15 minutes and try again.
- The calendar cleans up automatically after 40 days of inactivity (no saves by anyone). The organiser can ask the site admin to make it permanent.
- Slot names support letters, numbers, spaces, hyphens, and periods. Max 20 characters.
- Display names support letters, numbers, spaces, apostrophes, and hyphens. Max 40 characters.
