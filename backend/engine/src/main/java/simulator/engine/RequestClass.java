package simulator.engine;

/** Service 的邊只給哪個 class 的請求呼叫（spec 3.4）。 */
public enum RequestClass {
    ALL,
    READ,
    WRITE;

    /** 這個 class（read 或 write）的請求會不會走這條邊。 */
    public boolean includes(boolean read) {
        return switch (this) {
            case ALL -> true;
            case READ -> read;
            case WRITE -> !read;
        };
    }
}
