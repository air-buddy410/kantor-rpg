"""Navigation grid shared contract (Python side).

The runtime (app/src/world/navgrid.ts) implements the same raster rules; a
consistency test compares walkable-cell counts per floor so the validator and
the game cannot disagree about what is reachable.

Rules: cell 0.1 m, a cell is blocked when its centre is inside a wall
rectangle (unless inside a door opening that is open for the access mode) or
inside a collider fixture; blocked cells are then inflated by the agent
radius (0.25 m, centre distance). Reachability uses 4-neighbour BFS.
"""
from __future__ import annotations

import math
from collections import deque

from .geometry import derive_walls, opening_rect, point_in_fixture, wall_rect

CELL = 0.1
RADIUS = 0.25


class NavGrid:
    def __init__(self, world, floor_id, fixtures=None, mode="staff", cell=CELL, radius=RADIUS):
        self.floor_id = floor_id
        self.cell = cell
        floor = next(f for f in world["floors"] if f["id"] == floor_id)
        xs = [p[0] for p in floor["envelope"]]
        ys = [p[1] for p in floor["envelope"]]
        self.x0, self.y0 = min(xs), min(ys)
        self.w = round((max(xs) - self.x0) / cell)
        self.h = round((max(ys) - self.y0) / cell)
        raw = bytearray(self.w * self.h)
        walls, openings = derive_walls(world, floor_id)
        for wall in walls:
            self._fill_rect(raw, wall_rect(wall), 1)
        for op in openings:
            # Walls are already cut at every door; a locked door is re-filled.
            locked = mode == "visitor" and op["access"] == "restricted"
            self._fill_rect(raw, opening_rect(op, world), 1 if locked else 0)
        fixtures = world["fixtures"] if fixtures is None else fixtures
        for fx in fixtures:
            if fx["floor"] != floor_id or not fx.get("collider"):
                continue
            self._fill_fixture(raw, fx)
        self.raw = raw
        self.blocked = self._inflate(raw, radius)

    def center(self, i, j):
        return self.x0 + (i + 0.5) * self.cell, self.y0 + (j + 0.5) * self.cell

    def _range(self, lo, hi, n, origin):
        a = max(0, math.floor((lo - origin) / self.cell - 0.5))
        b = min(n - 1, math.ceil((hi - origin) / self.cell - 0.5))
        return a, b

    def _fill_rect(self, grid, rect, value):
        x0, y0, x1, y1 = rect
        ia, ib = self._range(x0, x1, self.w, self.x0)
        ja, jb = self._range(y0, y1, self.h, self.y0)
        for j in range(ja, jb + 1):
            cy = self.y0 + (j + 0.5) * self.cell
            if cy < y0 or cy > y1:
                continue
            row = j * self.w
            for i in range(ia, ib + 1):
                cx = self.x0 + (i + 0.5) * self.cell
                if x0 <= cx <= x1:
                    grid[row + i] = value

    def _fill_fixture(self, grid, fx):
        w, d = fx["size"][:2]
        rad = math.hypot(w, d) / 2
        cx0, cy0 = fx["pos"]
        ia, ib = self._range(cx0 - rad, cx0 + rad, self.w, self.x0)
        ja, jb = self._range(cy0 - rad, cy0 + rad, self.h, self.y0)
        for j in range(ja, jb + 1):
            for i in range(ia, ib + 1):
                if point_in_fixture(self.center(i, j), fx):
                    grid[j * self.w + i] = 1

    def _inflate(self, raw, radius):
        r = radius / self.cell
        k = math.ceil(r)
        offsets = [(di, dj) for dj in range(-k, k + 1) for di in range(-k, k + 1)
                   if math.hypot(di, dj) <= r + 1e-9]
        out = bytearray(self.w * self.h)
        for j in range(self.h):
            for i in range(self.w):
                if raw[j * self.w + i]:
                    for di, dj in offsets:
                        ii, jj = i + di, j + dj
                        if 0 <= ii < self.w and 0 <= jj < self.h:
                            out[jj * self.w + ii] = 1
        # Cells within radius of the grid edge are blocked too.
        for j in range(self.h):
            for i in range(self.w):
                if i < k or j < k or i >= self.w - k or j >= self.h - k:
                    for di, dj in offsets:
                        ii, jj = i + di, j + dj
                        if not (0 <= ii < self.w and 0 <= jj < self.h):
                            out[j * self.w + i] = 1
                            break
        return out

    def cell_of(self, pt):
        i = int(math.floor((pt[0] - self.x0) / self.cell))
        j = int(math.floor((pt[1] - self.y0) / self.cell))
        return max(0, min(self.w - 1, i)), max(0, min(self.h - 1, j))

    def walkable(self, i, j):
        return 0 <= i < self.w and 0 <= j < self.h and not self.blocked[j * self.w + i]

    def walkable_count(self):
        return self.w * self.h - sum(self.blocked)

    def flood(self, start_cells):
        seen = bytearray(self.w * self.h)
        q = deque()
        for i, j in start_cells:
            if self.walkable(i, j) and not seen[j * self.w + i]:
                seen[j * self.w + i] = 1
                q.append((i, j))
        while q:
            i, j = q.popleft()
            for ni, nj in ((i + 1, j), (i - 1, j), (i, j + 1), (i, j - 1)):
                if self.walkable(ni, nj) and not seen[nj * self.w + ni]:
                    seen[nj * self.w + ni] = 1
                    q.append((ni, nj))
        return seen

    def nearest_walkable(self, pt, max_dist, mask=None):
        """Nearest walkable (and optionally flood-reached) cell centre within max_dist."""
        ci, cj = self.cell_of(pt)
        k = math.ceil(max_dist / self.cell)
        best = None
        for dj in range(-k, k + 1):
            for di in range(-k, k + 1):
                i, j = ci + di, cj + dj
                if not self.walkable(i, j):
                    continue
                if mask is not None and not mask[j * self.w + i]:
                    continue
                c = self.center(i, j)
                dist = math.hypot(c[0] - pt[0], c[1] - pt[1])
                if dist <= max_dist and (best is None or dist < best[0]):
                    best = (dist, (i, j))
        return best

    def path_length(self, start_pt, goal_pt):
        """8-neighbour Dijkstra length (m) between two points, None if unreachable."""
        import heapq
        s = self.nearest_walkable(start_pt, 1.0)
        g = self.nearest_walkable(goal_pt, 1.0)
        if not s or not g:
            return None
        start, goal = s[1], g[1]
        dist = {start: 0.0}
        pq = [(0.0, start)]
        diag = math.sqrt(2) * self.cell
        while pq:
            d, (i, j) = heapq.heappop(pq)
            if (i, j) == goal:
                return d
            if d > dist.get((i, j), 1e18):
                continue
            for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
                ni, nj = i + di, j + dj
                if not self.walkable(ni, nj):
                    continue
                if di and dj and not (self.walkable(i + di, j) and self.walkable(i, j + dj)):
                    continue
                nd = d + (diag if di and dj else self.cell)
                if nd < dist.get((ni, nj), 1e18):
                    dist[(ni, nj)] = nd
                    heapq.heappush(pq, (nd, (ni, nj)))
        return None
