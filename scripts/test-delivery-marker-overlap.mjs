import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../delivery_map_mapbox/test/index.html', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const names = ['finiteCoordinate', 'markerOverlapKey', 'markerZIndex', 'buildMarkerOverlapInfo',
  'markerOverlapItems', 'googleGuidanceOverlapItems', 'cycleMarkerOverlap', 'updateMarkerOverlapButton',
  'createMarkerOverlapButton', 'renderGoogleGuidanceOverlapBadges', 'updateMarkerZIndexes',
  'updateDeliveryMarkerElement', 'renderMarkers', 'clearPendingMarkerTapSelect',
  'addGoogleGuidanceMarker', 'clearGoogleGuidanceRouteOverlays', 'focusDelivery', 'openDeliveryMarkerDetails'];
function source(name) {
  const start = html.search(new RegExp(`^(?:async )?function ${name}\\(`, 'm'));
  assert.ok(start >= 0, name);
  const end = /\n(?:async )?function /.exec(html.slice(start + 1));
  return html.slice(start, end ? start + 1 + end.index : html.length);
}
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.children = [];
    this.listeners = new Map();
    const classes = new Set();
    this.classList = { add: c => classes.add(c), contains: c => classes.has(c),
      toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } };
  }
  set innerHTML(value) { this.html = value; this.children = []; }
  get innerHTML() { return this.html; }
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  querySelector(selector) {
    return this.children.find(child => `.${child.className}` === selector) ||
      this.children.map(child => child.querySelector(selector)).find(Boolean) || null;
  }
  setAttribute(name, value) { this[name] = value; }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
}
function fixture() {
  const deliveries = [
    { id: 'one', address: '架空町1-2-3', note: 'A 101号室', lat: 35.69, lng: 139.77, packageCount: 4, completed: true },
    { id: 'two', address: '架空町1-2-4', lat: 35.691, lng: 139.771 },
    { id: 'three', address: '架空町1-2-3', note: 'B 203号室', lat: 35.69, lng: 139.77, completed: true }
  ];
  const pane = new Element();
  class OverlayView {
    static preventMapHitsAndGesturesFrom(element) { element.preventsMapGestures = true; }
    setMap(map) { this.map = map; if (map) { this.onAdd(); this.draw(); } else this.onRemove(); }
    getPanes() { return { overlayMouseTarget: pane }; }
    getProjection() { return { fromLatLngToDivPixel: () => ({ x: 150, y: 150 }) }; }
  }
  class Marker {
    constructor(options) { this.options = options; this.zIndex = options.zIndex; }
    setZIndex(value) { this.zIndex = value; }
    setMap(value) { this.map = value; }
  }
  const context = vm.createContext({ deliveries, markers: new Map(), markerOverlapFrontIds: new Map(),
    optimizedRouteOrderedIds: ['three', 'one', 'two'],
    optimizedRouteGeometry: { type: 'LineString', coordinates: [[139.77, 35.69], [139.771, 35.691]] },
    cachedGuidanceRoute: { targetId: 'one', distance: 123 },
    lastVisibleDeliveries: [], activeDeliveryId: null, temporaryGuidanceTargetId: null,
    googleGuidanceRouteMarkers: [], googleGuidanceRouteOverlays: [], googleGuidanceOverlapBadges: [],
    googleGuidanceMap: {}, pendingMarkerTapSelect: null, suppressMarkerTapSelectUntil: 0,
    LABEL_MODES: [{ key: 'both' }], labelModeIndex: 0,
    document: { createElement: tag => new Element(tag), activeElement: null },
    currentListSearchQuery: () => '', currentListTimeWindowFilter: () => '',
    isVisibleInCurrentMode: d => !d.otherMode,
    deliveryMatchesListFilters: d => !d.filtered,
    displayNumber: (_, index) => String(index + 1),
    buildLabelText: d => `${d.address} ${d.note || ''}`,
    deliveryTimeInfo: () => ({ hasTime: false }),
    isSpotPickupDelivery: () => false, isOtherCoursePickup: () => false,
    escapeHtml: value => String(value), renderList() { context.listRenders++; }, listRenders: 0,
    showToast(message) { context.toast = message; },
    openEdit(id) { context.edited = id; }, clearTimeout() {},
    fetch() { throw Error('Pin switching must not call an API'); },
    localStorage: { setItem() { throw Error('Pin switching must not write delivery or route state'); } },
    saveDeliveries() { throw Error('Pin switching must not save deliveries'); },
    map: { flyTo() { throw Error('Pin switching must not change the viewport'); } },
    bindGoogleGuidanceMarkerInteractions() {},
    google: { maps: { OverlayView, Marker, SymbolPath: { CIRCLE: 'circle' }, event: { clearInstanceListeners() {} } } }
  });
  context.window = { google: context.google };
  vm.runInContext(names.map(source).join('\n'), context);
  context.createDeliveryMarker = () => {
    const element = new Element();
    return { getElement: () => element, setLngLat(point) { this.point = point; }, remove() { element.remove(); } };
  };
  return { context, pane };
}
const snapshot = context => JSON.stringify({ deliveries: context.deliveries,
  route: context.optimizedRouteOrderedIds, geometry: context.optimizedRouteGeometry,
  cache: context.cachedGuidanceRoute, target: context.temporaryGuidanceTargetId });
