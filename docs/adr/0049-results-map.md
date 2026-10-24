# 0049. Results on a map

- Status: Accepted
- Date: 2026-10-24

## Context

Documents with GeoJSON points (stores, deliveries, users' addresses) are hard to judge as
coordinates. Compass shows them on a map in its schema tab, using a tile server.

## Decision

- In the results' Chart view (ADR-0048), a field whose values are mostly GeoJSON `Point`s is a
  **place**: choosing it plots each loaded document as a dot on a world map, with its name-like
  field (or `_id`) and coordinates on hover. Its `type` and `coordinates` sub-fields are not
  offered on their own.
- The map is an SVG drawn from **bundled land outlines** (Natural Earth, public domain, via
  world-atlas): the 1:110m outline (about 55 kB) always, the 1:50m one (about 450 kB, its own
  chunk) once the view is narrower than 60° of longitude. Equirectangular, wheel or buttons to
  zoom, drag to pan, double-click to zoom in. No tile server and no new dependency.
- `results/lib/map-view.ts` holds the projection, fitting, zoom and pan as plain functions.

## Alternatives considered

- **Leaflet or MapLibre with online tiles** — street-level detail, but every pan sends the area
  being looked at to a third party, needs the network, and adds a dependency.
- **Polygons and lines** — GeoJSON beyond points is rarer in practice; points cover stores,
  events and addresses.

## Consequences

- No streets or labels: the map answers "where are these", not "which street".
- Areas near the poles look stretched, as in any equirectangular map.
