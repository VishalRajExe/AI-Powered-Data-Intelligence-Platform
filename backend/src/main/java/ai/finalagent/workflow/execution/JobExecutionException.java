package ai.finalagent.workflow.execution;

/**
 * A step failure, carrying whether another attempt could plausibly help.
 *
 * <p>The distinction matters because the retry vocabulary came from the old project's contract
 * unchanged: {@code TIMEOUT}, {@code RATE_LIMIT}, {@code TRANSIENT_NETWORK}, {@code SERVER_ERROR}
 * are worth another attempt; a robots refusal, an exhausted schema repair or a rejected request are
 * not, and retrying them spends Firecrawl credits to arrive at the same answer. Anything not
 * listed here is treated as permanent, so an unclassified failure cannot quietly become an
 * infinite loop.
 */
public class JobExecutionException extends RuntimeException {

    public static final String TIMEOUT = "TIMEOUT";
    public static final String RATE_LIMIT = "RATE_LIMIT";
    public static final String TRANSIENT_NETWORK = "TRANSIENT_NETWORK";
    public static final String SERVER_ERROR = "SERVER_ERROR";

    private final String code;
    private final boolean retryable;

    public JobExecutionException(String code, String message, boolean retryable) {
        super(message);
        this.code = code;
        this.retryable = retryable;
    }

    public JobExecutionException(String code, String message, boolean retryable, Throwable cause) {
        super(message, cause);
        this.code = code;
        this.retryable = retryable;
    }

    public String code() {
        return code;
    }

    public boolean retryable() {
        return retryable;
    }

    public static JobExecutionException permanent(String code, String message) {
        return new JobExecutionException(code, message, false);
    }

    public static JobExecutionException transientFailure(String code, String message) {
        return new JobExecutionException(code, message, true);
    }

    /** Status classification for an AI-service call that failed at the HTTP layer. */
    public static JobExecutionException fromHttpStatus(int status, String message) {
        return switch (status) {
            case 408 -> transientFailure(TIMEOUT, message);
            case 429 -> transientFailure(RATE_LIMIT, message);
            case 502, 503, 504 -> transientFailure(SERVER_ERROR, message);
            // 400/422 mean the request itself was rejected: another attempt sends the same
            // rejected bytes. 500 is treated as permanent for the same reason — a crash in the
            // service is a code fault, not a transient one, and looping on it hides it.
            default -> permanent("AI_SERVICE_REJECTED", message);
        };
    }
}
