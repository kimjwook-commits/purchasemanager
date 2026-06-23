"""
출고예측 알고리즘 S1-S7 (명세서 v5)
입출력 단위: qty_boxes (DB 저장 단위와 동일)

수정 이력:
- v1.1: S5 불완전 연도(cur_y) 제외 — 6-12월 계절지수 왜곡 수정
- v1.1: S4a is_one_time 2년 케이스 보호 (최신연도 최고값 = 성장세)
- v1.2: STEP 4.5 추가 (성장추세 보정 평활화)
- v1.3: 명세서 v5 반영
         · S4a 단순화 (len<2 → skip)
         · S4b 신규 추가 — 로버스트 MAD 벌크 제거 (bulk_mad_k, bulk_min_mult)
         · STEP 4.5 제거 (S4b로 대체)
"""
from typing import Dict, List, Optional
from collections import defaultdict
import statistics

DEFAULT_PARAMS: Dict = {
    'forecast_horizon': 6,
    'intermittent_active_months': 4,
    'regular_density': 0.7,
    'regular_min_months': 9,
    'spike_neighbor_mult': 2.5,
    'spike_cap': 1.3,
    'dip_ratio': 0.6,
    'rebound_ratio': 1.3,
    'conserve_tol': 0.4,
    'onetime_year_mult': 3.0,
    'onetime_min_diff': 17,    # 박스 단위 (명세서 200병 ÷ 12 ≈ 17)
    # ── S4b: 로버스트 벌크 제거 ──────────────────────────────────────────────
    'bulk_mad_k':    4.0,   # med + k·MAD 임계값 (과탐 방지 위해 보수적 기본값)
    'bulk_min_mult': 1.8,   # 추가 조건: val > med × 배수
    'brand_prefix_len': 5,
    'brand_min_volume': 5,     # 박스
    'shrink_K': 150,
    'growth_clamp_lo': -0.6,
    'growth_clamp_hi': 1.5,
    'level_recent_R': 3,
    'blend_level_cap': 0.65,
    'blend_ramp_months': 8,
    'level_min_active': 2,
    'service_floor': 0,
}


