# GPC Web UI — URL Parameters API

The GPC Web UI supports bidirectional initialization and synchronization of its filtering state using browser URL query parameters. This allows for creating bookmarkable views, making it easy to link directly to specific configurations from external tools (like browser extensions) or share exact data views with your team.

## Usage

When loading the GPC Web UI, you can fully customize the initial view by appending specific query parameters to the URL string. 
Additionally, as you interact with the UI filters (such as dropdowns and search bars), the application will automatically update the URL to reflect to your new state.

### Available Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `search`<br>`url`<br>`domain`<br>`site` | `string` | Applies a text filter to search for a specific site URL. If present, the UI will automatically scroll to the data table on load. |
| `state` | `string` | Filters the data by state code. Example: `CA`, `CT`, `CO`, `NJ`. |
| `period` | `string` | Filters by the crawl time period. Example: `May2025`, `Dec2023`. |
| `mode` | `string` | Sets the analysis mode of the UI. Accepts either `schema` (Schema classifications) or `legacy` (Legacy reasons). |
| `datatype`<br>`type` | `string` | Sets the data slice type. Options include `all`, `null`, `pnc` (Potentially non-compliant), or `schema-noncompliant`. |
| `tokens`<br>`schema` | `string` | A comma-separated list of schema tokens to filter the data. Example: `usnat,usca`. |
| `reasons` | `string` | A comma-separated list of legacy filter reasons (when in `legacy` mode). |
| `page` | `integer` | Sets the current page number for the main table view. Defaults to `1`. |

## Example Scenarios

### 1. Simple Site Lookup
To launch the dashboard targeted specifically at one website's analysis:
`/?url=google.com`

### 2. Complex View Initialization
To configure the UI for Connecticut (CT), filtering by the `usnat` token, and immediately searching for a site:
`/?search=example.com&state=CT&tokens=usnat`

### 3. Shareable Page Navigation
To share a fully hydrated state view with a colleague highlighting page 5 of schema-noncompliant sites:
`/?mode=schema&datatype=schema-noncompliant&page=5`
