/* Monthly themes for the independent SPAWN Note. No embedded-app overrides. */
(() => {
  "use strict";
  if (new URLSearchParams(location.search).get("embed") === "1") return;
  const PALETTES = Object.freeze({
  "1": {
    "label": "눈꽃 겨울",
    "icon": "❄️",
    "decor": [
      "❄️",
      "✧",
      "❄️"
    ],
    "bg": "#e6f2ff",
    "soft": "#f6faff",
    "header": "#234c75",
    "accent": "#245887",
    "glow1": "rgba(105,169,231,.28)",
    "glow2": "rgba(185,214,245,.38)"
  },
  "2": {
    "label": "라벤더",
    "icon": "💜",
    "decor": [
      "💜",
      "✨",
      "✦"
    ],
    "bg": "#f2e7f5",
    "soft": "#fff7fd",
    "header": "#66305f",
    "accent": "#883c7e",
    "glow1": "rgba(194,150,215,.30)",
    "glow2": "rgba(241,172,210,.26)"
  },
  "3": {
    "label": "벚꽃",
    "icon": "🌸",
    "decor": [
      "🌸",
      "🌸",
      "✿"
    ],
    "bg": "#ffe8f1",
    "soft": "#fff9fc",
    "header": "#70304d",
    "accent": "#93405a",
    "glow1": "rgba(241,140,178,.30)",
    "glow2": "rgba(250,200,215,.32)"
  },
  "4": {
    "label": "봄꽃",
    "icon": "🌷",
    "decor": [
      "🌷",
      "🦋",
      "✿"
    ],
    "bg": "#eee7ff",
    "soft": "#fcfaff",
    "header": "#504380",
    "accent": "#69529c",
    "glow1": "rgba(159,147,227,.24)",
    "glow2": "rgba(239,185,217,.29)"
  },
  "5": {
    "label": "초록 정원",
    "icon": "🌿",
    "decor": [
      "🌿",
      "🍀",
      "🌱"
    ],
    "bg": "#e7f5e4",
    "soft": "#f8fcf5",
    "header": "#245b3d",
    "accent": "#326a4a",
    "glow1": "rgba(145,201,136,.28)",
    "glow2": "rgba(210,234,165,.25)"
  },
  "6": {
    "label": "여름 하늘",
    "icon": "☁️",
    "decor": [
      "☁️",
      "🫧",
      "☀️"
    ],
    "bg": "#e2f2ff",
    "soft": "#f4fbff",
    "header": "#1b516e",
    "accent": "#226483",
    "glow1": "rgba(108,186,224,.29)",
    "glow2": "rgba(173,222,252,.33)"
  },
  "7": {
    "label": "푸른 바다",
    "icon": "🌊",
    "decor": [
      "🌊",
      "🐚",
      "🫧"
    ],
    "bg": "#dbf7f6",
    "soft": "#f2fdfc",
    "header": "#105566",
    "accent": "#126376",
    "glow1": "rgba(95,202,211,.27)",
    "glow2": "rgba(127,186,223,.32)"
  },
  "8": {
    "label": "여름 선셋",
    "icon": "🌻",
    "decor": [
      "🌻",
      "☀️",
      "🍉"
    ],
    "bg": "#fff0e1",
    "soft": "#fff9f1",
    "header": "#753b36",
    "accent": "#974f32",
    "glow1": "rgba(250,171,104,.30)",
    "glow2": "rgba(218,167,208,.27)"
  },
  "9": {
    "label": "황금 들판",
    "icon": "🌾",
    "decor": [
      "🌾",
      "🌻",
      "☀️"
    ],
    "bg": "#f8f1df",
    "soft": "#fffaf0",
    "header": "#69511f",
    "accent": "#866225",
    "glow1": "rgba(219,189,113,.27)",
    "glow2": "rgba(186,195,141,.25)"
  },
  "10": {
    "label": "단풍 가을",
    "icon": "🍁",
    "decor": [
      "🍁",
      "🍂",
      "🌰"
    ],
    "bg": "#ffebdc",
    "soft": "#fff8f0",
    "header": "#75351a",
    "accent": "#9a4c23",
    "glow1": "rgba(241,145,78,.30)",
    "glow2": "rgba(211,157,93,.25)"
  },
  "11": {
    "label": "늦가을",
    "icon": "🕯️",
    "decor": [
      "🕯️",
      "🍂",
      "🌰"
    ],
    "bg": "#eee5ec",
    "soft": "#f9f6f9",
    "header": "#51384f",
    "accent": "#6b4e68",
    "glow1": "rgba(180,141,170,.26)",
    "glow2": "rgba(159,148,162,.25)"
  },
  "12": {
    "label": "크리스마스",
    "icon": "🎄",
    "decor": [
      "🎄",
      "❄️",
      "🎁"
    ],
    "bg": "#eaf1fb",
    "soft": "#fbfbff",
    "header": "#702e45",
    "accent": "#92394f",
    "glow1": "rgba(148,182,220,.32)",
    "glow2": "rgba(215,156,171,.27)"
  }
});
  const root = document.documentElement;
  let lastMonth = 0;
  let scene = null;
  let badge = null;
  function koreaMonth() {
    // Broadcasters use Korean calendar months even when visiting from overseas.
    try {
      return Number(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", month: "numeric" }).format(new Date()));
    } catch {
      return new Date().getMonth() + 1;
    }
  }
  function applySeasonTheme() {
    const month = koreaMonth();
    const theme = PALETTES[String(month)];
    if (!theme || month === lastMonth) return;
    root.dataset.spwnSeason = String(month);
    for (const key of ["bg", "soft", "header", "accent", "glow1", "glow2"]) {
      root.style.setProperty("--spwn-" + key, theme[key]);
    }
    if (!scene) {
      scene = document.createElement("div");
      scene.className = "spwn-season-decor";
      scene.setAttribute("aria-hidden", "true");
      document.body.appendChild(scene);
    }
    scene.replaceChildren(...theme.decor.map(symbol => {
      const object = document.createElement("span");
      object.textContent = symbol;
      return object;
    }));
    if (!badge) {
      badge = document.createElement("span");
      badge.className = "spwn-season-badge";
      const title = document.querySelector(".brandtext h1");
      if (title) title.appendChild(badge);
    }
    if (badge) badge.textContent = theme.icon + " " + month + "월 " + theme.label;
    lastMonth = month;
  }
  applySeasonTheme();
  window.addEventListener("pageshow", applySeasonTheme);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) applySeasonTheme(); });
  // Revisiting an open tab after a month boundary must also switch the theme.
  setInterval(() => { if (!document.hidden) applySeasonTheme(); }, 15 * 60 * 1000);
})();
