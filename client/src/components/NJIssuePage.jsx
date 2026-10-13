function BackArrowIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
      <path fillRule="evenodd" d="M15 8a.5.5 0 0 0-.5-.5H2.707l3.147-3.146a.5.5 0 1 0-.708-.708l-4 4a.5.5 0 0 0 0 .708l4 4a.5.5 0 0 0 .708-.708L2.707 8.5H14.5A.5.5 0 0 0 15 8z" />
    </svg>
  );
}

const C = {
  ink: "#0f172a",
  muted: "#475569",
  line: "#cbd5e1",
  soft: "#f1f5f9",
  red: "#fecaca",
  green: "#bbf7d0",
  amber: "#fde68a",
  gray: "#e2e8f0",
};

const bar = { red: "#e58a8a", green: "#7cc79a", blue: "#7fb0d9", gray: "#b8c0cc" };

/* ---------- Data (from the investigation sheet) ---------- */

const complianceRows = [
  { label: "MullvadVPN (NY IP)", vals: [831, 2998, 644, 7157] },
  { label: "ExpressVPN (NJ IP)", vals: [900, 3053, 647, 7050] },
  { label: "Difference", vals: [69, 55, 3, 107], diff: true },
  { label: "MullvadVPN, usnj sites removed", vals: [830, 2964, 638, 7135] },
  { label: "ExpressVPN, usnj sites removed", vals: [879, 3006, 641, 7050] },
  { label: "Difference", vals: [49, 42, 3, 85], diff: true },
  { label: "MullvadVPN, usnj sites only", vals: [1, 34, 6, 22] },
  { label: "ExpressVPN, usnj sites only", vals: [21, 47, 6, 0] },
  { label: "Difference", vals: [20, 13, 0, 22], diff: true },
];

const states = ["CA", "CO", "NY", "CT"];

const classificationMatrix = [
  [0, 1836, 1745, 1871],
  [1836, 0, 1360, 1550],
  [1745, 1360, 0, 1748],
  [1871, 1550, 1748, 0],
];

const resultsMatrix = [
  [0, 1159, 1322, 1090],
  [1159, 0, 793, 817],
  [1322, 793, 0, 1145],
  [1090, 817, 1145, 0],
];

const usnjChart = [
  { name: "MullvadVPN (NY IP)", vals: [1, 34, 6, 22] },
  { name: "ExpressVPN (NJ IP)", vals: [21, 47, 6, 0] },
];
const chartLegend = [
  ["Likely does not honor GPC", bar.red],
  ["Likely honors GPC", bar.green],
  ["Not applicable / invalid / missing", bar.blue],
  ["Null site", bar.gray],
];

/* ---------- Small building blocks ---------- */

const th = { padding: "8px 10px", textAlign: "right", fontWeight: 700, borderBottom: `2px solid ${C.ink}`, fontSize: "13px" };
const td = { padding: "7px 10px", textAlign: "right", borderBottom: `1px solid ${C.line}`, fontSize: "14px", fontVariantNumeric: "tabular-nums" };

function Section({ title, children }) {
  return (
    <section style={{ marginTop: "36px" }}>
      <h2 style={{ margin: "0 0 12px", fontSize: "20px", fontWeight: 800, color: C.ink }}>{title}</h2>
      {children}
    </section>
  );
}

function P({ children, style }) {
  return <p style={{ margin: "0 0 12px", lineHeight: 1.6, color: C.muted, fontSize: "15px", ...style }}>{children}</p>;
}

function Scroll({ children }) {
  return <div style={{ overflowX: "auto", border: `1px solid ${C.line}`, borderRadius: "8px" }}>{children}</div>;
}

function Stat({ value, label }) {
  return (
    <div style={{ flex: "1 1 160px", padding: "14px 16px", border: `1px solid ${C.line}`, borderRadius: "8px", background: "#fff" }}>
      <div style={{ fontSize: "28px", fontWeight: 800, color: C.ink }}>{value}</div>
      <div style={{ fontSize: "13px", color: C.muted, marginTop: "2px", lineHeight: 1.4 }}>{label}</div>
    </div>
  );
}