const front = context => [...context.markers.entries()].filter(([, marker]) =>
  !marker.getElement().classList.contains('overlap-back')).map(([id]) => id);

test('only valid, registered coordinates form overlap groups; room or completion differences are retained', () => {
  const { context: c } = fixture();
  for (const value of [null, undefined, '', 'bad']) assert.equal(c.markerOverlapKey({ lat: value, lng: 139 }), '');
  assert.equal(c.markerOverlapKey({ lat: 0, lng: 0 }), '0.00000,0.00000');
  const info = c.buildMarkerOverlapInfo();
  assert.equal(info.get('one').count, 2);
  assert.equal(info.get('one').frontId, 'one');
  assert.equal(info.get('three').frontId, 'one');
  assert.equal(info.has('two'), false);
  assert.equal(c.deliveries.length, 3);
});

test('Mapbox cycles 2 and 3 overlapping pins without changing records, packages, route, or viewport', () => {
  const { context: c } = fixture();
  c.renderMarkers();
  const before = snapshot(c);
  assert.deepEqual(front(c), ['one', 'two']);
  c.cycleMarkerOverlap('one');
  assert.deepEqual(front(c), ['two', 'three']);
  assert.equal(c.activeDeliveryId, 'three');
  assert.match(c.markers.get('three').getElement().querySelector('.overlap-count-label').title, /手前: 3番 \/ 次: 1番/);
  assert.equal(c.edited, undefined);
  c.renderMarkers();
  assert.deepEqual(front(c), ['two', 'three']);
  c.cycleMarkerOverlap('three');
  assert.deepEqual(front(c), ['one', 'two']);
  assert.equal(snapshot(c), before);
  c.deliveries.push({ id: 'four', address: '架空町1-2-3', lat: 35.69, lng: 139.77 });
  c.renderMarkers();
  for (const id of ['three', 'four', 'one']) {
    c.cycleMarkerOverlap('one');
    assert.equal(c.activeDeliveryId, id);
    assert.match(c.markers.get(id).getElement().querySelector('.overlap-count-label').innerHTML, /3件/);
  }
});

test('counts and cycling exclude filtered or different-mode pins and recover after removal or movement', () => {
  const { context: c } = fixture();
  c.deliveries[2].filtered = true;
  c.renderMarkers();
  assert.equal(c.markers.get('one').getElement().querySelector('.overlap-count-label'), null);
  c.cycleMarkerOverlap('one');
  assert.equal(c.activeDeliveryId, null);
  c.deliveries[2].filtered = false;
  c.deliveries[2].otherMode = true;
  c.renderMarkers();
  assert.equal(c.markers.has('three'), false);
  c.deliveries[2].otherMode = false;
  c.renderMarkers(); c.cycleMarkerOverlap('one');
  c.deliveries[2].lat += 0.001;
  c.renderMarkers();
  assert.equal(c.markers.get('one').getElement().classList.contains('overlap-back'), false);
  assert.equal(c.markers.get('one').getElement().querySelector('.overlap-count-label'), null);
  c.deliveries.splice(2, 1);
  c.renderMarkers();
  assert.equal(c.markers.has('three'), false);
});

