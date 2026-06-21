"""
샘플 데이터 삽입 스크립트
- 과거 출고 실적 (DemandActual) : 24개월 × 10 SKU
- 기초 재고  (InventoryLot)     : 10 SKU × 1~2로트

사용: python3 seed_sample.py
"""
import os, sys, random, math
from datetime import date, datetime, timezone, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://pm_user:pm_pass@localhost:5432/purchasemaster")
engine = create_engine(DATABASE_URL)

from app.models.inventory import DemandActual, InventoryLot
from app.models.product import Product
from app.models.master import WarehouseZone

# ── 티어별 기준 수요 (박스/월) ────────────────────────────────────────────────
TIER_BASE = {
    "cold":    {"base": 20,  "cv": 0.20},  # 냉장: 소량, 변동 큼
    "ambient": {"base": 50,  "cv": 0.15},
    "room":    {"base": 80,  "cv": 0.12},
}

def gen_demand(base: int, cv: float, months: int) -> list[int]:
    """베이스 수요 + 계절성(여름/연말 피크) + 랜덤 변동"""
    random.seed(42)
    result = []
    for i in range(months):
        month_no = ((date.today().month - months + i) % 12) + 1
        seasonal = 1.0
        if month_no in (6, 7, 8):    seasonal = 1.30   # 여름 피크
        elif month_no in (11, 12):   seasonal = 1.20   # 연말
        elif month_no in (1, 2):     seasonal = 0.80   # 연초 저점
        noise = 1.0 + random.gauss(0, cv)
        qty = max(5, round(base * seasonal * noise))
        # 10박스 단위 반올림 (CTN 단위)
        qty = max(10, round(qty / 10) * 10)
        result.append(qty)
    return result

def add_months(d: date, n: int) -> str:
    month = d.month + n
    year  = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    return f"{year:04d}-{month:02d}"


def run(db: Session):
    products = db.query(Product).filter(Product.is_active == True).all()
    zones    = {z.code: z for z in db.query(WarehouseZone).all()}

    # ── 과거 출고 실적 ────────────────────────────────────────────────────────
    print("▶ DemandActual 삽입 (24개월 × 10 SKU) …")

    today    = date.today()
    start_ym = add_months(today, -24)   # 24개월 전 YYYY-MM

    for prod in products:
        tier_code = prod.tier.code if prod.tier else "room"
        cfg  = TIER_BASE.get(tier_code, TIER_BASE["room"])
        # 상품별 개성 반영 (product_id 기반 편차)
        personal = 0.7 + (prod.product_id % 7) * 0.1
        base_adj = int(cfg["base"] * personal)

        demands = gen_demand(base_adj, cfg["cv"], 24)

        for i, qty in enumerate(demands):
            ym = add_months(date.fromisoformat(start_ym + "-01"), i)
            existing = db.query(DemandActual).filter(
                DemandActual.product_id == prod.product_id,
                DemandActual.ym == ym,
            ).first()
            if existing:
                existing.qty_boxes = qty
            else:
                db.add(DemandActual(product_id=prod.product_id, ym=ym, qty_boxes=qty))

        print(f"   {prod.product_code} ({tier_code}) — 기준 {base_adj}박스/월")

    db.flush()

    # ── 기초 재고 ─────────────────────────────────────────────────────────────
    print("\n▶ InventoryLot 삽입 (기초재고) …")

    cold_zone = zones.get("COLD")
    amb_zone  = zones.get("AMBIENT")

    now = datetime.now(timezone.utc)

    for prod in products:
        tier_code = prod.tier.code if prod.tier else "room"
        cfg  = TIER_BASE.get(tier_code, TIER_BASE["room"])
        personal = 0.7 + (prod.product_id % 7) * 0.1
        base_adj = int(cfg["base"] * personal)

        # 재고 = 1.5개월치 (로트 1~2개로 분리)
        total_stock = round(base_adj * 1.5 / 10) * 10

        zone = cold_zone if tier_code == "cold" else amb_zone
        if zone is None:
            print(f"   {prod.product_code} — 구역 없음, 건너뜀")
            continue

        # 유통기한: cold 3개월, ambient 6개월, room 12개월
        shelf = {"cold": 3, "ambient": 6, "room": 12}.get(tier_code, 6)
        exp   = date(today.year, today.month, 1)
        for _ in range(shelf):
            m = exp.month + 1
            exp = date(exp.year + (m - 1) // 12, (m - 1) % 12 + 1, 1)
        # 말일로 조정
        next_m = date(exp.year + (exp.month) // 12, exp.month % 12 + 1, 1)
        exp    = next_m - timedelta(days=1)

        mfg = date(today.year, today.month, 1) - timedelta(days=30)

        lot_no = f"INIT-{prod.product_code}-{today.strftime('%Y%m')}-A"

        if db.query(InventoryLot).filter(InventoryLot.lot_no == lot_no).first():
            print(f"   {prod.product_code} — 이미 존재, 건너뜀")
            continue

        db.add(InventoryLot(
            product_id  = prod.product_id,
            zone_id     = zone.zone_id,
            lot_no      = lot_no,
            qty_boxes   = total_stock,
            mfg_date    = mfg,
            exp_date    = exp,
            received_at = now,
            status      = "AVAILABLE",
        ))
        print(f"   {prod.product_code} ({tier_code}) — {total_stock}박스, 유통기한 {exp}")

    db.commit()
    print("\n✅ 완료")


if __name__ == "__main__":
    with Session(engine) as db:
        run(db)
