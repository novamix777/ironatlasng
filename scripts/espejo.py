#!/usr/bin/env python3
import json, os, random, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

BASE = os.environ["ORIGEN_DATOS"].rstrip("/")
DEST = os.environ.get("DESTINO", "mapa/wifi-data")
MIN  = int(os.environ.get("MIN_COUNT", "120"))
TOPE = int(os.environ.get("MAX_CELDAS_DENSIDAD", "4000"))
GRID = 0.25
UA   = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36"}

os.makedirs(os.path.join(DEST, "tiles"), exist_ok=True)

def bajar(url, intentos=4):
    for n in range(intentos):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                d = r.read()
            if d[:1] not in (b"[", b"{"):
                return None
            return json.loads(d)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
        except Exception:
            pass
        time.sleep(0.6 * (2 ** n) + random.random() * 0.4)
    return None

dens = bajar(BASE + "/density.json")
if not dens:
    sys.exit("sin density.json")

dens.sort(key=lambda c: c.get("count", 0), reverse=True)
dens = dens[:TOPE]
print(f"{len(dens):,} celdas")

with open(os.path.join(DEST, "density.json"), "w") as f:
    json.dump([{"lat": c["lat"], "lon": c["lon"], "count": c["count"]} for c in dens],
              f, separators=(",", ":"))

def trabajo(c):
    if c.get("count", 0) < MIN:
        return False
    la = int(c["lat"] // GRID) * GRID
    lo = int(c["lon"] // GRID) * GRID
    nombre = f"{la:.2f}_{lo:.2f}"
    datos = bajar(BASE + f"/tiles/{nombre}.json")
    if not datos:
        return False
    compacto = [[r.get("essid", ""), r.get("key", ""), r.get("comment", ""),
                 round(float(r["lat"]), 5), round(float(r["lon"]), 5)]
                for r in datos if r.get("lat") and r.get("lon")]
    with open(os.path.join(DEST, "tiles", nombre + ".json"), "w") as f:
        json.dump(compacto, f, ensure_ascii=False, separators=(",", ":"))
    return True

ok = 0
with ThreadPoolExecutor(max_workers=8) as ex:
    for res in ex.map(trabajo, dens):
        ok += bool(res)
print(f"{ok:,} tiles")
