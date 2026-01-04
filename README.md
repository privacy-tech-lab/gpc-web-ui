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
1. Run the Full_Parse_Data_to_csv colab for your desired Month, Year, and State (Guide [here](https://github.com/privacy-tech-lab/gpc-web-crawler/wiki/Instructions-for-Lab-Members-Performing-Crawls#parsinganalyzing-crawl-data))
2. Download the <MonthYear>, <MonthYear>NullSites and <MonthYear>PotentiallyNonCompliantSites csv files from Google Drive (GPC/GPC_Web/Web_Data/Web_Crawler/Crawl_Results_Overall/<State>).
3. Put files in the `/public/<state>` folder
4. Update the `stateMonths` and `timePeriods` in `App.jsx`
