import { PLAYLET_ROOT_ID, PLAYLET_STYLE_ID } from "../core/constants.js";

export function createStyles() {
  if (document.getElementById(PLAYLET_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PLAYLET_STYLE_ID;
  style.textContent = `
#${PLAYLET_ROOT_ID} {
  position: fixed;
  inset: 14px 14px 14px auto;
  width: min(520px, calc(100vw - 28px));
  z-index: 2147483647;
  color: #101111;
  font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  pointer-events: auto;
}
#${PLAYLET_ROOT_ID} .playlet-card {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 28px);
  max-height: 940px;
  background: linear-gradient(160deg, #ffffff 0%, #f5f7fa 100%);
  border: 1px solid #d8dde8;
  border-radius: 14px;
  box-shadow: 0 22px 44px rgba(5, 14, 26, 0.2);
  overflow: hidden;
}
#${PLAYLET_ROOT_ID} .playlet-head {
  padding: 10px;
  border-bottom: 1px solid #dde4ef;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-head-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}
#${PLAYLET_ROOT_ID} .playlet-title {
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.02em;
}
#${PLAYLET_ROOT_ID} .playlet-meta {
  font-size: 11px;
  color: #4c5668;
}
#${PLAYLET_ROOT_ID} .playlet-inputs {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
#${PLAYLET_ROOT_ID} input,
#${PLAYLET_ROOT_ID} button {
  font: inherit;
}
#${PLAYLET_ROOT_ID} .playlet-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid #ced7e6;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-btn,
#${PLAYLET_ROOT_ID} .playlet-icon-btn {
  border-radius: 7px;
  border: 1px solid #2d6cdf;
  background: #2d6cdf;
  color: #fff;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-row.dragging {
  opacity: 0.45;
}
#${PLAYLET_ROOT_ID} .playlet-row.drop-target {
  outline: 2px dashed #7ca4ec;
  outline-offset: 1px;
}
#${PLAYLET_ROOT_ID} .playlet-btn {
  padding: 6px 9px;
}
#${PLAYLET_ROOT_ID} .playlet-icon-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  line-height: 1;
  font-weight: 700;
}
#${PLAYLET_ROOT_ID} .playlet-btn[data-kind="ghost"],
#${PLAYLET_ROOT_ID} .playlet-icon-btn[data-kind="ghost"] {
  color: #204a97;
  border-color: #bed0f2;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-btn[disabled],
#${PLAYLET_ROOT_ID} .playlet-icon-btn[disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}
#${PLAYLET_ROOT_ID} .playlet-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
#${PLAYLET_ROOT_ID} .playlet-section-title {
  padding: 6px 10px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.09em;
  color: #566071;
  border-top: 1px solid #edf1f6;
  background: #fafbfd;
}
#${PLAYLET_ROOT_ID} .playlet-scroll-zone {
  overflow: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
}
#${PLAYLET_ROOT_ID} .playlet-tree,
#${PLAYLET_ROOT_ID} .playlet-playlist {
  padding: 7px;
}
#${PLAYLET_ROOT_ID} .playlet-tree-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-tree {
  flex: 1;
  min-height: 0;
}
#${PLAYLET_ROOT_ID} .playlet-library-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
#${PLAYLET_ROOT_ID} .playlet-search-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
#${PLAYLET_ROOT_ID} .playlet-search-bar {
  display: flex;
  gap: 6px;
  align-items: center;
}
#${PLAYLET_ROOT_ID} .playlet-search-input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 7px;
  border: 1px solid #ced7e6;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-search-meta {
  display: flex;
  gap: 6px;
  align-items: center;
  color: #5d6a82;
  font-size: 10px;
}
#${PLAYLET_ROOT_ID} .playlet-playlist {
  height: 34%;
  min-height: 92px;
}
#${PLAYLET_ROOT_ID} .playlet-tabs {
  display: flex;
  gap: 6px;
  align-items: center;
}
#${PLAYLET_ROOT_ID} .playlet-tab {
  border: 1px solid #bed0f2;
  color: #204a97;
  background: #fff;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-tab[data-active="1"] {
  background: #2d6cdf;
  border-color: #2d6cdf;
  color: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-row {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  margin-bottom: 3px;
  border-radius: 7px;
  border: 1px solid #e7ebf2;
  background: #fff;
}
#${PLAYLET_ROOT_ID} .playlet-row[data-now="1"] {
  border-color: #73a3ff;
  background: #f6f9ff;
}
#${PLAYLET_ROOT_ID} .playlet-row-main {
  min-width: 0;
}
#${PLAYLET_ROOT_ID} .playlet-row-title {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PLAYLET_ROOT_ID} .playlet-row-sub {
  font-size: 10px;
  color: #6a7486;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PLAYLET_ROOT_ID} .playlet-folder-count {
  margin-left: 6px;
  font-size: 10px;
  color: #6a7486;
  opacity: 0;
  transition: opacity 120ms ease;
}
#${PLAYLET_ROOT_ID} .playlet-row[data-kind="container"]:hover .playlet-folder-count,
#${PLAYLET_ROOT_ID} .playlet-row[data-kind="container"]:focus-within .playlet-folder-count {
  opacity: 1;
}
#${PLAYLET_ROOT_ID} .playlet-row-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
#${PLAYLET_ROOT_ID} .playlet-row:hover .playlet-row-actions,
#${PLAYLET_ROOT_ID} .playlet-row:focus-within .playlet-row-actions,
#${PLAYLET_ROOT_ID} .playlet-row[data-now="1"] .playlet-row-actions {
  opacity: 1;
  pointer-events: auto;
}
@media (hover: none), (pointer: coarse) {
  #${PLAYLET_ROOT_ID} .playlet-row-actions {
    opacity: 1;
    pointer-events: auto;
  }
}
#${PLAYLET_ROOT_ID} .playlet-twisty {
  width: 18px;
  height: 18px;
  padding: 0;
  border-radius: 4px;
  border: 1px solid #c9d6ec;
  background: #fff;
  font-size: 11px;
  color: #2f4d80;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-twisty[disabled] {
  opacity: 0.35;
  cursor: default;
}
#${PLAYLET_ROOT_ID} .playlet-item-indent {
  display: inline-block;
  width: 10px;
  height: 1px;
}
#${PLAYLET_ROOT_ID} .playlet-track-index {
  display: inline-block;
  width: 24px;
  text-align: right;
  padding-right: 2px;
  font-variant-numeric: tabular-nums;
  color: #53617a;
}
#${PLAYLET_ROOT_ID} .playlet-foot {
  border-top: 1px solid #dde4ef;
  background: #fff;
  padding: 9px 10px 10px;
}
#${PLAYLET_ROOT_ID} .playlet-now {
  font-size: 11px;
  margin-bottom: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-controls {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
#${PLAYLET_ROOT_ID} .playlet-control-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding-right: 4px;
  margin-right: 2px;
  border-right: 1px solid #dde4ef;
}
#${PLAYLET_ROOT_ID} .playlet-control-group:last-of-type {
  border-right: 0;
  padding-right: 0;
  margin-right: 0;
}
#${PLAYLET_ROOT_ID} .playlet-now-inline {
  font-size: 11px;
  color: #334158;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  max-width: 52%;
}
#${PLAYLET_ROOT_ID} .playlet-range {
  width: 100%;
  margin-top: 7px;
}
#${PLAYLET_ROOT_ID} .playlet-vol-range {
  width: 120px;
}
#${PLAYLET_ROOT_ID} .playlet-native-audio audio {
  width: 100%;
  margin-top: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-status {
  margin-top: 6px;
  font-size: 10px;
  color: #4d586b;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${PLAYLET_ROOT_ID} .playlet-error {
  margin: 6px 10px;
  padding: 7px 8px;
  border-radius: 7px;
  border: 1px solid #f2b9b9;
  color: #7a1b1b;
  background: #fce9e9;
  font-size: 11px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
#${PLAYLET_ROOT_ID} .playlet-error-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#${PLAYLET_ROOT_ID} .playlet-error-close {
  border: 1px solid #e39e9e;
  background: #fff6f6;
  color: #7a1b1b;
  border-radius: 6px;
  width: 20px;
  height: 20px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}
#${PLAYLET_ROOT_ID} .playlet-toast {
  position: absolute;
  right: 12px;
  bottom: 12px;
  background: rgba(16, 19, 28, 0.94);
  color: #fff;
  padding: 6px 9px;
  font-size: 11px;
  border-radius: 7px;
}
#${PLAYLET_ROOT_ID} .playlet-empty {
  color: #6a7486;
  font-size: 11px;
  padding: 7px;
}
`;
  document.head.appendChild(style);
}
