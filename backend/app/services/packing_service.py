"""
Module 4 — FFD 팔레트/컨테이너 배정 서비스

알고리즘:
  1. PO 라인 → 팔레트 수 계산  (ceil(boxes / 40))
  2. 온도 티어 기반 컨테이너 그룹 결정
       default_zone_code=="COLD"   → 냉장 컨테이너(cold tier specs)
       default_zone_code=="AMBIENT"→ 상온 컨테이너(room tier specs)
  3. 최적 컨테이너 조합 — 비용 최소화
       40ft(20팔레트) vs 20ft(10팔레트) 선택
  4. FFD (First Fit Decreasing) — 팔레트 수 내림차순 정렬 후 순서대로 배정
  5. confirm 시 Shipment + Container + ContainerLoad DB 저장
"""
import math
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session, joinedload

from app.models.master import ContainerSpec, TemperatureTier
from app.models.order import PoLine, PurchaseOrder
from app.models.product import Product
from app.models.shipment import Container, ContainerLoad, Shipment

BOXES_PER_PALLET = 40
BOXES_PER_LAYER = 10


# ── 내부 데이터 클래스 ─────────────────────────────────────────────────────────

@dataclass
class LineAssignment:
    po_line_id: int
    product_id: int
    product_code: Optional[str]
    name_ja: Optional[str]
    tier_code: Optional[str]
    total_boxes: int
    pallets_in_container: int
    boxes_in_container: int
    layers_in_container: int
    pallet_start: int


@dataclass
class ContainerSlot:
    spec_id: int
    container_type: str   # 20ft / 40ft
    tier_code: str
    cost_usd: float
    max_pallets: int
    pallets_used: int = 0
    assignments: List[LineAssignment] = field(default_factory=list)

    @property
    def remaining(self) -> int:
        return self.max_pallets - self.pallets_used


@dataclass
class PackingPlan:
    po_id: int
    po_no: str
    total_boxes: int
    total_pallets: int
    total_cost_usd: float
    containers: List[ContainerSlot]


# ── 헬퍼 ───────────────────────────────────────────────────────────────────────

def _pallets(boxes: int) -> int:
    return math.ceil(boxes / BOXES_PER_PALLET) if boxes > 0 else 0


def _container_mix(
    total_pallets: int,
    spec_40: ContainerSpec,
    spec_20: ContainerSpec,
) -> List[Tuple[ContainerSpec, int]]:
    """최소 비용 컨테이너 조합 반환: [(spec, capacity), ...]"""
    if total_pallets <= 0:
        return []

    n40, rem = divmod(total_pallets, spec_40.max_pallets)
    result: List[Tuple[ContainerSpec, int]] = [(spec_40, spec_40.max_pallets)] * n40

    if rem == 0:
        return result

    if rem <= spec_20.max_pallets:
        # 20ft 1개 vs 40ft 1개 — 더 저렴한 쪽 선택
        if float(spec_20.cost_usd) <= float(spec_40.cost_usd):
            result.append((spec_20, spec_20.max_pallets))
        else:
            result.append((spec_40, spec_40.max_pallets))
    else:
        # rem > 10 → 40ft 1개 추가 (20ft 2개보다 저렴)
        result.append((spec_40, spec_40.max_pallets))

    return result


def _ffd_assign(
    slots: List[ContainerSlot],
    items: List[Tuple],  # (po_line_id, pallets, product_id, product_code, name_ja, tier_code, total_boxes)
) -> None:
    """FFD: 팔레트 수 내림차순으로 컨테이너에 배정 (in-place)"""
    sorted_items = sorted(items, key=lambda x: x[1], reverse=True)

    for (po_line_id, pallets_needed, product_id, product_code,
         name_ja, tier_code, total_boxes) in sorted_items:

        remaining_pallets = pallets_needed
        assigned_boxes = 0

        for slot in slots:
            if remaining_pallets <= 0:
                break
            if slot.remaining <= 0:
                continue

            assign_pallets = min(remaining_pallets, slot.remaining)

            # 마지막 배정 구간: 실제 박스 수 사용 (부분 팔레트 보정)
            if assign_pallets == remaining_pallets:
                assign_boxes = total_boxes - assigned_boxes
            else:
                assign_boxes = assign_pallets * BOXES_PER_PALLET

            assign_layers = math.ceil(assign_boxes / BOXES_PER_LAYER)
            pallet_start = slot.pallets_used + 1

            slot.assignments.append(LineAssignment(
                po_line_id=po_line_id,
                product_id=product_id,
                product_code=product_code,
                name_ja=name_ja,
                tier_code=tier_code,
                total_boxes=total_boxes,
                pallets_in_container=assign_pallets,
                boxes_in_container=assign_boxes,
                layers_in_container=assign_layers,
                pallet_start=pallet_start,
            ))
            slot.pallets_used += assign_pallets
            assigned_boxes += assign_boxes
            remaining_pallets -= assign_pallets


# ── 퍼블릭 API ─────────────────────────────────────────────────────────────────

