# GPC Web UI

Code for showing GPC crawl results in an interactive user interface on the web

Currently deployed on vercel at [gpc-web-ui.vercel.app](gpc-web-ui.vercel.app)

# Instructions for Running Locally

Run the following command to clone this repository locally:

``git clone https://github.com/privacy-tech-lab/gpc-web-ui.git``

Navigate to the client directory

``cd client``

Run these commands, then navigate to the localhost link provided in your terminal to see the UI displayed.

```npm i```

```npm run dev```

# Adding New Data

To add new data to the UI:
1. Download the <MonthYear>, <MonthYear>NullSites and <MonthYear>PotentiallyNonCompliantSites as csv files.
2. Place the csv files in the `/public` folder in the appropriate state.
3. Update the `stateMonths` and `timePeriods` in `App.jsx`

