import { useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpRight } from "lucide-react";
import { listTimelines, loadTimeline } from "../utils/electronApi";
import { getStorageId } from "../utils/idUtils";
import { describeLink, normalizeLinks, normalizeListing } from "../utils/timelineLinks";

const TYPE_ORDER = { era: 0, span: 1, event: 2 };

const sortElements = (elements) =>
  [...(elements || [])]
    .filter((el) => el?.id && ["event", "span", "era"].includes(el.type))
    .sort((a, b) => (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]) || String(a.title || "").localeCompare(String(b.title || "")));

// the library listing is shared by every open links section, one fetch is plenty
let listingPromise = null;
function useLibraryListing(enabled) {
  const [listing, setListing] = useState([]);
  useEffect(() => {
    if (!enabled || window.electron === undefined) return undefined;
    let cancelled = false;
    listingPromise = listingPromise || listTimelines().then(normalizeListing).finally(() => {
      // forget it soon so new timelines show up next time around
      setTimeout(() => { listingPromise = null; }, 5000);
    });
    listingPromise.then((list) => { if (!cancelled) setListing(list); });
    return () => { cancelled = true; };
  }, [enabled]);
  return listing;
}

export default function TimelineLinksSection({ element, timelineData, isEditMode, readOnly = false, onCommit, onFollowLink, removeButton = null, startAdding = false, localOnly = false }) {
  const { t } = useTranslation("timeline");
  const typeLabels = {
    event: t("elementTypes.event", "Event"),
    span: t("elementTypes.span", "Span"),
    era: t("elementTypes.era", "Era"),
  };
  const currentUid = getStorageId(timelineData?.file);
  // the web viewer only has this one timeline, so links elsewhere are hidden (also keeps other timeline names private)
  const links = useMemo(() => {
    const all = normalizeLinks(element?.links);
    return localOnly ? all.filter((link) => link.timeline === currentUid && link.element) : all;
  }, [element?.links, localOnly, currentUid]);
  const canBrowse = window.electron !== undefined;
  const listing = useLibraryListing(canBrowse && (links.length > 0 || isEditMode));

  const [isAdding, setIsAdding] = useState(false);
  const [targetTimeline, setTargetTimeline] = useState("");
  const [targetElements, setTargetElements] = useState([]);
  const [targetElement, setTargetElement] = useState("");
  const [isLoadingTarget, setIsLoadingTarget] = useState(false);
  const fieldId = useId();

  // just added from the property menu with nothing linked yet? open the picker right away
  useEffect(() => {
    setIsAdding(startAdding && links.length === 0);
    setTargetTimeline("");
    setTargetElement("");
  }, [element?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!targetTimeline) {
      setTargetElements([]);
      return undefined;
    }
    if (targetTimeline === currentUid) {
      setTargetElements(sortElements(timelineData?.elements).filter((el) => el.id !== element?.id));
      return undefined;
    }
    const entry = listing.find((item) => item.uid === targetTimeline);
    if (!entry) return undefined;
    let cancelled = false;
    setIsLoadingTarget(true);
    loadTimeline(entry.id)
      .then((data) => { if (!cancelled) setTargetElements(sortElements(data?.elements)); })
      .catch(() => { if (!cancelled) setTargetElements([]); })
      .finally(() => { if (!cancelled) setIsLoadingTarget(false); });
    return () => { cancelled = true; };
  }, [targetTimeline, currentUid, listing, timelineData?.elements, element?.id]);

  if (!element) return null;
  if (!isEditMode && links.length === 0) return null;

  const commitLinks = (nextLinks) => {
    const normalized = normalizeLinks(nextLinks);
    const next = { ...element };
    if (normalized.length) next.links = normalized;
    else delete next.links;
    onCommit?.(next);
  };

  const addLink = () => {
    if (!targetTimeline) return;
    const isSelf = targetTimeline === currentUid;
    const entry = listing.find((item) => item.uid === targetTimeline);
    const target = targetElements.find((el) => el.id === targetElement);
    const link = { timeline: targetTimeline };
    if (!isSelf && entry?.name) link.timelineTitle = entry.name;
    if (target) {
      link.element = target.id;
      link.elementTitle = target.title || target.id;
    }
    commitLinks([...links, link]);
    setIsAdding(false);
    setTargetTimeline("");
    setTargetElement("");
  };

  const describe = (link) => {
    const info = describeLink(link, listing, currentUid);
    const timelineTitle = info.isSelf
      ? t("links.thisTimeline", "This timeline")
      : info.timelineTitle || t("links.missingTimeline", "Missing timeline");
    const label = info.elementTitle ? `${timelineTitle} · ${info.elementTitle}` : timelineTitle;
    const title = info.isMissing ? t("links.missingHint", "That timeline isn't in your library anymore") : t("links.goTo", "Go to {{label}}", { label });
    return { ...info, label, title };
  };

  const renderLink = (link) => {
    const { isMissing, label, title } = describe(link);
    return (
      <div key={`${link.timeline}-${link.element ?? ""}`} className={`timeline-link-row${isMissing ? " is-missing" : ""}`}>
        <button
          type="button"
          className="timeline-link-button"
          disabled={!onFollowLink || isMissing}
          title={title}
          onClick={() => onFollowLink?.(link)}
        >
          <ArrowUpRight size={12} />
          <span className="timeline-link-label">{label}</span>
        </button>
      </div>
    );
  };

  // edit mode borrows the tag chips: label to follow, x to remove, dashed chip to add
  const renderEditChip = (link, index) => {
    const { isMissing, label, title } = describe(link);
    return (
      <div key={`${link.timeline}-${link.element ?? ""}`} className={`tag-edit-chip timeline-link-chip${isMissing ? " is-missing" : ""}`}>
        <button
          type="button"
          className="timeline-link-chip-label"
          disabled={!onFollowLink || isMissing}
          title={title}
          onClick={() => onFollowLink?.(link)}
        >
          <ArrowUpRight size={11} />
          <span className="timeline-link-label">{label}</span>
        </button>
        {!readOnly && (
          <button
            type="button"
            className="tag-edit-remove"
            onClick={() => commitLinks(links.filter((_, i) => i !== index))}
            aria-label={t("links.remove", "Remove connection to {{label}}", { label })}
          >×</button>
        )}
      </div>
    );
  };

  if (!isEditMode) {
    return (
      <div className="view-group view-group-chips">
        <label>{t("links.label", "Connections")}</label>
        <div className="view-separator" />
        <div className="timeline-link-list">{links.map(renderLink)}</div>
      </div>
    );
  }

  return (
    <div className="form-group timeline-links-editor">
      {removeButton}
      <div className="edit-row edit-row-tags edit-row-links">
        <label>{t("links.label", "Connections")}</label>
        <div className="tag-edit-flow">
          {links.map(renderEditChip)}
          {!readOnly && !isAdding && (
            <button type="button" className="tag-add-chip" onClick={() => setIsAdding(true)} disabled={!canBrowse && !currentUid}>
              + {t("links.add", "Add connection")}
            </button>
          )}
        </div>
      </div>
      {!readOnly && isAdding && (
        // same frame, fields and buttons as the add-source form, so the panel feels like one thing
        <div className="source-add-form timeline-link-picker" onKeyDown={(e) => { if (e.key === "Escape") setIsAdding(false); }}>
          <div className="source-field">
            <label className="source-field-label" htmlFor={`${fieldId}-timeline`}>{t("links.timelineField", "Timeline")}</label>
            <div className="timeline-link-select-wrap">
              <select
                id={`${fieldId}-timeline`}
                className="source-field-input timeline-link-select"
                value={targetTimeline}
                autoFocus
                onChange={(e) => { setTargetTimeline(e.target.value); setTargetElement(""); }}
              >
                <option value="">{t("links.pickTimeline", "Pick a timeline…")}</option>
                {currentUid && <option value={currentUid}>{t("links.thisTimeline", "This timeline")}</option>}
                {listing
                  .filter((entry) => entry.uid && entry.uid !== currentUid && !entry.isPackage)
                  .sort((a, b) => String(a.name).localeCompare(String(b.name)))
                  .map((entry) => (
                    <option key={entry.uid} value={entry.uid}>{entry.folder ? `${entry.folder}/` : ""}{entry.name}</option>
                  ))}
              </select>
            </div>
          </div>
          <div className="source-field">
            <label className="source-field-label" htmlFor={`${fieldId}-element`}>{t("links.elementField", "Element")}</label>
            <div className="timeline-link-select-wrap">
              <select
                id={`${fieldId}-element`}
                className="source-field-input timeline-link-select"
                value={targetElement}
                disabled={!targetTimeline || isLoadingTarget}
                onChange={(e) => setTargetElement(e.target.value)}
              >
                <option value="">
                  {isLoadingTarget
                    ? t("links.loading", "Loading…")
                    : targetTimeline === currentUid ? t("links.pickElement", "Pick an element…") : t("links.wholeTimeline", "Whole timeline")}
                </option>
                {targetElements.map((el) => (
                  <option key={el.id} value={el.id}>{typeLabels[el.type] ?? el.type} · {el.title || el.id}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="source-add-actions">
            <button type="button" className="btn-secondary" onClick={() => setIsAdding(false)}>{t("common:actions.cancel", "Cancel")}</button>
            <button
              type="button"
              className="btn-primary"
              disabled={!targetTimeline || (targetTimeline === currentUid && !targetElement)}
              onClick={addLink}
            >
              {t("links.add", "Add connection")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
