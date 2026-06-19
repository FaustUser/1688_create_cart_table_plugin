function makeFrozenHeaderSheetViewsXML() {
  return `<sheetViews>
  <sheetView workbookViewId="0">
    <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
  </sheetView>
</sheetViews>
`;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { makeFrozenHeaderSheetViewsXML };
}
