import React, { useState } from "react";
import "./../App.css";

function HamburgerIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
            <path fillRule="evenodd" d="M2.5 4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0 4A.5.5 0 0 1 3 7.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5zm0 4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5z" />
        </svg>
    );
}

function HomeIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
            <path d="M8.354 1.146a.5.5 0 0 0-.708 0l-6 6A.5.5 0 0 0 1.5 7.5v7a.5.5 0 0 0 .5.5h4.5a.5.5 0 0 0 .5-.5v-4h2v4a.5.5 0 0 0 .5.5H14a.5.5 0 0 0 .5-.5v-7a.5.5 0 0 0-.146-.354L8.354 1.146zM2.5 14V7.707l5.5-5.5 5.5 5.5V14H9.5v-4a.5.5 0 0 0-.5-.5H7a.5.5 0 0 0-.5.5v4H2.5z" />
        </svg>
    );
}

function ChartIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
            <path d="M0 0h1v15h15v1H0V0zm14.817 3.113a.5.5 0 0 1 .07.704l-4.5 5.5a.5.5 0 0 1-.74.037L7.06 6.767l-3.656 5.027a.5.5 0 0 1-.808-.588l4-5.5a.5.5 0 0 1 .758-.06l2.609 2.61 4.15-5.073a.5.5 0 0 1 .704-.07z" />
        </svg>
    );
}

function PieIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
            <path d="M15.985 8.5H8.207l5.5 5.5a8 8 0 0 0 2.278-5.5zM14.972 7A7.001 7.001 0 0 0 9 1.028v6.972h5.972zM8 1.028V8l.5.5H15.5A8 8 0 1 0 8 1.028zM7.5 9V1.028A8 8 0 1 0 13.73 14.5L7.5 9z" />
        </svg>
    );
}

function TableIcon() {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
            <path d="M0 2a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H1a1 1 0 0 1-1-1V2zm1 2v2h3V4H1zm4 0v2h3V4H5zm4 0v2h3V4H9zm4 0v2h2V4h-2zM1 7v2h3V7H1zm4 0v2h3V7H5zm4 0v2h3V7H9zm4 0v2h2V7h-2zm-12 3v2h3v-2H1zm4 0v2h3v-2H5zm4 0v2h3v-2H9zm4 0v2h2v-2h-2z" />
        </svg>
    );
}

const NAV_ITEMS = [
    {
        id: "overview",
        label: "Overview",
        description: "Jump to the page title and intro.",
        Icon: HomeIcon,
    },
    {
        id: "trends",
        label: "Trends Chart",
        description: "View compliance trends over time.",
        Icon: ChartIcon,
    },
    {
        id: "gpp",
        label: "GPC Breakdown",
        description: "View the GPC section breakdown chart.",
        Icon: PieIcon,
    },
    {
        id: "table",
        label: "Data Table",
        description: "Browse and search the raw crawl data.",
        Icon: TableIcon,
    },
];

export default function SideNav({ activeSectionId, onNavigate }) {
    const [hovering, setHovering] = useState(false);
    const open = hovering;

    function handleNavigate(id) {
        onNavigate(id);
    }

    return (
        <nav
            className={`side-nav ${open ? "side-nav--expanded" : ""}`}
            aria-label="Section navigation"
            onMouseEnter={() => setHovering(true)}
            onMouseLeave={() => setHovering(false)}
        >
            <span className="side-nav__toggle" aria-hidden="true">
                <HamburgerIcon />
            </span>

            <ul className="side-nav__list">
                {NAV_ITEMS.map(({ id, label, description, Icon }) => (
                    <li key={id}>
                        <button
                            type="button"
                            className="side-nav__item"
                            title={label}
                            aria-current={activeSectionId === id ? "true" : undefined}
                            onClick={() => handleNavigate(id)}
                        >
                            <span className="side-nav__icon">
                                <Icon />
                            </span>
                            <span className="side-nav__text">
                                <span className="side-nav__label">{label}</span>
                                <span className="side-nav__desc">{description}</span>
                            </span>
                        </button>
                    </li>
                ))}
            </ul>
        </nav>
    );
}