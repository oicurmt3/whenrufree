# Archived: Saved on this browser (Hub shortcuts)

**Status:** Removed June 2026. Do not ship without revisiting shared-computer privacy.

## Why removed

Hub shortcuts in `localStorage` (`wruf_saved_hubs`) posed a privacy risk on shared computers. The feature was originally opt-in at Hub creation, but the product direction moved away from browser-persisted Hub lists entirely.

Since the September 2026 accounts release, each account's Hubs are listed on its profile page (`account.html`), so no browser storage is needed. The old Hub organiser session cache (`wruf_group_auth_{token}`) has also been removed.

## Original behaviour

1. **Opt-in at create:** Checkbox on Hub save panel — "Save this Hub on this browser"
2. **Go page list:** Section "Saved on this browser" showing up to 8 recent entries
3. **Remove:** Per-item pill "Remove shortcut only from this browser" with inline confirm modal
4. **Not removed by Logout:** Hub organiser Logout cleared auth only, not saved shortcuts

## localStorage schema

Key: `wruf_saved_hubs`

```json
[
  {
    "token": "Ab12Cd34",
    "title": "Netball Club",
    "url": "https://example.com/hub.html?g=Ab12Cd34",
    "saved_at": "2026-06-27T12:00:00.000Z"
  }
]
```

Max 20 entries; dedupe by token; newest first.

## Files that implemented it (pre-removal)

| File | Role |
|------|------|
| `hub.js` | `saveHubToLocalStorage()`, `SAVED_HUBS_KEY`, save panel checkbox |
| `hub.html` | `#saveRememberCheckbox` |
| `go/index.html` | `#savedSection`, remove modal, `renderSavedHubs()` |
| `privacy.html` | Section 10 Hub shortcuts paragraph |
| `guide.html` | Save on this browser bullets |

## Restore checklist (if reinstated later)

- [ ] Explicit opt-in only — never auto-save on visit
- [ ] Clear shared-computer warnings in UI and privacy copy
- [ ] Separate "Recent" vs "Saved" if visit tracking is added
- [ ] Per-item remove + empty section hidden
- [ ] Document in guide and changelog

## Reference: remove helper (Go page)

```javascript
function removeHubFromLocalStorage(token) {
  const raw = localStorage.getItem('wruf_saved_hubs');
  if (!raw) return;
  let list = JSON.parse(raw);
  if (!Array.isArray(list)) return;
  list = list.filter(h => h?.token !== token);
  if (list.length) localStorage.setItem('wruf_saved_hubs', JSON.stringify(list));
  else localStorage.removeItem('wruf_saved_hubs');
}
```

## Reference: save helper (hub.js)

```javascript
saveHubToLocalStorage(meta) {
  const entry = {
    token: meta.token,
    title: meta.title || '',
    url: meta.url || buildHubUrl(meta.token),
    saved_at: new Date().toISOString()
  };
  // merge into array, max 20, write wruf_saved_hubs
}
```
