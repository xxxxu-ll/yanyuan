#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 map-source/campus-source.json 生成《像素燕园》游戏使用的紧凑地图数据。

输入是本地已有的燕园地理数据集（OSM 衍生几何 + 影像配准校正），
坐标系为原点 116.304E/39.992N 的本地米制平面：x 向东，y 向南。

输出:
  data/map.json          游戏运行时数据（整数分米坐标）
  data/map.stats.json    构建诊断，用于核对覆盖面与已知误差
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import Counter

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SRC = os.path.join(os.path.dirname(ROOT), "map-source", "campus-source.json")
OUT_DIR = os.path.join(ROOT, "data")


def dm(v: float) -> int:
    """米 -> 分米整数，控制文件体积。"""
    return int(round(v * 10))


def r1(v: float) -> float:
    return round(v, 1)


def ring_area(ring):
    a = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def centroid(ring):
    a = 0.0
    cx = cy = 0.0
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % len(ring)]
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-9:
        xs = [p[0] for p in ring]
        ys = [p[1] for p in ring]
        return [sum(xs) / len(xs), sum(ys) / len(ys)]
    a *= 0.5
    return [cx / (6 * a), cy / (6 * a)]


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i]
        x2, y2 = ring[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            t = (y - y1) / (y2 - y1)
            if x < x1 + t * (x2 - x1):
                inside = not inside
    return inside


def geom_rings(geom):
    """返回多边形列表，每个多边形是 [outer, hole, ...]，均为米制点列。"""
    gtype = geom.get("type")
    coords = geom.get("coordinates") or []
    if gtype == "Polygon":
        return [[[list(p) for p in coords[0]]] + [[list(p) for p in h] for h in coords[1:]]]
    if gtype == "MultiPolygon":
        out = []
        for poly in coords:
            out.append([[list(p) for p in poly[0]]] + [[list(p) for p in h] for h in poly[1:]])
        return out
    return []


def line_of(geom):
    coords = geom.get("coordinates") or []
    if geom.get("type") == "LineString":
        return [[list(p) for p in coords]]
    if geom.get("type") == "MultiLineString":
        return [[list(p) for p in seg] for seg in coords]
    if geom.get("type") == "Polygon":
        return [[list(p) for p in coords[0]]]
    return []


def simplify(points, tol=0.45):
    """Douglas-Peucker，保留像素级可见形状，去掉冗余点。"""
    if len(points) <= 2:
        return points
    pts = [(float(p[0]), float(p[1])) for p in points]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, ay = pts[i]
        bx, by = pts[j]
        dx, dy = bx - ax, by - ay
        den = math.hypot(dx, dy)
        best, bi = -1.0, -1
        for k in range(i + 1, j):
            px, py = pts[k]
            if den < 1e-9:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dx * (py - ay) - dy * (px - ax)) / den
            if d > best:
                best, bi = d, k
        if best > tol:
            keep[bi] = True
            stack.append((i, bi))
            stack.append((bi, j))
    return [list(pts[i]) for i in range(len(pts)) if keep[i]]