test('explicit selection overrides temporary guidance only visually; list focus and normal edit still work', () => {
  const { context: c } = fixture();
  c.temporaryGuidanceTargetId = 'one';
  c.renderMarkers();
  c.cycleMarkerOverlap('one');
  assert.equal(c.activeDeliveryId, 'three');
  assert.equal(c.temporaryGuidanceTargetId, 'one');
  c.focusDelivery('one', false);
  assert.ok(front(c).includes('one'));
  c.openDeliveryMarkerDetails('three');
  assert.equal(c.edited, 'three');
  assert.ok(front(c).includes('three'));
  c.focusDelivery('two', false);
  assert.equal(c.markerOverlapFrontIds.has(c.markerOverlapKey(c.deliveries[1])), false);
});

test('badge pointer events do not trigger pin editing, long-press placement, or map gestures', () => {
  const { context: c } = fixture();
  c.renderMarkers();
  const button = c.markers.get('one').getElement().querySelector('.overlap-count-label');
  let stopped = 0, prevented = 0;
  const event = { stopPropagation() { stopped++; }, preventDefault() { prevented++; } };
  c.pendingMarkerTapSelect = { timer: 1 };
  button.listeners.get('pointerdown')(event);
  assert.equal(c.pendingMarkerTapSelect, null);
  button.listeners.get('dblclick')(event);
  button.listeners.get('click')(event);
  assert.equal(c.activeDeliveryId, 'three');
  assert.equal(stopped, 3); assert.equal(prevented, 1);
  assert.equal(button.type, 'button');
  assert.match(button['aria-label'], /ピンを切り替える/);
  assert.equal(c.edited, undefined);
});

test('Google badges cycle actual rendered delivery markers and clean up independently from route line visibility', () => {
  const { context: c, pane } = fixture();
  c.renderMarkers();
  c.deliveries.forEach(d => c.addGoogleGuidanceMarker(d, d.id, '#aaa', d.address, 13, d.id));
  c.renderGoogleGuidanceOverlapBadges();
  assert.equal(c.googleGuidanceOverlapBadges.length, 1);
  assert.equal(pane.children.length, 1);
  assert.equal(pane.children[0].preventsMapGestures, true);
  const { button } = c.googleGuidanceOverlapBadges[0];
  const before = snapshot(c);
  button.listeners.get('click')({ preventDefault() {}, stopPropagation() {} });
  assert.equal(c.activeDeliveryId, 'three');
  const top = [...c.googleGuidanceRouteMarkers].sort((a, b) => b.zIndex - a.zIndex)[0];
  assert.equal(top.__rysDeliveryId, 'three');
  assert.match(button.title, /手前: 3番/);
  assert.equal(snapshot(c), before);
  assert.equal(c.googleGuidanceRouteOverlays.length, 0);
  c.clearGoogleGuidanceRouteOverlays();
  assert.equal(pane.children.length, 0);
  assert.equal(c.googleGuidanceOverlapBadges.length, 0);
  assert.equal(c.googleGuidanceRouteMarkers.length, 0);
  c.deliveries.forEach(d => c.addGoogleGuidanceMarker(d, d.id, '#aaa', d.address, 13, d.id));
  c.renderGoogleGuidanceOverlapBadges();
  assert.match(c.googleGuidanceOverlapBadges[0].button.title, /手前: 3番/);
  c.clearGoogleGuidanceRouteOverlays();
  c.addGoogleGuidanceMarker(c.deliveries[0], '1', '#aaa', '', 13, 'one');
  c.renderGoogleGuidanceOverlapBadges();
  assert.equal(c.googleGuidanceOverlapBadges.length, 0);
});

test('the application parses and badges are touch-sized, wired, and hidden only on background pins', () => {
  const start = html.indexOf("<script>\n'use strict';");
  new vm.Script(html.slice(start + '<script>'.length, html.lastIndexOf('</script>')));
  assert.match(html, /\.overlap-count-label \{[^}]*height: 44px;/);
  assert.match(html, /\.delivery-marker\.overlap-back \.overlap-count-label \{ visibility: hidden; \}/);
  assert.match(source('renderMarkers'), /buildMarkerOverlapInfo\(markerOverlapItems\(\)\)/);
  assert.match(html, /renderGoogleGuidanceOverlapBadges\(\);\n  updateGoogleGuidanceUserMarker/);
  const version = /const APP_VERSION = '([^']+)'/.exec(html)[1];
  assert.equal(version, 'v2026.06.24-test.128');
  assert.equal(html.split(version).length - 1, 3);
});
