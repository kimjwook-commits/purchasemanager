"""
출고예측 교정 알고리즘 C1-C7 (명세서 v1)
로버스트 기준선(비계절화 평균) + 계절지수 × 성장률

이전 v5 대비 핵심 변경:
  C3: 현재연도 실적 비계절화 평균 = 기준선 (구: YoY × level 블렌드)
  C5: L[p] × w[m] × growth_factor  (구: YoY + level 혼합)
  품목 분류(regular/intermittent) 제거 — 단일 경로로 통일

입출력 단위: qty_boxes (DB 저장 단위와 동일; 명세서 병→박스 환산 불필요)
"""
from typing import Dict, List, Optional
from collections import defaultdict
import statistics

# ── CONFIG ─────────────────────────────────────────────────────────────────────
CONFIG: Dict = {
    # C1.1 이웃달 고점 평탄화
    'spike_neighbor_mult': 2.5,   # 이웃 중앙값 대비 이 배수 초과 → 스파이크
    'spike_cap':           1.3,   # 스파이크 대체값 = 이웃 중앙값 × cap
    # C1.2 캐치업 (함몰→급증 패턴)
    'dip_ratio':    0.6,
    'rebound_ratio': 1.3,
    'conserve_tol': 0.4,
    # C1.3 연도간 일회성
    'onetime_year_mult': 3.0,
    'onetime_min_diff':  17,    # 박스 (명세서 200병 ÷ ~12 ≈ 17)
    # C1.4 로버스트 벌크(MAD)
    'bulk_mad_k':    4.0,
    'bulk_min_mult': 1.8,
    # C4 성장률 James-Stein 수축
    'brand_prefix_len':  5,
    'brand_min_volume':  5,     # 박스 (명세서 50병 ÷ ~12 ≈ 4)
    'shrink_K':          150,
    'growth_clamp_lo':  -0.6,
    'growth_clamp_hi':   1.5,
    # C5 예측
    'apply_growth': True,
    # C7 진단 (시스템 대비 과탐지)
    'over_ratio': 1.8,
}

# 하위 호환 별칭
DEFAULT_PARAMS = CONFIG


def _add_ym(ym: str, n: int) -> str:
    y, m = int(ym[:4]), int(ym[5:7])
    m += n
    while m > 12: m -= 12; y += 1
    while m < 1:  m += 12; y -= 1
    return f"{y:04d}-{m:02d}"