def main():
    if not os.path.exists(SRC):
        sys.exit("missing source: " + SRC)
    src = json.load(open(SRC, encoding="utf-8"))
    feats = src["features"]

    stats = {
        "sourceVersion": src.get("version"),
        "sourceHash": src.get("sourceHash"),
        "frame": src.get("frame"),
        "counts": Counter(f["properties"]["kind"] for f in feats),
    }

    # ---------- 边界 ----------
    boundary = None
    for f in feats:
        if f["properties"]["kind"] == "boundary":
            polys = geom_rings(f["geometry"])
            if polys:
                outer = max((p[0] for p in polys), key=ring_area)
                boundary = simplify(outer, 0.8)
            break
    if boundary is None:
        sys.exit("boundary polygon missing")

    # ---------- 水域 ----------
    water = []
    for f in feats:
        if f["properties"]["kind"] != "water":
            continue
        p = f["properties"]
        polys = []
        for poly in geom_rings(f["geometry"]):
            outer = simplify(poly[0], 0.35)
            if ring_area(outer) < 12:      # 小于 12 平方米的水池不渲染为水面
                continue
            polys.append([[dm(x), dm(y)] for x, y in outer])
        if not polys:
            continue
        c = centroid(max(polys, key=ring_area))   # 已在分米单位
        water.append({
            "id": p.get("id"),
            "name": p.get("name") or "",
            "polys": polys,
            "label": [int(round(c[0])), int(round(c[1]))],
            "area": round(sum(ring_area(poly) for poly in polys) / 100.0, 1),
        })

    # ---------- 绿地 ----------
    landcover = []
    for lc in src.get("landcover") or []:
        ring = simplify(lc.get("ring") or [], 0.6)
        if len(ring) < 3 or ring_area(ring) < 40:
            continue
        landcover.append({
            "id": lc.get("id"),
            "name": lc.get("name") or "",
            "wooded": bool(lc.get("wooded")),
            "ring": [[dm(x), dm(y)] for x, y in ring],
        })

    # ---------- 建筑 ----------
    buildings = []
    unnamed = 0
    for f in feats:
        if f["properties"]["kind"] != "building":
            continue
        p = f["properties"]
        polys = []
        for poly in geom_rings(f["geometry"]):
            outer = simplify(poly[0], 0.4)
            if len(outer) < 3 or ring_area(outer) < 8:
                continue
            rings = [[[dm(x), dm(y)] for x, y in outer]]
            for hole in poly[1:]:
                h = simplify(hole, 0.5)
                if len(h) >= 3 and ring_area(h) >= 12:
                    rings.append([[dm(x), dm(y)] for x, y in h])
            polys.append(rings)
        if not polys:
            continue
        h = p.get("height") or 0
        floors = p.get("floors") or max(1, round(h / 3.4))
        name = (p.get("name") or "").strip()
        if not name:
            unnamed += 1
        biggest = polys_max([poly[:1] for poly in polys])   # 最大的外环，分米单位
        c = centroid(biggest)
        buildings.append({
            "id": p.get("pickId"),
            "osm": p.get("id"),
            "name": name,
            "cat": p.get("category") or "",
            "h": r1(min(h, 90)),
            "fl": int(floors) if floors else 1,
            "roof": p.get("roofTreatment") or "flat",
            "style": (p.get("architecture") or {}).get("strategy") or "",
            "label": [int(round(c[0])), int(round(c[1]))],
            "polys": polys,
            "alias": [a for a in (p.get("aliases") or []) if a and a != name][:14],
            "heritage": bool(p.get("heritage")),
        })

    # ---------- 道路 ----------
    roads = []
    bridge_boxes = []
    for f in feats:
        if f["properties"]["kind"] != "road":
            continue
        p = f["properties"]
        hw = (p.get("tags") or {}).get("highway") or "footway"
        w = p.get("width") or 2
        for seg in line_of(f["geometry"]):
            pts = simplify(seg, 0.5)
            if len(pts) < 2:
                continue
            roads.append({
                "id": p.get("pickId"),
                "name": p.get("name") or "",
                "w": r1(max(1.2, min(w, 8))),
                "kind": hw,
                "pts": [[dm(x), dm(y)] for x, y in pts],
            })

    # 桥：道路穿过水面的段落视为可通行栈桥
    for road in roads:
        pts = [(x / 10.0, y / 10.0) for x, y in road["pts"]]
        for wi, wf in enumerate(water):
            wpoly = [[(x / 10.0, y / 10.0) for x, y in poly] for poly in wf["polys"]]
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]
                if any(point_in_ring(((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), ring) for ring in wpoly):
                    bridge_boxes.append({
                        "w": wi,
                        "a": [dm(a[0]), dm(a[1])],
                        "b": [dm(b[0]), dm(b[1])],
                        "width": dm(road["w"] + 2.4),
                    })

    # ---------- 体育场地 ----------
    sports = []
    for f in feats:
        if f["properties"]["kind"] != "sport":
            continue
        p = f["properties"]
        tags = p.get("tags") or {}
        for poly in geom_rings(f["geometry"]):
            outer = simplify(poly[0], 0.5)
            if len(outer) < 3:
                continue
            sports.append({
                "name": p.get("name") or "",
                "sport": tags.get("sport") or "",
                "leisure": tags.get("leisure") or "",
                "ring": [[dm(x), dm(y)] for x, y in outer],
            })

    # ---------- 校门 / 文物 / 片区 ----------
    gates = []
    for f in feats:
        if f["properties"]["kind"] != "gate":
            continue
        p = f["properties"]
        c = p.get("centre")
        if c:
            gates.append({"name": p.get("name") or "", "pt": [dm(c[0]), dm(c[1])]})

    heritage = []
    for f in feats:
        if f["properties"]["kind"] != "heritage":
            continue
        p = f["properties"]
        c = p.get("centre")
        if not c:
            continue
        heritage.append({
            "name": p.get("name") or "",
            "pt": [dm(c[0]), dm(c[1])],
            "kind": p.get("category") or "",
        })

    precincts = []
    for f in feats:
        if f["properties"]["kind"] != "precinct":
            continue
        p = f["properties"]
        for poly in geom_rings(f["geometry"]):
            outer = simplify(poly[0], 0.7)
            if len(outer) < 3 or ring_area(outer) < 200:
                continue
            precincts.append({
                "name": p.get("name") or "",
                "ring": [[dm(x), dm(y)] for x, y in outer],
            })

    piers = []
    for f in feats:
        if f["properties"]["kind"] not in ("pier", "landscape"):
            continue
        p = f["properties"]
        rings = geom_rings(f["geometry"])
        if rings:
            outer = simplify(rings[0][0], 0.6)
            piers.append({"name": p.get("name") or "", "ring": [[dm(x), dm(y)] for x, y in outer],
                          "kind": p.get("kind")})

    # ---------- 地标检索表（统一以分米存储，各来源只转换一次） ----------
    landmarks = []
    seen = set()
    for b in buildings:
        if not b["name"]:
            continue
        if b["name"] in seen:
            continue
        seen.add(b["name"])
        landmarks.append({"n": b["name"], "t": b["cat"] or "建筑", "p": b["label"], "k": "building"})
    for g in gates:
        landmarks.append({"n": g["name"], "t": "校门",
                          "p": [dm(g["pt"][0] / 10.0), dm(g["pt"][1] / 10.0)], "k": "gate"})
    for w in water:
        if w["name"]:
            landmarks.append({"n": w["name"], "t": "水域", "p": w["label"], "k": "water"})
    for s in sports:
        if s["name"]:
            c = centroid([[p[0] / 10.0, p[1] / 10.0] for p in s["ring"]])
            landmarks.append({"n": s["name"], "t": "体育场地", "p": [dm(c[0]), dm(c[1])], "k": "sport"})
    for h in heritage:
        landmarks.append({"n": h["name"], "t": "校园景观",
                          "p": [dm(h["pt"][0] / 10.0), dm(h["pt"][1] / 10.0)], "k": "heritage"})
    for pr in precincts:
        if pr["name"]:
            c = centroid([[p[0] / 10.0, p[1] / 10.0] for p in pr["ring"]])
            landmarks.append({"n": pr["name"], "t": "片区", "p": [dm(c[0]), dm(c[1])], "k": "precinct"})

    # 别名并入检索
    alias_index = []
    for b in buildings:
        for a in b["alias"]:
            if a in seen:
                continue
            seen.add(a)
            alias_index.append({"n": a, "t": b["cat"] or "建筑", "p": b["label"],
                                "k": "building", "aliasOf": b["name"] or "未命名建筑"})
    # ---------- 出生点候选（校验不在建筑/水里） ----------
    def blocked(pt):
        for b in buildings:
            for poly in b["polys"]:
                if point_in_ring((pt[0] / 10.0, pt[1] / 10.0), [(x / 10.0, y / 10.0) for x, y in poly[0]]):
                    return True
        for w in water:
            for poly in w["polys"]:
                if point_in_ring((pt[0] / 10.0, pt[1] / 10.0), [(x / 10.0, y / 10.0) for x, y in poly]):
                    return True
        return False

    def free_spot(pt, radius=60.0):
        """从候选点向外螺旋搜索最近的未阻挡位置（分米）。"""
        cx, cy = pt
        if not blocked((cx, cy)):
            return [int(cx), int(cy)], 0.0
        for r in range(10, int(radius * 10), 10):
            for k in range(24):
                ang = k * math.pi * 2 / 24
                q = (cx + r * math.cos(ang), cy + r * math.sin(ang))
                if not blocked(q):
                    return [int(round(q[0])), int(round(q[1]))], r / 10.0
        return [dm(cx), dm(cy)], None

    spawn_anchors = {
        "westGate": (-461.0, -140.0),
        "jingyuanLawn": (60.0, 120.0),
        "weimingLake": (-120.0, -120.0),
        "boyaTower": (-40.0, -40.0),
        "library": (110.0, 215.0),
        "southGate": (124.0, 730.0),
        "hundredPodium": (150.0, 300.0),
    }
    spawns = {}
    for key, pt in spawn_anchors.items():
        spot, moved = free_spot((dm(pt[0]), dm(pt[1])))
        spawns[key] = {"pt": spot, "moved": moved}

    # ---------- 地标的"可达点"：从地标中心向外找最近的可站立位置 ----------
    # 很多地标（尤其大建筑）的中心点在建筑内部，直接当导航终点会永远走不到。
    def clear_pt(x, y, pad=14):
        """点本身可走，并且四周留出约 1.4 米余量（角色有半径，贴着墙不算可达）"""
        if blocked((x, y)):
            return False
        for dx, dy in ((pad, 0), (-pad, 0), (0, pad), (0, -pad),
                       (pad, pad), (-pad, -pad), (pad, -pad), (-pad, pad)):
            if blocked((x + dx, y + dy)):
                return False
        return True

    def reachable_pt(pt_dm, radius=90.0):
        cx, cy = pt_dm
        if clear_pt(cx, cy):
            return [int(cx), int(cy)], 0.0
        r = 4
        while r <= radius * 10:
            for k in range(24):
                ang = k * math.pi * 2 / 24
                q = (cx + r * math.cos(ang), cy + r * math.sin(ang))
                if clear_pt(q[0], q[1]):
                    return [int(round(q[0])), int(round(q[1]))], r / 10.0
            r += 10
        return [int(cx), int(cy)], None

    for lm in landmarks:
        spot, moved = reachable_pt(lm["p"])
        lm["a"] = spot
        if moved:
            lm["moved"] = round(moved, 1)
    # 别名（建筑别名）沿用同一栋楼的可达点
    _by_pt = {}
    for lm in landmarks:
        _by_pt[(lm["p"][0], lm["p"][1])] = lm["a"]
    for a in alias_index:
        a["a"] = _by_pt.get((a["p"][0], a["p"][1]), a["p"])
    # ---------- 可行走世界范围：覆盖全部要素 + 边距 ----------
    allp = []
    for b in buildings:
        for poly in b["polys"]:
            allp += poly[0]
    for r in roads:
        allp += r["pts"]
    for w in water:
        for poly in w["polys"]:
            allp += poly
    for lc in landcover:
        allp += lc["ring"]
    for s in sports:
        allp += s["ring"]
    xs = [p[0] for p in allp]
    ys = [p[1] for p in allp]
    margin = 320      # 32 米绿化缓冲
    world = [min(xs) - margin, min(ys) - margin, max(xs) + margin, max(ys) + margin]

    out = {
        "meta": {
            "name": "燕园",
            "version": str(src.get("version")),
            "sourceHash": src.get("sourceHash"),
            "origin": src["frame"]["origin"],
            "units": "decimetres",
            "note": "坐标为原点 116.304E/39.992N 的本地米制平面，x 向东、y 向南；本文件以分米存储。",
            "generatedBy": "tools/build_map.py",
        },
        "bounds": bounds_of(boundary),
        "world": world,
        "boundary": [[dm(x), dm(y)] for x, y in boundary],
        "water": water,
        "landcover": landcover,
        "buildings": buildings,
        "roads": roads,
        "bridges": bridge_boxes,
        "sports": sports,
        "gates": gates,
        "heritage": heritage,
        "precincts": precincts,
        "piers": piers,
        "landmarks": landmarks,
        "aliases": alias_index,
        "spawns": spawns,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    path = os.path.join(OUT_DIR, "map.json")
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))

    stats.update({
        "buildings": len(buildings),
        "buildingsUnnamed": unnamed,
        "roads": len(roads),
        "water": len(water),
        "landcover": len(landcover),
        "sports": len(sports),
        "gates": len(gates),
        "heritage": len(heritage),
        "landmarks": len(landmarks),
        "aliases": len(alias_index),
        "bridges": len(bridge_boxes),
        "bytes": os.path.getsize(path),
        "bounds": out["bounds"],
        "spawns": spawns,
        "waterNames": [w["name"] for w in water],
    })
    with open(os.path.join(OUT_DIR, "map.stats.json"), "w", encoding="utf-8") as fh:
        json.dump(stats, fh, ensure_ascii=False, indent=2)
    print(json.dumps({k: stats[k] for k in ("buildings", "roads", "water", "landcover", "sports",
                                            "gates", "heritage", "landmarks", "bytes", "bounds")},
                     ensure_ascii=False))


def polys_max(polys):
    """取面积最大的外环（polys 为分米或米制均可，返回同单位点列）。"""
    best = None
    best_area = -1.0
    for poly in polys:
        ring = poly[0]
        a = ring_area(ring)
        if a > best_area:
            best_area, best = a, ring
    return best


def bounds_of(ring):
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return [round(min(xs), 1), round(min(ys), 1), round(max(xs), 1), round(max(ys), 1)]


if __name__ == "__main__":
    main()
