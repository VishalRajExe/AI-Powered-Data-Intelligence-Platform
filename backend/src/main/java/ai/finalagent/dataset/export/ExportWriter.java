package ai.finalagent.dataset.export;

import java.io.BufferedWriter;
import java.io.FilterOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import ai.finalagent.dataset.domain.DatasetRows;
import ai.finalagent.workflow.support.Json;

import com.fasterxml.jackson.core.JsonEncoding;
import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.SerializationFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.fasterxml.jackson.datatype.jsr310.JavaTimeModule;
import org.apache.poi.ss.usermodel.Cell;
import org.apache.poi.ss.usermodel.CellType;
import org.apache.poi.ss.usermodel.Sheet;
import org.apache.poi.xssf.streaming.SXSSFWorkbook;

/**
 * Turning dataset rows into a file, one row at a time.
 *
 * <p>All three implementations stream: a writer is handed a row and returns, so the memory a large
 * export costs is the chunk the queue is holding, not the file. That is also why the progress figure
 * beside a running export means something — a row is counted only once it has physically gone
 * through the writer.
 *
 * <p>{@link #finish()} returns the exact byte count written, from a counting stream rather than a
 * later {@code File.length()}, so a truncated write is visible at the point it happens.
 */
public interface ExportWriter {

    void begin(List<DatasetRows.Column> columns, Map<String, Object> meta) throws IOException;

    void write(ExportRow row) throws IOException;

    /** Flushes and closes what is underneath, and reports the bytes written. */
    long finish() throws IOException;

    /** Characters a spreadsheet would otherwise execute. */
    String FORMULA_LEADING = "=+-@\t\r";

    /**
     * RFC 4180 quoting, plus a leading apostrophe on a cell whose text starts like a formula. A
     * dataset field is a string somebody else wrote on a page, which is exactly the input class of
     * CSV injection: {@code =HYPERLINK(…)} in a cell is a click waiting to happen.
     *
     * <p>The apostrophe is applied <em>outside</em> the quotes, because it is Excel's own text-prefix
     * marker rather than content. Inside the quoting it survives into the cell and shows as a stray
     * character while the field is still read as text anyway — the guard applied in the wrong place.
     */
    static String csvCell(String text) {
        String value = text == null ? "" : text;
        boolean formula = !value.isEmpty() && FORMULA_LEADING.indexOf(value.charAt(0)) >= 0;
        boolean needsQuotes = value.indexOf('"') >= 0 || value.indexOf(',') >= 0
                || value.indexOf('\n') >= 0 || value.indexOf('\r') >= 0;
        String cell = needsQuotes ? '"' + value.replace("\"", "\"\"") + '"' : value;
        return formula ? "'" + cell : cell;
    }

    // ---------------------------------------------------------------------- CSV

    final class Csv implements ExportWriter {

        private final Counting out;
        private final BufferedWriter writer;
        private List<DatasetRows.Column> columns = List.of();

        public Csv(OutputStream target) {
            this.out = new Counting(target);
            this.writer = new BufferedWriter(new OutputStreamWriter(out, StandardCharsets.UTF_8));
        }

        @Override
        public void begin(List<DatasetRows.Column> columns, Map<String, Object> meta)
                throws IOException {
            this.columns = List.copyOf(columns);
            // A BOM is not decoration. Without it, Excel reads a UTF-8 CSV in the local code page and
            // every non-ASCII value in the dataset arrives mangled.
            out.write(new byte[]{(byte) 0xEF, (byte) 0xBB, (byte) 0xBF});
            writer.write(header());
            writer.write("\r\n");
        }

        private String header() {
            StringBuilder line = new StringBuilder();
            for (int i = 0; i < columns.size(); i++) {
                if (i > 0) {
                    line.append(',');
                }
                line.append(csvCell(columns.get(i).fieldKey()));
            }
            return line.toString();
        }

        @Override
        public void write(ExportRow row) throws IOException {
            StringBuilder line = new StringBuilder();
            for (int i = 0; i < columns.size(); i++) {
                if (i > 0) {
                    line.append(',');
                }
                line.append(csvCell(row.text(columns.get(i).fieldKey())));
            }
            writer.write(line.toString());
            writer.write("\r\n");
        }

        @Override
        public long finish() throws IOException {
            writer.flush();
            writer.close();
            return out.bytes();
        }
    }

    // ---------------------------------------------------------------------- JSON

    /**
     * The dataset as itself: the contract it was produced under, its columns, and its rows with their
     * provenance still attached. An export that a caller can trace back to a run is the point of the
     * platform, so the JSON form carries the evidence instead of flattening it into a grid.
     */
    final class JsonFile implements ExportWriter {

        /**
         * Carries the JSR-310 module because a source's {@code retrievedAt} is an {@code Instant} and
         * provenance is the whole content of this format: a plain mapper refuses the value, so every
         * export of a dataset with a retrieved page would fail on the first row.
         *
         * <p>ISO-8601 rather than an epoch number, matching what the read APIs return, so the same
         * timestamp in a listing and in an export is the same string.
         */
        private static final com.fasterxml.jackson.databind.ObjectMapper EXPORTING =
                com.fasterxml.jackson.databind.json.JsonMapper.builder()
                        .addModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule())
                        .configure(com.fasterxml.jackson.databind.SerializationFeature
                                .WRITE_DATES_AS_TIMESTAMPS, false)
                        .build();