def _add_ym(ym: str, n: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    m += n
    while m > 12:
        m -= 12; y += 1
    while m < 1:
        m += 12; y -= 1
    return f"{y:04d}-{m:02d}"


def run_demand_forecast(
    demand_rows: List[Dict],
    today_ym: str,
    horizon: int = 6,
    params: Optional[Dict] = None,
) -> Dict[str, Dict[str, int]]:
    """
    demand_rows: [{'product_code': str, 'ym': 'YYYY-MM', 'qty_boxes': int}]
    today_ym:   현재 월 (미완성, 예: '2026-06') — 이보다 이전 완성월만 입력으로 사용
    반환:       {product_code: {'YYYY-MM': forecast_qty_boxes}}
    """
    P = {**DEFAULT_PARAMS, **(params or {})}
    # horizon: 함수 인자 우선, params에서 명시적으로 넘긴 경우에만 덮어쓰기
    if params and 'forecast_horizon' in params:
        horizon = int(params['forecast_horizon'])

    last_complete = _add_ym(today_ym, -1)
    cur_y = int(today_ym[:4])
    cur_m = int(today_ym[5:7])
    prev_y = cur_y - 1

    # ── STEP 1: S[pc][year][month] 구축 ──────────────────────────────────────
    S: Dict[str, Dict[int, Dict[int, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )
    all_products: set = set()

    for row in demand_rows:
        pc = row.get('product_code', '')
        ym = row.get('ym', '')
        if not pc or not ym or ym > last_complete:
            continue
        qty = max(0.0, float(row.get('qty_boxes') or 0))
        y, m = int(ym[:4]), int(ym[5:7])
        S[pc][y][m] = qty
        all_products.add(pc)

    if not all_products:
        return {}

    # 활성 기간 통계
    active_months: Dict[str, int] = {}
    elapsed: Dict[str, int] = {}

    for pc in all_products:
        nonzero = sorted(
            f"{y:04d}-{m:02d}"
            for y, yd in S[pc].items()
            for m, qty in yd.items()
            if qty > 0
        )
        if not nonzero:
            active_months[pc] = 0
            elapsed[pc] = 0
            continue
        active_months[pc] = len(nonzero)
        fy, fm_ = int(nonzero[0][:4]), int(nonzero[0][5:7])
        ly, lm_ = int(nonzero[-1][:4]), int(nonzero[-1][5:7])
        elapsed[pc] = (ly - fy) * 12 + (lm_ - fm_) + 1

    # ── STEP 2: 품목 분류 ─────────────────────────────────────────────────────
    cls: Dict[str, str] = {}
    for pc in all_products:
        am = active_months.get(pc, 0)
        el = max(elapsed.get(pc, 1), 1)
        if am <= P['intermittent_active_months']:
            cls[pc] = 'intermittent'
        elif el >= 6 and am / el >= P['regular_density'] and am >= P['regular_min_months']:
            cls[pc] = 'regular'
        else:
            cls[pc] = 'limited'

    # ── is_one_time 헬퍼: 특정 (품목, 월)이 일회성 이벤트인지 판단 (S4a용) ───
    def is_one_time(pc: str, m: int, data: Dict) -> bool:
        """v5: 완성연도 데이터 기준, 2년 미만이면 False(반복 처리)"""
        vals_by_year = sorted(
            [(y, data[pc][y].get(m, 0.0)) for y in data[pc] if data[pc][y].get(m, 0.0) > 0],
            key=lambda x: x[0]
        )
        if len(vals_by_year) < 2:
            return False
        values = [v for _, v in vals_by_year]
        hi, lo = max(values), min(values)
        return hi > lo * P['onetime_year_mult'] and hi - lo > P['onetime_min_diff']

    # STEP 3·3.5에서 사용할 is_recurring (is_one_time의 역): 원본 S 기준
    def is_recurring_s(pc: str, m: int) -> bool:
        return not is_one_time(pc, m, S)

    # ── S_clean: S의 복사본 ───────────────────────────────────────────────────
    S_clean: Dict[str, Dict[int, Dict[int, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )
    for pc in all_products:
        for y, yd in S[pc].items():
            for m, qty in yd.items():
                S_clean[pc][y][m] = qty

    # ── STEP 3: 단발 급증(스파이크) 상한 ('regular'만) ──────────────────────
    for pc in all_products:
        if cls[pc] != 'regular':
            continue
        for y in list(S[pc].keys()):
            for m in range(1, 13):
                val = S[pc][y].get(m, 0.0)
                if val <= 0 or is_recurring_s(pc, m):
                    continue
                neighbors = [
                    S[pc][y].get(nm, 0.0)
                    for nm in range(max(1, m - 2), min(13, m + 3))
                    if nm != m and S[pc][y].get(nm, 0.0) > 0
                ]
                if len(neighbors) < 2:
                    continue
                nb_median = statistics.median(neighbors)
                if nb_median > 0 and val > nb_median * P['spike_neighbor_mult']:
                    S_clean[pc][y][m] = nb_median * P['spike_cap']

    # ── STEP 3.5: 캐치업 보존 (함몰→급증 패턴 평탄화) ───────────────────────
    for pc in all_products:
        if cls[pc] not in ('regular', 'limited'):
            continue
        for y in list(S_clean[pc].keys()):
            active_y = sorted(
                m for m in range(1, 13) if S_clean[pc][y].get(m, 0.0) > 0
            )
            if len(active_y) < 3:
                continue
            i = 0
            while i < len(active_y):
                m = active_y[i]
                val = S_clean[pc][y].get(m, 0.0)
                surr = [
                    S_clean[pc][y].get(k, 0.0)
                    for k in range(max(1, m - 3), min(13, m + 4))
                    if k != m and S_clean[pc][y].get(k, 0.0) > 0
                ]
                if len(surr) < 2:
                    i += 1
                    continue
                local_base = statistics.median(surr)
                if local_base <= 0 or val >= local_base * P['dip_ratio']:
                    i += 1
                    continue

                b_idx = i
                while b_idx + 1 < len(active_y):
                    if S_clean[pc][y].get(active_y[b_idx + 1], 0.0) < local_base * P['dip_ratio']:
                        b_idx += 1
                    else:
                        break

                rebound_idx = None
                for j in range(b_idx + 1, len(active_y)):
                    if S_clean[pc][y].get(active_y[j], 0.0) > local_base * P['rebound_ratio']:
                        rebound_idx = j
                        break

                if rebound_idx is not None:
                    window = [active_y[j] for j in range(i, rebound_idx + 1)]
                    total = sum(S_clean[pc][y].get(wm, 0.0) for wm in window)
                    expected = len(window) * local_base
                    if expected > 0 and abs(total - expected) <= expected * P['conserve_tol']:
                        avg_val = total / len(window)
                        for wm in window:
                            S_clean[pc][y][wm] = avg_val
                    i = rebound_idx + 1
                else:
                    for j in range(i, b_idx + 1):
                        S_clean[pc][y][active_y[j]] = local_base
                    i = b_idx + 1

    # ── STEP 4: 연도간 일회성 이벤트 제거 ─────────────────────────────────────
    # STEP 3 이후의 S_clean 기준으로 판단 (이미 cap된 스파이크 이중처리 방지)
    # 단조증가 성장 트렌드는 보호됨 (is_one_time 내 monotonic check)
    for pc in all_products:
        for m in range(1, 13):
            if not is_one_time(pc, m, S_clean):
                continue
            vals_by_year = {
                y: S_clean[pc][y].get(m, 0.0)
                for y in S_clean[pc]
                if S_clean[pc][y].get(m, 0.0) > 0
            }
            if len(vals_by_year) < 2:
                continue
            max_y = max(vals_by_year, key=vals_by_year.get)  # type: ignore[arg-type]
            min_val = min(vals_by_year.values())
            S_clean[pc][max_y][m] = min_val

    # ── S4b: 로버스트 벌크 제거 ──────────────────────────────────────────────────
    # S4a 이후 정제된 S_clean 기준. 전체 비영 분포에서 MAD로 이상 고점 탐지.
    # 조건: val > med + k·max(MAD,1)  AND  val > med×bulk_min_mult
    #       AND 동일 달 타 연도에 반복 패턴 없음 (비반복 단일 고점만 제거)
    bulk_k    = float(P['bulk_mad_k'])
    bulk_mult = float(P['bulk_min_mult'])

    for pc in all_products:
        all_nz = [
            S_clean[pc][y].get(m, 0.0)
            for y in S_clean[pc]
            for m in range(1, 13)
            if S_clean[pc][y].get(m, 0.0) > 0
        ]
        if len(all_nz) < 6:
            continue
        med_g = statistics.median(all_nz)
        if med_g <= 0:
            continue
        mad_g = 1.4826 * statistics.median([abs(v - med_g) for v in all_nz])
        threshold = med_g + bulk_k * max(mad_g, 1.0)

        for y in list(S_clean[pc].keys()):
            for m in range(1, 13):
                val = S_clean[pc][y].get(m, 0.0)
                if val <= 0 or val <= threshold or val <= med_g * bulk_mult:
                    continue
                # 동일 달 타 연도 반복 여부 확인
                other_same_m = [
                    S_clean[pc][y2].get(m, 0.0)
                    for y2 in S_clean[pc]
                    if y2 != y and S_clean[pc][y2].get(m, 0.0) > 0
                ]
                if any(v > med_g * 1.5 for v in other_same_m):
                    continue  # 반복 패턴 → 계절성이므로 보존
                S_clean[pc][y][m] = med_g  # 비반복 단일 고점 → 중앙값으로 대체

    # ── S5: 다달 계절지수 w[m] ───────────────────────────────────────────────
    # ★ 불완전 연도(cur_y) 제외: cur_y Jan-May만 있으면 Jun-Dec가 0으로 집계되어
    #   6-12월 가중치가 0.5대로 폭락하고 1-5월은 1.4로 뻥튀기됨
    complete_years = [y for y in sorted(set(y for pc in all_products for y in S_clean[pc])) if y < cur_y]

    w_by_year: Dict[int, Dict[int, float]] = {}
    for y in complete_years:
        A_y = {
            m: sum(S_clean[pc][y].get(m, 0.0) for pc in all_products)
            for m in range(1, 13)
        }
        total_y = sum(A_y.values())
        if total_y <= 0:
            continue
        avg_y = total_y / 12
        w_by_year[y] = {m: A_y[m] / avg_y for m in range(1, 13)}

    w_monthly: Dict[int, float] = {}
    for m in range(1, 13):
        wvals = [w_by_year[y][m] for y in w_by_year]
        w_monthly[m] = statistics.mean(wvals) if wvals else 1.0

    # 평균=1로 정규화
    w_mean = statistics.mean(w_monthly.values()) if w_monthly else 1.0
    if w_mean > 0:
        w_monthly = {m: v / w_mean for m, v in w_monthly.items()}

    # ── S6: 성장률 (회사→브랜드→품목 James-Stein 수축) ──────────────────────
    JM = list(range(1, cur_m))   # 올해 완성월 [1..cur_m-1]
    if JM:
        cur_y_for_g, prev_y_for_g, JM_g = cur_y, prev_y, JM
    else:
        cur_y_for_g, prev_y_for_g, JM_g = prev_y, prev_y - 1, list(range(1, 13))

    sum_cur_co = sum(S_clean[pc][cur_y_for_g].get(m, 0.0) for pc in all_products for m in JM_g)
    sum_prev_co = sum(S_clean[pc][prev_y_for_g].get(m, 0.0) for pc in all_products for m in JM_g)
    g_co = (sum_cur_co / sum_prev_co - 1) if sum_prev_co > 0 else 0.0
    g_co = max(P['growth_clamp_lo'], min(P['growth_clamp_hi'], g_co))

    blen = P['brand_prefix_len']
    brands = set(pc[:blen] for pc in all_products if len(pc) >= blen)
    g_brand: Dict[str, float] = {}
    for b in brands:
        bprods = [pc for pc in all_products if len(pc) >= blen and pc[:blen] == b]
        sp = sum(S_clean[pc][prev_y_for_g].get(m, 0.0) for pc in bprods for m in JM_g)
        sc = sum(S_clean[pc][cur_y_for_g].get(m, 0.0) for pc in bprods for m in JM_g)
        g_brand[b] = (sc / sp - 1) if sp >= P['brand_min_volume'] else g_co

    g: Dict[str, float] = {}
    K = float(P['shrink_K'])
    for pc in all_products:
        b = pc[:blen] if len(pc) >= blen else pc
        sp_p = sum(S_clean[pc][prev_y_for_g].get(m, 0.0) for m in JM_g)
        sc_p = sum(S_clean[pc][cur_y_for_g].get(m, 0.0) for m in JM_g)
        g_b = g_brand.get(b, g_co)
        if sp_p < 1:
            g[pc] = g_b
        else:
            raw = sc_p / sp_p - 1
            g[pc] = (sp_p * raw + K * g_b) / (sp_p + K)
        g[pc] = max(P['growth_clamp_lo'], min(P['growth_clamp_hi'], g[pc]))

    # ── S7: 품목별 예측 (YoY × 현재수준 블렌드) ─────────────────────────────
    forecast_yms = [_add_ym(today_ym, i) for i in range(horizon)]
    yoy_ref_y = cur_y - 1   # 직전 완성년

    result: Dict[str, Dict[str, int]] = {}

    for pc in all_products:
        # 비현실 기준수준: 올해 최근 R개월 비계절화 평균
        recent_R = P['level_recent_R']
        recent_ms = [
            m for m in range(max(1, cur_m - recent_R), cur_m)
            if S_clean[pc][cur_y].get(m, 0.0) > 0 and w_monthly.get(m, 0) > 0
        ]
        L_recent = (
            statistics.mean(S_clean[pc][cur_y][m] / w_monthly[m] for m in recent_ms)
            if recent_ms else None
        )

        # 올해 활성월 수
        nC = sum(1 for m in range(1, cur_m) if S_clean[pc][cur_y].get(m, 0.0) > 0)

        # 블렌드 비중
        if nC < P['level_min_active'] or L_recent is None:
            wL = 0.0
        else:
            wL = min(float(P['blend_level_cap']), nC / float(P['blend_ramp_months']))

        pc_result: Dict[str, int] = {}

        if cls[pc] == 'intermittent':
            all_vals = [
                S_clean[pc][y].get(m, 0.0)
                for y in S_clean[pc]
                for m in range(1, 13)
                if S_clean[pc][y].get(m, 0.0) > 0
            ]
            rate = statistics.mean(all_vals) if all_vals else 0.0
            for fym in forecast_yms:
                fm = int(fym[5:7])
                val = rate * w_monthly.get(fm, 1.0) * (1 + g.get(pc, g_co))
                pc_result[fym] = max(int(P['service_floor']), round(val))

        else:
            for fym in forecast_yms:
                fm = int(fym[5:7])

                # YoY 관점
                base_yoy = S_clean[pc][yoy_ref_y].get(fm, 0.0)
                if base_yoy == 0:
                    base_prev2 = S_clean[pc][yoy_ref_y - 1].get(fm, 0.0)
                    if base_prev2 > 0:
                        base_yoy = base_prev2 * (1 + g_co)
                yoy_view = base_yoy * (1 + g.get(pc, g_co))

                # 비현실수준 관점
                level_view = (L_recent * w_monthly.get(fm, 1.0)) if L_recent is not None else 0.0

                forecast_val = (1 - wL) * yoy_view + wL * level_view
                pc_result[fym] = max(int(P['service_floor']), round(forecast_val))

        result[pc] = pc_result

    return result
