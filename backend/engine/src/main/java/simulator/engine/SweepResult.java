package simulator.engine;

import java.util.List;

/**
 * 一次負載掃描的結果（spec 4.10）。拓撲有驗證錯誤時 {@code valid} 為 false，{@code points} 為空、門檻為 null。
 *
 * @param currentRps 目前所有 Client 的 rps 加總（倍率 1）
 * @param points 依倍率排序：均分的點，加上門檻那幾點
 * @param warn 第一個節點 ρ 到 0.7 的位置；範圍內沒有到時為 null
 * @param overload 第一個節點過載（ρ 到 1）的位置；範圍內沒有到時為 null
 */
public record SweepResult(boolean valid, List<ValidationError> errors, double currentRps, List<SweepPoint> points,
        SweepThreshold warn, SweepThreshold overload) {

    static SweepResult invalid(List<ValidationError> errors) {
        return new SweepResult(false, errors, 0, List.of(), null, null);
    }
}
