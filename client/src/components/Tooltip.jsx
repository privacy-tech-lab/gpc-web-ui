import React, { useState } from "react";
import "./../App.css";

/**
 * A reusable Tooltip component.
 *
 * @param {Object} props
 * @param {React.ReactNode} props.content - The content to display inside the tooltip.
 * @param {string} [props.position="top"] - "top" (above element) or "bottom" (below element).
 * @param {React.ReactNode} props.children - The trigger element.
 * @param {string} [props.className] - Optional extra class for the wrapper.
 */
export default function Tooltip({
    content,
    position = "top",
    children,
    className = "",
}) {
    return (
        <div className={`tooltip-wrapper ${className}`}>
            {children}
            {content && (
                <div className={`tooltip-content tooltip--${position}`}>{content}</div>
            )}
        </div>
    );
}
