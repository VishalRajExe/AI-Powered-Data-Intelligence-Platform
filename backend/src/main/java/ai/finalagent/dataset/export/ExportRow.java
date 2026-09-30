package ai.finalagent.dataset.export;

import java.io.BufferedWriter;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import ai.finalagent.workflow.support.Json;

import com.fasterxml.jackson.core.JsonEncoding;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Row;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;

/**
 * One exported row, already joined with its evidence.
 *
 * <p>The runner assembles this so no writer has to reach back at the database, and so a format that
 * cannot carry provenance (CSV, XLSX) and one that can (JSON) are reading the same row rather than
 * two different views of it.
 */
public record ExportRow(int recordIndex, Map<String, Object> values, Map<String, Object> rawValues,
                        boolean valid, boolean advisoryValid, String verificationStatus,
                        Double confidence, String duplicateOf, List<Map<String, Object>> sources,
                        List<Map<String, Object>> issues) {

    public ExportRow {
        values = values == null ? Map.of() : Map.copyOf(values);
        rawValues = rawValues == null ? Map.of() : Map.copyOf(rawValues);
        sources = sources == null ? List.of() : List.copyOf(sources);
        issues = issues == null ? List.of() : List.copyOf(issues);
    }

    /** A cell's text, for the grid formats: structures are serialised, nulls are empty. */
    public String text(String key) {
        Object value = values.get(key);
        if (value == null) {
            return "";
        }
        if (value instanceof Map || value instanceof List) {
            return Json.write(value);
        }
        return String.valueOf(value);
    }

    public Object value(String key) {
        return values.get(key);
    }
}
