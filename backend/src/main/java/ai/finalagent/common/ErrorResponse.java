package ai.finalagent.common;

import java.util.List;

/**
 * The single error envelope for every API response: {@code {"error": {code, message, details}}}.
 * Messages are actionable and never contain a stack trace or a secret.
 */
public record ErrorResponse(ErrorBody error) {

    public record ErrorBody(String code, String message, List<Object> details) {
    }

    public static ErrorResponse of(String code, String message) {
        return new ErrorResponse(new ErrorBody(code, message, List.of()));
    }

    public static ErrorResponse of(String code, String message, List<Object> details) {
        return new ErrorResponse(new ErrorBody(code, message, details));
    }
}
