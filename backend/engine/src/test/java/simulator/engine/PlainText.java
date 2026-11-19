package simulator.engine;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** 測試用：白話模板（spec 4.9）的檢查，以及照前端的格式代入數字，用來比對整句。 */
final class PlainText {

    // {符號}、{=}、{@符號}
    private static final Pattern PLACEHOLDER = Pattern.compile("\\{([^}]+)}");
    private static final String RESULT = "=";
    private static final String NAME = "@";

    private PlainText() {
    }

    /**
     * 代入後的一句。數字的格式和前端的代入值相同：rps 取整數加千分位、ms 一位小數、比例一位小數加 %（接近 0 或 100% 時寫
     * 「< 0.1%」「> 99.9%」）、沒有單位的整數加千分位，其他兩位小數、days 寫成「約 116 天」。bytes 不在這裡比對。
     */
    static String render(ExplanationStep step, Function<String, String> nodeName) {
        Matcher matcher = PLACEHOLDER.matcher(step.plain());
        var text = new StringBuilder();
        while (matcher.find()) {
            String symbol = matcher.group(1);
            String replacement;
            if (symbol.equals(RESULT)) {
                replacement = format(step.value(), step.unit());
            } else if (symbol.startsWith(NAME)) {
                replacement = nodeName.apply(term(step, symbol.substring(1)).nodeId());
            } else {
                ExplanationTerm term = term(step, symbol);
                replacement = format(term.value(), term.unit());
            }
            matcher.appendReplacement(text, Matcher.quoteReplacement(replacement));
        }
        matcher.appendTail(text);
        return text.toString();
    }

    static String render(ExplanationStep step, Map<String, String> names) {
        return render(step, names::get);
    }

    /**
     * 每一步的白話和顯示模式對得上：只在看公式顯示的沒有白話，其他都有；白話裡的 {符號} 都在 terms 裡，{@符號} 的代入值有
     * nodeId，{=} 只出現在有結果的步驟；terms 先是公式裡的依序排列，接著的只有白話用到。
     */
    static void assertConsistent(String where, ExplanationStep step) {
        List<String> formulaSymbols = placeholders(step.formula());
        List<String> termSymbols = step.terms().stream().map(ExplanationTerm::symbol).toList();
        assertThat(termSymbols.subList(0, Math.min(formulaSymbols.size(), termSymbols.size())))
                .as("%s: %s formula", where, step.label()).containsExactlyElementsOf(formulaSymbols);
        if (step.view() == ExplanationView.FORMULA) {
            assertThat(step.plain()).as("%s: %s", where, step.label()).isNull();
            assertThat(termSymbols).as("%s: %s", where, step.label()).hasSameSizeAs(formulaSymbols);
            return;
        }
        assertThat(step.plain()).as("%s: %s", where, step.label()).isNotBlank();
        Set<String> used = new HashSet<>(formulaSymbols);
        for (String symbol : placeholders(step.plain())) {
            if (symbol.equals(RESULT)) {
                assertThat(step.value()).as("%s: %s 用了 {=}", where, step.label()).isNotNull();
            } else if (symbol.startsWith(NAME)) {
                assertThat(term(step, symbol.substring(1)).nodeId()).as("%s: %s {%s}", where, step.label(), symbol)
                        .isNotNull();
            } else {
                assertThat(termSymbols).as("%s: %s", where, step.label()).contains(symbol);
                used.add(symbol);
            }
        }
        // 公式沒用到的代入值，白話一定要用到
        assertThat(used).as("%s: %s 沒用到的代入值", where, step.label()).containsAll(termSymbols);
    }

    private static List<String> placeholders(String text) {
        return PLACEHOLDER.matcher(text).results().map(match -> match.group(1)).toList();
    }

    private static ExplanationTerm term(ExplanationStep step, String symbol) {
        return step.terms().stream().filter(term -> term.symbol().equals(symbol)).findFirst()
                .orElseThrow(() -> new AssertionError("No term " + symbol + " in " + step));
    }

    private static String format(Double value, String unit) {
        if (value == null) {
            return "—";
        }
        if (unit == null) {
            return value == Math.rint(value) ? String.format("%,d", value.longValue()) : String.format("%.2f", value);
        }
        return switch (unit) {
            case "rps" -> String.format("%,d", Math.round(value));
            case "ms" -> String.format("%.1f", value);
            case "%" -> {
                String text = String.format("%.1f%%", value * 100);
                if (value > 0 && text.equals("0.0%")) {
                    yield "< 0.1%";
                }
                yield value < 1 && text.equals("100.0%") ? "> 99.9%" : text;
            }
            case "days" -> value < 1 ? "不到 1 天"
                    : value < 100 ? String.format("約 %.1f 天", value) : String.format("約 %,d 天", Math.round(value));
            default -> throw new IllegalArgumentException("Not compared here: " + unit);
        };
    }
}
