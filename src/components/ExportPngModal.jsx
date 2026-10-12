import { ArrowLeft } from "lucide-react";
import { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { detailToSlider, sliderToDetail } from "../utils/sliderUtils";
import { formatYear } from "../utils/timelineUtils";
import useEscapeKey from "../hooks/useEscapeKey";
import "../styles/07-modals-menus.css";

const RESOLUTION_OPTIONS = [
  { value: 'current', label: 'Timeline', width: null, height: null },
  { value: 'hd', label: '1080p (1920 × 1080)', width: 1920, height: 1080 },
  { value: '4k', label: '4K (3840 × 2160)', width: 3840, height: 2160 },
  { value: 'letter', label: 'Letter 300 DPI (3300 × 2550)', width: 3300, height: 2550 },
  { value: 'a4', label: 'A4 300 DPI (3508 × 2480)', width: 3508, height: 2480 },
  { value: 'poster', label: 'Poster 36×24" (10800 × 7200)', width: 10800, height: 7200 },
  { value: 'custom', label: 'Custom', width: null, height: null },
];

export default function ExportPngModal({ isOpen, onClose, onExport, timelineData, timelineViewRef, exportState }) {
  const { t } = useTranslation("app");
  // Listed statically so i18next-parser sees every resolution key.
  const resolutionLabels = useMemo(() => ({
    current: t("exportPng.resolutions.current", "Timeline"),
    hd: t("exportPng.resolutions.hd", "1080p (1920 × 1080)"),
    "4k": t("exportPng.resolutions.4k", "4K (3840 × 2160)"),
    letter: t("exportPng.resolutions.letter", "Letter 300 DPI (3300 × 2550)"),
    a4: t("exportPng.resolutions.a4", "A4 300 DPI (3508 × 2480)"),
    poster: t("exportPng.resolutions.poster", "Poster 36×24\u0022 (10800 × 7200)"),
    custom: t("exportPng.resolutions.custom", "Custom"),
  }), [t]);
  const [filename, setFilename] = useState("");
  const [previewData, setPreviewData] = useState(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  const [validationErrors, setValidationErrors] = useState([]);
  const [resolution, setResolution] = useState('current');
  const [customWidth, setCustomWidth] = useState('1920');
  const [customHeight, setCustomHeight] = useState('1080');
  const [bgOption, setBgOption] = useState('default');
  const [showTitle, setShowTitle] = useState(false);
  const [titlePosition, setTitlePosition] = useState('bottom-right');
  const [titleStyle, setTitleStyle] = useState('title-logo');
  const [titleText, setTitleText] = useState('');
  const [exportRange, setExportRange] = useState({ startPercent: 0, endPercent: 100 });
  // Horizontal spacing for this export only (same as Ctrl+Shift+scroll); null until the modal opens
  const [detailLevel, setDetailLevel] = useState(null);

  const previewTimeoutRef = useRef(null);
  const backdropPointerDownRef = useRef(false);
  const minRangePercent = 5;
  const rangeSpanPercent = Math.max(minRangePercent, exportRange.endPercent - exportRange.startPercent);

  useEffect(() => {
    if (isOpen && timelineData?.file) {
      const file = timelineData.file;
      setFilename(file.id || file.title || "timeline");
      setValidationErrors([]);
      setPreviewData(null);
      setResolution('current');
      setBgOption('default');
      setShowTitle(false);
      setTitlePosition('bottom-right');
      setTitleStyle('title-logo');
      setTitleText(file.title || "");
      setExportRange({ startPercent: 0, endPercent: 100 });
      setDetailLevel(timelineViewRef?.current?.getDetailLevel?.() ?? 1);
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // The scale is applied to the live timeline while the modal is open, and undone when it closes
  useEffect(() => {
    if (!isOpen) return;
    const view = timelineViewRef?.current;
    return () => { view?.setExportDetailLevel?.(null); };
  }, [isOpen, timelineViewRef]);

  useEffect(() => {
    if (resolution === "current" && showTitle) {
      setShowTitle(false);
    }
  }, [resolution, showTitle]);

  useEffect(() => {
    if (!isOpen || !timelineViewRef?.current?.generatePreview) return;

    if (previewTimeoutRef.current) {
      clearTimeout(previewTimeoutRef.current);
    }

    previewTimeoutRef.current = setTimeout(async () => {
      setIsGeneratingPreview(true);
      try {
        if (detailLevel != null) await timelineViewRef.current.setExportDetailLevel?.(detailLevel);
        let previewOpts = {};
        if (bgOption === 'transparent') {
          previewOpts.transparentBg = true;
        } else if (bgOption === 'secondary' || bgOption === 'tertiary') {
          const varName = bgOption === 'secondary' ? '--surface' : '--inset-bg';
          previewOpts.customBg = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
        }
        const data = await timelineViewRef.current.generatePreview(previewOpts);
        setPreviewData(data);
      } catch (error) {
        console.error('Error generating preview:', error);
      } finally {
        setIsGeneratingPreview(false);
      }
    }, 300);

    return () => {
      if (previewTimeoutRef.current) {
        clearTimeout(previewTimeoutRef.current);
      }
    };
  }, [isOpen, bgOption, detailLevel, timelineViewRef]);

  const isExporting = Boolean(exportState);

  useEscapeKey(isOpen && !isExporting, onClose);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e) => {
    backdropPointerDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropMouseUp = (e) => {
    if (!isExporting && backdropPointerDownRef.current && e.target === e.currentTarget) {
      onClose();
    }
    backdropPointerDownRef.current = false;
  };

  const handleExport = () => {
    let targetWidth, targetHeight;
    if (resolution === 'custom') {
      const parsedW = parseInt(customWidth, 10);
      const parsedH = parseInt(customHeight, 10);
      targetWidth = (parsedW > 0) ? Math.min(parsedW, 16384) : null;
      targetHeight = (parsedH > 0) ? Math.min(parsedH, 16384) : null;
    } else {
      const selectedRes = RESOLUTION_OPTIONS.find(r => r.value === resolution) || RESOLUTION_OPTIONS[0];
      targetWidth = selectedRes.width;
      targetHeight = selectedRes.height;
    }

    let exportBgOpts = {};
    if (bgOption === 'transparent') {
      exportBgOpts.transparentBg = true;
    } else if (bgOption === 'secondary' || bgOption === 'tertiary') {
      const varName = bgOption === 'secondary' ? '--surface' : '--inset-bg';
      exportBgOpts.customBg = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    }

    const startYear = previewData?.percentToYear
      ? previewData.percentToYear(exportRange.startPercent)
      : previewData?.minYear;
    const endYear = previewData?.percentToYear
      ? previewData.percentToYear(exportRange.endPercent)
      : previewData?.maxYear;

    onExport({
      ...exportBgOpts,
      filename: (filename || "").trim() || (timelineData?.file?.id || timelineData?.file?.title || "timeline"),
      targetWidth,
      targetHeight,
      exportStartYear: startYear,
      exportEndYear: endYear,
      showTitle,
      titlePosition,
      titleStyle,
      title: titleText,
    });
  };

  const handleCancel = () => {
    if (isExporting) return;
    setValidationErrors([]);
    setPreviewData(null);
    onClose();
  };

  const selectedRes = RESOLUTION_OPTIONS.find(r => r.value === resolution) || RESOLUTION_OPTIONS[0];
  const rangeRatio = rangeSpanPercent / 100;
  const rangeWidthPx = previewData?.elementWidth ? previewData.elementWidth * rangeRatio : null;
  const previewStartPercent = Math.min(exportRange.startPercent, 100 - rangeSpanPercent);
  // The export keeps only the rows this range uses (TimelineView's measureContentBounds), so the
  // content is centred in the frame; the size readout and preview use the same band
  const contentBounds = previewData?.contentBounds?.(previewStartPercent, previewStartPercent + rangeSpanPercent);
  const contentTop = contentBounds?.top ?? 0;
  const contentHeight = contentBounds
    ? Math.max(1, contentBounds.bottom - contentBounds.top)
    : (previewData?.elementHeight || 1);

  const getExportDimensions = () => {
    if (!previewData?.elementWidth || !previewData?.elementHeight) return null;
    if (resolution === 'custom') {
      const w = Math.min(16384, parseInt(customWidth, 10));
      const h = Math.min(16384, parseInt(customHeight, 10));
      if (w > 0 && h > 0) return { width: w, height: h };
      if (w > 0) {
        const sourceWidth = rangeWidthPx || previewData.elementWidth;
        if (!sourceWidth) return null;
        const scale = w / sourceWidth;
        return { width: w, height: Math.round(contentHeight * scale) };
      }
      return null;
    }
    // Presets export at exactly their size; a timeline that doesn't fit is scaled down inside it
    if (selectedRes.width) {
      return { width: selectedRes.width, height: selectedRes.height };
    }
    const sourceWidth = rangeWidthPx || previewData.elementWidth;
    return {
      width: Math.round(sourceWidth * 2),
      height: Math.round(contentHeight * 2)
    };
  };

  // Fixed output size (preset, or custom width and height), or null when the height follows the timeline
  const getTargetSize = () => {
    if (!previewData?.elementWidth || !previewData?.elementHeight) return null;
    const targetW = resolution === 'custom' ? parseInt(customWidth, 10) : selectedRes.width;
    const targetH = resolution === 'custom' ? parseInt(customHeight, 10) : selectedRes.height;
    return targetW > 0 && targetH > 0 ? { targetW, targetH } : null;
  };

  const targetSize = getTargetSize();
  // Preview frame: the output's shape, holding a window onto the selected range's content band.
  // With a fixed size the band is scaled to fit inside it and centred, as the export does.
  const frameW = targetSize ? targetSize.targetW : (rangeWidthPx || 1);
  const frameH = targetSize ? targetSize.targetH : contentHeight;
  const bandScale = Math.min(frameW / (rangeWidthPx || 1), frameH / contentHeight);
  const previewWindowStyle = {
    position: 'relative',
    overflow: 'hidden',
    flexShrink: 0,
    width: `${((rangeWidthPx || 1) * bandScale / frameW) * 100}%`,
    height: `${(contentHeight * bandScale / frameH) * 100}%`,
  };
  const previewImageStyle = {
    position: 'absolute',
    left: `${-(previewStartPercent / rangeSpanPercent) * 100}%`,
    top: `${-(contentTop / contentHeight) * 100}%`,
    width: `${100 / rangeRatio}%`,
    height: 'auto',
    maxWidth: 'none',
    maxHeight: 'none',
  };
  const previewBgColor = bgOption === 'secondary' ? 'var(--surface)'
    : bgOption === 'tertiary' ? 'var(--inset-bg)'
    : undefined;
  const file = timelineData?.file;
  const displayYear = (value) => {
    if (!Number.isFinite(value)) return "--";
    return formatYear(value, file?.negID, file?.posID, file?.useCalendar === true, file?.hideDecimals);
  };
  const selectedStartYear = previewData?.percentToYear
    ? previewData.percentToYear(exportRange.startPercent)
    : previewData?.minYear;
  const selectedEndYear = previewData?.percentToYear
    ? previewData.percentToYear(exportRange.endPercent)
    : previewData?.maxYear;
  const rangeMinYear = previewData?.minYear;
  const rangeMaxYear = previewData?.maxYear;
  const rangeStep = 0.1;

  const handleStartRangeChange = (e) => {
    const raw = Number(e.target.value);
    if (!Number.isFinite(raw)) return;
    setExportRange((current) => ({
      startPercent: Math.min(Math.max(0, raw), current.endPercent - minRangePercent),
      endPercent: current.endPercent,
    }));
  };

  const handleEndRangeChange = (e) => {
    const raw = Number(e.target.value);
    if (!Number.isFinite(raw)) return;
    setExportRange((current) => ({
      startPercent: current.startPercent,
      endPercent: Math.max(Math.min(100, raw), current.startPercent + minRangePercent),
    }));
  };

  return (
    <div className="settings-backdrop" onMouseDown={handleBackdropMouseDown} onMouseUp={handleBackdropMouseUp}>
      <div className="settings-modal export-png-modal">
        <div className="settings-header">
          <button
            className="settings-back-button"
            onClick={handleCancel}
            aria-label={t("common:actions.close", "Close")}
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <h2 className="settings-title">{t("exportPng.title", "EXPORT PNG")}</h2>
        </div>

        {validationErrors.length > 0 && (
          <div className="settings-errors">
            {validationErrors.map((error, index) => (
              <div key={index} className="settings-error">
                {error}
              </div>
            ))}
          </div>
        )}

        <div className="settings-content">
          <div
            className={`export-preview-container ${bgOption === 'transparent' ? 'export-preview-transparent' : ''}`}
          >
            {isGeneratingPreview ? (
              <div className="export-preview-loading">{t("exportPng.generatingPreview", "Generating preview...")}</div>
            ) : previewData?.imageUrl ? (
              <div
                className="export-preview-wrapper"
                style={{
                  aspectRatio: `${frameW} / ${frameH}`,
                  // Width-driven, so cap it where the 368px max height would otherwise squash the shape
                  width: `min(100%, calc(368px * ${frameW / frameH}))`,
                  backgroundColor: previewBgColor,
                }}
              >
                <div style={previewWindowStyle}>
                  <img
                    src={previewData.imageUrl}
                    alt={t("exportPng.previewAlt", "Export preview")}
                    className="export-preview-image"
                    style={previewImageStyle}
                    draggable={false}
                  />
                </div>
                <div className="export-preview-bounds" style={{
                  border: '1px dashed var(--ui-muted)',
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  boxSizing: 'border-box',
                }} />
                {showTitle && resolution !== 'current' && (
                  <div className={`export-preview-title export-preview-title-${titlePosition}`}>
                    {titleStyle !== 'logo-only' && (titleText || '')}
                    {titleStyle !== 'title-only' && (
                      <svg
                        className={`export-preview-title-logo${titleStyle === 'logo-only' ? ' export-preview-title-logo-only' : ''}`}
                        viewBox="0 0 67 25"
                        fill="currentColor"
                        xmlns="http://www.w3.org/2000/svg"
                        aria-hidden="true"
                      >
                        <rect y="8.89844" width="28.2656" height="6.80469" />
                        <rect x="35.0703" width="31.9297" height="7.32812" />
                        <rect x="35.0703" y="16.75" width="31.9297" height="7.32812" />
                        <path d="M28.2656 5C28.2656 2.23858 30.5042 0 33.2656 0H35.0703V24.0781H33.2656C30.5042 24.0781 28.2656 21.8395 28.2656 19.0781V5Z" />
                      </svg>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="export-preview-placeholder">{t("exportPng.previewPlaceholder", "Preview will appear here")}</div>
            )}
          </div>

          {isExporting && (
            <div className="settings-row">
              <div className="settings-row-left" style={{ flex: 1 }}>
                <div className="settings-row-label">{exportState.stage || t("exportPng.exporting", "Exporting...")}</div>
                <div className="export-progress-bar">
                  <div
                    className="export-progress-fill"
                    style={{ width: `${exportState.percent || 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">{t("exportPng.resolution.label", "Resolution")}</div>
              <div className="settings-row-description">
                {(() => {
                  const dims = getExportDimensions();
                  return dims ? `${dims.width} × ${dims.height} px` : t("exportPng.resolution.description", "Higher resolutions are better for printing.");
                })()}
              </div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
              >
                {RESOLUTION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{resolutionLabels[opt.value] || opt.label}</option>
                ))}
              </select>
              {resolution === 'custom' && (
                <div className="export-custom-resolution">
                  <input
                    type="number"
                    className="settings-input export-custom-resolution-input"
                    value={customWidth}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    placeholder={t("exportPng.width", "Width")}
                    min={1}
                    max={16384}
                  />
                  <span className="settings-scale-section-separator">×</span>
                  <input
                    type="number"
                    className="settings-input export-custom-resolution-input"
                    value={customHeight}
                    onChange={(e) => setCustomHeight(e.target.value)}
                    placeholder={t("exportPng.height", "Height")}
                    min={1}
                    max={16384}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">{t("exportPng.scale.label", "Timeline Scale")}</div>
              <div className="settings-row-description">
                {t("exportPng.scale.description", "Spacing between years for this export ({{level}}x). Your timeline isn't changed.", { level: detailLevel ?? 1 })}
              </div>
            </div>
            <div className="settings-row-right">
              <div className="settings-slider-wrap">
                <input
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  className="settings-slider"
                  aria-label={t("exportPng.scale.label", "Timeline Scale")}
                  value={detailToSlider(detailLevel ?? 1)}
                  disabled={isExporting || detailLevel == null}
                  onChange={(e) => {
                    const raw = sliderToDetail(Number(e.target.value));
                    setDetailLevel(Number((Math.round(raw * 10) / 10).toFixed(1)));
                  }}
                />
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">{t("exportPng.range.label", "Timeline Range")}</div>
              <div className="settings-row-description">
                {t("exportPng.range.description", "{{start}} to {{end}} (of {{min}} to {{max}})", { start: displayYear(selectedStartYear), end: displayYear(selectedEndYear), min: displayYear(rangeMinYear), max: displayYear(rangeMaxYear) })}
              </div>
            </div>
            <div className="settings-row-right">
              <div className="export-range-control">
                <div className="export-range-slider-wrap">
                  <div className="export-range-track" />
                  <div
                    className="export-range-selection"
                    style={{
                      left: `${exportRange.startPercent}%`,
                      width: `${Math.max(0, exportRange.endPercent - exportRange.startPercent)}%`,
                    }}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={rangeStep}
                    value={exportRange.startPercent}
                    onChange={handleStartRangeChange}
                    className="export-range-slider export-range-slider-start"
                    aria-label={t("exportPng.range.startAria", "Export start year")}
                    disabled={!previewData}
                  />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={rangeStep}
                    value={exportRange.endPercent}
                    onChange={handleEndRangeChange}
                    className="export-range-slider export-range-slider-end"
                    aria-label={t("exportPng.range.endAria", "Export end year")}
                    disabled={!previewData}
                  />
                </div>
                <div className="export-range-labels">
                  <span>{displayYear(selectedStartYear)}</span>
                  <span>{displayYear(selectedEndYear)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">{t("exportPng.background.label", "Background")}</div>
              <div className="settings-row-description">{t("exportPng.background.description", "Choose the background color for the export.")}</div>
            </div>
            <div className="settings-row-right">
              <select
                className="settings-select"
                value={bgOption}
                onChange={(e) => setBgOption(e.target.value)}
              >
                <option value="default">{t("exportPng.background.default", "Default")}</option>
                <option value="secondary">{t("exportPng.background.secondary", "Secondary")}</option>
                <option value="tertiary">{t("exportPng.background.tertiary", "Tertiary")}</option>
                <option value="transparent">{t("exportPng.background.transparent", "Transparent")}</option>
              </select>
            </div>
          </div>

          <div className="settings-row">
            <div className="settings-row-left">
              <div className="settings-row-label">{t("exportPng.watermark.label", "Title Watermark")}</div>
              <div className="settings-row-description">
                {resolution === "current"
                  ? t("exportPng.watermark.unavailable", "Available for fixed export resolutions.")
                  : t("exportPng.watermark.description", "Overlay the timeline title on the export.")}
              </div>
            </div>
            <div className="settings-row-right">
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={showTitle}
                  onChange={(e) => setShowTitle(e.target.checked)}
                  disabled={resolution === "current"}
                />
                <span className="settings-toggle-slider"></span>
              </label>
            </div>
          </div>

          {showTitle && resolution !== "current" && (
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">{t("exportPng.titleText.label", "Title Text")}</div>
                <div className="settings-row-description">{t("exportPng.titleText.description", "Custom text used only for this export.")}</div>
              </div>
              <div className="settings-row-right">
                <input
                  type="text"
                  className="settings-input"
                  value={titleText}
                  onChange={(e) => setTitleText(e.target.value)}
                  placeholder={t("exportPng.titleText.placeholder", "Enter export title")}
                  maxLength={120}
                  disabled={titleStyle === "logo-only"}
                />
              </div>
            </div>
          )}

          {showTitle && resolution !== "current" && (
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">{t("exportPng.titleStyle.label", "Title Style")}</div>
                <div className="settings-row-description">{t("exportPng.titleStyle.description", "Choose what appears in the watermark.")}</div>
              </div>
              <div className="settings-row-right">
                <select
                  className="settings-select"
                  value={titleStyle}
                  onChange={(e) => setTitleStyle(e.target.value)}
                >
                  <option value="title-logo">{t("exportPng.titleStyle.titleLogo", "Title and Logo")}</option>
                  <option value="title-only">{t("exportPng.titleStyle.titleOnly", "Title Only")}</option>
                  <option value="logo-only">{t("exportPng.titleStyle.logoOnly", "Logo Only")}</option>
                </select>
              </div>
            </div>
          )}

          {showTitle && resolution !== "current" && (
            <div className="settings-row">
              <div className="settings-row-left">
                <div className="settings-row-label">{t("exportPng.titlePosition.label", "Title Position")}</div>
                <div className="settings-row-description">{t("exportPng.titlePosition.description", "Where to place the title on the export.")}</div>
              </div>
              <div className="settings-row-right">
                <select
                  className="settings-select"
                  value={titlePosition}
                  onChange={(e) => setTitlePosition(e.target.value)}
                >
                  <option value="top-left">{t("exportPng.titlePosition.topLeft", "Top Left")}</option>
                  <option value="top-center">{t("exportPng.titlePosition.topCenter", "Top Center")}</option>
                  <option value="top-right">{t("exportPng.titlePosition.topRight", "Top Right")}</option>
                  <option value="bottom-left">{t("exportPng.titlePosition.bottomLeft", "Bottom Left")}</option>
                  <option value="bottom-center">{t("exportPng.titlePosition.bottomCenter", "Bottom Center")}</option>
                  <option value="bottom-right">{t("exportPng.titlePosition.bottomRight", "Bottom Right")}</option>
                </select>
              </div>
            </div>
          )}

        </div>

        <div className="settings-footer">
          <button
            className="settings-footer-button settings-cancel-button"
            onClick={handleCancel}
            disabled={isExporting}
          >
            {t("common:actions.cancel", "Cancel")}
          </button>
          <button
            className="settings-footer-button settings-create-button"
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? t("exportPng.exportingPercent", "Exporting {{percent}}%", { percent: exportState.percent || 0 }) : t("exportPng.export", "Export")}
          </button>
        </div>
      </div>
    </div>
  );
}
