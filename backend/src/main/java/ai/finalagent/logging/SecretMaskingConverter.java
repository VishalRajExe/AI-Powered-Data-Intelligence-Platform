package ai.finalagent.logging;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ch.qos.logback.classic.pattern.ClassicConverter;
import ch.qos.logback.classic.spi.ILoggingEvent;

/**
 * Masks credential-shaped content before it reaches any log sink. Ported requirement from the
 * old project's Pino masking, widened: JDBC failure messages and outbound request dumps both
 * leaked values there.
 */
public class SecretMaskingConverter extends ClassicConverter {

    private static final String REPLACEMENT = "***";

    /** {@code apiKey: "abcd"}, {@code password=abcd}, {@code "token":"abcd"} and friends. */
    private static final Pattern KEY_VALUE = Pattern.compile(
            "(?i)(\"?[a-z0-9_]*(api[_-]?key|password|passwd|secret|token|authorization|cookie)[a-z0-9_]*\"?\\s*[:=]\\s*)(\"?)([^\"'\\s,;}&]+)(\"?)");

    /** Bare provider key shapes, so a value logged alone is still caught. */
    private static final Pattern KEY_SHAPE = Pattern.compile(
            "\\b(fc-[A-Za-z0-9_-]{8,}|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{4,}\\.[A-Za-z0-9_-]{4,})\\b");

    /** user:pass@host connection strings. */
    private static final Pattern URL_CREDENTIALS = Pattern.compile(
            "(?i)://([^:/\\s]+):([^@\\s]+)@");

    @Override
    public String convert(ILoggingEvent event) {
        try {
            return mask(event.getFormattedMessage());
        } catch (RuntimeException e) {
            return "[unformattable log event]";
        }
    }

    public static String mask(String message) {
        if (message == null || message.isEmpty()) {
            return message;
        }
        String masked = replaceAll(KEY_VALUE, message, m -> m.group(1) + m.group(3) + REPLACEMENT + m.group(5));
        masked = replaceAll(URL_CREDENTIALS, masked, m -> "://" + m.group(1) + ":" + REPLACEMENT + "@");
        masked = replaceAll(KEY_SHAPE, masked, m -> REPLACEMENT);
        return masked;
    }

    private static String replaceAll(Pattern pattern, String input, java.util.function.Function<Matcher, String> replacer) {
        Matcher matcher = pattern.matcher(input);
        StringBuilder out = new StringBuilder();
        while (matcher.find()) {
            matcher.appendReplacement(out, Matcher.quoteReplacement(replacer.apply(matcher)));
        }
        matcher.appendTail(out);
        return out.toString();
    }
}
