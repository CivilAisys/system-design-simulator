package simulator.engine;

/**
 * 拓撲格式錯誤（spec 4.5）：錯誤沒辦法指到哪一個節點或邊。engine 在 id 重複時丟出，
 * api 模組在缺少必填欄位、版本不支援時也用它。API 只把這個例外回成 HTTP 400，其他例外是程式錯誤。
 */
public class TopologyFormatException extends IllegalArgumentException {

    public TopologyFormatException(String message) {
        super(message);
    }
}
