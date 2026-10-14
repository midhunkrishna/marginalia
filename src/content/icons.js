// icons.js — tiny inline-SVG icon set (Lucide-style 24×24 outlines) replacing
// the old emoji/unicode glyphs, which rendered differently per platform. Built
// with createElementNS + setAttribute only — never innerHTML (XSS house rule).
// Icons inherit color via stroke="currentColor".
var GA = (typeof GA !== "undefined" && GA) || {};

GA.icons = (function () {
  const NS = "http://www.w3.org/2000/svg";

  // path data (d attributes) per icon; drawn on a 24x24 grid, stroke-width 2
  const PATHS = {
    minimize: ["M4 12h16"],
    restore: ["M4 9h16", "M4 15h10"],
    expand: ["M15 3h6v6", "M9 21H3v-6", "M21 3l-7 7", "M3 21l7-7"],
    trash: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"],
    close: ["M18 6L6 18", "M6 6l12 12"],
    stop: ["M7 7h10v10H7z"],
    retry: ["M3 12a9 9 0 1 0 3-6.7", "M3 4v5h5"],
    copy: ["M9 9h11v11H9z", "M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"],
    check: ["M20 6L9 17l-5-5"],
    resolve: ["M22 12a10 10 0 1 1-10-10", "M9 12l2.5 2.5L22 4"],
    reopen: ["M9 14L4 9l5-5", "M4 9h11a5 5 0 0 1 0 10h-3"],
    "comment-plus": ["M21 12a8 8 0 0 1-8 8H4l1.5-3.2A8 8 0 1 1 21 12z", "M12 8v6", "M9 11h6"],
    "chevron-up": ["M6 15l6-6 6 6"],
    "chevron-down": ["M6 9l6 6 6-6"],
    alert: ["M12 3l10 18H2z", "M12 10v4", "M12 17.5v.5"],
    list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
    jump: ["M5 12h14", "M12 5l7 7-7 7"],
    tag: [
      "M12.6 2.9a2 2 0 0 0-1.4-.6H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.5 8.5a2 2 0 0 0 2.8 0l7.2-7.2a2 2 0 0 0 0-2.8z",
      "M7.5 7.5h.01",
    ],
    pencil: ["M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"],
    markdown: [
      "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
      "M6 15v-6l2.5 3L11 9v6",
      "M15.5 9v4",
      "M13.5 11.5l2 2.5 2-2.5",
    ],
    globe: [
      "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z",
      "M2 12h20",
      "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z",
    ],
    download: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
    eye: [
      "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0z",
      "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    ],
    "eye-off": [
      "M10.733 5.076a10.744 10.744 0 0 1 11.205 6.576 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",
      "M14.084 14.158a3 3 0 0 1-4.242-4.242",
      "M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",
      "M2 2l20 20",
    ],
    gear: [
      "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
      "M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
    ],
  };

  // make("copy") -> <svg>; make("copy", 14) -> sized 14px (default 16 via CSS)
  function make(name, size) {
    const paths = PATHS[name];
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    if (size) {
      svg.setAttribute("width", String(size));
      svg.setAttribute("height", String(size));
    }
    (paths || []).forEach(function (d) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    });
    return svg;
  }

  // Swap a button's icon in place (e.g. minimize <-> restore, copy -> check).
  function swap(buttonEl, name) {
    const old = buttonEl.querySelector("svg");
    if (old) old.remove();
    buttonEl.appendChild(make(name));
  }

  return { make, swap };
})();