        private final Counting out;
        private final JsonGenerator generator;
        private final com.fasterxml.jackson.databind.ObjectMapper mapper = EXPORTING;

        public JsonFile(OutputStream target) {
            this.out = new Counting(target);
            try {
                this.generator = mapper.getFactory().createGenerator(out, JsonEncoding.UTF8);
            } catch (IOException e) {
                throw new IllegalStateException("the JSON export could not be opened", e);
            }
        }

        @Override
        public void begin(List<DatasetRows.Column> columns, Map<String, Object> meta)
                throws IOException {
            generator.writeStartObject();
            generator.writeFieldName("dataset");
            generator.writeRawValue(mapper.writeValueAsString(meta));
            generator.writeFieldName("columns");
            generator.writeRawValue(mapper.writeValueAsString(columns.stream().map(
                    column -> Map.of("key", column.fieldKey(),
                            "label", column.label() == null ? column.fieldKey() : column.label(),
                            "type", column.type(),
                            "required", column.required(),
                            "origin", column.origin())).toList()));
            generator.writeFieldName("rows");
            generator.writeStartArray();
        }

        @Override
        public void write(ExportRow row) throws IOException {
            generator.writeStartObject();
            generator.writeNumberField("recordIndex", row.recordIndex());
            generator.writeFieldName("values");
            generator.writeRawValue(mapper.writeValueAsString(row.values()));
            generator.writeFieldName("rawValues");
            generator.writeRawValue(mapper.writeValueAsString(row.rawValues()));
            generator.writeBooleanField("valid", row.valid());
            generator.writeBooleanField("advisoryValid", row.advisoryValid());
            generator.writeStringField("verificationStatus", row.verificationStatus());
            generator.writeNumberField("confidence", row.confidence());
            generator.writeStringField("duplicateOf", row.duplicateOf());
            generator.writeFieldName("sources");
            generator.writeRawValue(mapper.writeValueAsString(row.sources()));
            generator.writeFieldName("issues");
            generator.writeRawValue(mapper.writeValueAsString(row.issues()));
            generator.writeEndObject();
        }

        @Override
        public long finish() throws IOException {
            generator.writeEndArray();
            generator.writeEndObject();
            generator.flush();
            generator.close();
            return out.bytes();
        }
    }

    // ---------------------------------------------------------------------- XLSX

    /**
     * A spreadsheet through POI's streaming writer. Numbers stay numbers, so a sum works, and text
     * carries the same leading-formula guard as CSV — a spreadsheet is precisely where a formula that
     * arrived from a web page would execute.
     */
    final class Xlsx implements ExportWriter {

        private final SXSSFWorkbook book = new SXSSFWorkbook(100);
        private final Sheet sheet = book.createSheet("data");
        private final Counting out;
        private List<DatasetRows.Column> columns = List.of();
        private int nextRow;

        Xlsx(OutputStream target) {
            this.out = new Counting(target);
        }

        @Override
        public void begin(List<DatasetRows.Column> columns, Map<String, Object> meta) {
            this.columns = List.copyOf(columns);
            org.apache.poi.ss.usermodel.Row header = sheet.createRow(nextRow++);
            for (int i = 0; i < this.columns.size(); i++) {
                DatasetRows.Column column = this.columns.get(i);
                header.createCell(i).setCellValue(
                        column.label() == null || column.label().isBlank() ? column.fieldKey()
                                : column.label());
            }
        }

        @Override
        public void write(ExportRow row) {
            org.apache.poi.ss.usermodel.Row target = sheet.createRow(nextRow++);
            for (int i = 0; i < columns.size(); i++) {
                DatasetRows.Column column = columns.get(i);
                Cell cell = target.createCell(i);
                Object value = row.value(column.fieldKey());
                if (value == null) {
                    cell.setCellType(CellType.BLANK);
                } else if (value instanceof Number number) {
                    cell.setCellValue(number.doubleValue());
                } else if (value instanceof Boolean flag) {
                    cell.setCellValue(flag);
                } else {
                    String text = row.text(column.fieldKey());
                    if (!text.isEmpty() && ExportWriter.FORMULA_LEADING.indexOf(text.charAt(0)) >= 0) {
                        text = "'" + text;
                    }
                    cell.setCellValue(text);
                }
            }
        }

        @Override
        public long finish() throws IOException {
            // Written straight through the counting stream rather than via a byte array: the whole
            // point of SXSSF is that a large workbook never exists in memory at once, and buffering it
            // here to measure it would undo that. POI does not close the stream it is handed, so the
            // byte count below is the file's size and the rename that follows publishes it complete.
            book.write(out);
            book.close();
            book.dispose();
            out.flush();
            out.close();
            return out.bytes();
        }
    }

    // ---------------------------------------------------------------------- bytes

    /** An output stream that knows how many bytes it was handed. */
    final class Counting extends FilterOutputStream {

        private long bytes;

        Counting(OutputStream delegate) {
            super(delegate);
        }

        @Override
        public void write(int one) throws IOException {
            out.write(one);
            bytes++;
        }

        @Override
        public void write(byte[] b, int off, int len) throws IOException {
            out.write(b, off, len);
            bytes += len;
        }

        @Override
        public void write(byte[] b) throws IOException {
            write(b, 0, b.length);
        }

        long bytes() {
            return bytes;
        }
    }
}
