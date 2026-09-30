package ai.finalagent.dataset.export;

/**
 * The three formats an export can take, and the two things every one of them has to answer:
 * what the browser is told the file is, and what it is called on disk.
 *
 * <p>The extension is not cosmetic — a caller who renames a CSV to {@code .xlsx} and opens it in a
 * spreadsheet gets a corrupt-file warning, so the extension is derived from the format rather than
 * accepted from the request.
 */
public enum ExportFormat {

    CSV("text/csv; charset=UTF-8", "csv"),
    JSON("application/json", "json"),
    XLSX("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx");

    ExportFormat(String contentType, String extension) {
        this.contentType = contentType;
        this.extension = extension;
    }

    private final String contentType;
    private final String extension;

    public String contentType() {
        return contentType;
    }

    public String extension() {
        return extension;
    }

    public static ExportFormat of(String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("an export needs a format: CSV, JSON or XLSX");
        }
        return switch (value.trim().toUpperCase()) {
            case "CSV" -> CSV;
            case "JSON" -> JSON;
            case "XLSX", "EXCEL" -> XLSX;
            default -> throw new IllegalArgumentException("unsupported export format '" + value
                    + "'; this build writes CSV, JSON and XLSX");
        };
    }
}
