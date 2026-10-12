// Shared helpers for PNG and video export

// Draws the "title + logo" overlay onto a canvas context sized width x height.
// Font size follows the image size but is capped by its height, so very wide panoramas don't get a
// giant title; text that doesn't fit is cut with an ellipsis instead of running off the edge.
export function drawTitleWatermark(ctx, width, height, { title = "", titleStyle = "title-logo", position = "bottom-right" } = {}) {
  const showText = titleStyle !== "logo-only";
  const showLogo = titleStyle !== "title-only";
  if (!showLogo && !String(title).trim()) return;

  const fontSize = Math.max(14, Math.round(Math.min(width * 0.018, height * 0.035)));
  const padding = Math.round(fontSize * 1.5);
  const computedStyle = getComputedStyle(document.documentElement);
  const themeFont = computedStyle.getPropertyValue("--app-font-family").trim() || "Inter, system-ui, sans-serif";
  const themeColor = computedStyle.getPropertyValue("--text-primary").trim() || "#888";

  ctx.save();
  ctx.font = `700 ${fontSize}px ${themeFont}`;
  ctx.fillStyle = themeColor;

  const logoHeight = Math.round(fontSize * 0.8);
  const logoWidth = (67 / 25) * logoHeight;
  const logoGap = Math.round(fontSize * 0.35);
  const logoBaselineOffset = fontSize * 0.08;
  const logoSpace = showLogo ? (showText ? logoGap : 0) + logoWidth : 0;

  let text = showText ? String(title) : "";
  const maxTextWidth = Math.max(0, width - padding * 2 - logoSpace);
  if (text && ctx.measureText(text).width > maxTextWidth) {
    while (text.length > 1 && ctx.measureText(`${text}…`).width > maxTextWidth) text = text.slice(0, -1);
    text = `${text.trimEnd()}…`;
  }
  const textWidth = text ? ctx.measureText(text).width : 0;
  const totalWidth = textWidth + logoSpace;

  let x;
  if (position.includes("left")) x = padding;
  else if (position.includes("center")) x = (width - totalWidth) / 2;
  else x = width - totalWidth - padding;
  const y = position.includes("top") ? padding + fontSize : height - padding;

  if (text) ctx.fillText(text, x, y);

  if (showLogo) {
    const logoX = x + textWidth + (text ? logoGap : 0);
    const logoY = y - logoHeight + logoBaselineOffset;
    const scale = logoHeight / 25;
    ctx.translate(logoX, logoY);
    ctx.scale(scale, scale);
    ctx.fillRect(0, 8.89844, 28.2656, 6.80469);
    ctx.fillRect(35.0703, 0, 31.9297, 7.32812);
    ctx.fillRect(35.0703, 16.75, 31.9297, 7.32812);
    ctx.beginPath();
    ctx.moveTo(35.0703, 0);
    ctx.lineTo(35.0703, 24.0781);
    ctx.lineTo(33.2656, 24.0781);
    ctx.bezierCurveTo(30.5042, 24.0781, 28.2656, 21.8395, 28.2656, 19.0781);
    ctx.lineTo(28.2656, 5);
    ctx.bezierCurveTo(28.2656, 2.23858, 30.5042, 0, 33.2656, 0);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

// Saves an exported file. In the desktop app this shows a native save dialog, so the result says
// whether the file was actually written ({ success } or { canceled }); in a browser it falls back to
// a download, which can't report a cancel.
export async function saveExportFile(blob, filename, { filterName, extension }) {
  if (window.electron?.saveExportFile) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return window.electron.saveExportFile({ bytes, suggestedName: filename, filterName, extension });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoking right away can cancel a large download before the browser has read it
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return { success: true };
}
