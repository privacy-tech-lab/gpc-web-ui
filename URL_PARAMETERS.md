# GPC Web UI — URL Parameters

The GPC Web UI reads its initial view from URL query parameters and keeps them in sync as you interact with the UI. This makes views bookmarkable and lets external tools (like browser extensions) link directly to a site or configuration.

## Usage

Append query parameters to the UI's URL, for example `/?url=google.com`. As you change filters, dropdowns, or the search box, the UI updates the URL automatically (without adding browser history entries), so you can copy the address bar to share the current view.

Parameters are only written to the URL when they differ from the default, except `period`, which is always written.

### Data table parameters

| Parameter                               | Type                     | Description                                                                                                                                                                                                                                                                             |
| --------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search`<br>`url`<br>`domain`<br>`site` | `string`                 | Filters the data table to sites whose URL contains this text. If present, the UI skips the overview, opens the data table, and scrolls to it.                                                                                                                                           |
| `state`                                 | `string`                 | The crawl state shown in the data table. One of `CA`, `CT`, `CO`, `NJ_NY` (the NJ crawl, displayed as "NJ/NY"). Defaults to `CA`. Note that `NJ` is not valid.                                                                                                                          |
| `period`                                | `string`                 | The crawl period shown in the data table, e.g. `Dec2023`, `Apr2026`, `AugSep2026`. Valid keys come from the CSV file names in `public/` and differ by state. If the period doesn't exist for the selected state, the UI falls back to that state's default period and resets to page 1. |
| `page`                                  | `integer`                | The data table page number. Defaults to `1`; invalid or non-positive values become `1`.                                                                                                                                                                                                 |
| `tseries`                               | comma-separated `string` | Compliance result filters applied to the data table. See [Series values](#series-values).                                                                                                                                                                                               |

### Chart parameters

| Parameter | Type                     | Description                                                                                                       |
| --------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `cseries` | comma-separated `string` | Series plotted in the trends chart. Defaults to `Likely Does Not Honor GPC`. See [Series values](#series-values). |
| `cstates` | comma-separated `string` | States plotted in the trends chart, e.g. `CA,CT`. Defaults to `CA`. Invalid states are dropped.                   |
| `ctype`   | `string`                 | Chart type: `line` (default) or `bar`.                                                                            |

### Other

| Parameter | Type     | Description                                                          |
| --------- | -------- | -------------------------------------------------------------------- |
| `screen`  | `string` | `nj-issue` opens the NJ issue report page. Defaults to the main app. |

### Series values

`cseries` and `tseries` take comma-separated series names. Names containing spaces or `|` should be URL-encoded (e.g. `%20`, `%7C`) in hand-written links; the UI encodes them automatically when it writes the URL.

- **Compliance results** (valid in `cseries` and `tseries`): `Likely Does Not Honor GPC`, `Likely Honors GPC`, `Not Applicable/Invalid/Missing`, `None`.
- **Privacy signal tokens** (valid in `cseries` only): `family|status` or `gpp|STATE|FIELD|status`, e.g. `usps|opted_out`, `optanonConsent|did_not_opt_out`, `wellKnown|opted_out`, `gpp|CA|SaleOptOut|opted_out`. Statuses are `opted_out`, `did_not_opt_out`, `invalid_missing`, `invalid`, `not_applicable`.

The UI checks series against the loaded data and drops any that don't exist. Privacy signal tokens in `tseries` are cleared when the data table opens or its state changes, so use compliance results there. Table filters are combined with AND, so use at most one compliance result in `tseries`.

### Landing behavior

Only a search parameter (`search`, `url`, `domain`, or `site`) skips the overview and opens the data table. Links with only chart or table parameters still land on the overview, and the parameters take effect once the matching section is opened.

## Example Scenarios

### 1. Simple Site Lookup

To open the data table filtered to one website:
`/?url=google.com`

### 2. Site Lookup for a Specific State and Period

To look up a site in the NJ/NY crawl for a specific period:
`/?search=example.com&state=NJ_NY&period=AugSep2026`

### 3. Chart Configuration

To show a bar chart comparing California and Connecticut for sites that likely honor GPC:
`/?cstates=CA,CT&cseries=Likely%20Honors%20GPC&ctype=bar`

### 4. Filtered Table Page

To share page 5 of the Colorado table, filtered to sites that likely do not honor GPC:
`/?state=CO&period=AugSep2026&tseries=Likely%20Does%20Not%20Honor%20GPC&page=5`