def generate_packing_plan(db: Session, po_id: int) -> PackingPlan:
    """
    PO → FFD 팔레트/컨테이너 배정 계획 생성 (DB 저장 없음)

    Raises:
        ValueError: PO/라인 없음, 컨테이너 스펙 없음
    """
    po = db.query(PurchaseOrder).filter(PurchaseOrder.po_id == po_id).first()
    if not po:
        raise ValueError("발주서를 찾을 수 없습니다")

    lines = (
        db.query(PoLine)
        .options(joinedload(PoLine.product).joinedload(Product.tier))
        .filter(PoLine.po_id == po_id)
        .all()
    )
    if not lines:
        raise ValueError("발주 라인이 없습니다")

    # 컨테이너 스펙 로드: tier_id → {container_type → ContainerSpec}
    all_specs = db.query(ContainerSpec).filter(ContainerSpec.is_active == True).all()
    specs_by_tier: Dict[int, Dict[str, ContainerSpec]] = {}
    for spec in all_specs:
        specs_by_tier.setdefault(spec.tier_id, {})[spec.container_type] = spec

    # TemperatureTier 로드
    all_tiers = {t.tier_id: t for t in db.query(TemperatureTier).all()}
    cold_tier_id = next(
        (t.tier_id for t in all_tiers.values() if t.code == "cold"), None
    )
    room_tier_id = next(
        (t.tier_id for t in all_tiers.values() if t.code == "room"), None
    )

    def container_tier_id(product_tier: TemperatureTier) -> Optional[int]:
        """제품 티어 → 사용할 컨테이너 스펙 tier_id 매핑"""
        if product_tier.default_zone_code == "COLD":
            return cold_tier_id
        return room_tier_id

    # PO 라인 그룹핑: container_tier_id → [(po_line_id, pallets, ...)]
    groups: Dict[int, List[Tuple]] = {}
    for line in lines:
        tier = line.product.tier if line.product else None
        if not tier:
            continue
        ctid = container_tier_id(tier)
        if ctid is None:
            continue
        groups.setdefault(ctid, []).append((
            line.po_line_id,
            _pallets(line.order_boxes),
            line.product_id,
            line.product.product_code if line.product else None,
            line.product.name_ja if line.product else None,
            tier.code,
            line.order_boxes,
        ))

    # 그룹별 FFD 배정
    all_slots: List[ContainerSlot] = []

    for ctid, items in sorted(groups.items()):
        tier_specs = specs_by_tier.get(ctid, {})
        spec_40 = tier_specs.get("40ft")
        spec_20 = tier_specs.get("20ft")

        if not spec_40 or not spec_20:
            ctier = all_tiers.get(ctid)
            raise ValueError(
                f"컨테이너 스펙이 없습니다 (tier={ctier.code if ctier else ctid}). "
                "container_spec 테이블을 확인하세요."
            )

        ctier = all_tiers[ctid]
        total_pallets = sum(item[1] for item in items)
        mix = _container_mix(total_pallets, spec_40, spec_20)

        slots = [
            ContainerSlot(
                spec_id=spec.spec_id,
                container_type=spec.container_type,
                tier_code=ctier.code,
                cost_usd=float(spec.cost_usd),
                max_pallets=cap,
            )
            for spec, cap in mix
        ]
        _ffd_assign(slots, items)
        all_slots.extend(slots)

    total_boxes = sum(line.order_boxes for line in lines)
    total_pallets = sum(s.pallets_used for s in all_slots)
    total_cost = sum(s.cost_usd for s in all_slots)

    return PackingPlan(
        po_id=po_id,
        po_no=po.po_no,
        total_boxes=total_boxes,
        total_pallets=total_pallets,
        total_cost_usd=round(total_cost, 2),
        containers=all_slots,
    )


def confirm_packing_plan(db: Session, po_id: int) -> Shipment:
    """
    FFD 계획을 확정하고 Shipment + Container + ContainerLoad DB 저장

    Raises:
        ValueError: 중복 선적 건, 계획 오류
    """
    existing = db.query(Shipment).filter(Shipment.po_id == po_id).first()
    if existing:
        raise ValueError(
            f"이미 선적 건이 생성되어 있습니다 (shipment_id={existing.shipment_id})"
        )

    plan = generate_packing_plan(db, po_id)

    shipment = Shipment(po_id=po_id, status="DEPARTED")
    db.add(shipment)
    db.flush()

    for slot in plan.containers:
        container = Container(
            shipment_id=shipment.shipment_id,
            spec_id=slot.spec_id,
            pallets_used=slot.pallets_used,
            cost_usd=slot.cost_usd,
        )
        db.add(container)
        db.flush()

        pallet_cursor = 1
        for asgn in slot.assignments:
            db.add(ContainerLoad(
                container_id=container.container_id,
                po_line_id=asgn.po_line_id,
                pallet_no=pallet_cursor,
                layers_loaded=asgn.layers_in_container,
                boxes_loaded=asgn.boxes_in_container,
                is_mixed=False,
            ))
            pallet_cursor += asgn.pallets_in_container

    db.commit()
    db.refresh(shipment)
    return shipment


def get_confirmed_plan(db: Session, po_id: int) -> Optional[Shipment]:
    """기확정 선적 건 조회"""
    return db.query(Shipment).filter(Shipment.po_id == po_id).first()