function Matrix({ data, summary }) {
  return (
    <>
      <Scroll>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={{ ...th, textAlign: "left" }}>IP geolocation</th>
              {states.map((s) => <th key={s} style={th}>{s}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={states[i]}>
                <td style={{ ...td, textAlign: "left", fontWeight: 600 }}>{states[i]}</td>
                {row.map((v, j) => (
                  <td key={j} style={{ ...td, background: i === j ? C.soft : undefined, color: i === j ? "#94a3b8" : C.ink }}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Scroll>
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginTop: "10px" }}>
        {summary.map(([label, value, color]) => (
          <div key={label} style={{ flex: "1 1 140px", padding: "10px 12px", borderRadius: "8px", background: color }}>
            <div style={{ fontSize: "12px", color: C.ink }}>{label}</div>
            <div style={{ fontSize: "20px", fontWeight: 800, color: C.ink }}>{value}</div>
          </div>
        ))}
      </div>
    </>
  );
}

function UsnjChart() {
  const max = 50;
  const h = 180;
  return (
    <div>
      <div style={{ display: "flex", gap: "32px", justifyContent: "center", alignItems: "flex-end", height: `${h + 28}px`, borderBottom: `1px solid ${C.line}`, padding: "0 8px" }}>
        {usnjChart.map((g) => (
          <div key={g.name} style={{ display: "flex", gap: "8px", alignItems: "flex-end" }}>
            {g.vals.map((v, i) => (
              <div key={i} style={{ width: "clamp(28px, 8vw, 52px)", textAlign: "center" }}>
                <div style={{ fontSize: "12px", fontWeight: 700, color: C.ink, marginBottom: "2px" }}>{v}</div>
                <div style={{ height: `${(v / max) * h}px`, minHeight: v ? "3px" : 0, background: chartLegend[i][1], borderRadius: "4px 4px 0 0" }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: "32px", justifyContent: "center", marginTop: "6px", fontSize: "13px", fontWeight: 600, color: C.ink, textAlign: "center" }}>
        {usnjChart.map((g) => <div key={g.name}>{g.name}</div>)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", justifyContent: "center", marginTop: "14px" }}>
        {chartLegend.map(([label, color]) => (
          <span key={label} style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: C.muted }}>
            <span style={{ width: "10px", height: "10px", borderRadius: "50%", background: color }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------- Page ---------- */

function NJIssuePage({ onBack }) {
  return (
    <div className="app-container" style={{ padding: "24px", maxWidth: "760px", margin: "0 auto", boxSizing: "border-box" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
        <button
          onClick={onBack}
          aria-label="Go back"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "40px",
            height: "40px",
            flexShrink: 0,
            border: "1px solid #cbd5e1",
            borderRadius: "8px",
            background: "#ffffff",
            color: "#0f172a",
            cursor: "pointer",
          }}
        >
          <BackArrowIcon />
        </button>

        <h1 style={{ margin: 0, color: "#0f172a", fontSize: "26px", fontWeight: "800" }}>
          NJ Issue
        </h1>
      </div>

      <Section title="Background">
        <P>
          We have historically used MullvadVPN to get a "New Jersey" connection. The Mullvad server is physically in
          New Jersey, but its public IP address geolocates to New York. That raised two questions: were our NJ crawls
          receiving traffic representative of New Jersey users, and if not, how different would results be from a true
          NJ connection?
        </P>
        <P>
          To find out, we ran a second NJ crawl through ExpressVPN, whose NJ IP truly geolocates to New Jersey. This
          investigation is tied to WebCrawler issue{" "}
          <a href="https://github.com/privacy-tech-lab/gpc-web-crawler/issues/345" style={{ color: "#2563eb" }}>#345</a>.
        </P>
      </Section>

      <Section title="Key findings">
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", marginBottom: "16px" }}>
          <Stat value="74" label="sites used a usnj GPP string (about 0.6% of sites crawled)" />
          <Stat value="22" label="usnj sites that were null from the NY IP but non-null from the NJ IP" />
          <Stat value="1.17%" label="decrease in NJ–NY complianceResults difference vs. the cross-state average" />
        </div>
        <ol style={{ margin: 0, paddingLeft: "20px", color: C.muted, fontSize: "15px", lineHeight: 1.6 }}>
          <li style={{ marginBottom: "8px" }}>
            <strong style={{ color: C.ink }}>Mullvad's NJ server was treated as a NY connection.</strong> Where the
            IP sits matters far more than where the server physically is.
          </li>
          <li style={{ marginBottom: "8px" }}>
            <strong style={{ color: C.ink }}>NJ and NY traffic are not unusually similar.</strong> Despite being
            neighbors, their compliance differences were about average relative to other state pairs.
          </li>
          <li>
            <strong style={{ color: C.ink }}>IP geolocation is the main trigger for state-specific privacy logic.</strong>{" "}
            Sites only applied NJ-specific behavior when the IP geolocated to NJ.
          </li>
        </ol>
      </Section>

      <Section title="usnj appearances">
        <P>
          Only 74 unique sites used the usnj string, and it appeared on none of the ExpressVPN-crawl pages. Because the
          count is small, it more likely reflects limited GPP adoption than a real lack of difference between NJ and NY
          traffic.
        </P>
        <Scroll>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Dataset</th>
                <th style={th}>usnj before</th>
                <th style={th}>usnj after</th>
                <th style={th}>Unique sites</th>
                <th style={th}>% of sites</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{ ...td, textAlign: "left" }}>ExpressVPN</td>
                <td style={td}>72</td><td style={td}>69</td><td style={td}>74</td><td style={td}>0.63</td>
              </tr>
              <tr>
                <td style={{ ...td, textAlign: "left" }}>MullvadVPN</td>
                <td style={td}>0</td><td style={td}>0</td><td style={td}>0</td><td style={td}>0</td>
              </tr>
            </tbody>
          </table>
        </Scroll>
      </Section>

      <Section title="Effect of switching VPNs on complianceResults">
        <P>
          Each row pair shows how results changed when the same crawl ran from a NY-geolocated IP versus a truly
          NJ-geolocated IP. Red marks sites that likely do not honor GPC, green those that likely do, and amber the
          crawl without usnj sites.
        </P>
        <Scroll>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "560px" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Dataset</th>
                <th style={th}>Does not honor</th>
                <th style={th}>Honors</th>
                <th style={th}>N/A, invalid, missing</th>
                <th style={th}>Null</th>
              </tr>
            </thead>
            <tbody>
              {complianceRows.map((r, i) => (
                <tr key={i} style={{ background: i >= 6 ? "#f0fdf4" : i >= 3 ? "#fffbeb" : undefined }}>
                  <td style={{ ...td, textAlign: "left", fontStyle: r.diff ? "italic" : "normal", fontWeight: r.diff ? 700 : 400 }}>
                    {r.label}
                  </td>
                  {r.vals.map((v, j) => (
                    <td key={j} style={{ ...td, fontWeight: r.diff ? 700 : 400, fontStyle: r.diff ? "italic" : "normal" }}>{v}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Scroll>
        <P style={{ marginTop: "14px" }}>
          All 22 usnj sites that were null from the NY IP became non-null from the NJ IP. That points to a sudden
          attempt at implementation, and shows NJ-specific logic failed to trigger when using Mullvad. Mullvad's server
          was physically in NJ, but its IP behaved as a NY connection.
        </P>
      </Section>

      <Section title="usnj subset by VPN">
        <UsnjChart />
      </Section>

      <Section title="Is NJ simply similar to NY?">
        <P>
          Given their proximity, NJ and NY might be expected to see similar traffic. If so, the NJ–NY difference would be
          smaller than average. The matrices below count how many sites changed classification or result between each
          pair of crawl states. The average is taken across the six pairs among CA, CO, NY and CT.
        </P>

        <h3 style={{ margin: "16px 0 8px", fontSize: "16px", color: C.ink }}>complianceClassifications</h3>
        <Matrix
          data={classificationMatrix}
          summary={[
            ["Average difference", "1685", C.red],
            ["NJ vs. NY difference", "1558", C.amber],
            ["Below average by", "7.54%", C.green],
          ]}
        />

        <h3 style={{ margin: "24px 0 8px", fontSize: "16px", color: C.ink }}>complianceResults</h3>
        <Matrix
          data={resultsMatrix}
          summary={[
            ["Average difference", "1054", C.red],
            ["NJ vs. NY difference", "1042", C.amber],
            ["Below average by", "1.17%", C.green],
          ]}
        />

        <P style={{ marginTop: "14px" }}>
          NJ and NY were only 7.5% and 1.2% closer than average, which is substantially smaller than the gaps between
          other states. Geographic proximity does not produce similar compliance behavior. Other factors, such as IP
          geolocation and state privacy requirements, matter more. NJ has comprehensive privacy laws and NY does not.
        </P>
      </Section>

      <Section title="Implications">
        <P>
          These results support the conclusion that Mullvad's "NJ" crawl is really a NY crawl, and that ExpressVPN is
          the true NJ crawl. Between the two crawls, 1,558 sites changed in schema classification, and 1,042 of the
          11,708 sites crawled (about 8.9%) ended up with a different overall compliance result. Among the 74 sites
          that used a usnj string, overall classification changed for 36.
        </P>
        <P>
          To judge whether that gap was meaningful, we compared it with the differences between our other Aug–Sept state
          crawls. The classification difference (1,558) sits just above the first quartile of state differences
          (average 1,685, median 1,746.5). The results difference (1,042) is near the average (1,054.3, median
          1,117.5). Both fall in the middle of the expected range, so the two "NJ" crawls differ about as much as
          crawls from different states do.
        </P>
        <P>
          It also shows a limit of IP-based protections: an NJ resident could lose NJ-specific privacy protections
          simply by connecting through a NY-geolocated IP.
        </P>
      </Section>
    </div>
  );
}

export default NJIssuePage;