import React, { useState, useRef, useEffect } from "react";
import ReactDOM from "react-dom";
import "./../App.css";

/**
 * A reusable Tooltip component using React Portal.
 * This resolves z-index stacking issues in tables/sticky headers.
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
    const [isVisible, setIsVisible] = useState(false);
    const triggerRef = useRef(null);
    const [coords, setCoords] = useState({ top: 0, left: 0 });

    const calculatePosition = () => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        const gap = 8;

        let top = 0;
        let left = rect.left + rect.width / 2 + scrollX;

        if (position === "top") {
            top = rect.top + scrollY - gap;
        } else {
            top = rect.bottom + scrollY + gap;
        }

        setCoords({ top, left });
    };

    const handleMouseEnter = () => {
        calculatePosition();
        setIsVisible(true);
    };

    const handleMouseLeave = () => {
        setIsVisible(false);
    };

    // Recalculate on scroll/resize if visible
    useEffect(() => {
        if (!isVisible) return;
        const handleUpdate = () => calculatePosition();
        window.addEventListener("scroll", handleUpdate, true);
        window.addEventListener("resize", handleUpdate);
        return () => {
            window.removeEventListener("scroll", handleUpdate, true);
            window.removeEventListener("resize", handleUpdate);
        };
    }, [isVisible]);

    return (
        <>
            <div
                className={`tooltip-wrapper ${className}`}
                ref={triggerRef}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {children}
            </div>
            {isVisible &&
                content &&
                ReactDOM.createPortal(
                    <div
                        className={`tooltip-portal-content tooltip--${position}`}
                        style={{
                            top: coords.top,
                            left: coords.left,
                        }}
                    >
                        {content}
                    </div>,
                    document.body
                )}
        </>
    );
}
