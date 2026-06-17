"""
기준 데이터 시딩 스크립트
사용법: python seed_data.py

적재 순서:
  TemperatureTier → ContainerSpec → WarehouseZone
  → Entity → Exporter → Brewery → Role → AppUser
  → Product (샘플 10개) → ExporterProduct → SupplyPrice
  → FxRate → PlanningParam
"""
import os
import sys
from datetime import date

import bcrypt as _bcrypt
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import Session


def _hash_pw(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode(), _bcrypt.gensalt()).decode()

load_dotenv()

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.models import (
    Base, TemperatureTier, ContainerSpec, WarehouseZone,
    Entity, Exporter, Brewery, Role, AppUser, UserRole,
    Product, ExporterProduct, SupplyPrice, FxRate, PlanningParam,
)

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+psycopg2://pm_user:pm_pass@localhost:5432/purchasemaster")
engine = create_engine(DATABASE_URL)


def seed(db: Session) -> None:
    print("▶ TemperatureTier 시딩...")
    tiers = {
        "cold": TemperatureTier(
            code="cold", name_ko="냉",
            shelf_life_months=3, review_cycle_months=2,
            lead_time_months=1, default_zone_code="COLD",
        ),
        "ambient": TemperatureTier(
            code="ambient", name_ko="일반",
            shelf_life_months=6, review_cycle_months=4,
            lead_time_months=1, default_zone_code="COLD",
        ),
        "room": TemperatureTier(
            code="room", name_ko="상온",
            shelf_life_months=12, review_cycle_months=6,
            lead_time_months=1, default_zone_code="AMBIENT",
        ),
    }
    for t in tiers.values():
        db.add(t)
    db.flush()
    # flush 후 DB 자동발급 tier_id를 딕셔너리 객체에 반영
    for t in tiers.values():
        db.refresh(t)

    print("▶ ContainerSpec 시딩...")
    specs = [
        # 냉장 컨테이너
        ContainerSpec(container_type="40ft", tier_id=tiers["cold"].tier_id, max_pallets=20, cost_usd=800.00),
        ContainerSpec(container_type="20ft", tier_id=tiers["cold"].tier_id, max_pallets=10, cost_usd=500.00),
        # 상온 컨테이너
        ContainerSpec(container_type="40ft", tier_id=tiers["room"].tier_id, max_pallets=20, cost_usd=10.00),
        ContainerSpec(container_type="20ft", tier_id=tiers["room"].tier_id, max_pallets=10, cost_usd=5.00),
    ]
    for s in specs:
        db.add(s)
    db.flush()

    print("▶ WarehouseZone 시딩...")
    zones = [
        WarehouseZone(code="COLD", name_ko="냉장구역", tier_id=tiers["cold"].tier_id, capacity_pallets=500),
        WarehouseZone(code="AMBIENT", name_ko="상온구역", tier_id=tiers["room"].tier_id, capacity_pallets=1000),
    ]
    for z in zones:
        db.add(z)
    db.flush()

    print("▶ Entity 시딩...")
    entity_hq = Entity(name="(주)퍼체이스마스터", business_no="000-00-00000", address="서울특별시")
    db.add(entity_hq)
    db.flush()

    print("▶ Exporter 시딩...")
    exporters = {
        "CRJPN": Exporter(entity_id=entity_hq.entity_id, code="CRJPN", name="CR JPN (일본 지사)", country="JPN"),
        "NZN":   Exporter(code="NZN",   name="NZN Co., Ltd.", country="JPN"),
        "JFC":   Exporter(code="JFC",   name="JFC Japan", country="JPN"),
        "SAKURA":Exporter(code="SAKURA",name="SAKURA Trading", country="JPN"),
    }
    for e in exporters.values():
        db.add(e)
    db.flush()

    print("▶ Brewery 시딩...")
    breweries = [
        Brewery(name="Hakutsuru Sake Brewing", name_ja="白鶴酒造", country="JPN", region="Hyogo"),
        Brewery(name="Gekkeikan Sake Co.", name_ja="月桂冠", country="JPN", region="Kyoto"),
        Brewery(name="Ozeki Corporation", name_ja="大関", country="JPN", region="Hyogo"),
        Brewery(name="Takara Shuzo", name_ja="宝酒造", country="JPN", region="Kyoto"),
        Brewery(name="Nihonsakari Co.", name_ja="日本盛", country="JPN", region="Hyogo"),
    ]
    for b in breweries:
        db.add(b)
    db.flush()

    print("▶ Role 시딩...")
    roles = {
        "HQ_ADMIN": Role(
            name="HQ_ADMIN",
            description="본사 관리자 — 전체 권한",
            permissions=["price_view_brewery", "item_register", "po_approve", "plan_approve",
                         "shipment_manage", "user_manage"],
        ),
        "PURCHASING_MANAGER": Role(
            name="PURCHASING_MANAGER",
            description="구매 담당자",
            permissions=["price_view_brewery", "po_approve", "plan_approve", "shipment_manage"],
        ),
        "PURCHASING_STAFF": Role(
            name="PURCHASING_STAFF",
            description="구매 실무자",
            permissions=["item_register", "shipment_manage"],
        ),
        "VIEWER": Role(
            name="VIEWER",
            description="조회 전용",
            permissions=[],
        ),
    }
    for r in roles.values():
        db.add(r)
    db.flush()

    print("▶ AppUser 시딩...")
    admin = AppUser(
        username="admin",
        email="admin@purchasemaster.com",
        hashed_password=_hash_pw("admin1234!"),
        entity_id=entity_hq.entity_id,
    )
    db.add(admin)
    db.flush()
    db.add(UserRole(user_id=admin.user_id, role_id=roles["HQ_ADMIN"].role_id))

    print("▶ Product 시딩 (샘플 10개)...")
    sample_products = [
        Product(product_code="SKU0000", name_ja="白鶴 純米大吟醸", name_ko="하쿠츠루 준마이다이긴조",
                brewery_id=breweries[0].brewery_id, tier_id=tiers["cold"].tier_id,
                boxes_per_pallet=40, alcohol_pct=16.0, volume_ml=720),
        Product(product_code="SKU0001", name_ja="白鶴 特撰", name_ko="하쿠츠루 도쿠센",
                brewery_id=breweries[0].brewery_id, tier_id=tiers["ambient"].tier_id,
                boxes_per_pallet=40, alcohol_pct=15.5, volume_ml=1800),
        Product(product_code="SKU0002", name_ja="月桂冠 糖質ゼロ", name_ko="겟케이칸 당질제로",
                brewery_id=breweries[1].brewery_id, tier_id=tiers["room"].tier_id,
                boxes_per_pallet=40, alcohol_pct=13.5, volume_ml=900),
        Product(product_code="SKU0003", name_ja="大関 上撰", name_ko="오제키 조센",
                brewery_id=breweries[2].brewery_id, tier_id=tiers["room"].tier_id,
                boxes_per_pallet=40, alcohol_pct=15.0, volume_ml=1800),
        Product(product_code="SKU0004", name_ja="宝 松竹梅", name_ko="다카라 쇼치쿠바이",
                brewery_id=breweries[3].brewery_id, tier_id=tiers["room"].tier_id,
                boxes_per_pallet=40, alcohol_pct=14.5, volume_ml=1800),
        Product(product_code="SKU0005", name_ja="日本盛 超辛口", name_ko="니혼사카리 초가라쿠치",
                brewery_id=breweries[4].brewery_id, tier_id=tiers["ambient"].tier_id,
                boxes_per_pallet=40, alcohol_pct=15.5, volume_ml=720),
        Product(product_code="SKU0006", name_ja="白鶴 まる", name_ko="하쿠츠루 마루",
                brewery_id=breweries[0].brewery_id, tier_id=tiers["room"].tier_id,
                boxes_per_pallet=40, alcohol_pct=13.5, volume_ml=900),
        Product(product_code="SKU0007", name_ja="月桂冠 特撰", name_ko="겟케이칸 도쿠센",
                brewery_id=breweries[1].brewery_id, tier_id=tiers["cold"].tier_id,
                boxes_per_pallet=40, alcohol_pct=15.0, volume_ml=720),
        Product(product_code="SKU0008", name_ja="大関 純米", name_ko="오제키 준마이",
                brewery_id=breweries[2].brewery_id, tier_id=tiers["ambient"].tier_id,
                boxes_per_pallet=40, alcohol_pct=14.5, volume_ml=1800),
        Product(product_code="SKU0009", name_ja="宝 焼酎ハイボール", name_ko="다카라 소주하이볼",
                brewery_id=breweries[3].brewery_id, tier_id=tiers["room"].tier_id,
                boxes_per_pallet=40, alcohol_pct=8.0, volume_ml=500),
    ]
    for p in sample_products:
        db.add(p)
    db.flush()

    print("▶ ExporterProduct + SupplyPrice 시딩...")
    ep_today = date.today()
    for i, p in enumerate(sample_products):
        exporter = list(exporters.values())[i % len(exporters)]
        ep = ExporterProduct(
            exporter_id=exporter.exporter_id,
            product_id=p.product_id,
            item_code=f"{exporter.code}-{p.product_code}",
        )
        db.add(ep)
        db.flush()
        db.add(SupplyPrice(
            ep_id=ep.ep_id,
            effective_date=ep_today,
            currency="JPY",
            brewery_price=800 + i * 50,
            supply_price=1200 + i * 80,
        ))

    print("▶ FxRate 시딩...")
    db.add(FxRate(
        base_currency="JPY", quote_currency="KRW",
        rate_date=ep_today, rate=9.45, source="manual",
    ))

    print("▶ PlanningParam 시딩 (no_mix 샘플)...")
    # 냉장 SKU들은 no_mix=True (전산 검수 샘플 위 배치 필요)
    for p in sample_products:
        if p.tier_id == tiers["cold"].tier_id:
            db.add(PlanningParam(product_id=p.product_id, no_mix_flag=True))

    db.commit()
    print("✅ 시딩 완료!")


if __name__ == "__main__":
    with Session(engine) as session:
        seed(session)