def run_demand_forecast(
    demand_rows: List[Dict],
    today_ym: str,
    horizon: int = 6,
    params: Optional[Dict] = None,
) -> Dict[str, Dict[str, int]]:
    """
    C1-C7 교정 알고리즘으로 품목별 월별 출고량 예측.

    demand_rows: [{'product_code': str, 'ym': 'YYYY-MM', 'qty_boxes': int}]
    today_ym:   현재 월 (미완성, 이 달 이전 완성월만 입력으로 사용)
    반환:       {product_code: {'YYYY-MM': forecast_qty_boxes}}
    """
    P = {**CONFIG, **(params or {})}
    if params and 'forecast_horizon' in params:
        horizon = int(params['forecast_horizon'])

    last_complete = _add_ym(today_ym, -1)
    cur_y = int(today_ym[:4])
    cur_m = int(today_ym[5:7])
    prev_y = cur_y - 1

    # ── 0. 데이터 로드: S[pc][year][month] ───────────────────────────────────
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

    # ── C1: 로버스트 정제 → S_clean ──────────────────────────────────────────
    S_clean: Dict[str, Dict[int, Dict[int, float]]] = defaultdict(
        lambda: defaultdict(lambda: defaultdict(float))
    )
    for pc in all_products:
        for y, yd in S[pc].items():
            for m, qty in yd.items():
                S_clean[pc][y][m] = qty

    # C1.1: 이웃달 고점 평탄화 (같은 해 m±2 범위 이웃 중앙값 기준)
    for pc in all_products:
        for y in list(S[pc].keys()):
            for m in range(1, 13):
                val = S[pc][y].get(m, 0.0)
                if val <= 0:
                    continue
                neighbors = [
                    S[pc][y].get(nm, 0.0)
                    for nm in range(max(1, m - 2), min(13, m + 3))
                    if nm != m and S[pc][y].get(nm, 0.0) > 0
                ]
                if len(neighbors) < 2:
                    continue
                nb_med = statistics.median(neighbors)
                if nb_med > 0 and val > nb_med * P['spike_neighbor_mult']:
                    S_clean[pc][y][m] = nb_med * P['spike_cap']

    # C1.2: 캐치업 보존 (함몰→급증 패턴 평탄화, 합계 보존)
    for pc in all_products:
        for y in list(S_clean[pc].keys()):
            active_y = sorted(m for m in range(1, 13) if S_clean[pc][y].get(m, 0.0) > 0)
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
                # 함몰 구간 끝 탐색
                b_idx = i
                while b_idx + 1 < len(active_y):
                    if S_clean[pc][y].get(active_y[b_idx + 1], 0.0) < local_base * P['dip_ratio']:
                        b_idx += 1
                    else:
                        break
                # 반등 탐색
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

    # C1.3: 연도간 일회성 이벤트 제거
    def is_one_time(pc: str, m: int) -> bool:
        vals = sorted(
            [(y, S_clean[pc][y].get(m, 0.0)) for y in S_clean[pc] if S_clean[pc][y].get(m, 0.0) > 0],
            key=lambda x: x[0]
        )
        if len(vals) < 2:
            return False
        values = [v for _, v in vals]
        hi, lo = max(values), min(values)
        return hi > lo * P['onetime_year_mult'] and hi - lo > P['onetime_min_diff']

    for pc in all_products:
        for m in range(1, 13):
            if not is_one_time(pc, m):
                continue
            vals_by_y = {y: S_clean[pc][y].get(m, 0.0) for y in S_clean[pc] if S_clean[pc][y].get(m, 0.0) > 0}
            if len(vals_by_y) < 2:
                continue
            max_y = max(vals_by_y, key=vals_by_y.get)   # type: ignore[arg-type]
            min_val = min(vals_by_y.values())
            S_clean[pc][max_y][m] = min_val

    # C1.4: 로버스트 벌크 제거 (전체 분포 MAD 기준)
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
                # 동일 달 타 연도 반복 여부 확인 (계절성이면 보존)
                other_same_m = [
                    S_clean[pc][y2].get(m, 0.0)
                    for y2 in S_clean[pc]
                    if y2 != y and S_clean[pc][y2].get(m, 0.0) > 0
                ]
                if any(v > med_g * 1.5 for v in other_same_m):
                    continue
                S_clean[pc][y][m] = med_g

    # ── C2: 계절지수 w[m] (완성연도만, 정규화 평균=1) ─────────────────────────
    complete_years = sorted(set(
        y for pc in all_products for y in S_clean[pc] if y < cur_y
    ))

    w_by_year: Dict[int, Dict[int, float]] = {}
    for y in complete_years:
        A_y = {m: sum(S_clean[pc][y].get(m, 0.0) for pc in all_products) for m in range(1, 13)}
        total_y = sum(A_y.values())
        if total_y <= 0:
            continue
        avg_y = total_y / 12
        w_by_year[y] = {m: A_y[m] / avg_y for m in range(1, 13)}

    w: Dict[int, float] = {}
    for m in range(1, 13):
        wvals = [w_by_year[y][m] for y in w_by_year]
        w[m] = statistics.mean(wvals) if wvals else 1.0

    w_mean = statistics.mean(w.values()) if w else 1.0
    if w_mean > 0:
        w = {m: v / w_mean for m, v in w.items()}

    # ── 사전 g_co (C3 fallback용 회사 전체 성장률) ───────────────────────────
    JM = list(range(1, cur_m))          # 올해 완성월
    if JM:
        y_c, y_p, JM_g = cur_y, prev_y, JM
    else:
        y_c, y_p, JM_g = prev_y, prev_y - 1, list(range(1, 13))

    sum_cur  = sum(S_clean[pc][y_c].get(m, 0.0) for pc in all_products for m in JM_g)
    sum_prev = sum(S_clean[pc][y_p].get(m, 0.0) for pc in all_products for m in JM_g)
    g_co = (sum_cur / sum_prev - 1) if sum_prev > 0 else 0.0
    g_co = max(P['growth_clamp_lo'], min(P['growth_clamp_hi'], g_co))

    # ── C3: 기준선 L[p] (현재연도 비계절화 평균; fallback=전년×g_co) ──────────
    L: Dict[str, float] = {}
    flags: Dict[str, list] = {pc: [] for pc in all_products}

    for pc in all_products:
        # 올해 완성월 (비영 & 계절지수 > 0)
        cur_months = [
            m for m in range(1, cur_m)
            if S_clean[pc][cur_y].get(m, 0.0) > 0 and w.get(m, 0.0) > 0
        ]
        if cur_months:
            L[pc] = statistics.mean(
                S_clean[pc][cur_y][m] / w[m] for m in cur_months
            )
        else:
            # fallback: 전년 비계절화 평균 × (1 + g_co)
            prev_months = [
                m for m in range(1, 13)
                if S_clean[pc][prev_y].get(m, 0.0) > 0 and w.get(m, 0.0) > 0
            ]
            if prev_months:
                L[pc] = statistics.mean(
                    S_clean[pc][prev_y][m] / w[m] for m in prev_months
                ) * (1 + g_co)
                flags[pc].append('fallback_prevyear')
            else:
                L[pc] = 0.0

    # ── C4: 성장률 g[p] (James-Stein 브랜드→품목 수축) ──────────────────────
    blen   = P['brand_prefix_len']
    brands = set(pc[:blen] for pc in all_products if len(pc) >= blen)
    g_brand: Dict[str, float] = {}
    for b in brands:
        bprods = [pc for pc in all_products if len(pc) >= blen and pc[:blen] == b]
        sp = sum(S_clean[pc][y_p].get(m, 0.0) for pc in bprods for m in JM_g)
        sc = sum(S_clean[pc][y_c].get(m, 0.0) for pc in bprods for m in JM_g)
        g_brand[b] = (sc / sp - 1) if sp >= P['brand_min_volume'] else g_co

    K = float(P['shrink_K'])
    g: Dict[str, float] = {}
    for pc in all_products:
        b    = pc[:blen] if len(pc) >= blen else pc
        sp_p = sum(S_clean[pc][y_p].get(m, 0.0) for m in JM_g)
        sc_p = sum(S_clean[pc][y_c].get(m, 0.0) for m in JM_g)
        g_b  = g_brand.get(b, g_co)
        if sp_p < 1:
            g[pc] = g_b
        else:
            raw  = sc_p / sp_p - 1
            g[pc] = (sp_p * raw + K * g_b) / (sp_p + K)
        g[pc] = max(P['growth_clamp_lo'], min(P['growth_clamp_hi'], g[pc]))

    # ── C5: 월별 예측 corrected[p][ym] = L × w × growth_factor ──────────────
    forecast_yms  = [_add_ym(today_ym, i) for i in range(horizon)]
    apply_growth  = bool(P.get('apply_growth', True))

    result: Dict[str, Dict[str, int]] = {}

    for pc in all_products:
        if L.get(pc, 0.0) <= 0:
            continue
        pc_result: Dict[str, int] = {}
        for fym in forecast_yms:
            fm        = int(fym[5:7])
            fy        = int(fym[:4])
            yrs_ahead = fy - cur_y                         # 0(올해) or 1+(내년~)
            growth_factor = (1 + g.get(pc, g_co)) ** yrs_ahead if apply_growth else 1.0
            val = L[pc] * w.get(fm, 1.0) * growth_factor
            pc_result[fym] = max(0, round(val))
        result[pc] = pc_result

    return result
